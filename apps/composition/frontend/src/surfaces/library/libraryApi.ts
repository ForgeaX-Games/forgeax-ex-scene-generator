// Thin client for the read-only asset-library HTTP routes the AssetStore pane
// browses. Backed by /api/v1/library/{zones,list,serve}.
import { pluginFetch, pluginUrl } from '../../api/pluginHttp'

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
  /** Set on project-private (user-imported) records — the grid badges these. */
  private?: true
  /** Presence drives the list view's "几何" column (matches asset_manager's `hasGeometry`). */
  geometryJson?: string | null
  /** Free-text tags (asset-store `tags_json`), separate from the 13 alias fields. */
  tags?: string[]
  createdAt?: string
  updatedAt?: string
  /** asset-store QA flags surfaced in the preview panel. */
  hasError?: boolean
  isPlaceholder?: boolean
}

/** A 13-field name filter: a substring that must appear in `fieldIdx`'s bracket. */
export interface FieldFilter {
  fieldIdx: number
  value: string
}

/** Merged library-info (read by the left-pane "资产库信息" menu). */
export interface MonitorResult {
  totalAssets: number
  totalBytes: number
  privateCount: number
  zoneStats: Array<{ zone: string; assetCount: number; totalBytes: number; source: 'base' | 'private' }>
}

export interface NonStandardAsset {
  id: string
  alias: string
  zone: string
  sizeBytes: number
}

export interface AssetPage {
  items: AssetRecord[]
  total: number
  page: number
  pageSize: number
}

// Folder taxonomies: bucket a flat zone into folders by one alias field.
//   type → asset type · place → indoor/outdoor · style → art theme
//   size → ppu · index → f0 索引/分类路径 (a `-`-joined hierarchy, drilled level by level)
export type FacetScheme = 'type' | 'place' | 'style' | 'size' | 'index'

// Sentinel folder value (assets with a blank field). Mirrors backend UNCLASSIFIED.
export const UNCLASSIFIED = '__none__'

export interface FacetItem {
  value: string
  label: string
  count: number
  /** Up to 4 sample aliases for the folder's peek-thumbnail cover. */
  samples: string[]
}

export interface ListQuery {
  zone: string
  search?: string
  page?: number
  pageSize?: number
  by?: FacetScheme
  value?: string
  parent?: string
  fieldFilters?: FieldFilter[]
}

async function getJson<T>(path: string): Promise<T> {
  const r = await pluginFetch(path, { method: 'GET' })
  if (!r.ok) throw new Error(`${path} → ${r.status}`)
  return (await r.json()) as T
}

async function sendJson<T>(path: string, method: string, body?: unknown): Promise<T> {
  const r = await pluginFetch(path, {
    method,
    ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
  if (!r.ok && r.status !== 204) throw new Error(`${path} → ${r.status}`)
  return r.status === 204 ? (undefined as T) : ((await r.json()) as T)
}

// Read a File as a base64 string (no data: prefix). The plugin iframe sandbox
// blocks multipart uploads, so imports POST JSON { filename, dataBase64 }.
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const res = reader.result as string
      const comma = res.indexOf(',')
      resolve(comma >= 0 ? res.slice(comma + 1) : res)
    }
    reader.onerror = () => reject(reader.error ?? new Error('file read failed'))
    reader.readAsDataURL(file)
  })
}

export const libraryApi = {
  zones(): Promise<string[]> {
    return getJson<string[]>('/api/v1/library/zones')
  },
  list(q: ListQuery): Promise<AssetPage> {
    const params = new URLSearchParams({ zone: q.zone })
    if (q.search) params.set('search', q.search)
    if (q.page) params.set('page', String(q.page))
    if (q.pageSize) params.set('pageSize', String(q.pageSize))
    if (q.by) params.set('by', q.by)
    if (q.value != null) params.set('value', q.value)
    if (q.parent != null) params.set('parent', q.parent)
    if (q.fieldFilters && q.fieldFilters.length > 0) {
      params.set('fieldFilters', q.fieldFilters.map((f) => `${f.fieldIdx}:${f.value}`).join('||'))
    }
    return getJson<AssetPage>(`/api/v1/library/list?${params.toString()}`)
  },
  facets(zone: string, by: FacetScheme, parent?: string): Promise<FacetItem[]> {
    const params = new URLSearchParams({ zone, by })
    if (parent != null) params.set('parent', parent)
    return getJson<FacetItem[]>(`/api/v1/library/facets?${params.toString()}`)
  },
  // The blob URL for an alias (image src). Single-tenant, no slug needed.
  serveUrl(alias: string): string {
    return pluginUrl(`/api/v1/library/serve/${encodeURIComponent(alias)}`)
  },

  // ── Project-private writes (base library.db stays read-only) ──────────────

  /** Import a local file as a project-private staging asset. */
  async import(file: File, zone?: string): Promise<AssetRecord> {
    const dataBase64 = await fileToBase64(file)
    return sendJson<AssetRecord>('/api/v1/library/import', 'POST', {
      filename: file.name,
      mimeType: file.type || undefined,
      dataBase64,
      ...(zone ? { zone } : {}),
    })
  },
  /** Patch a private asset (alias and/or anchor). */
  patchPrivate(
    id: string,
    patch: { alias?: string; anchorX?: number | null; anchorY?: number | null },
  ): Promise<AssetRecord> {
    return sendJson<AssetRecord>(`/api/v1/library/private/${id}`, 'PATCH', patch)
  },
  /** Rename/repair a single private asset's alias. */
  rename(id: string, alias: string): Promise<AssetRecord> {
    return this.patchPrivate(id, { alias })
  },
  trash(id: string): Promise<AssetRecord> {
    return sendJson<AssetRecord>(`/api/v1/library/private/${id}/trash`, 'POST')
  },
  restore(id: string): Promise<AssetRecord> {
    return sendJson<AssetRecord>(`/api/v1/library/private/${id}/restore`, 'POST')
  },
  move(id: string, zone: string): Promise<AssetRecord> {
    return sendJson<AssetRecord>(`/api/v1/library/private/${id}/move`, 'POST', { zone })
  },
  remove(id: string): Promise<void> {
    return sendJson<void>(`/api/v1/library/private/${id}`, 'DELETE')
  },
  /** Batch op over private ids (base records are skipped server-side). */
  batch(op: 'trash' | 'restore' | 'delete' | 'move', ids: string[], zone?: string): Promise<{ ok: number; total: number }> {
    return sendJson('/api/v1/library/private/batch', 'POST', { op, ids, ...(zone ? { zone } : {}) })
  },
  nonStandard(): Promise<NonStandardAsset[]> {
    return getJson<NonStandardAsset[]>('/api/v1/library/private/non-standard')
  },
  batchRepair(ids: string[]): Promise<{ repaired: number; items: Array<{ id: string; oldAlias: string; newAlias: string }> }> {
    return sendJson('/api/v1/library/private/batch-repair', 'POST', { ids })
  },
  monitor(): Promise<MonitorResult> {
    return getJson<MonitorResult>('/api/v1/library/monitor')
  },
  fieldValues(fieldIdx: number, zone?: string): Promise<string[]> {
    const params = new URLSearchParams({ fieldIdx: String(fieldIdx) })
    if (zone) params.set('zone', zone)
    return getJson<string[]>(`/api/v1/library/field-values?${params.toString()}`)
  },
}
