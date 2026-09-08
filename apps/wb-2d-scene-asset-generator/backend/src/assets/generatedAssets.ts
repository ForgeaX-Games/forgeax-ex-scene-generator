import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { Runtime } from '@forgeax/node-runtime'
import { PRESET_FOLDER, isPresetAlias, listPresetAssets, readPresetAsset, readPresetAssetByBlobId } from './presetAssets.js'

const INDEX_PATH = 'generated/_asset2d-index.json'

/** Virtual cross-folder filter token: lists every favorited asset regardless of folder. */
export const FAVORITES_FILTER = '__favorites__'

export interface GeneratedAssetRecord {
  alias: string
  blobId: string
  relPath: string
  mimeType: string
  sizeBytes: number
  createdAt: string
  /** Human-readable display name shown as the card title; falls back to `alias` when absent. Editable via rename. */
  name?: string
  prompt?: string
  nodeId?: string
  source?: string
  folder: string
  tags: string[]
  /** User-pinned favorite. A flag on the single record — favoriting never copies the asset. */
  favorite?: boolean
  /** Optional favorite sub-group, surfaced as a `__favorites__/<group>` rail sub-menu. */
  favoriteGroup?: string
  /** True for plugin-shipped preset assets (read-only, cannot be deleted). Derived, not persisted. */
  readonly?: boolean
}

const FAVORITE_GROUPS_PATH = 'generated/_asset2d-favorite-groups.json'

/** User-created favorite sub-group names (persisted so an empty group still
 *  shows in the rail until it is filled or deleted). */
function readFavoriteGroups(rt: Runtime): string[] {
  const bytes = rt.assets.read(FAVORITE_GROUPS_PATH)
  if (!bytes) return []
  try {
    const parsed = JSON.parse(bytes.toString('utf-8')) as { groups?: unknown }
    if (!Array.isArray(parsed.groups)) return []
    return parsed.groups.filter((g): g is string => typeof g === 'string' && g.length > 0)
  } catch {
    return []
  }
}

function writeFavoriteGroups(rt: Runtime, groups: string[]): void {
  const unique = Array.from(new Set(groups.filter((g) => g.length > 0)))
  rt.assets.write(FAVORITE_GROUPS_PATH, Buffer.from(JSON.stringify({ groups: unique }, null, 2), 'utf-8'))
}

/** Create an (empty) favorite sub-group so it appears in the rail before any
 *  asset is moved into it. Returns the normalized group name, or null. */
export function createFavoriteGroup(rt: Runtime, rawName: string): string | null {
  const name = rawName.trim().slice(0, 48)
  if (!name || name.includes('/')) return null
  writeFavoriteGroups(rt, [...readFavoriteGroups(rt), name])
  return name
}

/** Delete a favorite sub-group: drop it from the persisted list and clear the
 *  `favoriteGroup` field on any asset that referenced it (the assets stay
 *  favorited, just ungrouped). */
export function deleteFavoriteGroup(rt: Runtime, rawName: string): boolean {
  const name = rawName.trim()
  if (!name) return false
  writeFavoriteGroups(rt, readFavoriteGroups(rt).filter((g) => g !== name))
  const items = readIndex(rt)
  let changed = false
  const next = items.map((item) => {
    if (item.favoriteGroup === name) {
      changed = true
      const { favoriteGroup: _drop, ...rest } = item
      return rest
    }
    return item
  })
  if (changed) writeIndex(rt, next)
  return true
}

export interface ImportGeneratedImageRequest {
  prompt?: string
  nodeId?: string
  imageBase64: string
  mimeType?: string
  source?: string
  folder?: string
  tags?: string[]
  /** Human-readable display name (card title); when set, written to the record's `name` field. */
  name?: string
  /**
   * When a record with the same effective display name already exists, replace it
   * in place (reusing its slot/file) instead of appending a new entry. When false
   * (or the name is empty), always create a fresh entry. Defaults to false.
   */
  overwrite?: boolean
}

export interface CopyGeneratedImageRequest {
  image: string
  operation: string
  suffix?: string
  folder?: string
  /** Human-readable display name for the saved asset (card title); empty → auto. */
  name?: string
  /** Tags to attach; when omitted falls back to `['battery', operation]`. */
  tags?: string[]
  /** Overwrite an existing asset with the same display name in place. */
  overwrite?: boolean
}

export interface ImageRefLibrary {
  alias: string
  blobId: string
}

export type ImageRef = ImageRefLibrary | { dataUrl: string }

export function encodeImageRef(ref: ImageRef): string {
  if ('dataUrl' in ref) return ref.dataUrl
  return JSON.stringify({ alias: ref.alias, blobId: ref.blobId })
}

export function parseImageRef(value: string | null | undefined): ImageRef | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('data:')) return { dataUrl: trimmed }
  if (!trimmed.startsWith('{')) return null
  try {
    const parsed = JSON.parse(trimmed) as { alias?: unknown; blobId?: unknown }
    if (typeof parsed.alias === 'string' && typeof parsed.blobId === 'string' && parsed.alias && parsed.blobId) {
      return { alias: parsed.alias, blobId: parsed.blobId }
    }
  } catch {
    return null
  }
  return null
}

