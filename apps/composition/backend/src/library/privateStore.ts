/**
 * Project-private asset store — the WRITABLE companion to the read-only shared
 * `library.db`.
 *
 * The built-in library (`materials/asset-store/library.db`) ships as content and
 * is opened read-only (see `db.ts`); app code must never write it. User-imported
 * and user-edited assets therefore live HERE instead, as a per-project private
 * library under the ACTIVE PROJECT's folder — the same place the baked-scene
 * store persists (`getActiveProjectDir()`):
 *
 *   <activeProject>/private-assets/index.json            ← record array
 *   <activeProject>/private-assets/blobs/<sha2>/<sha>     ← content-addressed
 *
 * The AssetStore pane MERGES these private records with the base library for
 * display (private ones flagged `private: true` + a corner badge). Only private
 * records can be imported, renamed/repaired, moved, trashed, or deleted; the
 * base library stays immutable.
 */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getActiveProjectDir } from '../runtime.js'
import { SLOT } from './aliasName.js'
import { validateTileAtlasDimensions } from './tileRuleAtlasValidation.js'

/** A user-owned asset record. Superset of the base `AssetRecord` with origin/time
 *  metadata and the `private` discriminator the frontend badges. */
export interface PrivateAssetRecord {
  id: string
  alias: string
  zone: string
  blobSha256: string
  mimeType: string
  sizeBytes: number
  widthPx?: number
  heightPx?: number
  anchorX: number | null
  anchorY: number | null
  source: 'manual' | 'pipeline' | 'ai_gen'
  createdAt: string
  updatedAt: string
  private: true
  /** Autotile rule binding for published tiles (e.g. `common_16`). A non-empty,
   *  non-`asset`/`object` value marks an exported tile group, so `deriveAliasMeta`
   *  reads it as the exact rule — covers rules the field[8] legacy map can't
   *  reach (slope_9, …). Unset for cutout objects. */
  assetKind?: string
  /** Optional placement geometry JSON (object_height / collision_mask) for
   *  object assets, mirrored from the base library's `geometry_json`. */
  geometryJson?: string
  /** Provenance: source 2D-asset blob id, so re-publishing the same bytes is
   *  idempotent (dedup by this id rather than creating duplicate records). */
  sourceBlobId?: string
}

/** Default landing zone for a freshly imported asset (mirrors legacy upload). */
export const STAGING_ZONE = 'staging'
/** Soft-delete (recycle bin) zone. Restoring moves back to `staging`. */
export const TRASH_ZONE = 'trash'

const DIR = 'private-assets'
const INDEX = 'index.json'

// One cached index per project file path (active project rarely changes within a
// process; switching just resolves a different path). Mirrors baked/store.ts.
const cache = new Map<string, PrivateAssetRecord[]>()

function storeDir(projDir: string): string {
  return join(projDir, DIR)
}
function indexPath(projDir: string): string {
  return join(storeDir(projDir), INDEX)
}

function load(projDir: string): PrivateAssetRecord[] {
  const path = indexPath(projDir)
  const hit = cache.get(path)
  if (hit) return hit
  let list: PrivateAssetRecord[] = []
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf-8'))
      if (Array.isArray(parsed)) list = parsed as PrivateAssetRecord[]
    } catch {
      list = []
    }
  }
  cache.set(path, list)
  return list
}

function persist(projDir: string, list: PrivateAssetRecord[]): void {
  const path = indexPath(projDir)
  cache.set(path, list)
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  // Atomic write (tmp + rename), mirroring the kernel registry / baked store.
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf-8')
  renameSync(tmp, path)
}

/** Disk path of a private blob: `<store>/blobs/{sha[0:2]}/{sha}`. */
export function resolvePrivateBlobPath(projDir: string, sha: string): string {
  return join(storeDir(projDir), 'blobs', sha.slice(0, 2), sha)
}

function writeBlob(projDir: string, sha: string, bytes: Buffer): void {
  const path = resolvePrivateBlobPath(projDir, sha)
  if (existsSync(path)) return // content-addressed → identical bytes already there
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, bytes)
}

/** Remove a blob only when no remaining record references its sha (dedup-safe). */
function gcBlob(projDir: string, sha: string, list: PrivateAssetRecord[]): void {
  if (list.some((r) => r.blobSha256 === sha)) return
  const path = resolvePrivateBlobPath(projDir, sha)
  try {
    if (existsSync(path)) rmSync(path)
  } catch {
    /* best-effort */
  }
}

