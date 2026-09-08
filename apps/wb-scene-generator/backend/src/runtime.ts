import { createRuntime, createBatteryLoader, OpRegistry, OverlayOpRegistry, ProjectRegistry } from '@forgeax/node-runtime'
import type { Runtime, BatteryLoader, LoaderEvent } from '@forgeax/node-runtime'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { resolveBatteryScanRoots } from '@forgeax/editor-host/backend'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')

export function resolveWorkspaceRoot(): string {
  return process.env.FORGEAX_PROJECT_ROOT ?? resolve(repoRoot, '.forgeax-runtime')
}

/**
 * Shared Studio games tree: `<instance>/.forgeax/games`.
 *
 * Workbench plugins get FORGEAX_PROJECT_ROOT = `.forgeax/workbench/<pluginId>/`.
 * Derive the sibling shared games dir from that layout alone — no host env vars.
 * Standalone / test (no workbench segment) falls back to `<workspace>/.forgeax/games`.
 */
export function resolveSharedGamesRoot(): string {
  const ws = resolveWorkspaceRoot()
  const norm = ws.replace(/\\/g, '/')
  // <instance>/.forgeax/workbench/<pluginId> → <instance>/.forgeax/games
  if (/(?:^|\/)\.forgeax\/workbench\//.test(norm)) {
    return resolve(ws, '..', '..', 'games')
  }
  return resolve(ws, '.forgeax', 'games')
}

const PLUGIN_ID = '@forgeax-plugin/wb-scene-generator'

let registry: ProjectRegistry | null = null
let registryWorkspaceRoot: string | null = null
let sharedOps: OpRegistry | null = null
let sharedOpsPromise: Promise<OpRegistry> | null = null
let batteryLoader: BatteryLoader | null = null
let stopWatch: (() => void) | null = null
let registryPromise: Promise<ProjectRegistry> | null = null
const projectOverlays = new Map<string, OverlayOpRegistry>()

const GAME_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,127}$/u

function isWorkbenchPluginRoot(workspaceRoot: string): boolean {
  return /(?:^|\/)\.forgeax\/workbench\/[^/]+$/u.test(workspaceRoot.replace(/\\/g, '/'))
}

export const ACTIVE_GAME_REQUIRED = 'ACTIVE_GAME_REQUIRED'

export class ActiveGameRequiredError extends Error {
  readonly code = ACTIVE_GAME_REQUIRED
  readonly retryable = true

  constructor(readonly detail: string) {
    super('Create or select a game before using Scene Generator.')
    this.name = 'ActiveGameRequiredError'
  }
}

export function isActiveGameRequiredError(error: unknown): error is ActiveGameRequiredError {
  return error instanceof ActiveGameRequiredError
}

/**
 * The Studio host owns active-game.json. A standalone/test backend retains its
 * own workspace root, while a Workbench backend always stores projects inside
 * the selected game's directory.
 */
export function resolveActiveGameSlug(): string | null {
  const workspaceRoot = resolveWorkspaceRoot()
  if (!isWorkbenchPluginRoot(workspaceRoot)) return null

  const gamesRoot = resolveSharedGamesRoot()
  const activeGameFile = resolve(gamesRoot, '..', 'active-game.json')
  try {
    const active = JSON.parse(readFileSync(activeGameFile, 'utf-8')) as { slug?: unknown }
    if (typeof active.slug !== 'string' || !GAME_SLUG_RE.test(active.slug)) {
      throw new Error('active-game.json has no valid slug')
    }
    const gameRoot = resolve(gamesRoot, active.slug)
    if (!gameRoot.startsWith(`${resolve(gamesRoot)}/`) || !existsSync(gameRoot) || !statSync(gameRoot).isDirectory()) {
      throw new Error(`active game directory does not exist: ${active.slug}`)
    }
    return active.slug
  } catch (error) {
    throw new ActiveGameRequiredError(`${activeGameFile}: ${(error as Error).message}`)
  }
}

export type RuntimeBindingStatus =
  | { mode: 'standalone'; binding: 'ready'; activeGameSlug: null }
  | { mode: 'studio'; binding: 'ready'; activeGameSlug: string }
  | { mode: 'studio'; binding: 'unbound'; activeGameSlug: null; code: typeof ACTIVE_GAME_REQUIRED }

export function getRuntimeBindingStatus(): RuntimeBindingStatus {
  if (!isWorkbenchPluginRoot(resolveWorkspaceRoot())) {
    return { mode: 'standalone', binding: 'ready', activeGameSlug: null }
  }
  try {
    return { mode: 'studio', binding: 'ready', activeGameSlug: resolveActiveGameSlug()! }
  } catch (error) {
    if (!isActiveGameRequiredError(error)) throw error
    return { mode: 'studio', binding: 'unbound', activeGameSlug: null, code: ACTIVE_GAME_REQUIRED }
  }
}

export function resolveProjectWorkspaceRoot(): string {
  const workspaceRoot = resolveWorkspaceRoot()
  const gameSlug = resolveActiveGameSlug()
  if (!gameSlug) return workspaceRoot
  return resolve(resolveSharedGamesRoot(), gameSlug, '.forgeax', 'workbench', 'wb-scene-generator')
}