function decodeBase64Image(raw: string): { bytes: Buffer; mimeType?: string } {
  const match = raw.match(/^data:([^;]+);base64,(.+)$/u)
  if (match) return { bytes: Buffer.from(match[2], 'base64'), mimeType: match[1] }
  return { bytes: Buffer.from(raw, 'base64') }
}

function slug(raw: string, fallback: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48)
  return normalized || fallback
}

/**
 * Slug a single folder-name segment. Unlike `slug()` (used for ASCII-safe asset
 * filenames), folder/menu names are user-facing and frequently CJK, so we keep
 * Unicode letters/numbers and only strip filesystem-hostile characters
 * (path separators, control/reserved chars, leading dots). This lets menus like
 * `高反射` / `树林` map to real on-disk directories.
 */
function slugFolderSegment(raw: string): string {
  return raw
    .normalize('NFC')
    .trim()
    // Keep Unicode letters/numbers (incl. CJK), spaces, dash and underscore;
    // drop everything else (punctuation, symbols, path separators, controls).
    .replace(/[^\p{L}\p{N} _-]+/gu, '')
    .replace(/\s+/gu, '-')
    .replace(/^[.\-]+|[.\-]+$/gu, '') // no leading dot/dash, no trailing
    .slice(0, 48)
}

/**
 * Slug a (possibly nested) folder path: each `/`-separated segment is
 * normalized independently and re-joined with `/`, so a two-level menu like
 * `user/sub` survives normalization. Empty segments are dropped; an all-empty
 * path falls back to `fallback`. This is the SSOT for how the frontend folder
 * tree maps to the on-disk `generated/<path>/` directory structure.
 */
function slugFolderPath(raw: string, fallback: string): string {
  const segments = raw
    .split('/')
    .map((seg) => slugFolderSegment(seg))
    .filter((seg) => seg.length > 0)
  return segments.length > 0 ? segments.join('/') : fallback
}

function extForMime(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/webp') return 'webp'
  return 'png'
}

function readIndex(rt: Runtime): GeneratedAssetRecord[] {
  const bytes = rt.assets.read(INDEX_PATH)
  if (!bytes) return []
  try {
    const parsed = JSON.parse(bytes.toString('utf-8')) as { items?: unknown }
    if (!Array.isArray(parsed.items)) return []
    return parsed.items.filter((item): item is GeneratedAssetRecord => {
      if (!item || typeof item !== 'object') return false
      const rec = item as Partial<GeneratedAssetRecord>
      return typeof rec.alias === 'string' && typeof rec.blobId === 'string' && typeof rec.relPath === 'string'
    })
  } catch {
    return []
  }
}

function writeIndex(rt: Runtime, items: GeneratedAssetRecord[]): void {
  rt.assets.write(INDEX_PATH, Buffer.from(JSON.stringify({ items }, null, 2), 'utf-8'))
}

/**
 * Absolute path of the on-disk `generated/` directory (the parent of every
 * folder column). Derived from the index file's own absolute path so we never
 * hard-code the assets root or create a circular import with `runtime.ts`: a
 * harmless write of the index (idempotent — same content if it already exists)
 * returns its `absPath`, whose parent dir is `generated/`.
 *
 * This is the SSOT bridge for the empty-folder tree: the frontend menu structure
 * mirrors these real directories, so creating/deleting a (possibly empty) menu
 * must create/delete a real directory here.
 */
function generatedDir(rt: Runtime): string {
  const desc = rt.assets.write(INDEX_PATH, rt.assets.read(INDEX_PATH) ?? Buffer.from(JSON.stringify({ items: [] }, null, 2), 'utf-8'))
  return dirname(desc.absPath)
}

/** The `folder` slug values that are fixed top-level columns: they never get
 *  sub-folders and cannot be deleted/created as menus from the UI. `generated`
 *  is the implicit root bucket (rel `generated/<file>`), kept off the menu. */
const FIXED_TOP_FOLDERS = new Set(['ai', 'grayscale', 'processed', 'staging', 'generated'])

/** Recursively collect every folder path (relative to `generated/`) on disk,
 *  e.g. `user`, `user/sub`. The implicit root files (directly under
 *  `generated/`, folder === 'generated') are not a directory entry here. */
function scanFolderDirs(root: string, base = '', out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return out
  }
  for (const name of entries) {
    if (name.startsWith('.') || name === 'node_modules') continue
    const abs = join(root, name)
    let st
    try {
      st = statSync(abs)
    } catch {
      continue
    }
    if (!st.isDirectory()) continue
    const relFolder = base ? `${base}/${name}` : name
    out.push(relFolder)
    scanFolderDirs(abs, relFolder, out)
  }
  return out
}

