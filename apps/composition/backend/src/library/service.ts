/**
 * Read-only, single-tenant asset-library service.
 *
 * Resolves aliases to asset records (image blobs) from the vendored shared
 * library.db, and exposes the metadata the renderer's autotile matcher needs.
 * Ported from the legacy multi-tenant LibraryService, stripped to the read path
 * (no per-game DB, no import/write, no embeddings/tags).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SLOT } from './aliasName.js'
import { getSharedDb, ASSET_STORE_DIR, repoRoot } from './db.js'

export interface AssetRecord {
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
  /** Set on project-private (user-imported) records so the grid can badge them. */
  private?: true
  geometryJson?: string | null
  /** Free-text tags (asset-store `tags_json`), separate from the 13 alias fields. */
  tags?: string[]
  createdAt?: string
  updatedAt?: string
  /** asset-store QA flags: the generator marked this asset broken / a placeholder. */
  hasError?: boolean
  isPlaceholder?: boolean
}

interface AssetRow {
  id: string
  alias: string
  zone: string
  blob_sha256: string
  mime_type: string
  size_bytes: number
  width_px: number | null
  height_px: number | null
  anchor_x: number | null
  anchor_y: number | null
  geometry_json?: string | null
  tags_json?: string | null
  created_at?: string | null
  updated_at?: string | null
  has_error?: number | null
  is_placeholder?: number | null
}

/** Parse the asset-store `tags_json` column into a string[] (empty → undefined). */
function parseTags(raw?: string | null): string[] | undefined {
  if (!raw) return undefined
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return undefined
    const tags = arr.map((t) => String(t).trim()).filter((t) => t.length > 0)
    return tags.length ? tags : undefined
  } catch {
    return undefined
  }
}

export function normalizeAlias(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, 200) || 'asset'
}

function rowToRecord(row: AssetRow): AssetRecord {
  return {
    id: row.id,
    alias: row.alias,
    zone: row.zone,
    blobSha256: row.blob_sha256,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    widthPx: row.width_px ?? undefined,
    heightPx: row.height_px ?? undefined,
    anchorX: row.anchor_x,
    anchorY: row.anchor_y,
    geometryJson: row.geometry_json ?? null,
    ...(parseTags(row.tags_json) ? { tags: parseTags(row.tags_json) } : {}),
    ...(row.created_at ? { createdAt: row.created_at } : {}),
    ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
    ...(row.has_error ? { hasError: true } : {}),
    ...(row.is_placeholder ? { isPlaceholder: true } : {}),
  }
}

// Short / legacy / taxonomy tokens in alias field[7] → vendored assets/rules/*.json.
// Taxonomy junk (瓦片组/未裁剪/正常) must NOT become tileType as-is — getOrLoadRule
// would 404 and billboard falls back to full-atlas blit (looks like unstitched grass).
const LEGACY_TILETYPE_TO_RULE_ALIAS: Record<string, string> = {
  tilemap: 'common_16',
  flower_bed: 'flower_bed_11',
  fence: 'fence_7',
  floor: 'floor_1',
  wall: 'wall_outer_16',
  /** Inner-wall export id; wall_outer_16 already switches to inner sprites via regions. */
  wa_inner: 'wall_outer_16',
  wa_outer: 'wall_outer_16',
  瓦片组: 'common_16',
  未裁剪: 'common_16',
  正常: 'common_16',
  path: 'common_16',
  street: 'common_16',
  bridge: 'bridge_horizontal_9',
}

// Non-tile type-field sentinels (cutout objects). Anything else in the alias
// type field (idx 7) IS the autotile rule alias (e.g. common_16 / wall_outer_16).
const NON_TILE_ASSET_KINDS = new Set(['', 'asset', 'object', '抠图'])

function isTileAssetKind(assetKind?: string | null): boolean {
  return !NON_TILE_ASSET_KINDS.has((assetKind ?? '').trim())
}

function extractAliasTypeField(alias: string): string {
  const matches = alias.match(/\[([^\]]*)\]/g)
  if (!matches || matches.length <= 7) return ''
  return matches[7].slice(1, -1).trim()
}

