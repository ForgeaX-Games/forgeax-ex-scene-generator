import { createRuntime, createBatteryLoader, OpRegistry, ProjectRegistry } from '@forgeax/node-runtime'
import type { Runtime, BatteryLoader, LoaderEvent } from '@forgeax/node-runtime'
import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import { resolveBatteryScanRoots } from '@forgeax/editor-host/backend'
import { createBakerServices } from './services/baker-context.js'
import { createPartsRegistry } from './services/parts-registry.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')

export function resolveWorkspaceRoot(): string {
  return process.env.FORGEAX_PROJECT_ROOT ?? resolve(repoRoot, '.forgeax-runtime')
}

const PLUGIN_ID = '@forgeax-plugin/wb-3d-lowpoly'

let registry: ProjectRegistry | null = null
let sharedOps: OpRegistry | null = null
// Retained so the dev-mode chokidar watcher keeps running for the process
// lifetime; without a reference it would be GC-eligible and stop emitting.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- write-only keepalive ref, see comment above
let batteryLoader: BatteryLoader | null = null
// The chokidar watcher's teardown fn (closes the fs watch). Held so a graceful
// shutdown can release it — an OPEN watcher keeps the Node event loop alive, so
// short-lived processes (smoke scripts, ephemeral backends) would otherwise hang
// after `app.close()`. Wired to the app's onClose hook in main.ts.
let stopWatch: (() => void) | null = null

/**
 * Whether to hot-reload batteries during development. The kernel loader already
 * supports chokidar watch; we enable it outside production/test so editing a
 * battery's meta.json / index.ts live-refreshes the shared OpRegistry without a
 * backend restart. `FORGEAX_BATTERY_WATCH=1|0` force-overrides the heuristic.
 */
function batteryWatchEnabled(): boolean {
  const flag = process.env.FORGEAX_BATTERY_WATCH
  if (flag === '1' || flag === 'true') return true
  if (flag === '0' || flag === 'false') return false
  const env = process.env.NODE_ENV
  return env !== 'production' && env !== 'test'
}

// Mirror the loader's registry diff to every connected WS client so the editor
// can refetch /api/v1/ops. Lazy-imported to avoid a circular module load
// (routes/ws.js imports getRuntime from here).
function broadcastLoaderEvent(event: LoaderEvent): void {
  if (event.kind === 'scan-error') {
    console.warn(`[battery watch] scan error ${event.error.dir}: ${event.error.reason}`)
    return
  }
  console.log(`[battery watch] ${event.kind} ${event.opId}`)
  void import('./routes/ws.js')
    .then((m) => m.broadcastToClients({ event: 'ops:changed', payload: { kind: event.kind, opId: event.opId } }))
    .catch(() => {})
}

async function buildSharedOps(): Promise<OpRegistry> {
  const ops = new OpRegistry()
  const watch = batteryWatchEnabled()
  const loader = createBatteryLoader(ops, {
    pluginId: PLUGIN_ID,
    scanDirs: resolveBatteryScanRoots(repoRoot),
    layout: 'flexible',
    watch,
  })
  const res = await loader.scan()
  for (const e of res.errors) console.warn(`[battery skip] ${e.dir}: ${e.reason}`)
  console.log(`[runtime] loaded ${res.added} ops (${res.errors.length} skipped)${watch ? ' [hot-reload on]' : ''}`)
  if (watch) {
    batteryLoader = loader
    loader.subscribe(broadcastLoaderEvent)
    stopWatch = loader.startWatching()
  }
  return ops
}

/**
 * Stop the dev battery watcher (closes the chokidar fs watch). Idempotent.
 * Registered on the Fastify `onClose` hook so `app.close()` lets the process
 * exit cleanly instead of being held open by the watcher's event loop handles.
 */
export function stopBatteryWatch(): void {
  if (stopWatch) {
    stopWatch()
    stopWatch = null
  }
  batteryLoader = null
}