export function importGeneratedImage(
  rt: Runtime,
  req: ImportGeneratedImageRequest,
): { image: string; asset: GeneratedAssetRecord } {
  const decoded = decodeBase64Image(req.imageBase64)
  const bytes = decoded.bytes
  const mimeType = req.mimeType ?? decoded.mimeType ?? 'image/png'
  const blobId = createHash('sha256').update(bytes).digest('hex')
  const folder = slugFolderPath(req.folder ?? 'generated', 'generated')
  const promptPart = slug(req.prompt ?? 'image', 'image')
  const nodePart = slug(req.nodeId ?? 'node', 'node')
  const displayName = req.name?.trim() ? req.name.trim() : undefined
  const index = readIndex(rt)

  // Overwrite-in-place: when an explicit display name is given and `overwrite`
  // is on, replace an existing record that shares that effective display name
  // rather than appending a new entry. The Chinese display name can't live in
  // the `alias` (slug strips non-ASCII), so "same name" is judged by `name`.
  if (displayName && req.overwrite) {
    const targetIdx = index.findIndex((item) => (item.name ?? item.alias).trim() === displayName)
    if (targetIdx !== -1) {
      const target = index[targetIdx]
      rt.assets.write(target.relPath, bytes)
      const updated: GeneratedAssetRecord = {
        ...target,
        blobId,
        mimeType,
        sizeBytes: bytes.length,
        name: displayName,
        ...(req.prompt ? { prompt: req.prompt } : {}),
        ...(req.nodeId ? { nodeId: req.nodeId } : {}),
        ...(req.source ? { source: req.source } : {}),
        tags: req.tags ?? target.tags,
      }
      const next = index.slice()
      next[targetIdx] = updated
      writeIndex(rt, next)
      return { image: encodeImageRef({ alias: updated.alias, blobId }), asset: updated }
    }
  }

  const alias = `ai-${promptPart}-${nodePart}-${Date.now().toString(36)}.${extForMime(mimeType)}`
  const relPath = folder === 'generated' ? `generated/${alias}` : `generated/${folder}/${alias}`
  const descriptor = rt.assets.write(relPath, bytes)
  const asset: GeneratedAssetRecord = {
    alias,
    blobId,
    relPath,
    mimeType,
    sizeBytes: descriptor.size,
    createdAt: new Date().toISOString(),
    ...(displayName ? { name: uniqueDisplayName(index, displayName, alias) } : {}),
    ...(req.prompt ? { prompt: req.prompt } : {}),
    ...(req.nodeId ? { nodeId: req.nodeId } : {}),
    ...(req.source ? { source: req.source } : {}),
    folder,
    tags: req.tags ?? [],
  }
  const items = index.filter((item) => item.alias !== alias)
  writeIndex(rt, [asset, ...items])
  return { image: encodeImageRef({ alias, blobId }), asset }
}

export function listGeneratedAssets(rt: Runtime, folder?: string): { items: GeneratedAssetRecord[] } {
  // The favorites filter is a cross-folder virtual column: match favorited
  // records regardless of their `folder`. Checked before slug() (which would
  // mangle the `__favorites__` token). A `__favorites__/<group>` path narrows to
  // one favorite group; bare `__favorites__` lists every favorite.
  if (folder === FAVORITES_FILTER || folder?.startsWith(`${FAVORITES_FILTER}/`)) {
    const group = folder === FAVORITES_FILTER ? null : folder.slice(`${FAVORITES_FILTER}/`.length)
    const items = readIndex(rt)
      .filter((item) => item.favorite === true)
      .filter((item) => group === null || (item.favoriteGroup ?? '') === group)
      .filter((item) => rt.assets.read(item.relPath) !== null)
    return { items }
  }
  const normalizedFolder = folder ? slugFolderPath(folder, folder) : undefined
  const items = readIndex(rt)
    // A selected folder matches its own assets AND those in any nested sub-folder
    // (`folder/...`), so selecting a PARENT menu behaves like an "All" for its
    // whole subtree. Fixed/leaf columns have no children, so this is exact-match
    // for them in practice.
    .filter(
      (item) => !normalizedFolder || item.folder === normalizedFolder || item.folder.startsWith(`${normalizedFolder}/`),
    )
    .filter((item) => rt.assets.read(item.relPath) !== null)
  // Append plugin-shipped read-only preset assets (not in the file-backed index,
  // served straight from the plugin dir). They show in the unfiltered "All"
  // view, in the `presets` parent column (all presets), and in each
  // `presets/<sub>` sub-menu (only that sub-directory's presets). They stay
  // read-only (no rename/delete) via `readonly`.
  if (!normalizedFolder) {
    items.push(...listPresetAssets())
  } else if (normalizedFolder === PRESET_FOLDER || normalizedFolder.startsWith(`${PRESET_FOLDER}/`)) {
    items.push(...listPresetAssets().filter((p) => p.folder === normalizedFolder))
  }
  return { items }
}