// ── Image dimension sniffing (PNG/JPEG/GIF/WebP headers, no decode) ──────────

function sniffDimensions(buf: Buffer): { widthPx?: number; heightPx?: number } {
  // PNG: 8-byte sig, then IHDR (width @16, height @20, big-endian).
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { widthPx: buf.readUInt32BE(16), heightPx: buf.readUInt32BE(20) }
  }
  // GIF: "GIF8", then logical screen width/height (little-endian @6/@8).
  if (buf.length >= 10 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
    return { widthPx: buf.readUInt16LE(6), heightPx: buf.readUInt16LE(8) }
  }
  // JPEG: scan for a SOF marker (0xFFC0..0xFFCF except C4/C8/CC).
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++
        continue
      }
      const marker = buf[i + 1]
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { heightPx: buf.readUInt16BE(i + 5), widthPx: buf.readUInt16BE(i + 7) }
      }
      const segLen = buf.readUInt16BE(i + 2)
      if (segLen < 2) break
      i += 2 + segLen
    }
  }
  // WebP: RIFF....WEBP; VP8X has 24-bit canvas dims @24/@27 (minus-one encoded).
  if (
    buf.length >= 30 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP' &&
    buf.toString('ascii', 12, 16) === 'VP8X'
  ) {
    const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16))
    const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16))
    return { widthPx: w, heightPx: h }
  }
  return {}
}

// ── Public API (all resolve the active project's store) ─────────────────────

/** Every private record in the active project (all zones). */
export async function listAllPrivate(): Promise<PrivateAssetRecord[]> {
  return load(await getActiveProjectDir())
}

/**
 * Count a project's live private assets (any zone except trash) by ABSOLUTE
 * project dir — works for ANY project, not just the active one, so the delete
 * dialog can probe a project it isn't currently opened on. Trash is a soft-
 * delete bucket, so trashed records don't count as "produced assets".
 */
export function countLivePrivateAssets(projDir: string): number {
  return load(projDir).filter((r) => r.zone !== TRASH_ZONE).length
}

export async function getPrivateById(id: string): Promise<PrivateAssetRecord | null> {
  return (await listAllPrivate()).find((r) => r.id === id) ?? null
}

export async function getPrivateByAlias(alias: string): Promise<PrivateAssetRecord | null> {
  // Prefer a non-trash record (trash is "deleted"); else any match.
  const list = await listAllPrivate()
  return list.find((r) => r.alias === alias && r.zone !== TRASH_ZONE) ?? list.find((r) => r.alias === alias) ?? null
}

/** Distinct private zones present (e.g. ['staging','trash']). */
export async function listPrivateZones(): Promise<string[]> {
  const set = new Set<string>()
  for (const r of await listAllPrivate()) set.add(r.zone)
  return [...set]
}

export interface ImportInput {
  filename: string
  mimeType?: string
  /** base64-encoded file bytes (the iframe sandbox blocks multipart downloads,
   *  so the frontend reads the File as base64 and POSTs JSON). */
  dataBase64: string
  zone?: string
  /** Prefab / pipeline provenance — idempotent re-import by this key. */
  sourceBlobId?: string
  anchorX?: number | null
  anchorY?: number | null
  geometryJson?: string
  assetKind?: string
  cropTypeOriginal?: string
  /** Override `source` discriminator (default `manual`). */
  sourceTag?: 'manual' | 'pipeline' | 'ai_gen'
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
}