export async function getProjectRegistry(): Promise<ProjectRegistry> {
  if (registry) return registry
  const workspaceRoot = resolveWorkspaceRoot()
  // Content-addressed blob root for baked meshes; served by GET /api/v1/library/blob.
  const libRoot = join(workspaceRoot, 'library')
  const bakerServices = createBakerServices(libRoot)
  sharedOps = sharedOps ?? (await buildSharedOps())
  const ops = sharedOps
  const reg = new ProjectRegistry({
    workspaceRoot,
    defaultType: 'lowpoly',
    defaultProjectName: 'Default Lowpoly',
    defaultProjectId: 'main',
    legacyStateDir: 'state',
    createRuntime: (req) =>
      createRuntime({
        projectRoot: workspaceRoot,
        pipelineId: req.pipelineId,
        pluginId: PLUGIN_ID,
        registry: ops,
        // Inject the baker/library bag so g_to_urdf can tessellate composites into
        // real OBJ meshes instead of falling back to AABB boxes. Also inject a
        // per-project parts registry (state/parts.json, sibling of graph.json) so
        // g_bake_part can auto-register every baked mesh for cheap discovery via
        // lowpoly:parts.list and for mesh-aware QC. Generic kernel seam.
        createExecutionContext: (base) => {
          const graphAbs = isAbsolute(req.graphFile) ? req.graphFile : join(workspaceRoot, req.graphFile)
          const parts = createPartsRegistry(dirname(graphAbs))
          // g_texture 的 image 路径约定相对 <projectDir>/assets/textures/ 解析；g_bake_object
          // 读贴图字节时需要这个基准目录。与下方 layout.assetsDir 用同一套推导，保持两者一致。
          const assetsDir = join(dirname(dirname(graphAbs)), 'assets')
          return { ...base, services: { ...bakerServices, parts, assetsDir } }
        },
        layout: {
          graphFile: req.graphFile,
          historyFile: req.historyFile,
          outputsDir: req.outputsDir,
          // Without an explicit assetsDir, the kernel defaults every project's
          // AssetResolver to `<workspaceRoot>/assets` — the SAME shared folder
          // for every project, since `projectRoot` above is always the global
          // workspaceRoot (per-project isolation only happens via the `layout`
          // overrides). That silently broke `lowpoly:assets.list` for any
          // non-default project: `lowpoly:export-glb` / the screenshot cache
          // write under this project's OWN dir (`getProjectDir()` in
          // agent/routes.ts, i.e. two segments up from graphFile), but
          // assets.list was scanning the wrong (global) folder and would never
          // find them — the "path" mismatch agents hit after exporting a GLB
          // and then trying to list/verify it. Deriving assetsDir the same way
          // `getProjectDir()` does keeps both in lockstep.
          assetsDir: join(dirname(dirname(req.graphFile)), 'assets'),
        },
      }),
  })
  reg.init()
  registry = reg
  return reg
}

/** The UI viewing project's Runtime (legacy alias). */
export async function getRuntime(): Promise<Runtime> {
  const reg = await getProjectRegistry()
  return reg.getViewingRuntime()
}

export async function getRuntimeForProject(projectId: string): Promise<Runtime> {
  const reg = await getProjectRegistry()
  if (!reg.getProject(projectId)) throw new Error(`project not found: ${projectId}`)
  return reg.getRuntimeFor(projectId)
}

export async function getViewingProjectDir(): Promise<string> {
  const reg = await getProjectRegistry()
  const ws = resolveWorkspaceRoot()
  const id = reg.getViewingProjectId()
  const rec = id ? reg.getProject(id) : null
  const graphRel = rec?.manifest.storage.graphFile ?? join('state', 'graph.json')
  const graphAbs = isAbsolute(graphRel) ? graphRel : join(ws, graphRel)
  return dirname(dirname(graphAbs))
}

/** @deprecated Use getViewingProjectDir(). */
export async function getActiveProjectDir(): Promise<string> {
  return getViewingProjectDir()
}

export async function getProjectDir(id: string): Promise<string | null> {
  const reg = await getProjectRegistry()
  const rec = reg.getProject(id)
  if (!rec) return null
  const ws = resolveWorkspaceRoot()
  const graphRel = rec.manifest.storage.graphFile
  const graphAbs = isAbsolute(graphRel) ? graphRel : join(ws, graphRel)
  return dirname(dirname(graphAbs))
}

export function resetRuntimeForTests(): void {
  registry = null
  sharedOps = null
  stopBatteryWatch()
}