export function listGeneratedFolders(rt: Runtime): { folders: Array<{ name: string; count: number }> } {
  // One-time migration: the legacy default import column `user` is renamed to
  // `staging`, freeing `user` to be a regular (sub-folderable) top-level menu.
  migrateUserToStaging(rt)

  // Count assets per folder from the index (real, file-backed records only).
  const counts = new Map<string, number>()
  let favoriteCount = 0
  // Per-favorite-group counts so favorites can render two-level sub-menus.
  const favoriteGroupCounts = new Map<string, number>()
  for (const item of readIndex(rt).filter((it) => rt.assets.read(it.relPath) !== null)) {
    counts.set(item.folder, (counts.get(item.folder) ?? 0) + 1)
    if (item.favorite === true) {
      favoriteCount++
      const group = item.favoriteGroup?.trim()
      if (group) favoriteGroupCounts.set(group, (favoriteGroupCounts.get(group) ?? 0) + 1)
    }
  }
  // Merge in every real directory on disk (including EMPTY folders, which carry
  // no index rows) so a freshly-created/empty menu still appears. The frontend
  // tree mirrors this directory set exactly.
  const dirs = scanFolderDirs(generatedDir(rt))
  const names = new Set<string>([...counts.keys(), ...dirs])
  // The implicit root bucket (`generated`) is not a user-facing folder column.
  names.delete('generated')

  const folders = Array.from(names)
    .map((name) => ({ name, count: counts.get(name) ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // Surface the preset column (read-only, plugin-shipped) and its sub-folder
  // columns (`presets/<sub>`) so they render as a two-level menu. Counted from
  // the derived preset records (presets carry no index rows).
  const presetRecords = listPresetAssets()
  if (presetRecords.length > 0) {
    const presetCounts = new Map<string, number>()
    for (const rec of presetRecords) presetCounts.set(rec.folder, (presetCounts.get(rec.folder) ?? 0) + 1)
    for (const [name, count] of presetCounts) folders.push({ name, count })
    // Ensure the parent column always exists even if every preset sits in a
    // sub-folder, so the rail has a clickable `presets` row.
    if (!presetCounts.has(PRESET_FOLDER)) folders.push({ name: PRESET_FOLDER, count: 0 })
  }

  // Surface the virtual favorites column (cross-folder) only when it has
  // favorites OR a user-created (possibly empty) group, plus each group as a
  // `__favorites__/<group>` sub-menu so favorites render a two-level menu.
  const favoriteGroups = new Set<string>([...favoriteGroupCounts.keys(), ...readFavoriteGroups(rt)])
  if (favoriteCount > 0 || favoriteGroups.size > 0) {
    folders.push({ name: FAVORITES_FILTER, count: favoriteCount })
    for (const group of favoriteGroups) {
      folders.push({ name: `${FAVORITES_FILTER}/${group}`, count: favoriteGroupCounts.get(group) ?? 0 })
    }
  }
  return { folders }
}

/**
 * One-time, idempotent migration of the legacy default-import column `user` to
 * `staging`. Moves index rows (`folder` + `relPath`) and the on-disk directory
 * so existing imports survive; afterwards `user` is a free, regular top-level
 * menu the user can sub-folder. Runs lazily from `listGeneratedFolders` (the
 * surface's first call), so no separate boot hook is needed. No-op once done.
 */
function migrateUserToStaging(rt: Runtime): void {
  const dir = generatedDir(rt)
  // One-time sentinel: once migrated, `user` is a normal user-creatable column
  // again and must never be auto-folded into `staging` on later list calls.
  const marker = join(dir, '.user-staging-migrated')
  if (existsSync(marker)) return

  const items = readIndex(rt)
  const hasLegacy = items.some((it) => it.folder === 'user' || it.folder.startsWith('user/'))
  const legacyDirExists = existsSync(join(dir, 'user'))
  if (!hasLegacy && !legacyDirExists) {
    // Nothing legacy to migrate (fresh workspace) — still drop the marker so the
    // migration never runs again and `user` stays a regular folder.
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(marker, '1')
    } catch {
      /* best-effort */
    }
    return
  }

  // Rewrite index rows: user → staging, user/x → staging/x.
  if (hasLegacy) {
    const next = items.map((it) => {
      if (it.folder !== 'user' && !it.folder.startsWith('user/')) return it
      const folder = it.folder === 'user' ? 'staging' : `staging/${it.folder.slice('user/'.length)}`
      const relPath = it.relPath.startsWith('generated/user/')
        ? `generated/staging/${it.relPath.slice('generated/user/'.length)}`
        : it.relPath
      return { ...it, folder, relPath }
    })
    writeIndex(rt, next)
  }

  // Relocate the on-disk directory (merge into an existing `staging` if any).
  if (legacyDirExists) {
    const from = join(dir, 'user')
    const to = join(dir, 'staging')
    try {
      if (!existsSync(to)) renameSync(from, to)
      else {
        // `staging` already exists — move children individually, then drop `user`.
        for (const name of readdirSync(from)) {
          const dest = join(to, name)
          if (!existsSync(dest)) renameSync(join(from, name), dest)
        }
        rmSync(from, { recursive: true, force: true })
      }
    } catch {
      // Best-effort; the index rewrite above already points at `staging`.
    }
  }

  // Mark migration complete so `user` can be recreated as a regular column.
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(marker, '1')
  } catch {
    /* best-effort */
  }
}

/**
 * Create an (empty) folder column on disk so it appears in the menu tree even
 * before it holds any asset. The path is slug-normalized per segment. Fixed
 * top-level columns (`ai`/`grayscale`/`processed`/`staging`) may not gain
 * sub-folders, so a 2-segment path under one of them is rejected. Returns the
 * normalized folder path, or null when the path is invalid/rejected.
 */
export function createGeneratedFolder(rt: Runtime, rawPath: string): string | null {
  // Ensure the one-time user→staging migration has settled (and its sentinel is
  // written) before we let the user (re)create a `user` column.
  migrateUserToStaging(rt)
  const folder = slugFolderPath(rawPath, '')
  if (!folder) return null
  const segments = folder.split('/')
  if (segments.length > 2) return null // only one level of nesting is supported
  const top = segments[0]
  if (top === PRESET_FOLDER) return null // `presets` is a virtual, read-only column
  // A sub-folder under a fixed top-level column is not allowed.
  if (segments.length === 2 && FIXED_TOP_FOLDERS.has(top)) return null
  const abs = join(generatedDir(rt), folder)
  try {
    mkdirSync(abs, { recursive: true })
  } catch {
    return null
  }
  return folder
}

/**
 * Delete a folder column (and every asset inside it, including nested
 * sub-folders) from both the index and disk. Preset/virtual columns are
 * rejected. Returns the aliases that were removed (empty when the folder had no
 * assets but the directory was still deleted). Fixed top-level columns are NOT
 * deletable as menus (UI also hides the action), but a fixed column's request
 * is rejected here too for safety.
 */
export function deleteGeneratedFolder(rt: Runtime, rawPath: string): { deleted: string[]; ok: boolean } {
  const folder = slugFolderPath(rawPath, '')
  if (!folder || folder === PRESET_FOLDER || folder === FAVORITES_FILTER || folder === 'generated') {
    return { deleted: [], ok: false }
  }
  if (FIXED_TOP_FOLDERS.has(folder)) return { deleted: [], ok: false }
  const items = readIndex(rt)
  // Match the folder and any nested sub-folders (folder + 'folder/...').
  const inFolder = (f: string): boolean => f === folder || f.startsWith(`${folder}/`)
  const removed = items.filter((it) => inFolder(it.folder))
  const remaining = items.filter((it) => !inFolder(it.folder))
  if (removed.length !== items.length) writeIndex(rt, remaining)
  // Remove the whole directory subtree (covers files + empty nested dirs).
  try {
    rmSync(join(generatedDir(rt), folder), { recursive: true, force: true })
  } catch {
    // Best-effort; the index update above already dropped the records.
  }
  return { deleted: removed.map((it) => it.alias), ok: true }
}

export function readGeneratedAsset(rt: Runtime, alias: string): { record: GeneratedAssetRecord; bytes: Buffer } | null {
  if (isPresetAlias(alias)) return readPresetAsset(alias)
  const record = readIndex(rt).find((item) => item.alias === alias)
  if (!record) return null
  const bytes = rt.assets.read(record.relPath)
  return bytes ? { record, bytes } : null
}

export function readGeneratedAssetByBlobId(rt: Runtime, blobId: string): { record: GeneratedAssetRecord; bytes: Buffer } | null {
  const record = readIndex(rt).find((item) => item.blobId === blobId)
  if (!record) return readPresetAssetByBlobId(blobId)
  const bytes = rt.assets.read(record.relPath)
  return bytes ? { record, bytes } : null
}

/**
 * Remove a generated asset by alias: delete its backing file from the asset
 * store and drop its record from the index. Returns the deleted record, or null
 * when the alias is unknown. The same `blobId` may back several aliases (dedup),
 * so we only remove the file when no other index entry still references it —
 * otherwise we'd orphan the surviving aliases' `<img>` URLs.
 */
export function deleteGeneratedAsset(rt: Runtime, alias: string): GeneratedAssetRecord | null {
  // Preset assets are plugin-shipped and read-only: never deletable.
  if (isPresetAlias(alias)) return null
  const items = readIndex(rt)
  const record = items.find((item) => item.alias === alias)
  if (!record) return null
  const remaining = items.filter((item) => item.alias !== alias)
  const blobStillUsed = remaining.some((item) => item.relPath === record.relPath)
  if (!blobStillUsed) {
    try {
      rt.assets.remove(record.relPath)
    } catch {
      // File may already be gone; the index removal below still cleans up.
    }
  }
  writeIndex(rt, remaining)
  return record
}

/**
 * Delete several assets in one pass. Computed against a single index snapshot so
 * file removal correctly accounts for dedup: a backing file is only removed when
 * **no surviving** alias (outside the deletion set) still references its
 * `relPath`. Returns the list of aliases that actually existed and were removed.
 */
export function deleteGeneratedAssets(rt: Runtime, aliases: string[]): string[] {
  // Preset assets are read-only — silently drop them from the deletion set so a
  // mixed selection still removes the deletable (real index) entries.
  const wanted = new Set(aliases.filter((a) => !isPresetAlias(a)))
  const items = readIndex(rt)
  const removed = items.filter((item) => wanted.has(item.alias))
  if (removed.length === 0) return []
  const remaining = items.filter((item) => !wanted.has(item.alias))
  const survivingPaths = new Set(remaining.map((item) => item.relPath))
  for (const rec of removed) {
    if (!survivingPaths.has(rec.relPath)) {
      try {
        rt.assets.remove(rec.relPath)
      } catch {
        // Best-effort; the index write below still drops the entry.
      }
    }
  }
  writeIndex(rt, remaining)
  return removed.map((item) => item.alias)
}

/**
 * Move generated assets into another folder. The backing file is physically
 * relocated (read → write at the new `relPath` → remove the old path) and the
 * index entry's `folder`/`relPath` are updated, so thumbnails, drag identity,
 * and dedup-by-`blobId` stay stable. Preset assets are read-only and skipped
 * (never a valid source); the `presets` folder is read-only and rejected as a
 * destination. Returns the aliases that were actually moved.
 */
export function moveGeneratedAssets(rt: Runtime, aliases: string[], rawFolder: string): string[] {
  const folder = slugFolderPath(rawFolder, 'staging')
  if (folder === PRESET_FOLDER) return []
  const wanted = new Set(aliases.filter((a) => !isPresetAlias(a)))
  if (wanted.size === 0) return []
  const items = readIndex(rt)
  const moved: string[] = []
  const next = items.slice()
  for (let i = 0; i < next.length; i++) {
    const rec = next[i]
    if (!wanted.has(rec.alias) || rec.folder === folder) continue
    const fileName = rec.relPath.split('/').pop() ?? rec.alias
    const newRelPath = folder === 'generated' ? `generated/${fileName}` : `generated/${folder}/${fileName}`
    if (newRelPath === rec.relPath) {
      next[i] = { ...rec, folder }
      moved.push(rec.alias)
      continue
    }
    const bytes = rt.assets.read(rec.relPath)
    if (!bytes) continue
    rt.assets.write(newRelPath, bytes)
    // Only remove the old file when no other surviving entry still points at it
    // (dedup: the same relPath can back several aliases).
    const stillUsed = next.some((other, j) => j !== i && other.relPath === rec.relPath)
    if (!stillUsed) {
      try {
        rt.assets.remove(rec.relPath)
      } catch {
        // Best-effort; the index update below still reflects the new location.
      }
    }
    next[i] = { ...rec, folder, relPath: newRelPath }
    moved.push(rec.alias)
  }
  if (moved.length === 0) return []
  writeIndex(rt, next)
  return moved
}

/**
 * Copy a single generated asset into a destination folder, creating a fresh
 * independent entry (new alias) that shares the source's bytes. Used by the
 * AssetStore "paste" action: the source file is read and re-imported into the
 * target folder so the original is preserved and the duplicate lives on its
 * own. Preset sources are allowed (read-only originals stay intact); the
 * `presets` folder is rejected as a destination. Returns the new record, or
 * null when the source alias is unknown.
 */
export function copyGeneratedAssetToFolder(
  rt: Runtime,
  alias: string,
  rawFolder: string,
): GeneratedAssetRecord | null {
  const folder = slugFolderPath(rawFolder, 'staging')
  if (folder === PRESET_FOLDER) return null
  const found = readGeneratedAsset(rt, alias)
  if (!found) return null
  const base = found.record.alias.replace(/\.[^.]+$/u, '')
  const saved = importGeneratedImage(rt, {
    imageBase64: found.bytes.toString('base64'),
    mimeType: found.record.mimeType,
    prompt: base,
    source: 'user-paste',
    folder,
    tags: ['user-paste'],
    ...(found.record.name ? { name: found.record.name } : {}),
  })
  return saved.asset
}

/**
 * Compute a display name that is unique across the index (excluding the asset
 * being renamed). When `desired` collides with another asset's effective name
 * (its `name`, or `alias` fallback), append ` (2)`, ` (3)`, … until free.
 */
function uniqueDisplayName(items: GeneratedAssetRecord[], desired: string, exceptAlias: string): string {
  const taken = new Set(
    items.filter((item) => item.alias !== exceptAlias).map((item) => (item.name ?? item.alias).trim()),
  )
  if (!taken.has(desired)) return desired
  for (let n = 2; n < 10_000; n++) {
    const candidate = `${desired} (${n})`
    if (!taken.has(candidate)) return candidate
  }
  return `${desired} (${Date.now().toString(36)})`
}

/**
 * Rename a generated asset's human-readable display name (the card title). The
 * backing file, `alias`, `blobId`, and `relPath` are untouched — only the `name`
 * field in the index changes, so thumbnail URLs, drag identity, and dedup stay
 * stable. The requested name is trimmed and made unique across the index
 * (auto-suffixing ` (N)` on collision). Returns the updated record, or null when
 * the alias is unknown or the trimmed name is empty.
 */
export function renameGeneratedAsset(rt: Runtime, alias: string, rawName: string): GeneratedAssetRecord | null {
  const desired = rawName.trim()
  if (!desired) return null
  const items = readIndex(rt)
  const idx = items.findIndex((item) => item.alias === alias)
  if (idx === -1) return null
  const name = uniqueDisplayName(items, desired, alias)
  const updated: GeneratedAssetRecord = { ...items[idx], name }
  const next = items.slice()
  next[idx] = updated
  writeIndex(rt, next)
  return updated
}

/**
 * Toggle/set the `favorite` flag on a single generated asset. Favoriting only
 * flips a boolean on the existing record — it never copies the asset, so a
 * favorited image still lives as one file in its original folder. Preset assets
 * are read-only and cannot be favorited. Returns the updated record, or null
 * when the alias is unknown.
 */
export function setGeneratedAssetFavorite(
  rt: Runtime,
  alias: string,
  favorite: boolean,
  group?: string | null,
): GeneratedAssetRecord | null {
  if (isPresetAlias(alias)) return null
  const items = readIndex(rt)
  const idx = items.findIndex((item) => item.alias === alias)
  if (idx === -1) return null
  const updated: GeneratedAssetRecord = { ...items[idx], favorite }
  if (!favorite) {
    delete updated.favorite
    delete updated.favoriteGroup // un-favoriting drops any group membership
  } else if (group !== undefined) {
    const g = group?.trim()
    if (g) updated.favoriteGroup = g
    else delete updated.favoriteGroup
  }
  const next = items.slice()
  next[idx] = updated
  writeIndex(rt, next)
  return updated
}

/** Move favorited assets into a favorite sub-group (or out of all groups when
 *  `group` is null/empty). Auto-favorites any target that wasn't yet favorited,
 *  so dragging into a group is a one-step organize. Returns updated aliases. */
export function setAssetsFavoriteGroup(rt: Runtime, aliases: string[], group: string | null): string[] {
  const wanted = new Set(aliases.filter((a) => !isPresetAlias(a)))
  if (wanted.size === 0) return []
  const g = group?.trim() || null
  const items = readIndex(rt)
  const updated: string[] = []
  const next = items.map((item) => {
    if (!wanted.has(item.alias)) return item
    updated.push(item.alias)
    const rec: GeneratedAssetRecord = { ...item, favorite: true }
    if (g) rec.favoriteGroup = g
    else delete rec.favoriteGroup
    return rec
  })
  if (updated.length > 0) writeIndex(rt, next)
  return updated
}

/**
 * Resolve a battery `image` input (an encoded ImageRef — a `data:` URL or a
 * `{alias,blobId}` JSON string) into the raw image bytes + mime type, so an
 * image-processing battery can decode and transform it. Returns null when the
 * reference is malformed or the alias is not in the generated store.
 */
export function readImageBytesFromRef(
  rt: Runtime,
  image: string,
): { bytes: Buffer; mimeType: string; alias: string } | null {
  const parsed = parseImageRef(image)
  if (!parsed) return null
  if ('dataUrl' in parsed) {
    const decoded = decodeBase64Image(parsed.dataUrl)
    return { bytes: decoded.bytes, mimeType: decoded.mimeType ?? 'image/png', alias: 'data-url' }
  }
  const found = readGeneratedAsset(rt, parsed.alias)
  if (!found) return null
  return { bytes: found.bytes, mimeType: found.record.mimeType, alias: found.record.alias }
}

/**
 * Persist a battery's processed image bytes into the generated store and return
 * an encoded ImageRef for the downstream `image` port. `srcAlias` seeds the
 * output's prompt slug so the new alias visibly derives from its source.
 */
export function writeProcessedImage(
  rt: Runtime,
  req: {
    bytes: Buffer
    mimeType?: string
    operation: string
    srcAlias?: string
    suffix?: string
    folder?: string
  },
): { image: string; asset: GeneratedAssetRecord } {
  const base = (req.srcAlias ?? 'image').replace(/\.[^.]+$/u, '')
  return importGeneratedImage(rt, {
    imageBase64: req.bytes.toString('base64'),
    mimeType: req.mimeType ?? 'image/png',
    prompt: `${base}${req.suffix ?? `_${req.operation}`}`,
    nodeId: req.operation,
    source: `battery:${req.operation}`,
    folder: req.folder ?? 'processed',
    tags: ['battery', req.operation],
  })
}

export function copyGeneratedImage(
  rt: Runtime,
  req: CopyGeneratedImageRequest,
): { image: string; asset?: GeneratedAssetRecord; width: number; height: number; error: string } {
  const parsed = parseImageRef(req.image)
  if (!parsed) return { image: '', width: 0, height: 0, error: 'invalid image reference' }
  if ('dataUrl' in parsed) {
    const saved = importGeneratedImage(rt, {
      imageBase64: parsed.dataUrl,
      prompt: req.operation,
      source: `battery:${req.operation}`,
      folder: req.folder ?? 'processed',
      tags: req.tags ?? ['battery', req.operation],
      ...(req.name ? { name: req.name } : {}),
      ...(req.overwrite !== undefined ? { overwrite: req.overwrite } : {}),
    })
    return { image: saved.image, asset: saved.asset, width: 0, height: 0, error: '' }
  }
  const found = readGeneratedAsset(rt, parsed.alias)
  if (!found) return { image: req.image, width: 0, height: 0, error: `asset not found: ${parsed.alias}` }
  const base = found.record.alias.replace(/\.[^.]+$/u, '')
  const saved = importGeneratedImage(rt, {
    imageBase64: found.bytes.toString('base64'),
    mimeType: found.record.mimeType,
    prompt: `${base}${req.suffix ?? `_${req.operation}`}`,
    nodeId: req.operation,
    source: `battery:${req.operation}`,
    folder: req.folder ?? 'processed',
    tags: req.tags ?? ['battery', req.operation],
    ...(req.name ? { name: req.name } : {}),
    ...(req.overwrite !== undefined ? { overwrite: req.overwrite } : {}),
  })
  return {
    image: saved.image,
    asset: saved.asset,
    width: 0,
    height: 0,
    error: '',
  }
}

/**
 * Resolve the top-level `.forgeax/grayscale/` column directory where grayscale
 * maps are archived, independent of the per-project asset library. Order:
 *   1. `FORGEAX_GRAYSCALE_ROOT` env (explicit absolute override)
 *   2. walk up from `startDir` to the first ancestor containing `.forgeax/`
 *      → `<repoRoot>/.forgeax/grayscale`
 * Returns null when no `.forgeax/` ancestor is found (caller then skips the
 * column write without failing the image output). Avoids hard-coding a fragile
 * relative depth so it survives the web-dev / desktop-dev / desktop-prod forms.
 */
export function resolveGrayscaleRoot(startDir: string): string | null {
  const override = process.env.FORGEAX_GRAYSCALE_ROOT
  if (override && override.trim()) return resolve(override.trim())
  let dir = resolve(startDir)
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, '.forgeax'))) return join(dir, '.forgeax', 'grayscale')
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/**
 * Persist a battery-generated PNG that has **no source image** (created from
 * scratch, e.g. the house_template grayscale renderer). Dual-write:
 *   1. archive the PNG into the top-level `.forgeax/grayscale/` column (so it
 *      lives in its own dedicated, browsable directory), and
 *   2. import the same bytes into the per-project asset library via
 *      `importGeneratedImage`, returning a `{alias,blobId}` ImageRef for the
 *      downstream `image` port (canvas preview / All Images / consumers).
 *
 * `grayscaleRoot` is resolved by the caller (runtime) via `resolveGrayscaleRoot`.
 * When it is null or the archive write throws, the column write is skipped and
 * an `error` note is returned, but the asset-library `image` output still
 * succeeds — the canvas wiring never breaks because the column is unavailable.
 */