/** Resolve field[7] (or legacy token) to a stitch-rule alias for the renderer. */
export function resolveTileTypeFromAliasField(typeField: string): string {
  const raw = typeField.trim()
  if (!isTileAssetKind(raw)) return ''
  return LEGACY_TILETYPE_TO_RULE_ALIAS[raw] ?? raw
}

export function deriveAliasMeta(row: Pick<
  AssetRow,
  'alias' | 'anchor_x' | 'anchor_y' | 'width_px' | 'height_px' | 'geometry_json'
>): AliasMeta {
  // The alias type field (idx 7) now carries the rule alias directly for tiles
  // ('asset'/'' for cutout objects); the standalone asset_kind column was dropped.
  const typeField = extractAliasTypeField(row.alias)
  const tileType = resolveTileTypeFromAliasField(typeField)
  const placement = parsePlacementGeometry(row.geometry_json, row.width_px, row.height_px)
  return {
    alias: row.alias,
    ...(row.anchor_x !== null ? { anchorX: row.anchor_x } : {}),
    ...(row.anchor_y !== null ? { anchorY: row.anchor_y } : {}),
    ...(row.width_px !== null ? { widthPx: row.width_px } : {}),
    ...(row.height_px !== null ? { heightPx: row.height_px } : {}),
    ...(tileType ? { tileType } : {}),
    ...placement,
  }
}

export interface AliasMeta {
  alias: string
  tileType?: string
  anchorX?: number
  anchorY?: number
  widthPx?: number
  heightPx?: number
  ppu?: number
  objectHeightPx?: number
  geometry?: {
    collisionMask?: CollisionMask
  }
}

export type CollisionMask =
  | { kind: 'rectangle'; x: number; y: number; width: number; height: number }
  | { kind: 'polygon'; points: Array<{ x: number; y: number }> }

function parsePlacementGeometry(raw?: string | null, widthPx?: number | null, heightPx?: number | null): Pick<AliasMeta, 'geometry' | 'objectHeightPx' | 'ppu' | 'anchorX' | 'anchorY'> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const objectHeight = numberFrom(parsed.object_height) ?? numberFrom(parsed.objectHeight)
    const maskRaw = parsed.collision_mask ?? parsed.collisionMask
    const category = typeof parsed.collision_category === 'string' ? parsed.collision_category : typeof parsed.collisionCategory === 'string' ? parsed.collisionCategory : ''
    const collisionMask = parseCollisionMask(maskRaw, category, widthPx, heightPx)
    // pivot is the authoritative object anchor — [anchorX, anchorY], bottom-left
    // origin (0=bottom…1=top), exactly the convention the renderer expects. When
    // present it WINS over the descriptor's stored anchor_x/anchor_y, which the
    // publish flow sometimes fills with placeholder defaults (0.5/1) that would
    // seat the sprite's top on the ground and sink the object below it.
    const pivot = parsePivotAnchor(parsed.pivot)
    return {
      ppu: 16,
      ...(objectHeight !== undefined ? { objectHeightPx: objectHeight } : {}),
      ...(collisionMask ? { geometry: { collisionMask } } : {}),
      ...(pivot ? { anchorX: pivot.x, anchorY: pivot.y } : {}),
    }
  } catch {
    return {}
  }
}

/** geometry_json.pivot → { x: anchorX, y: anchorY } (bottom-left origin), or null. */
function parsePivotAnchor(raw: unknown): { x: number; y: number } | null {
  if (!Array.isArray(raw) || raw.length < 2) return null
  const x = numberFrom(raw[0])
  const y = numberFrom(raw[1])
  return x !== undefined && y !== undefined ? { x, y } : null
}

