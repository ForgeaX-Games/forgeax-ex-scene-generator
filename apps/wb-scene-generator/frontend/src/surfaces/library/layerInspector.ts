import type { Point3D } from '../../renderer/types.js'
import { RESERVED_BAKED_ATTRIBUTE_KEYS } from './reservedAttributes.js'

export interface LayerVoxelStats {
  cellCount: number
  xMin: number | null
  xMax: number | null
  yMin: number | null
  yMax: number | null
  zMin: number | null
  zMax: number | null
  tokenCount: number
}

export interface SelectedLayerSnapshot {
  kind: 'baked' | 'output'
  layerKey: string
  nodePath: string
  nodeName: string
  schema?: string
  value: number
  assetName: string
  assetType?: string
  /** Resolved library alias for thumbnail lookup, when the renderer can match it. */
  assetAlias?: string
  attributes: Record<string, unknown>
  voxelStats: LayerVoxelStats
  subTokens?: string[]
  bounds?: { width: number; height: number }
  version?: number
}

export interface PreviewEditContext {
  editMode: boolean
  viewMode: string
  drawMode: string
  editAvailable: boolean
}

export interface SelectedLayersState {
  layers: SelectedLayerSnapshot[]
  editContext: PreviewEditContext
}

export function computeVoxelStats(cells: ReadonlyArray<Point3D & { token?: string }>): LayerVoxelStats {
  if (cells.length === 0) {
    return {
      cellCount: 0,
      xMin: null, xMax: null, yMin: null, yMax: null, zMin: null, zMax: null,
      tokenCount: 0,
    }
  }
  let xMin = cells[0].x
  let xMax = cells[0].x
  let yMin = cells[0].y
  let yMax = cells[0].y
  let zMin = cells[0].z
  let zMax = cells[0].z
  const tokens = new Set<string>()
  for (const c of cells) {
    xMin = Math.min(xMin, c.x)
    xMax = Math.max(xMax, c.x)
    yMin = Math.min(yMin, c.y)
    yMax = Math.max(yMax, c.y)
    zMin = Math.min(zMin, c.z)
    zMax = Math.max(zMax, c.z)
    if (c.token) tokens.add(c.token)
  }
  return {
    cellCount: cells.length,
    xMin, xMax, yMin, yMax, zMin, zMax,
    tokenCount: tokens.size,
  }
}

export function splitAttributes(attrs: Readonly<Record<string, unknown>>): {
  reserved: Array<{ key: string; value: string }>
  custom: Array<{ key: string; value: string }>
} {
  const reserved: Array<{ key: string; value: string }> = []
  const custom: Array<{ key: string; value: string }> = []
  for (const [key, raw] of Object.entries(attrs)) {
    const value = formatAttrValue(raw)
    if (RESERVED_BAKED_ATTRIBUTE_KEYS.has(key)) reserved.push({ key, value })
    else custom.push({ key, value })
  }
  reserved.sort((a, b) => a.key.localeCompare(b.key))
  custom.sort((a, b) => a.key.localeCompare(b.key))
  return { reserved, custom }
}

export function formatAttrValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function commonPathPrefix(paths: string[]): string {
  if (paths.length === 0) return '/'
  const segs = paths.map((p) => p.split('/').filter(Boolean))
  const first = segs[0]
  const common: string[] = []
  for (let i = 0; i < first.length; i++) {
    const seg = first[i]
    if (segs.every((s) => s[i] === seg)) common.push(seg)
    else break
  }
  return common.length ? '/' + common.join('/') : '/'
}

export type FieldValue<T> = T | 'mixed'

export interface LayerInspectorViewModel {
  selectionCount: number
  bakedCount: number
  outputCount: number
  commonPath: string
  nodeName: FieldValue<string>
  nodePath: FieldValue<string>
  schema: FieldValue<string | undefined>
  value: FieldValue<number>
  assetName: FieldValue<string>
  assetType: FieldValue<string | undefined>
  voxelStats: {
    cellCount: FieldValue<number>
    xRange: FieldValue<string>
    yRange: FieldValue<string>
    zRange: FieldValue<string>
    tokenCount: FieldValue<number>
  }
  reservedAttrs: Array<{ key: string; value: FieldValue<string> }>
  customAttrs: Array<{ key: string; value: FieldValue<string>; editable: boolean }>
  anyBaked: boolean
  allBaked: boolean
  canEditCustom: boolean
}