export function createGeneratedImage(
  rt: Runtime,
  req: {
    bytes: Buffer
    width: number
    height: number
    mimeType?: string
    name: string
    nodeId?: string
    folder?: string
    grayscaleRoot?: string | null
  },
): { image: string; width: number; height: number; archivedPath: string; error: string } {
  const mimeType = req.mimeType ?? 'image/png'
  const base = slug(req.name, 'image')

  let archivedPath = ''
  let archiveError = ''
  if (req.grayscaleRoot) {
    try {
      mkdirSync(req.grayscaleRoot, { recursive: true })
      const fileName = `${base}-${Date.now().toString(36)}.${extForMime(mimeType)}`
      const dest = join(req.grayscaleRoot, fileName)
      writeFileSync(dest, req.bytes)
      archivedPath = dest
    } catch (e) {
      archiveError = `grayscale archive failed: ${e instanceof Error ? e.message : String(e)}`
    }
  } else {
    archiveError = 'grayscale column root not resolved'
  }

  const saved = importGeneratedImage(rt, {
    imageBase64: req.bytes.toString('base64'),
    mimeType,
    prompt: req.name,
    nodeId: req.nodeId ?? 'create_image',
    source: 'battery:create_image',
    folder: req.folder ?? 'grayscale',
    tags: ['battery', 'grayscale'],
  })

  return { image: saved.image, width: req.width, height: req.height, archivedPath, error: archiveError }
}