function guessMime(filename: string, given?: string): string {
  if (given && given !== 'application/octet-stream') return given
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

/** Import one file as a private asset. The alias is the raw filename
 *  (bracket-field exports keep their full alias as-is). */
export async function importPrivateAsset(input: ImportInput): Promise<PrivateAssetRecord> {
  const projDir = await getActiveProjectDir()
  const list = load(projDir)
  const bytes = Buffer.from(input.dataBase64, 'base64')
  if (bytes.length === 0) throw new Error('empty asset bytes (dataBase64)')
  const sha = createHash('sha256').update(bytes).digest('hex')
  writeBlob(projDir, sha, bytes)
  const dims = sniffDimensions(bytes)
  const now = new Date().toISOString()
  const alias = input.filename.trim() || `import-${sha.slice(0, 8)}`
  const zone = input.zone ?? STAGING_ZONE

  const fields = {
    alias,
    zone,
    blobSha256: sha,
    mimeType: guessMime(input.filename, input.mimeType),
    sizeBytes: bytes.length,
    ...(dims.widthPx ? { widthPx: dims.widthPx } : {}),
    ...(dims.heightPx ? { heightPx: dims.heightPx } : {}),
    anchorX: input.anchorX ?? null,
    anchorY: input.anchorY ?? null,
    source: input.sourceTag ?? ('manual' as const),
    updatedAt: now,
    private: true as const,
    ...(input.geometryJson ? { geometryJson: input.geometryJson } : {}),
    ...(input.assetKind ? { assetKind: input.assetKind } : {}),
    ...(input.cropTypeOriginal ? { cropTypeOriginal: input.cropTypeOriginal } : {}),
    ...(input.sourceBlobId ? { sourceBlobId: input.sourceBlobId } : {}),
  }

  const idx = input.sourceBlobId
    ? list.findIndex((r) => r.sourceBlobId === input.sourceBlobId)
    : list.findIndex((r) => r.alias === alias && r.zone === zone)
  if (idx >= 0) {
    const prev = list[idx]
    const next: PrivateAssetRecord = { ...prev, ...fields }
    const copy = [...list]
    copy[idx] = next
    persist(projDir, copy)
    gcBlob(projDir, prev.blobSha256, copy)
    return next
  }

  const rec: PrivateAssetRecord = { id: randomUUID(), createdAt: now, ...fields }
  persist(projDir, [...list, rec])
  return rec
}

// ── Texture-pipeline publish bridge (cross-app asset hand-off) ───────────────
//
// The 2D-asset app generates PNGs in its OWN isolated FORGEAX_PROJECT_ROOT. To
// make one matchable by THIS scene's billboard renderer it must be PUBLISHED
// into the active scene project's private `raw` zone with a renderer-shaped
// alias. `publishExternalAsset` does that atomically (compose alias → bind tile
// rule → land in raw → record provenance), so the orchestration skill never
// has to hand-stitch import + repair + field-edit + move.

export const CUTOUT_TYPE_FIELD = 'asset'

/** Compose the renderer's 12-bracket alias from a semantic descriptor. Shared by
 *  the private publish bridge AND the shared-game-sandbox reader so a texture
 *  matches identically no matter which source surfaced it. field2=item-name,
 *  field7=autotile rule (tile) | asset (cutout object). */
export function composeRendererAlias(input: {
  assetName: string
  assetType: 'tile' | 'object'
  autotileKind?: string
  extraFields?: Record<number, string>
}): string {
  const fields = Array.from({ length: 13 }, () => '')
  for (const [idx, val] of Object.entries(input.extraFields ?? {})) {
    const i = Number(idx)
    if (Number.isInteger(i) && i >= 0 && i < 13) fields[i] = String(val).trim()
  }
  fields[2] = input.assetName.trim()
  fields[7] = input.assetType === 'tile' ? (input.autotileKind ?? '').trim() : CUTOUT_TYPE_FIELD
  return fields.map((f) => `[${f}]`).join('_') + '.png'
}

export interface PublishExternalInput {
  /** field[2] semantic item-name the renderer matches on (e.g. `grassland`). */
  assetName: string
  /** `tile` → non-cutout pool + autotile rule; `object` → cutout pool. */
  assetType: 'tile' | 'object'
  /** base64-encoded PNG bytes (the 2D app's generated blob, read by the skill). */
  dataBase64: string
  /** Autotile rule alias for tiles (e.g. `common_16`). REQUIRED when type=tile. */
  autotileKind?: string
  /** Provenance / idempotency key — the source 2D blob id. Re-publishing the
   *  same id updates the existing record in place (no duplicate). */
  sourceBlobId?: string
  anchorX?: number | null
  anchorY?: number | null
  /** Optional placement geometry JSON (object_height / collision_mask). */
  geometryJson?: string
  /** Extra bracket fields by 0-based index (index/place/style/…). field 2 (name)
   *  and field 7 (type/rule) are owned by this bridge and ignored here. */
  extraFields?: Record<number, string>
}

/** 13 bracket fields with item-name (2) + type (7) set, plus any extras. */
function composePublishAlias(input: PublishExternalInput): string {
  return composeRendererAlias({
    assetName: input.assetName,
    assetType: input.assetType,
    ...(input.autotileKind !== undefined ? { autotileKind: input.autotileKind } : {}),
    ...(input.extraFields !== undefined ? { extraFields: input.extraFields } : {}),
  })
}

/**
 * Publish a 2D-generated texture into the active scene project's private `raw`
 * zone so the billboard renderer can match it. Atomic + idempotent.
 */
export async function publishExternalAsset(input: PublishExternalInput): Promise<PrivateAssetRecord> {
  if (!input.assetName?.trim()) throw new Error('assetName is required')
  if (input.assetType !== 'tile' && input.assetType !== 'object') {
    throw new Error("assetType must be 'tile' or 'object'")
  }
  if (input.assetType === 'tile' && !input.autotileKind?.trim()) {
    throw new Error('autotileKind is required for tile assets')
  }
  const projDir = await getActiveProjectDir()
  const list = load(projDir)
  const bytes = Buffer.from(input.dataBase64, 'base64')
  if (bytes.length === 0) throw new Error('empty asset bytes (dataBase64)')
  const dims = sniffDimensions(bytes)
  const isTile = input.assetType === 'tile'
  if (isTile) {
    const check = validateTileAtlasDimensions(input.autotileKind!, dims.widthPx, dims.heightPx)
    if (!check.ok) throw new Error(check.error)
  }
  const sha = createHash('sha256').update(bytes).digest('hex')
  writeBlob(projDir, sha, bytes)
  const now = new Date().toISOString()
  const alias = composePublishAlias(input)

  const fields = {
    alias,
    zone: 'raw',
    blobSha256: sha,
    mimeType: 'image/png',
    sizeBytes: bytes.length,
    ...(dims.widthPx ? { widthPx: dims.widthPx } : {}),
    ...(dims.heightPx ? { heightPx: dims.heightPx } : {}),
    anchorX: input.anchorX ?? null,
    anchorY: input.anchorY ?? null,
    source: 'pipeline' as const,
    updatedAt: now,
    private: true as const,
    ...(isTile ? { assetKind: input.autotileKind!.trim() } : {}),
    ...(input.geometryJson ? { geometryJson: input.geometryJson } : {}),
    ...(input.sourceBlobId ? { sourceBlobId: input.sourceBlobId } : {}),
  }

  // Idempotent: same provenance → update in place; else same alias in raw.
  const idx = input.sourceBlobId
    ? list.findIndex((r) => r.sourceBlobId === input.sourceBlobId)
    : list.findIndex((r) => r.alias === alias && r.zone === 'raw')
  if (idx >= 0) {
    const prev = list[idx]
    const next: PrivateAssetRecord = { ...prev, ...fields }
    const copy = [...list]
    copy[idx] = next
    persist(projDir, copy)
    gcBlob(projDir, prev.blobSha256, copy)
    return next
  }

  const rec: PrivateAssetRecord = { id: randomUUID(), createdAt: now, ...fields }
  persist(projDir, [...list, rec])
  return rec
}

function mutate(
  projDir: string,
  id: string,
  fn: (rec: PrivateAssetRecord) => PrivateAssetRecord,
): PrivateAssetRecord | null {
  const list = load(projDir)
  const idx = list.findIndex((r) => r.id === id)
  if (idx < 0) return null
  const next = fn({ ...list[idx], updatedAt: new Date().toISOString() })
  const copy = [...list]
  copy[idx] = next
  persist(projDir, copy)
  return next
}

/** Rename/repair a private asset's alias. */
export async function renamePrivate(id: string, alias: string): Promise<PrivateAssetRecord | null> {
  return updatePrivateMeta(id, { alias })
}

/** Patch alias and/or anchor on a private asset. */
export async function updatePrivateMeta(
  id: string,
  patch: { alias?: string; anchorX?: number | null; anchorY?: number | null },
): Promise<PrivateAssetRecord | null> {
  const projDir = await getActiveProjectDir()
  return mutate(projDir, id, (r) => ({
    ...r,
    ...(patch.alias !== undefined ? { alias: patch.alias.trim() || r.alias } : {}),
    ...(patch.anchorX !== undefined ? { anchorX: patch.anchorX } : {}),
    ...(patch.anchorY !== undefined ? { anchorY: patch.anchorY } : {}),
  }))
}

/** Move a private asset to a different zone (e.g. staging↔raw, or → trash). */
export async function movePrivate(id: string, zone: string): Promise<PrivateAssetRecord | null> {
  const projDir = await getActiveProjectDir()
  return mutate(projDir, id, (r) => ({ ...r, zone }))
}

/** Soft-delete: move into the trash zone. */
export async function trashPrivate(id: string): Promise<PrivateAssetRecord | null> {
  return movePrivate(id, TRASH_ZONE)
}

/** Restore from trash back to staging. */
export async function restorePrivate(id: string): Promise<PrivateAssetRecord | null> {
  return movePrivate(id, STAGING_ZONE)
}

/** Permanently remove a private asset (and its blob if now unreferenced). */
export async function deletePrivate(id: string): Promise<boolean> {
  const projDir = await getActiveProjectDir()
  const list = load(projDir)
  const idx = list.findIndex((r) => r.id === id)
  if (idx < 0) return false
  const removed = list[idx]
  const copy = list.filter((r) => r.id !== id)
  persist(projDir, copy)
  gcBlob(projDir, removed.blobSha256, copy)
  return true
}

/** Bracket fields of an alias, trimmed. `[a]_[]_[b]` → ['a','','b']. */
export function bracketFields(alias: string): string[] {
  const out: string[] = []
  const re = /\[([^\]]*)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(alias)) !== null) out.push(m[1].trim())
  return out
}