function batteryWatchEnabled(): boolean {
  const flag = process.env.FORGEAX_BATTERY_WATCH
  if (flag === '1' || flag === 'true') return true
  if (flag === '0' || flag === 'false') return false
  const env = process.env.NODE_ENV
  return env !== 'production' && env !== 'test'
}

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
  // This runs exactly once per backend process lifetime, lazily on whichever
  // HTTP request first calls getProjectRegistry() — in practice that's
  // whatever the frontend fires first on initial page load (loadBatteries()
  // or the first /view). scan() sequentially `await import()`s every
  // battery's index.ts (300-500+ files across the shared + app batteries
  // dirs) — under a TS dev loader (tsx/ts-node, no prebuilt dist) each import
  // pays a real per-file transpile+eval cost, so this can add up to real
  // seconds. Nothing before this point has any timing, so "opening the very
  // first project after a backend restart feels slower than switching
  // between already-open ones later" was previously invisible in any trace
  // log — the switch-trace/output-batch-trace timers only start once this
  // promise has already resolved.
  const __t0 = Date.now()
  const ops = new OpRegistry()
  const watch = batteryWatchEnabled()
  const loader = createBatteryLoader(ops, {
    pluginId: PLUGIN_ID,
    scanDirs: resolveBatteryScanRoots(repoRoot),
    layout: 'flexible',
    watch,
  })
  const res = await loader.scan()
  const __t1 = Date.now()
  for (const e of res.errors) console.warn(`[battery skip] ${e.dir}: ${e.reason}`)
  const mem = process.memoryUsage()
  console.log(
    `[runtime] loaded ${res.added} ops (${res.errors.length} skipped)${watch ? ' [hot-reload on]' : ''} ` +
      `[cold-start-trace] batteryScan=${__t1 - __t0}ms rss=${(mem.rss / 1024 / 1024).toFixed(1)}MB heapUsed=${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB`,
  )
  if (watch) {
    batteryLoader = loader
    loader.subscribe(broadcastLoaderEvent)
    stopWatch = loader.startWatching()
  }
  return ops
}

export function stopBatteryWatch(): void {
  if (stopWatch) {
    stopWatch()
    stopWatch = null
  }
  batteryLoader = null
}

export function disposeRuntimeState(): void {
  registry?.dispose()
  registry = null
  registryWorkspaceRoot = null
  registryPromise = null
  projectOverlays.clear()
  stopBatteryWatch()
  sharedOps = null
  sharedOpsPromise = null
}

export function getProjectOpOverlay(projectId: string): OverlayOpRegistry {
  if (!sharedOps) throw new Error('shared op registry is not loaded')
  let overlay = projectOverlays.get(projectId)
  if (!overlay) {
    overlay = new OverlayOpRegistry(sharedOps)
    projectOverlays.set(projectId, overlay)
  }
  return overlay
}

/** Release short-lived draft overlays after their scratch runtime is discarded. */
export function releaseProjectOpOverlay(projectId: string): void {
  projectOverlays.delete(projectId)
}

export async function getProjectRegistry(): Promise<ProjectRegistry> {
  const workspaceRoot = resolveProjectWorkspaceRoot()
  if (registry && registryWorkspaceRoot === workspaceRoot) return registry
  // Serialise initialisation. The left/center/renderer panes can all issue
  // their first request together; without this guard each request built its
  // own battery registry and ProjectRegistry.
  if (registryPromise) {
    await registryPromise
    return getProjectRegistry()
  }

  registryPromise = (async () => {
    const __t0 = Date.now()
    sharedOpsPromise ??= buildSharedOps().catch((error) => {
      sharedOpsPromise = null
      throw error
    })
    sharedOps = sharedOps ?? (await sharedOpsPromise)
    const __t1 = Date.now()

    if (registry && registryWorkspaceRoot !== workspaceRoot) {
      registry.dispose()
      projectOverlays.clear()
    }

    const reg = new ProjectRegistry({
      workspaceRoot,
      defaultType: 'scene',
      defaultProjectName: 'Default Scene',
      defaultProjectId: 'main',
      legacyStateDir: 'state',
      createRuntime: (req) =>
        createRuntime({
          projectRoot: workspaceRoot,
          pipelineId: req.pipelineId,
          pluginId: PLUGIN_ID,
          registry: getProjectOpOverlay(req.pipelineId),
          createExecutionContext: (base) => ({
            ...base,
            log: (level, message) => {
              if (level === 'error') console.error(`[exec] ${message}`)
              else if (level === 'warn') console.warn(`[exec] ${message}`)
              else if (process.env.FORGEAX_EXEC_DEBUG) console.log(`[exec:${level}] ${message}`)
            },
          }),
          layout: {
            graphFile: req.graphFile,
            historyFile: req.historyFile,
            outputsDir: req.outputsDir,
          },
        }),
    })
    const __t2 = Date.now()
    reg.init()
    const __t3 = Date.now()
    registry = reg
    registryWorkspaceRoot = workspaceRoot
    console.log(
      `[cold-start-trace] getProjectRegistry TOTAL=${__t3 - __t0}ms (buildSharedOps=${__t1 - __t0}ms newProjectRegistry=${__t2 - __t1}ms reg.init=${__t3 - __t2}ms)`,
    )
    return reg
  })()

  try {
    return await registryPromise
  } finally {
    registryPromise = null
  }
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
  const ws = resolveProjectWorkspaceRoot()
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
  const ws = resolveProjectWorkspaceRoot()
  const graphRel = rec.manifest.storage.graphFile
  const graphAbs = isAbsolute(graphRel) ? graphRel : join(ws, graphRel)
  return dirname(dirname(graphAbs))
}
