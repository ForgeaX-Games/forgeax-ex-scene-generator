import { defineGenerator } from '@forgeax/project-generator'
import { fabricOf } from './lib/fabric.generator-lib.ts'
import {
  aabbOf,
  asPoint,
  centroidOf,
  dist,
  distToPolyline,
  hashSeed,
  lerp,
  normalOf,
  pointInPolygon,
  resamplePolyline,
  rng,
  type Point,
} from './lib/geom.generator-lib.ts'

type RoadEdge = { key: string; polyline: Point[]; width: number; kind?: string }
type Region = { key: string; polygon: Point[]; attributes?: { hub?: Point } }
type Rect = { x0: number; y0: number; x1: number; y1: number }

const CELL = 10

function roadIndex(edges: RoadEdge[]) {
  const cells = new Map<string, RoadEdge[]>()
  const put = (x: number, y: number, edge: RoadEdge) => {
    const key = `${x}:${y}`
    const list = cells.get(key)
    if (list) {
      if (!list.includes(edge)) list.push(edge)
    } else {
      cells.set(key, [edge])
    }
  }
  for (const edge of edges) {
    const samples = resamplePolyline(edge.polyline, CELL)
    const pad = Math.ceil((edge.width / 2 + 8) / CELL)
    for (const pt of samples) {
      const gx = Math.round(pt[0] / CELL)
      const gy = Math.round(pt[1] / CELL)
      for (let dx = -pad; dx <= pad; dx++) {
        for (let dy = -pad; dy <= pad; dy++) put(gx + dx, gy + dy, edge)
      }
    }
  }
  const nearby = (pt: Point): RoadEdge[] => cells.get(`${Math.round(pt[0] / CELL)}:${Math.round(pt[1] / CELL)}`) ?? []
  const clearance = (pt: Point, extra: number, skip?: RoadEdge): number => {
    let best = Infinity
    for (const edge of nearby(pt)) {
      if (edge === skip) continue
      const d = distToPolyline(pt, edge.polyline) - edge.width / 2
      if (d < best) best = d
    }
    return best - extra
  }
  const toward = (pt: Point): Point => {
    let best: RoadEdge | null = null
    let bestD = Infinity
    for (const edge of nearby(pt)) {
      const d = distToPolyline(pt, edge.polyline)
      if (d < bestD) {
        bestD = d
        best = edge
      }
    }
    if (!best) return [0, -1]
    const line = best.polyline
    let nearest = line[0]!
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i]!
      const b = line[i + 1]!
      const ab: Point = [b[0] - a[0], b[1] - a[1]]
      const len2 = ab[0] * ab[0] + ab[1] * ab[1] || 1
      const t = Math.max(0, Math.min(1, ((pt[0] - a[0]) * ab[0] + (pt[1] - a[1]) * ab[1]) / len2))
      const q: Point = [a[0] + ab[0] * t, a[1] + ab[1] * t]
      if (dist(pt, q) < dist(pt, nearest)) nearest = q
    }
    const dx = nearest[0] - pt[0]
    const dy = nearest[1] - pt[1]
    const len = Math.hypot(dx, dy) || 1
    return [dx / len, dy / len]
  }
  return { clearance, toward }
}

function splitRect(rect: Rect, minW: number, minD: number, depth: number, random: () => number): Rect[] {
  const w = rect.x1 - rect.x0
  const h = rect.y1 - rect.y0
  if (depth <= 0 || w < minW * 1.2 || h < minD * 1.2) return [rect]
  const splitX = w >= h
  const t = 0.4 + random() * 0.2
  if (splitX) {
    const x = rect.x0 + w * t
    if (x - rect.x0 < minW || rect.x1 - x < minW) return [rect]
    return [
      ...splitRect({ ...rect, x1: x }, minW, minD, depth - 1, random),
      ...splitRect({ ...rect, x0: x }, minW, minD, depth - 1, random),
    ]
  }
  const y = rect.y0 + h * t
  if (y - rect.y0 < minD || rect.y1 - y < minD) return [rect]
  return [
    ...splitRect({ ...rect, y1: y }, minW, minD, depth - 1, random),
    ...splitRect({ ...rect, y0: y }, minW, minD, depth - 1, random),
  ]
}