function fieldAt(alias: string, idx: number): string {
  const f = bracketFields(alias)
  return idx < f.length ? f[idx] : ''
}

type PrivateFacetScheme = 'type' | 'place' | 'style' | 'size' | 'index'

export interface PrivateFilter {
  zone: string
  search?: string
  fieldFilters?: Array<{ fieldIdx: number; value: string }>
  by?: PrivateFacetScheme
  value?: string
  parent?: string
}

const FIELD_INDEX: Record<string, number> = {
  type: SLOT.cropType,
  style: SLOT.themeStyle,
  size: SLOT.size,
  index: SLOT.index,
}
const PLACE_INDOOR = SLOT.indoorOutdoor
const UNCLASSIFIED = '__none__'

function isBlank(v: string): boolean {
  return v === '' || v === '—'
}

function matchesFacet(alias: string, by?: string, value?: string, parent?: string): boolean {
  if (!by || value == null) return true
  if (by === 'place') {
    // single-level: match 室内/室外 only (parent kept for API compat)
    const target = parent != null ? parent : value
    const lvl1 = fieldAt(alias, PLACE_INDOOR)
    return target === UNCLASSIFIED ? isBlank(lvl1) : lvl1 === target
  }
  if (by === 'index') {
    const raw = fieldAt(alias, FIELD_INDEX.index)
    if (value === UNCLASSIFIED) return isBlank(raw)
    // Hierarchy leaf = whole subtree: the node itself or any descendant.
    return raw === value || raw.startsWith(`${value}-`)
  }
  const f = fieldAt(alias, FIELD_INDEX[by])
  return value === UNCLASSIFIED ? isBlank(f) : f === value
}

