/**
 * Shared-game-sandbox asset source.
 *
 * The 2D asset generator publishes finished textures into the project's shared
 * sandbox at `<projectRoot>/.forgeax/games/<slug>/textures/` (bytes under
 * `blobs/<sha>.png` + a raw descriptor list in `index.json`). That sandbox is the
 * ONLY cross-app common ground — each workbench runs under its own isolated
 * FORGEAX_PROJECT_ROOT, so neither can see the other's internal stores, but both
 * can reach the project's `.forgeax/games` tree.
 *
 * This module lets the scene workbench READ that sandbox as a third asset source
 * (alongside the read-only base library and the project-private store) and merge
 * it into the AssetStore listing + the renderer's matching pool — WITHOUT writing
 * into any app-internal store. The renderer's 13-bracket alias and autotile
 * binding are composed HERE (the consumer side) from the raw descriptor, reusing
 * the exact same helpers as the private publish bridge so matching is identical.
 */
import { existsSync, mkdirSync, readFileSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { dirname, join } from 'node:path'
import { broadcastToClients } from '../routes/ws.js'
import { getActiveProjectDir } from '../runtime.js'
import { deriveAliasMeta, type AliasMeta, type AssetRecord } from './service.js'
import { composeRendererAlias } from './privateStore.js'

/** One asset's entry in `<sandbox>/index.json`, written by asset2d:publishToGame. */
interface GameTextureDescriptor {
  assetName: string
  assetType: 'tile' | 'object'
  autotileKind?: string
  anchorX?: number | null
  anchorY?: number | null
  geometryJson?: string
  sha256: string
  file: string
  mimeType: string
  sizeBytes: number
  widthPx?: number
  heightPx?: number
  sourceBlobId?: string
  updatedAt?: string
}

// The bound sandbox `textures/` dir (absolute). Set by `scene:library.useGameTextures`
// (resolved from the host tool process's cwd). Cached in-process + persisted to a
// small ref file under the active project so it survives a backend restart.
// `boundForProjectDir` tracks which project's ref file `boundDir` came from —
// each scene project points at its own `.forgeax/games/<slug>/textures/` tree.
let boundDir: string | null = null
let boundForProjectDir: string | null = null
let watchedDir: string | null = null
let sandboxWatcher: FSWatcher | null = null
let sandboxDebounce: ReturnType<typeof setTimeout> | null = null
// Cross-process change detection fallback: the 2D app writes into this sandbox
// from a SEPARATE backend process, and `fs.watch` across processes (and on some
// filesystems / atomic-rename writes) is unreliable. A cheap mtime poll of
// index.json guarantees the scene side notices a publish even when the OS-level
// watcher misses it. Both paths funnel through the same debounce, so duplicate
// signals collapse into one broadcast.
let sandboxPoll: ReturnType<typeof setInterval> | null = null
let lastIndexSig: string | null = null
const POLL_INTERVAL_MS = 1500
const REF_FILE = 'private-assets/.game-textures-dir'

/** Signature of the sandbox index.json (mtime+size) used to detect changes. */
function indexSignature(dir: string): string {
  try {
    const st = statSync(join(dir, 'index.json'))
    return `${st.mtimeMs}:${st.size}`
  } catch {
    return 'absent'
  }
}

function broadcastSandboxChanged(reason: string): void {
  // Reconcile the polled signature to the state we're broadcasting so the mtime
  // poll doesn't re-fire for a change the fs.watch path already reported.
  if (watchedDir) lastIndexSig = indexSignature(watchedDir)
  console.log(`[library] game-sandbox changed (${reason})`)
  broadcastToClients({ event: 'library:changed', payload: { source: 'game-sandbox' } })
}

function scheduleSandboxChanged(reason: string): void {
  if (sandboxDebounce) clearTimeout(sandboxDebounce)
  sandboxDebounce = setTimeout(() => {
    sandboxDebounce = null
    broadcastSandboxChanged(reason)
  }, 150)
}

function stopGameSandboxWatcher(): void {
  sandboxWatcher?.close()
  sandboxWatcher = null
  watchedDir = null
  if (sandboxDebounce) {
    clearTimeout(sandboxDebounce)
    sandboxDebounce = null
  }
  if (sandboxPoll) {
    clearInterval(sandboxPoll)
    sandboxPoll = null
  }
  lastIndexSig = null
}

/** Watch index.json + blob writes so 2D publishToGame live-refreshes open panes. */
function startGameSandboxWatcher(dir: string): void {
  if (watchedDir === dir && sandboxWatcher) return
  stopGameSandboxWatcher()
  watchedDir = dir
  // The sandbox `textures/` dir is usually bound BEFORE the 2D app's first
  // publishToGame creates it. Without this, `watch()` throws ENOENT, the error
  // is swallowed, and no live-refresh ever happens — the bug that forced a
  // manual page refresh after every AI import. Creating it up-front (it's the
  // shared path the 2D app will write into anyway) lets the watcher attach now.
  try {
    mkdirSync(dir, { recursive: true })
  } catch (err) {
    console.warn(`[library] game-sandbox mkdir failed for ${dir}:`, err)
  }
  try {
    sandboxWatcher = watch(dir, (eventType, filename) => {
      if (!filename) return
      const norm = filename.replace(/\\/gu, '/')
      if (norm === 'index.json' || norm.startsWith('blobs/')) {
        scheduleSandboxChanged(`${eventType}:${norm}`)
      }
    })
  } catch (err) {
    console.warn(`[library] game-sandbox watcher failed for ${dir}:`, err)
  }
  // Reliable cross-process fallback: poll index.json's mtime/size and broadcast
  // when it changes (covers fs.watch misses across backend processes). Seed the
  // signature first so the initial tick doesn't fire a spurious broadcast.
  lastIndexSig = indexSignature(dir)
  sandboxPoll = setInterval(() => {
    const sig = indexSignature(dir)
    if (sig !== lastIndexSig) {
      lastIndexSig = sig
      scheduleSandboxChanged(`poll:${sig}`)
    }
  }, POLL_INTERVAL_MS)
  // Don't keep the event loop alive just for the poll.
  if (typeof sandboxPoll.unref === 'function') sandboxPoll.unref()
}

async function persistGameTexturesDir(dir: string): Promise<void> {
  try {
    const ref = join(await getActiveProjectDir(), REF_FILE)
    mkdirSync(dirname(ref), { recursive: true })
    writeFileSync(ref, dir, 'utf-8')
  } catch {
    /* persistence is best-effort; in-process binding still works */
  }
}

export async function setGameTexturesDir(dir: string): Promise<void> {
  boundDir = dir
  boundForProjectDir = await getActiveProjectDir()
  startGameSandboxWatcher(dir)
  await persistGameTexturesDir(dir)
}

/** Drop the in-process sandbox binding (e.g. before re-reading another project's ref). */
export function clearGameTexturesBinding(): void {
  boundDir = null
  boundForProjectDir = null
  stopGameSandboxWatcher()
}

/** Re-read the viewing project's `.game-textures-dir` ref after a project switch. */
export async function reloadGameTexturesBinding(): Promise<string | null> {
  clearGameTexturesBinding()
  return getGameTexturesDir()
}

export async function getGameTexturesDir(): Promise<string | null> {
  const projDir = await getActiveProjectDir()
  if (boundForProjectDir !== projDir) {
    clearGameTexturesBinding()
    boundForProjectDir = projDir
  }
  if (boundDir) return boundDir
  try {
    const ref = join(projDir, REF_FILE)
    if (existsSync(ref)) {
      const dir = readFileSync(ref, 'utf-8').trim()
      if (dir) {
        boundDir = dir
        startGameSandboxWatcher(dir)
      }
    }
  } catch {
    /* ignore */
  }
  return boundDir
}

/** Test-only: tear down the watcher without touching persisted ref. */
export function _resetGameSandboxWatcherForTests(): void {
  stopGameSandboxWatcher()
}

function loadDescriptors(dir: string): GameTextureDescriptor[] {
  const indexPath = join(dir, 'index.json')
  if (!existsSync(indexPath)) return []
  try {
    const parsed = JSON.parse(readFileSync(indexPath, 'utf-8')) as unknown
    return Array.isArray(parsed) ? (parsed as GameTextureDescriptor[]) : []
  } catch {
    return []
  }
}

function aliasOf(d: GameTextureDescriptor): string {
  return composeRendererAlias({
    assetName: d.assetName,
    assetType: d.assetType,
    ...(d.autotileKind !== undefined ? { autotileKind: d.autotileKind } : {}),
  })
}

function toRecord(d: GameTextureDescriptor): AssetRecord {
  return {
    id: `game-sandbox:${d.sha256}`,
    alias: aliasOf(d),
    zone: 'raw',
    blobSha256: d.sha256,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    ...(d.widthPx ? { widthPx: d.widthPx } : {}),
    ...(d.heightPx ? { heightPx: d.heightPx } : {}),
    anchorX: d.anchorX ?? null,
    anchorY: d.anchorY ?? null,
    private: true,
    ...(d.geometryJson ? { geometryJson: d.geometryJson } : {}),
  }
}

function toMeta(d: GameTextureDescriptor): AliasMeta {
  // aliasOf() already encodes the rule alias into the type field (idx 7) via
  // composeRendererAlias, so deriveAliasMeta reads tileType straight from it.
  return deriveAliasMeta({
    alias: aliasOf(d),
    anchor_x: d.anchorX ?? null,
    anchor_y: d.anchorY ?? null,
    width_px: d.widthPx ?? null,
    height_px: d.heightPx ?? null,
    geometry_json: d.geometryJson ?? null,
  })
}

/** AssetStore listing records for the sandbox (zone `raw` only). */
export async function listGameSandboxRecords(opts: { zone?: string; search?: string }): Promise<AssetRecord[]> {
  if (opts.zone && opts.zone !== 'raw') return []
  const dir = await getGameTexturesDir()
  if (!dir) return []
  const q = opts.search?.trim().toLowerCase()
  return loadDescriptors(dir)
    .filter((d) => !q || d.assetName.toLowerCase().includes(q) || aliasOf(d).toLowerCase().includes(q))
    .map(toRecord)
}

/** Read a project's persisted game-sandbox textures dir without touching the in-process binding. */
export function readGameTexturesDirRef(projDir: string): string | null {
  try {
    const ref = join(projDir, REF_FILE)
    if (existsSync(ref)) {
      const dir = readFileSync(ref, 'utf-8').trim()
      if (dir) return dir
    }
  } catch {
    /* ignore */
  }
  return null
}

/** Renderer matching-pool metas for one project's sandbox (zone `raw` only). */
export function gameSandboxAliasMetasForProjectDir(projDir: string, zone: string): AliasMeta[] {
  if (zone !== 'raw') return []
  const dir = readGameTexturesDirRef(projDir)
  if (!dir) return []
  return loadDescriptors(dir).map(toMeta)
}

/** Disk path of a sandbox blob for a composed alias within one project, or null. */
export function resolveGameSandboxBlobByAliasForProjectDir(
  projDir: string,
  alias: string,
): { path: string; mimeType: string } | null {
  const dir = readGameTexturesDirRef(projDir)
  if (!dir) return null
  const d = loadDescriptors(dir).find((x) => aliasOf(x) === alias)
  if (!d) return null
  const path = join(dir, d.file)
  return existsSync(path) ? { path, mimeType: d.mimeType } : null
}

/** Renderer matching-pool metas for the sandbox (zone `raw` only). */
export async function gameSandboxAliasMetas(zone: string): Promise<AliasMeta[]> {
  if (zone !== 'raw') return []
  const dir = await getGameTexturesDir()
  if (!dir) return []
  return loadDescriptors(dir).map(toMeta)
}

/** Disk path of a sandbox blob for a composed alias, or null if absent. */
export async function resolveGameSandboxBlobByAlias(alias: string): Promise<{ path: string; mimeType: string } | null> {
  const dir = await getGameTexturesDir()
  if (!dir) return null
  const d = loadDescriptors(dir).find((x) => aliasOf(x) === alias)
  if (!d) return null
  const path = join(dir, d.file)
  return existsSync(path) ? { path, mimeType: d.mimeType } : null
}
