import { createRuntime, createBatteryLoader, OpRegistry, ProjectRegistry } from '@forgeax/node-runtime'
import type { Runtime, BatteryLoader, LoaderEvent } from '@forgeax/node-runtime'
import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { resolveBatteryScanRoots } from '@forgeax/editor-host/backend'
import { copyGeneratedImage, readImageBytesFromRef, writeProcessedImage, createGeneratedImage, resolveGrayscaleRoot } from './assets/generatedAssets.js'
import { encodePng, decodeImageBytes, type DecodedImage } from './utils/png_codec.js'
import { generateImageAsset } from './ai/imageGeneration.js'
import { matteImage } from './ai/matting.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')

/** Workspace root holding all projects. Read at call-time so tests/smokes that
 *  set FORGEAX_PROJECT_ROOT before the first backend call get isolation. */
export function resolveWorkspaceRoot(): string {
  return process.env.FORGEAX_PROJECT_ROOT ?? resolve(repoRoot, '.forgeax-runtime')
}

const PLUGIN_ID = '@forgeax-plugin/wb-2d-scene-asset-generator'

let registry: ProjectRegistry | null = null
let sharedOps: OpRegistry | null = null
// Retained so the dev-mode chokidar watcher keeps running for the process
// lifetime; without a reference it would be GC-eligible and stop emitting.
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

// Scan the plugin's batteries ONCE into a shared OpRegistry; every per-project
// runtime reuses it, so opening a project never re-scans ops. In dev the same
// loader keeps a chokidar watch so battery edits hot-reload the registry.
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

/**
 * The workspace's multi-project registry. Backs every route: project CRUD,
 * activate, and `getRuntime()` (the active project's runtime). On first init it
 * backfills a default project ('main') that points at the existing implicit
 * `<workspaceRoot>/state/graph.json`, so current users keep their work.
 */