/** Private records matching a list query, sorted by alias (same order as base). */
function filterPrivateList(list: PrivateAssetRecord[], q: PrivateFilter): PrivateAssetRecord[] {
  const term = (q.search ?? '').trim().toLowerCase()
  return list
    .filter((r) => r.zone === q.zone)
    .filter((r) => {
      if (!term) return true
      const alias = r.alias.toLowerCase()
      const itemName = fieldAt(r.alias, SLOT.name).toLowerCase()
      return alias.includes(term) || itemName.includes(term)
    })
    .filter((r) =>
      (q.fieldFilters ?? []).every((ff) => fieldAt(r.alias, ff.fieldIdx).includes(ff.value.trim())),
    )
    .filter((r) => matchesFacet(r.alias, q.by, q.value, q.parent))
    .sort((a, b) => a.alias.localeCompare(b.alias))
}

export function filterPrivateForProjectDir(projDir: string, q: PrivateFilter): PrivateAssetRecord[] {
  return filterPrivateList(load(projDir), q)
}

/** All private records across every zone except trash (renderer matching pool). */
export function filterPrivateAllZonesForProjectDir(projDir: string): PrivateAssetRecord[] {
  return load(projDir).filter((r) => r.zone !== TRASH_ZONE)
}

export function getPrivateByAliasForProjectDir(projDir: string, alias: string): PrivateAssetRecord | null {
  const list = load(projDir)
  return list.find((r) => r.alias === alias && r.zone !== TRASH_ZONE) ?? list.find((r) => r.alias === alias) ?? null
}

