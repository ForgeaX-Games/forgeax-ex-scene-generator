// Thin client for the baked scene-layer service — the graph-independent,
// hand-editable layer store the preview's edit mode reads & writes. Backed by
// /api/v1/baked/* (see backend/src/baked/routes.ts). Unlike node-graph previews,
// these layers persist in the project folder and are never recomputed from the
// graph.

/** A baked layer as returned by GET /baked/layers — superset of a graph
 *  VoxelLayer with the bound asset inline, and EMPTY layers included. */
export interface BakedLayerDTO {
  nodePath: string
  nodeName: string
  value: number
  schema?: string
  assetName: string
  assetAlias?: string
  assetType?: string
  /** Omitted in summary mode (`?mode=summary`); use cellCount instead. */
  cells?: BakedCellDTO[]
  cellCount?: number
  attributes?: Record<string, unknown>
  version?: number
  bounds?: { width: number; height: number }
}

export interface BakedCellDTO {
  x: number
  y: number
  z: number
  token?: string
  state?: BakedObjectCellState | Record<string, unknown>
}

export type BakedCellRole = 'anchor' | 'column'

export interface BakedObjectCellState {
  [key: string]: unknown
  instanceId: string
  role: BakedCellRole
  footprintDx: number
  footprintDy: number
  columnDz: number
  columnHeight: number
  footprintOrigin: { x: number; y: number; z: number }
}

export interface BakedHistorySummaryDTO {
  paths: string[]
  cellDelta?: number
  assetAlias?: string
  assetName?: string
}

export interface BakedHistoryItemDTO {
  id: string
  label: string
  tool: 'paint' | 'erase' | 'layer' | 'bake' | 'attributes'
  createdAt: string
  summary: BakedHistorySummaryDTO
}

export interface BakedHistoryStatusDTO {
  canUndo: boolean
  canRedo: boolean
  undoLabel?: string
  redoLabel?: string
  entries: BakedHistoryItemDTO[]
}

import { syncTraceEnabled } from '../../debug/syncTrace.js'
import { pluginFetch } from '../../api/pluginHttp'

const JSON_HEADERS = { 'content-type': 'application/json' }

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? 'GET'
  const isMutation = method !== 'GET' && method !== 'HEAD'
  if (isMutation && syncTraceEnabled()) {
    console.log(`[sync-trace] baked:api ${method} ${url}`, {
      bodyPreview: typeof init?.body === 'string' ? init.body.slice(0, 200) : undefined,
    })
  }
  const r = await pluginFetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(15_000) })
  if (!r.ok) {
    if (r.status === 413) {
      throw new Error(`${url} → 413 payload too large (try fewer layers, or restart backend after bodyLimit bump)`)
    }
    throw new Error(`${url} → ${r.status}`)
  }
  return r.json() as Promise<T>
}

export type BakedLayersMode = 'summary' | 'full'

export interface BakedLayersListResult {
  layers: BakedLayerDTO[]
  /** Backend refused to parse an oversized baked-scene.json. */
  truncated?: boolean
}

export const bakedApi = {
  listResult(mode: BakedLayersMode = 'full'): Promise<BakedLayersListResult> {
    const qs = mode === 'summary' ? '?mode=summary' : ''
    return req<{ layers: BakedLayerDTO[]; truncated?: boolean }>(`/api/v1/baked/layers${qs}`).then((r) => ({
      layers: r.layers ?? [],
      truncated: r.truncated === true,
    }))
  },
  list(mode: BakedLayersMode = 'full'): Promise<BakedLayerDTO[]> {
    return bakedApi.listResult(mode).then((r) => r.layers)
  },
  listSummary(): Promise<BakedLayerDTO[]> {
    return bakedApi.list('summary')
  },
  history(): Promise<BakedHistoryStatusDTO> {
    return req<BakedHistoryStatusDTO>('/api/v1/baked/history')
  },
  undo(): Promise<BakedHistoryStatusDTO> {
    return req<BakedHistoryStatusDTO>('/api/v1/baked/history/undo', { method: 'POST' })
  },
  redo(): Promise<BakedHistoryStatusDTO> {
    return req<BakedHistoryStatusDTO>('/api/v1/baked/history/redo', { method: 'POST' })
  },
  addLayer(name: string, parentPath = '/'): Promise<string> {
    return req<{ path: string }>('/api/v1/baked/layers', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name, parentPath }),
    }).then((r) => r.path)
  },
  addSubLayer(parentPath: string, name: string): Promise<string> {
    return req<{ path: string }>('/api/v1/baked/sublayer', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ parentPath, name }),
    }).then((r) => r.path)
  },
  // Resolve which layer a paint stroke of `asset` under `parentPath` writes into,
  // creating a `layer-n` sub-layer if the asset differs from the active layer's
  // bound asset (reuses an existing same-asset sub-layer). Returns the target path.
  ensureTarget(parentPath: string, asset: { name: string; type?: string; alias?: string }): Promise<string> {
    return req<{ path: string }>('/api/v1/baked/target', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ parentPath, asset }),
    }).then((r) => r.path)
  },
  // Whole-layer cell overwrite (z=0 painting), with optional asset (re)bind.
  setCells(path: string, cells: BakedCellDTO[], asset?: { name: string; type?: string; alias?: string }): Promise<void> {
    return req<{ ok: true }>('/api/v1/baked/layers/cells', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ path, cells, asset }),
    }).then(() => undefined)
  },
  remove(path: string): Promise<void> {
    return req<{ ok: true }>('/api/v1/baked/layers', {
      method: 'DELETE',
      headers: JSON_HEADERS,
      body: JSON.stringify({ path }),
    }).then(() => undefined)
  },
  // Reparent and/or reorder a layer. destParentPath '/' = top level; beforeName
  // positions it before that sibling (omit = append last). Returns the new path.
  move(path: string, destParentPath: string, beforeName?: string): Promise<string | null> {
    return req<{ path: string | null }>('/api/v1/baked/move', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ path, destParentPath, beforeName }),
    }).then((r) => r.path)
  },
  rename(path: string, name: string): Promise<string> {
    return req<{ path: string }>('/api/v1/baked/rename', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ path, name }),
    }).then((r) => r.path)
  },
  bake(
    layers: ReadonlyArray<{ nodePath?: string; nodeName?: string; cells: BakedCellDTO[]; assetName?: string; assetAlias?: string; assetType?: string; schema?: string }>,
  ): Promise<string[]> {
    return req<{ paths: string[] }>('/api/v1/baked/bake', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ layers }),
      // Large voxel scenes can take longer than the default 15s client timeout.
      signal: AbortSignal.timeout(120_000),
    }).then((r) => r.paths)
  },
  patchAttributes(
    paths: string[],
    attributes: Record<string, unknown>,
    opts?: { overwrite?: boolean },
  ): Promise<void> {
    return req<{ ok: true }>('/api/v1/baked/layers/attributes', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ paths, attributes, overwrite: opts?.overwrite }),
    }).then(() => undefined)
  },
}