function numberFrom(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function parseCollisionMask(raw: unknown, category = '', widthPx?: number | null, heightPx?: number | null): CollisionMask | undefined {
  if (Array.isArray(raw)) return parseNormalizedCollisionMask(raw, category, widthPx, heightPx)
  if (!raw || typeof raw !== 'object') return undefined
  const obj = raw as Record<string, unknown>
  const kind = typeof obj.kind === 'string' ? obj.kind : typeof obj.type === 'string' ? obj.type : ''
  if (kind === 'rectangle') {
    const x = numberFrom(obj.x)
    const y = numberFrom(obj.y)
    const width = numberFrom(obj.width)
    const height = numberFrom(obj.height)
    if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined
    return { kind: 'rectangle', x, y, width, height }
  }
  if (kind === 'polygon' && Array.isArray(obj.points)) {
    const points = obj.points
      .map((point) => {
        if (Array.isArray(point)) {
          const [x, y] = point
          return numberFrom(x) !== undefined && numberFrom(y) !== undefined ? { x: numberFrom(x)!, y: numberFrom(y)! } : null
        }
        if (point && typeof point === 'object') {
          const x = numberFrom((point as Record<string, unknown>).x)
          const y = numberFrom((point as Record<string, unknown>).y)
          return x !== undefined && y !== undefined ? { x, y } : null
        }
        return null
      })
      .filter((point): point is { x: number; y: number } => point !== null)
    return points.length > 0 ? { kind: 'polygon', points } : undefined
  }
  return undefined
}

function parseNormalizedCollisionMask(raw: unknown[], category: string, widthPx?: number | null, heightPx?: number | null): CollisionMask | undefined {
  const width = numberFrom(widthPx)
  const height = numberFrom(heightPx)
  if (width === undefined || height === undefined || width <= 0 || height <= 0) return undefined

  const points = raw
    .map((point) => parseNormalizedPoint(point, width, height))
    .filter((point): point is { x: number; y: number } => point !== null)
  if (points.length !== raw.length || points.length === 0) return undefined

  const normalizedCategory = category.trim().toLowerCase()
  if (normalizedCategory.startsWith('rect') && points.length >= 2) {
    const [a, b] = points
    const x = Math.min(a.x, b.x)
    const y = Math.min(a.y, b.y)
    return {
      kind: 'rectangle',
      x,
      y,
      width: Math.abs(b.x - a.x),
      height: Math.abs(b.y - a.y),
    }
  }
  if (normalizedCategory.startsWith('poly') && points.length >= 3) return { kind: 'polygon', points }
  return undefined
}

function parseNormalizedPoint(raw: unknown, widthPx: number, heightPx: number): { x: number; y: number } | null {
  if (!Array.isArray(raw)) return null
  const [uRaw, vRaw] = raw
  const u = numberFrom(uRaw)
  const v = numberFrom(vRaw)
  // geometry_json v is bottom-left origin (0=bottom); image pixels are top-left.
  return u !== undefined && v !== undefined ? { x: u * widthPx, y: (1 - v) * heightPx } : null
}

export interface AssetPage {
  items: AssetRecord[]
  total: number
  page: number
  pageSize: number
}

// ── Folder taxonomies (browse the flat zone as nested folders) ──────────────
//
// Each asset alias is a 13-field bracketed name: `[f0]_[f1]__…_[f12].ext`.
// A "taxonomy" buckets a zone into folders by one (or two, for `place`) of those
// fields, so the AssetStore can present folders instead of one flat pile.
//   type  → f7  (asset / autotile 规则别名: common_16 / wall_outer_16 / …)
//   place → f1 (室内/室外)  ← single-level (小区域/roomType 字段已移除)
//   style → f5  (现代日常 / 赛博朋克 / 国风仙侠 / …)
//   size  → f8  (8 / 16 / 32 / 64 / 128 / …)  ← sorted numerically
//   index → f0  (索引/分类路径, a `-`-joined HIERARCHY; drilled level by level)
export type FacetScheme = 'type' | 'place' | 'style' | 'size' | 'index'

const FIELD_INDEX: Record<Exclude<FacetScheme, 'place'>, number> = {
  type: SLOT.cropType,
  style: SLOT.themeStyle,
  size: SLOT.size,
  index: SLOT.index,
}
const PLACE_INDOOR = SLOT.indoorOutdoor

// Sentinel folder value for assets whose field is blank/`—` (e.g. AI raw nodes).
export const UNCLASSIFIED = '__none__'

/** One folder of a taxonomy: a field value, its asset count, and up to 4 cover samples. */
export interface FacetItem {
  value: string
  label: string
  count: number
  /** Up to 4 sample aliases for the folder's peek-thumbnail cover. */
  samples: string[]
}

export interface ListFacetsQuery {
  zone: string
  by: FacetScheme
  /** For `place`: the level-1 value (室内/室外) whose rooms to enumerate.
   *  For `index`: the `-`-joined ancestor path whose direct child segments to
   *  enumerate (undefined/'' = the root level). */
  parent?: string
}

export interface ListRecordsQuery {
  zone: string
  search?: string
  page?: number
  pageSize?: number
  /** When set, restrict the listing to one folder of the given taxonomy. */
  by?: FacetScheme
  value?: string
  parent?: string
  /** 13-field name filters: each must appear in its bracket position (substring). */
  fieldFilters?: Array<{ fieldIdx: number; value: string }>
}

/** Like ListRecordsQuery but addressed by absolute offset/limit (for merging the
 *  base library with the project-private store into one paginated stream). */
export interface ListRecordsRange {
  zone: string
  search?: string
  offset: number
  limit: number
  by?: FacetScheme
  value?: string
  parent?: string
  fieldFilters?: Array<{ fieldIdx: number; value: string }>
}

/** Per-zone aggregate counts (for the library-info / monitor panel). */
export interface ZoneStat {
  zone: string
  assetCount: number
  totalBytes: number
}

/** Bracket fields of an alias, trimmed. `[a]_[]_[b]` → ['a','','b']. */
function bracketFields(alias: string): string[] {
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

function isBlankField(v: string): boolean {
  return v === '' || v === '—'
}

// SQL fragment matching a bracket field == value, or (for the sentinel) blank.
function eqOrBlankClause(idx: number, value: string): { sql: string; params: unknown[] } {
  if (value === UNCLASSIFIED) {
    return { sql: `(bracket_value(alias, ${idx}) IS NULL OR bracket_value(alias, ${idx}) IN ('', '—'))`, params: [] }
  }
  return { sql: `bracket_value(alias, ${idx}) = ?`, params: [value] }
}

function optionalAssetColumns(db: import('better-sqlite3').Database): string {
  const cols = new Set((db.prepare('PRAGMA table_info(assets)').all() as Array<{ name: string }>).map((c) => c.name))
  const optional = [
    'geometry_json',
  ]
  return optional.map((col) => (cols.has(col) ? col : `NULL AS ${col}`)).join(', ')
}

// Build the WHERE fragment restricting a listing to one taxonomy folder.
function facetClause(by?: FacetScheme, value?: string, parent?: string): { sql: string; params: unknown[] } | null {
  if (!by || value == null) return null
  if (by === 'place') {
    // Single-level after 小区域(roomType) field removal: filter by 室内/室外 only.
    return eqOrBlankClause(PLACE_INDOOR, parent != null ? parent : value)
  }
  if (by === 'index') {
    if (value === UNCLASSIFIED) return eqOrBlankClause(FIELD_INDEX.index, value)
    // f0 is a `-`-joined hierarchy path. A folder leaf shows the whole subtree:
    // the node itself OR any descendant (path followed by a `-` boundary).
    return {
      sql: `(bracket_value(alias, ${FIELD_INDEX.index}) = ? OR bracket_value(alias, ${FIELD_INDEX.index}) LIKE ?)`,
      params: [value, `${value}-%`],
    }
  }
  return eqOrBlankClause(FIELD_INDEX[by], value)
}

/**
 * Enumerate the direct child segments of the `index` (f0) hierarchy under the
 * `-`-joined ancestor path `parent` (undefined/'' = root). Each returned folder's
 * `value` is the full path so far and `label` is just the new segment; `count` is
 * the size of that whole subtree. A node's OWN direct assets (f0 === parent) are
 * NOT a child folder — the surface offers a "全部(含子类)" leaf card for those.
 */
function facetIndexChildren(rows: Array<{ alias: string }>, parent?: string): FacetItem[] {
  const prefix = (parent ?? '').trim()
  const buckets = new Map<string, { label: string; count: number; samples: string[] }>()
  for (const { alias } of rows) {
    const f0 = fieldAt(alias, 0)
    let rest: string
    if (prefix) {
      if (f0 === prefix || !f0.startsWith(`${prefix}-`)) continue
      rest = f0.slice(prefix.length + 1)
    } else if (isBlankField(f0)) {
      // Root level: blank-index assets bucket into the 未分类 sentinel folder.
      const entry = buckets.get(UNCLASSIFIED) ?? { label: '未分类', count: 0, samples: [] }
      entry.count += 1
      if (entry.samples.length < 4) entry.samples.push(alias)
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
    if (entry.samples.length < 4) entry.samples.push(alias)
    buckets.set(childPath, entry)
  }
  return [...buckets.entries()]
    .map(([value, e]) => ({ value, label: e.label, count: e.count, samples: e.samples }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-Hans'))
}

/** Per-face summary of a tilemap rule (autotile stitching), for the AssetStore card + left-pane detail. */
export interface RuleFaceSummary {
  basePieces: number
  /** Number of neighbour-key → sprite-idx entries in the lookup map. */
  mapEntries: number
  /** Number of conditional variant maps (v2 `face.variants`). */
  variants: number
  /** Whether the face declares probabilistic random-variant rules. */
  hasRandom: boolean
}

/**
 * Normalized summary of one vendored rule JSON (assets/rules/<alias>.json).
 * Both v1 (top-only) and v2 (top/front) schemas collapse into this single shape,
 * so the frontend only ever faces `faces.top` / `faces.front`.
 */
export interface RuleListItem {
  alias: string
  name?: string
  description?: string
  schemaVersion: 1 | 2
  ppu: number
  spriteCount: number
  faces: { top?: RuleFaceSummary; front?: RuleFaceSummary }
  regions: string[]
}

export interface LibraryService {
  getByAlias(alias: string, zone?: string): AssetRecord | null
  resolveAssetContent(alias: string, zone?: string): { bytes: Buffer; mimeType: string; widthPx?: number; heightPx?: number } | null
  listAliases(zone: string): string[]
  listAliasesWithMeta(zone: string): AliasMeta[]
  /** Renderer matching pool across ALL zones except trash (deduped by alias). */
  listAllAliasesWithMeta(): AliasMeta[]
  listZones(): string[]
  listRecords(query: ListRecordsQuery): AssetPage
  /** Offset/limit slice + total (for merging base + private into one stream). */
  listRecordsRange(query: ListRecordsRange): { items: AssetRecord[]; total: number }
  listFacets(query: ListFacetsQuery): FacetItem[]
  listRules(): RuleListItem[]
  /** Distinct values of one bracket field across a zone (CategoryNav options). */
  fieldValues(fieldIdx: number, zone?: string): string[]
  /** Per-zone asset counts + bytes (library-info panel). */
  zoneStats(): ZoneStat[]
}

// SQL fragment for the 13-field name filters (substring per bracket position).
function fieldFilterClause(
  fieldFilters?: Array<{ fieldIdx: number; value: string }>,
): { sql: string; params: unknown[] } | null {
  const active = (fieldFilters ?? []).filter((f) => f.value.trim().length > 0)
  if (active.length === 0) return null
  const parts: string[] = []
  const params: unknown[] = []
  for (const f of active) {
    parts.push(`bracket_value(alias, ${Math.floor(f.fieldIdx)}) LIKE ?`)
    params.push(`%${f.value.trim()}%`)
  }
  return { sql: parts.join(' AND '), params }
}

// Shared WHERE builder for listRecords/listRecordsRange.
function buildListWhere(q: {
  zone: string
  search?: string
  by?: FacetScheme
  value?: string
  parent?: string
  fieldFilters?: Array<{ fieldIdx: number; value: string }>
}): { where: string; params: unknown[] } {
  const clauses = ['zone = ?']
  const params: unknown[] = [q.zone]
  const term = (q.search ?? '').trim()
  if (term) {
    clauses.push('(alias LIKE ? OR bracket_value(alias, 2) LIKE ?)')
    params.push(`%${term}%`, `%${term}%`)
  }
  const facet = facetClause(q.by, q.value, q.parent)
  if (facet) {
    clauses.push(facet.sql)
    params.push(...facet.params)
  }
  const ff = fieldFilterClause(q.fieldFilters)
  if (ff) {
    clauses.push(ff.sql)
    params.push(...ff.params)
  }
  return { where: clauses.join(' AND '), params }
}

// ── Rule-file normalization (mirrors ruleCache.ts parseRule semantics) ──────

function summarizeFace(raw: unknown): RuleFaceSummary | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const face = raw as { basePieces?: unknown; map?: unknown; variants?: unknown; randomRules?: unknown }
  const map = face.map && typeof face.map === 'object' ? (face.map as Record<string, unknown>) : {}
  return {
    basePieces: typeof face.basePieces === 'number' ? face.basePieces : 0,
    mapEntries: Object.keys(map).length,
    variants: Array.isArray(face.variants) ? face.variants.length : 0,
    hasRandom: Array.isArray(face.randomRules) && face.randomRules.length > 0,
  }
}

/** Parse one rule JSON into a `RuleListItem`, or null if it is malformed. */
function summarizeRule(alias: string, json: unknown): RuleListItem | null {
  if (!json || typeof json !== 'object') return null
  const r = json as Record<string, unknown>
  const schemaVersion = r.schemaVersion === 1 ? 1 : 2
  const ppu = typeof r.ppu === 'number' ? r.ppu : 0
  const spriteCount = Array.isArray(r.sprites) ? r.sprites.length : 0
  const regions = r.regions && typeof r.regions === 'object' ? Object.keys(r.regions as object) : []

  // v1 keeps basePieces/map/randomRules at the top level (top face only); v2
  // nests them under `faces.{top,front}`. Collapse v1 into `faces.top`.
  const faces =
    schemaVersion === 1
      ? { top: summarizeFace(r) }
      : {
          top: summarizeFace((r.faces as { top?: unknown } | undefined)?.top),
          front: summarizeFace((r.faces as { front?: unknown } | undefined)?.front),
        }

  return {
    alias,
    ...(typeof r.name === 'string' ? { name: r.name } : {}),
    ...(typeof r.description === 'string' ? { description: r.description } : {}),
    schemaVersion,
    ppu,
    spriteCount,
    faces: {
      ...(faces.top ? { top: faces.top } : {}),
      ...(faces.front ? { front: faces.front } : {}),
    },
    regions,
  }
}

function createService(): LibraryService {
  return {
    getByAlias(alias, zone) {
      const db = getSharedDb()
      if (!db) return null
      const row = zone
        ? (db.prepare('SELECT * FROM assets WHERE alias = ? AND zone = ?').get(alias, zone) as AssetRow | undefined)
        : (db
            .prepare("SELECT * FROM assets WHERE alias = ? ORDER BY CASE zone WHEN 'raw' THEN 0 ELSE 1 END LIMIT 1")
            .get(alias) as AssetRow | undefined)
      return row ? rowToRecord(row) : null
    },
    resolveAssetContent(alias, zone) {
      const db = getSharedDb()
      if (!db) return null
      const row = zone
        ? (db.prepare('SELECT * FROM assets WHERE alias = ? AND zone = ?').get(alias, zone) as AssetRow | undefined)
        : (db
            .prepare("SELECT * FROM assets WHERE alias = ? ORDER BY CASE zone WHEN 'raw' THEN 0 ELSE 1 END LIMIT 1")
            .get(alias) as AssetRow | undefined)
      const rec = row ? rowToRecord(row) : null
      if (!rec) return null
      const path = resolveBlobPath(rec)
      if (!existsSync(path)) return null
      return {
        bytes: readFileSync(path),
        mimeType: rec.mimeType,
        ...(rec.widthPx !== undefined ? { widthPx: rec.widthPx } : {}),
        ...(rec.heightPx !== undefined ? { heightPx: rec.heightPx } : {}),
      }
    },
    listAliases(zone) {
      const db = getSharedDb()
      if (!db) return []
      const rows = db.prepare('SELECT alias FROM assets WHERE zone = ? ORDER BY alias').all(zone) as Array<{ alias: string }>
      return rows.map((r) => r.alias)
    },
    listAliasesWithMeta(zone) {
      const db = getSharedDb()
      if (!db) return []
      const rows = db
        .prepare(`SELECT alias, anchor_x, anchor_y, width_px, height_px, ${optionalAssetColumns(db)} FROM assets WHERE zone = ? ORDER BY alias`)
        .all(zone) as Array<Pick<AssetRow, 'alias' | 'anchor_x' | 'anchor_y' | 'width_px' | 'height_px' | 'geometry_json'>>
      return rows.map(deriveAliasMeta)
    },
    listAllAliasesWithMeta() {
      const db = getSharedDb()
      if (!db) return []
      // All zones except trash, one row per alias (GROUP BY dedupes an alias that
      // happens to live in more than one zone). The renderer matches a painted
      // alias regardless of which zone it currently sits in (mirrors serve-by-alias).
      const rows = db
        .prepare(`SELECT alias, anchor_x, anchor_y, width_px, height_px, ${optionalAssetColumns(db)} FROM assets WHERE zone IS NOT NULL AND zone <> 'trash' GROUP BY alias ORDER BY alias`)
        .all() as Array<Pick<AssetRow, 'alias' | 'anchor_x' | 'anchor_y' | 'width_px' | 'height_px' | 'geometry_json'>>
      return rows.map(deriveAliasMeta)
    },
    listZones() {
      const db = getSharedDb()
      if (!db) return []
      const rows = db
        .prepare("SELECT DISTINCT zone FROM assets WHERE zone IS NOT NULL AND zone <> '' ORDER BY zone")
        .all() as Array<{ zone: string }>
      return rows.map((r) => r.zone)
    },
    listRecords({ zone, search, page = 1, pageSize = 60, by, value, parent, fieldFilters }) {
      const db = getSharedDb()
      const safePage = Math.max(1, Math.floor(page))
      const safeSize = Math.min(500, Math.max(1, Math.floor(pageSize)))
      if (!db) return { items: [], total: 0, page: safePage, pageSize: safeSize }
      const { items, total } = this.listRecordsRange({
        zone,
        search,
        by,
        value,
        parent,
        fieldFilters,
        offset: (safePage - 1) * safeSize,
        limit: safeSize,
      })
      return { items, total, page: safePage, pageSize: safeSize }
    },
    listRecordsRange({ zone, search, offset, limit, by, value, parent, fieldFilters }) {
      const db = getSharedDb()
      if (!db) return { items: [], total: 0 }
      const safeOffset = Math.max(0, Math.floor(offset))
      const safeLimit = Math.max(0, Math.floor(limit))
      const { where, params } = buildListWhere({ zone, search, by, value, parent, fieldFilters })
      const totalRow = db
        .prepare(`SELECT COUNT(*) AS c FROM assets WHERE ${where}`)
        .get(...params) as { c: number }
      if (safeLimit === 0) return { items: [], total: totalRow.c }
      const rows = db
        .prepare(`SELECT * FROM assets WHERE ${where} ORDER BY alias LIMIT ? OFFSET ?`)
        .all(...params, safeLimit, safeOffset) as AssetRow[]
      return { items: rows.map(rowToRecord), total: totalRow.c }
    },
    fieldValues(fieldIdx, zone) {
      const db = getSharedDb()
      if (!db) return []
      const idx = Math.max(0, Math.floor(fieldIdx))
      const clauses = [`bracket_value(alias, ${idx}) IS NOT NULL`, `bracket_value(alias, ${idx}) <> ''`]
      const params: unknown[] = []
      if (zone) {
        clauses.unshift('zone = ?')
        params.push(zone)
      }
      const rows = db
        .prepare(
          `SELECT DISTINCT bracket_value(alias, ${idx}) AS v FROM assets WHERE ${clauses.join(' AND ')} ORDER BY v`,
        )
        .all(...params) as Array<{ v: string }>
      return rows.map((r) => r.v).filter((v) => v && v !== '—')
    },
    zoneStats() {
      const db = getSharedDb()
      if (!db) return []
      const rows = db
        .prepare(
          "SELECT zone, COUNT(*) AS c, COALESCE(SUM(size_bytes), 0) AS b FROM assets WHERE zone IS NOT NULL AND zone <> '' GROUP BY zone ORDER BY zone",
        )
        .all() as Array<{ zone: string; c: number; b: number }>
      return rows.map((r) => ({ zone: r.zone, assetCount: r.c, totalBytes: r.b }))
    },
    listFacets({ zone, by, parent }) {
      const db = getSharedDb()
      if (!db) return []
      // One pass over the zone's aliases; bucket by the taxonomy's field(s) in JS
      // (multi-valued / hierarchical fields need JS bucketing + cover samples).
      // place is single-level now (小区域/roomType removed): a drill-in request
      // (parent != null) has no sub-rooms → return an empty facet list.
      if (by === 'place' && parent != null) return []
      const rows = db.prepare('SELECT alias FROM assets WHERE zone = ? ORDER BY alias').all(zone) as Array<{ alias: string }>
      // `index` is a `-`-joined hierarchy: enumerate the DIRECT child segments
      // under the ancestor path `parent` (label = segment, value = full path).
      if (by === 'index') return facetIndexChildren(rows, parent)
      const groupIdx = by === 'place' ? PLACE_INDOOR : FIELD_INDEX[by]
      const buckets = new Map<string, { count: number; samples: string[] }>()
      for (const { alias } of rows) {
        const raw = fieldAt(alias, groupIdx)
        const value = isBlankField(raw) ? UNCLASSIFIED : raw
        let entry = buckets.get(value)
        if (!entry) {
          entry = { count: 0, samples: [] }
          buckets.set(value, entry)
        }
        entry.count += 1
        if (entry.samples.length < 4) entry.samples.push(alias)
      }
      const items: FacetItem[] = [...buckets.entries()].map(([value, e]) => ({
        value,
        label: value === UNCLASSIFIED ? '未分类' : value,
        count: e.count,
        samples: e.samples,
      }))
      if (by === 'size') {
        // Numeric folders (8/16/32/…) read best ascending; '未分类' sinks to the end.
        items.sort((a, b) => {
          const na = Number(a.value)
          const nb = Number(b.value)
          if (Number.isNaN(na)) return 1
          if (Number.isNaN(nb)) return -1
          return na - nb
        })
      } else {
        items.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'zh-Hans'))
      }
      return items
    },
    listRules() {
      const dir = rulesDir()
      if (!existsSync(dir)) return []
      const items: RuleListItem[] = []
      for (const file of readdirSync(dir).sort()) {
        if (!file.endsWith('.json')) continue
        const alias = file.slice(0, -'.json'.length)
        try {
          const summary = summarizeRule(alias, JSON.parse(readFileSync(join(dir, file), 'utf-8')))
          if (summary) items.push(summary)
        } catch {
          // Skip a malformed rule file rather than failing the whole listing.
        }
      }
      return items
    },
  }
}

let instance: LibraryService | null = null

export function getLibraryService(): LibraryService {
  if (!instance) instance = createService()
  return instance
}

/** Disk path of a blob: `<asset-store>/blobs/{sha[0:2]}/{sha[2:4]}/{sha}`. */
export function resolveBlobPath(rec: AssetRecord): string {
  const sha = rec.blobSha256
  return join(ASSET_STORE_DIR, 'blobs', sha.slice(0, 2), sha.slice(2, 4), sha)
}

/** Directory of the vendored rule JSONs (served on a /serve miss). */
export function rulesDir(): string {
  return join(repoRoot, 'assets', 'rules')
}