export async function getProjectRegistry(): Promise<ProjectRegistry> {
  if (registry) return registry
  // Read FORGEAX_PROJECT_ROOT at build time (not module-load) so tests/smokes
  // that set it before the first backend call get their isolated workspace.
  const workspaceRoot = resolveWorkspaceRoot()
  sharedOps = sharedOps ?? (await buildSharedOps())
  const ops = sharedOps
  const reg = new ProjectRegistry({
    workspaceRoot,
    defaultType: 'asset2d',
    defaultProjectName: 'Default Asset Workspace',
    defaultProjectId: 'main',
    legacyStateDir: 'state',
    createRuntime: (req) => {
      let rt: Runtime
      rt = createRuntime({
        projectRoot: workspaceRoot,
        pipelineId: req.pipelineId,
        pluginId: PLUGIN_ID,
        registry: ops,
        createExecutionContext: (base) => ({
          ...base,
          services: {
            ...(base.services ?? {}),
            asset2d: {
              copyImage: (
                image: string,
                opts?: { operation?: string; suffix?: string; folder?: string; name?: string; tags?: string[]; overwrite?: boolean },
              ) =>
                copyGeneratedImage(rt, {
                  image,
                  operation: opts?.operation ?? 'process',
                  ...(opts?.suffix ? { suffix: opts.suffix } : {}),
                  ...(opts?.folder ? { folder: opts.folder } : {}),
                  ...(opts?.name ? { name: opts.name } : {}),
                  ...(opts?.tags ? { tags: opts.tags } : {}),
                  ...(opts?.overwrite !== undefined ? { overwrite: opts.overwrite } : {}),
                }),
              decodeImage: (image: string) => {
                const found = readImageBytesFromRef(rt, image)
                if (!found) return null
                return decodeImageBytes(found.bytes, found.mimeType)
              },
              processImage: (
                image: string,
                opts: { operation: string; suffix?: string; folder?: string },
                transform: (img: DecodedImage) => { width: number; height: number; data: Buffer },
              ) => {
                const found = readImageBytesFromRef(rt, image)
                if (!found) return { image: '', width: 0, height: 0, error: `image not found: ${image.slice(0, 64)}` }
                let decoded: DecodedImage
                try {
                  decoded = decodeImageBytes(found.bytes, found.mimeType)
                } catch (e) {
                  return { image: '', width: 0, height: 0, error: `decode failed: ${e instanceof Error ? e.message : String(e)}` }
                }
                let out: { width: number; height: number; data: Buffer }
                try {
                  out = transform(decoded)
                } catch (e) {
                  return { image: '', width: 0, height: 0, error: `${opts.operation} failed: ${e instanceof Error ? e.message : String(e)}` }
                }
                const png = encodePng(out.width, out.height, out.data)
                const saved = writeProcessedImage(rt, {
                  bytes: png,
                  operation: opts.operation,
                  srcAlias: found.alias,
                  ...(opts.suffix ? { suffix: opts.suffix } : {}),
                  ...(opts.folder ? { folder: opts.folder } : {}),
                })
                return { image: saved.image, width: out.width, height: out.height, error: '' }
              },
              processImages: (
                images: string[],
                opts: { operation: string; suffix?: string; folder?: string },
                transform: (imgs: DecodedImage[]) => { width: number; height: number; data: Buffer },
              ) => {
                const decoded: DecodedImage[] = []
                let firstAlias = images[0] ?? ''
                for (let i = 0; i < images.length; i++) {
                  const found = readImageBytesFromRef(rt, images[i])
                  if (!found) return { image: '', width: 0, height: 0, error: `image not found: ${images[i].slice(0, 64)}` }
                  if (i === 0) firstAlias = found.alias
                  try {
                    decoded.push(decodeImageBytes(found.bytes, found.mimeType))
                  } catch (e) {
                    return { image: '', width: 0, height: 0, error: `decode failed (input ${i}): ${e instanceof Error ? e.message : String(e)}` }
                  }
                }
                let out: { width: number; height: number; data: Buffer }
                try {
                  out = transform(decoded)
                } catch (e) {
                  return { image: '', width: 0, height: 0, error: `${opts.operation} failed: ${e instanceof Error ? e.message : String(e)}` }
                }
                const png = encodePng(out.width, out.height, out.data)
                const saved = writeProcessedImage(rt, {
                  bytes: png,
                  operation: opts.operation,
                  srcAlias: firstAlias,
                  ...(opts.suffix ? { suffix: opts.suffix } : {}),
                  ...(opts.folder ? { folder: opts.folder } : {}),
                })
                return { image: saved.image, width: out.width, height: out.height, error: '' }
              },
              generateImage: (input: { prompt?: string; images?: string[]; nodeId?: string; model?: string; role?: 'concept-art' | 'sprite-frame'; imageSize?: string }) =>
                generateImageAsset(rt, input),
              // BiRefNet 语义抠图：模型跑在独立的 birefnet-server 服务里，ai/matting.ts
              // 只是 HTTP 客户端（POST 图、收 matte、合成落盘）。电池经
              // ctx.services.asset2d.matteImage 调用；服务地址走 serviceUrl 或 FORGEAX_BIREFNET_URL。
              matteImage: (input: { image: string; softEdges?: boolean; crop?: boolean; suffix?: string; serviceUrl?: string }) =>
                matteImage(rt, input),
              createImage: (
                pixels: Buffer,
                width: number,
                height: number,
                opts: { name: string; nodeId?: string; folder?: string },
              ) => {
                let png: Buffer
                try {
                  png = encodePng(width, height, pixels)
                } catch (e) {
                  return { image: '', width: 0, height: 0, archivedPath: '', error: `encode failed: ${e instanceof Error ? e.message : String(e)}` }
                }
                return createGeneratedImage(rt, {
                  bytes: png,
                  width,
                  height,
                  name: opts.name,
                  ...(opts.nodeId ? { nodeId: opts.nodeId } : {}),
                  ...(opts.folder ? { folder: opts.folder } : {}),
                  grayscaleRoot: resolveGrayscaleRoot(repoRoot),
                })
              },
            },
          },
        }),
        // Each project owns isolated graph/history/outputs; assets stay shared
        // at <workspaceRoot>/assets (the runtime's default assetsDir).
        layout: {
          graphFile: req.graphFile,
          historyFile: req.historyFile,
          outputsDir: req.outputsDir,
        },
      })
      return rt
    },
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
