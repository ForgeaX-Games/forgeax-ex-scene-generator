/**
 * multi_tier_houses: Diverse architectural settlement houses.
 */

import {
  buildMultiTierHousesMesh,
  parsePoint2dList,
  parseNumberList,
  type SceneMesh,
  type HouseType,
  type MultiTierHousePlot,
} from '../../../../vendor/shared/types/index.js'

export interface MultiTierHousesResult {
  mesh?: SceneMesh
  count: number
  error?: string
}

function extractPlots(raw: unknown): MultiTierHousePlot[] {
  if (!raw) return []
  let cur: unknown = raw
  if (cur && typeof cur === 'object' && 'items' in cur) {
    cur = (cur as { items: unknown }).items
  }
  if (!Array.isArray(cur)) return []
  const out: MultiTierHousePlot[] = []
  for (const item of cur) {
    if (Array.isArray(item) && item.length >= 2) {
      out.push({ x: Number(item[0]), y: Number(item[1]) })
    } else if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>
      out.push({
        x: Number(o.x ?? 0),
        y: Number(o.y ?? 0),
        type: o.type as HouseType,
        yaw: o.yaw !== undefined ? Number(o.yaw) : undefined,
        scale: o.scale !== undefined ? Number(o.scale) : undefined,
        district: o.district as string,
      })
    }
  }
  return out
}

export function multiTierHouses(input: Record<string, unknown>): MultiTierHousesResult {
  let plots: MultiTierHousePlot[] = []

  if (input.plots) {
    plots = extractPlots(input.plots)
  }

  if (plots.length === 0 && input.points) {
    const rawPts = parsePoint2dList(input.points)
    if (rawPts && rawPts.length > 0) {
      const yaws = parseNumberList(input.yaw)
      const types = Array.isArray(input.types) ? (input.types as string[]) : []

      plots = rawPts.map(([x, y], idx) => {
        const rawType = types[idx] ?? (idx % 3 === 0 ? 'townhouse' : idx % 3 === 1 ? 'cottage' : 'barn')
        const type: HouseType = rawType === 'townhouse' || rawType === 'barn' || rawType === 'farmhouse' || rawType === 'cabin' || rawType === 'chalet'
          ? rawType
          : 'cottage'
        const yaw = yaws?.[idx] ?? 0
        return { x, y, type, yaw }
      })
    }
  }

  if (plots.length === 0) {
    return { count: 0, error: 'plots or points is required' }
  }

  const mesh = buildMultiTierHousesMesh({
    plots,
    heightGrid: input.heightGrid,
    cellSize: typeof input.cellSize === 'number' ? input.cellSize : undefined,
  })

  if (!mesh) return { count: 0, error: 'failed to generate multi-tier houses mesh' }
  return { mesh, count: plots.length }
}