export const parcels = defineGenerator({
  id: 'parcels',
  version: '3.1.0',
  description: 'Street-front lots plus recursive BSP blocks that fill each functional district.',
  inputs: {
    network: { type: 'Any', runtimeType: 'road-network' },
    districts: { type: 'Any', runtimeType: 'region-set' },
    setback: { type: 'NumberValue', defaultValue: 6 },
  },
  outputs: {
    parcels: { type: 'Any', runtimeType: 'parcel-set' },
  },
  run(_ctx, args: { network: { edges: RoadEdge[] }; districts: { regions: Region[] }; setback: number }) {
    const regions = args.districts.regions ?? []
    const edges = args.network.edges ?? []
    const setback = Number(args.setback) || 6
    const random = rng(hashSeed(11, 53))
    const roads = roadIndex(edges)
    const out: Array<{
      key: string
      district: string
      polygon: Point[]
      frontageNormal: Point
      setback: number
      role: 'derived'
      lineage: { source: string; via: string[] }
    }> = []

    const districtAt = (point: Point): string => {
      for (const region of regions) {
        if (pointInPolygon(point, region.polygon)) return region.key
      }
      return regions[0]?.key ?? 'residential'
    }

    const nearHubPlaza = (point: Point): boolean =>
      regions.some((region) => {
        const hub = asPoint(region.attributes?.hub)
        return hub ? dist(point, hub) < 11 : false
      })

    const pushLot = (
      key: string,
      district: string,
      polygon: Point[],
      frontageNormal: Point,
      via: string[],
    ) => {
      out.push({
        key,
        district,
        polygon,
        frontageNormal,
        setback,
        role: 'derived',
        lineage: { source: via[0] ?? 'roads', via },
      })
    }

    for (const edge of edges) {
      const isLocal = edge.kind === 'local'
      const spacing = isLocal ? 8.6 : 10
      const samples = resamplePolyline(edge.polyline, spacing)
      if (samples.length < 2) continue

      for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1]!
        const b = samples[i]!
        const n = normalOf(a, b)
        const mid = lerp(a, b, 0.5)
        const along: Point = [b[0] - a[0], b[1] - a[1]]
        const len = Math.hypot(along[0], along[1]) || 1

        for (const side of [-1, 1] as const) {
          const kerb = isLocal ? setback + 0.6 : setback + 2.2
          const probe: Point = [
            mid[0] + n[0] * side * (edge.width / 2 + kerb + 3.0),
            mid[1] + n[1] * side * (edge.width / 2 + kerb + 3.0),
          ]
          if (roads.clearance(probe, 3.6, edge) < 0) continue
          const district = districtAt(probe)
          if (nearHubPlaza(probe) && district !== 'harbor' && !district.startsWith('suburb')) continue
          const half = fabricOf(district).lotWidth * 0.48
          const depth = fabricOf(district).lotDepth
          const t: Point = [(along[0] / len) * half, (along[1] / len) * half]
          const front: Point = [
            mid[0] + n[0] * side * (edge.width / 2 + kerb),
            mid[1] + n[1] * side * (edge.width / 2 + kerb),
          ]
          const back: Point = [front[0] + n[0] * side * depth, front[1] + n[1] * side * depth]
          pushLot(
            `parcel-${edge.key}-${i}-${side > 0 ? 'n' : 's'}`,
            district,
            [
              [front[0] - t[0], front[1] - t[1]],
              [front[0] + t[0], front[1] + t[1]],
              [back[0] + t[0], back[1] + t[1]],
              [back[0] - t[0], back[1] - t[1]],
            ],
            [n[0] * side, n[1] * side],
            ['roads', 'frontage', district],
          )
        }
      }
    }

    for (const region of regions) {
      if (region.polygon.length < 4) continue
      const district = region.key
      const lotW = Math.max(8, fabricOf(district).lotWidth)
      const lotD = Math.max(9, fabricOf(district).lotDepth)
      const box = aabbOf(region.polygon, -4)
      const urban = !district.startsWith('suburb')
      const blocks = splitRect(
        { x0: box.minX, y0: box.minY, x1: box.maxX, y1: box.maxY },
        urban ? 36 : 48,
        urban ? 36 : 48,
        4,
        random,
      )
      let i = 0
      for (const block of blocks) {
        const lots = splitRect(block, lotW, lotD, urban ? 3 : 2, random)
        for (const leaf of lots) {
          const w = leaf.x1 - leaf.x0
          const h = leaf.y1 - leaf.y0
          if (w < 6.5 || h < 6.5) continue
          const pt: Point = [(leaf.x0 + leaf.x1) * 0.5, (leaf.y0 + leaf.y1) * 0.5]
          if (!pointInPolygon(pt, region.polygon)) continue
          if (roads.clearance(pt, 5.2) < 0) continue
          if (nearHubPlaza(pt) && !district.startsWith('suburb')) continue
          const inset = 0.8
          const poly: Point[] = [
            [leaf.x0 + inset, leaf.y0 + inset],
            [leaf.x1 - inset, leaf.y0 + inset],
            [leaf.x1 - inset, leaf.y1 - inset],
            [leaf.x0 + inset, leaf.y1 - inset],
          ]
          pushLot(
            `bsp-${district}-${i++}`,
            district,
            poly,
            roads.toward(pt),
            ['bsp-blocks', 'subdivision', district],
          )
        }
      }
    }

    const unique: typeof out = []
    const gapFor = (district: string) => (district.startsWith('suburb') ? 9.2 : 7.0)
    for (const lot of out) {
      const c = centroidOf(lot.polygon)
      if (unique.some((other) => dist(c, centroidOf(other.polygon)) < gapFor(lot.district))) continue
      unique.push(lot)
      if (unique.length >= 1400) break
    }

    return { parcels: { parcels: unique, role: 'derived', lineage: { source: 'roads' } } }
  },
})