function fieldEqual<T>(layers: SelectedLayerSnapshot[], pick: (l: SelectedLayerSnapshot) => T): FieldValue<T> {
  if (layers.length === 0) return 'mixed' as FieldValue<T>
  const first = pick(layers[0])
  for (let i = 1; i < layers.length; i++) {
    if (pick(layers[i]) !== first) return 'mixed'
  }
  return first
}

function rangeLabel(min: number | null, max: number | null): string {
  if (min === null || max === null) return '—'
  return min === max ? String(min) : `${min} … ${max}`
}

export function buildLayerInspectorViewModel(layers: SelectedLayerSnapshot[]): LayerInspectorViewModel {
  const bakedCount = layers.filter((l) => l.kind === 'baked').length
  const outputCount = layers.length - bakedCount
  const allBaked = layers.length > 0 && bakedCount === layers.length
  const anyBaked = bakedCount > 0

  const reservedKeys = new Set<string>()
  const customKeys = new Set<string>()
  for (const l of layers) {
    for (const k of Object.keys(l.attributes)) {
      if (RESERVED_BAKED_ATTRIBUTE_KEYS.has(k)) reservedKeys.add(k)
      else customKeys.add(k)
    }
  }

  const reservedAttrs = [...reservedKeys].sort().map((key) => ({
    key,
    value: fieldEqual(layers, (l) => formatAttrValue(l.attributes[key])),
  }))

  const customAttrs = [...customKeys].sort().map((key) => ({
    key,
    value: fieldEqual(layers, (l) => formatAttrValue(l.attributes[key])),
    editable: layers.every((l) => l.kind === 'baked' || !(key in l.attributes)),
  }))

  return {
    selectionCount: layers.length,
    bakedCount,
    outputCount,
    commonPath: commonPathPrefix(layers.map((l) => l.nodePath)),
    nodeName: fieldEqual(layers, (l) => l.nodeName),
    nodePath: fieldEqual(layers, (l) => l.nodePath),
    schema: fieldEqual(layers, (l) => l.schema),
    value: fieldEqual(layers, (l) => l.value),
    assetName: fieldEqual(layers, (l) => l.assetName),
    assetType: fieldEqual(layers, (l) => l.assetType),
    voxelStats: {
      cellCount: fieldEqual(layers, (l) => l.voxelStats.cellCount),
      xRange: fieldEqual(layers, (l) => rangeLabel(l.voxelStats.xMin, l.voxelStats.xMax)),
      yRange: fieldEqual(layers, (l) => rangeLabel(l.voxelStats.yMin, l.voxelStats.yMax)),
      zRange: fieldEqual(layers, (l) => rangeLabel(l.voxelStats.zMin, l.voxelStats.zMax)),
      tokenCount: fieldEqual(layers, (l) => l.voxelStats.tokenCount),
    },
    reservedAttrs,
    customAttrs: customAttrs.map((row) => ({
      ...row,
      editable: anyBaked && row.value !== 'mixed',
    })),
    anyBaked,
    allBaked,
    canEditCustom: anyBaked,
  }
}

export function mergeTemplateAttributes(
  existing: Readonly<Record<string, unknown>>,
  template: Readonly<Record<string, unknown>>,
  overwrite: boolean,
): Record<string, unknown> {
  const out = { ...existing }
  for (const [key, value] of Object.entries(template)) {
    if (RESERVED_BAKED_ATTRIBUTE_KEYS.has(key)) continue
    if (!overwrite && Object.prototype.hasOwnProperty.call(out, key)) continue
    out[key] = value
  }
  return out
}

export function parseAttrInput(raw: string): unknown {
  const trimmed = raw.trim()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null') return null
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    return JSON.parse(trimmed) as unknown
  }
  return raw
}