export async function filterPrivate(q: PrivateFilter): Promise<PrivateAssetRecord[]> {
  return filterPrivateList(await listAllPrivate(), q)
}

export interface PrivateFacetItem {
  value: string
  label: string
  count: number
  samples: string[]
}

/** Bucket private records of a zone into taxonomy folders (mirrors service.listFacets). */
export async function facetPrivate(
  zone: string,
  by: PrivateFacetScheme,
  parent?: string,
): Promise<PrivateFacetItem[]> {
  // place is single-level now (小区域/roomType removed): drill-in has no sub-rooms.
  if (by === 'place' && parent != null) return []
  const list = (await listAllPrivate()).filter((r) => r.zone === zone)
  // `index` is a `-`-joined hierarchy: enumerate direct child segments under `parent`.
  if (by === 'index') return facetPrivateIndexChildren(list, parent)
  const groupIdx = by === 'place' ? PLACE_INDOOR : FIELD_INDEX[by]
  const buckets = new Map<string, { count: number; samples: string[] }>()
  for (const r of list) {
    const raw = fieldAt(r.alias, groupIdx)
    const value = isBlank(raw) ? UNCLASSIFIED : raw
    let entry = buckets.get(value)
    if (!entry) {
      entry = { count: 0, samples: [] }
      buckets.set(value, entry)
    }
    entry.count += 1
    if (entry.samples.length < 4) entry.samples.push(r.alias)
  }
  return [...buckets.entries()].map(([value, e]) => ({
    value,
    label: value === UNCLASSIFIED ? '未分类' : value,
    count: e.count,
    samples: e.samples,
  }))
}

/** Direct child segments of the `index` (f0) hierarchy under `parent` (mirrors service.facetIndexChildren). */
function facetPrivateIndexChildren(list: PrivateAssetRecord[], parent?: string): PrivateFacetItem[] {
  const prefix = (parent ?? '').trim()
  const buckets = new Map<string, { label: string; count: number; samples: string[] }>()
  for (const r of list) {
    const f0 = fieldAt(r.alias, 0)
    let rest: string
    if (prefix) {
      if (f0 === prefix || !f0.startsWith(`${prefix}-`)) continue
      rest = f0.slice(prefix.length + 1)
    } else if (isBlank(f0)) {
      const entry = buckets.get(UNCLASSIFIED) ?? { label: '未分类', count: 0, samples: [] }
      entry.count += 1
      if (entry.samples.length < 4) entry.samples.push(r.alias)
      buckets.set(UNCLASSIFIED, entry)
      continue
    } else {
      rest = f0
    }
    const seg = rest.split('-')[0]
    if (!seg) continue
    const childPath = prefix ? `${prefix}-${seg}` : seg
    const entry = buckets.get(childPath) ?? { label: seg, count: 0, samples: [] }
    entry.count += 1
    if (entry.samples.length < 4) entry.samples.push(r.alias)
    buckets.set(childPath, entry)
  }
  return [...buckets.entries()].map(([value, e]) => ({ value, label: e.label, count: e.count, samples: e.samples }))
}

/** Per-zone aggregate counts of private records (library-info panel). */
export async function privateZoneStats(): Promise<Array<{ zone: string; assetCount: number; totalBytes: number }>> {
  const map = new Map<string, { assetCount: number; totalBytes: number }>()
  for (const r of await listAllPrivate()) {
    const e = map.get(r.zone) ?? { assetCount: 0, totalBytes: 0 }
    e.assetCount += 1
    e.totalBytes += r.sizeBytes
    map.set(r.zone, e)
  }
  return [...map.entries()].map(([zone, e]) => ({ zone, ...e }))
}

/** Distinct values of one bracket field across private records (CategoryNav). */
export async function privateFieldValues(fieldIdx: number, zone?: string): Promise<string[]> {
  const set = new Set<string>()
  for (const r of await listAllPrivate()) {
    if (zone && r.zone !== zone) continue
    const v = fieldAt(r.alias, fieldIdx)
    if (v && !isBlank(v)) set.add(v)
  }
  return [...set]
}

/** Private records whose alias is NOT in the bracket-field convention (no '['). */
export async function listNonStandardPrivate(): Promise<PrivateAssetRecord[]> {
  return (await listAllPrivate()).filter((r) => r.zone !== TRASH_ZONE && !r.alias.includes('['))
}

/** Test-only: drop the in-memory cache so a fresh load re-reads disk. */
export function _clearPrivateCache(): void {
  cache.clear()
}
