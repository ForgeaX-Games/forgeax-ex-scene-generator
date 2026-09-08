import { defineGenerator } from '@forgeax/project-generator'
import {
  aabbOf,
  asPoint,
  asPointList,
  centroidOf,
  dist,
  distToPolyline,
  pointInPolygon,
  polygonArea,
  sampleGridHeight,
  type Point,
} from './lib/geom.generator-lib.ts'

type Block = { key: string; district: string; polygon: Point[]; area: number; axis?: Point }
type Parcel = { key: string; district: string; polygon: Point[]; frontageNormal: Point; setback?: number }
type Region = { key: string; polygon: Point[]; attributes?: { hub?: Point } }
type RoadEdge = { key?: string; polyline: Point[]; width: number; kind?: string }

const TARGET_MIN = 4000
const TARGET_MAX = 7000
const CREEK_MIN = 25
const CREEK_MAX = 90

function nearestOnEdges(point: Point, edges: Array<{ polyline: Point[] }>): { point: Point; distance: number } | null {
  let nearest: Point | null = null
  let best = Infinity
  for (const edge of edges) {
    for (let i = 1; i < edge.polyline.length; i++) {
      const a = edge.polyline[i - 1]!
      const b = edge.polyline[i]!
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      const length2 = dx * dx + dy * dy || 1
      const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2))
      const candidate: Point = [a[0] + dx * t, a[1] + dy * t]
      const d = dist(point, candidate)
      if (d < best) {
        best = d
        nearest = candidate
      }
    }
  }
  return nearest ? { point: nearest, distance: best } : null
}

function boxesOverlap(a: ReturnType<typeof aabbOf>, b: ReturnType<typeof aabbOf>, pad: number): boolean {
  return a.minX <= b.maxX + pad && a.maxX >= b.minX - pad && a.minY <= b.maxY + pad && a.maxY >= b.minY - pad
}

function adjacent(a: Block, b: Block): boolean {
  if (!boxesOverlap(aabbOf(a.polygon), aabbOf(b.polygon), 8)) return false
  const ca = centroidOf(a.polygon)
  const cb = centroidOf(b.polygon)
  return dist(ca, cb) < 90
}

function mergePolygons(blocks: Block[]): Point[] {
  const box = aabbOf(blocks.flatMap((block) => block.polygon), 0)
  return [
    [box.minX, box.minY],
    [box.maxX, box.minY],
    [box.maxX, box.maxY],
    [box.minX, box.maxY],
  ]
}

function roadTouches(polygon: Point[], edges: RoadEdge[]): Array<{ point: Point; edge: RoadEdge; inward: Point }> {
  const center = centroidOf(polygon)
  const hits: Array<{ point: Point; edge: RoadEdge; inward: Point; span: number }> = []
  for (const edge of edges) {
    if (edge.polyline.length < 2) continue
    let near = 0
    let acc: Point = [0, 0]
    for (let i = 1; i < edge.polyline.length; i++) {
      const a = edge.polyline[i - 1]!
      const b = edge.polyline[i]!
      const mid: Point = [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5]
      const d = distToPolyline(mid, [
        ...polygon,
        polygon[0]!,
      ])
      if (d < edge.width / 2 + 10 && pointInPolygon(offsetIn(mid, center, 6), polygon) === false) {
        const toCenter = dist(mid, center)
        if (toCenter < 140) {
          near += dist(a, b)
          acc = [acc[0] + mid[0], acc[1] + mid[1]]
        }
      }
    }
    if (near < 8) continue
    const count = Math.max(1, edge.polyline.length - 1)
    const point: Point = [acc[0] / count || center[0], acc[1] / count || center[1]]
    const nearest = nearestOnEdges(center, [edge])
    const gate = nearest?.point ?? point
    const dx = center[0] - gate[0]
    const dy = center[1] - gate[1]
    const len = Math.hypot(dx, dy) || 1
    hits.push({ point: gate, edge, inward: [dx / len, dy / len], span: near })
  }
  hits.sort((a, b) => b.span - a.span)
  const unique: typeof hits = []
  for (const hit of hits) {
    if (unique.some((other) => dist(other.point, hit.point) < 18)) continue
    unique.push(hit)
  }
  return unique.slice(0, 4)
}

function sideOffset(axis: Point, sign: number): Point {
  return [-axis[1] * 18 * sign, axis[0] * 18 * sign]
}

function offsetIn(point: Point, toward: Point, metres: number): Point {
  const dx = toward[0] - point[0]
  const dy = toward[1] - point[1]
  const len = Math.hypot(dx, dy) || 1
  return [point[0] + (dx / len) * metres, point[1] + (dy / len) * metres]
}

function slopeOf(polygon: Point[], heightAt: (point: Point) => number): number {
  const box = aabbOf(polygon)
  const samples: Point[] = [
    [(box.minX + box.maxX) * 0.5, (box.minY + box.maxY) * 0.5],
    [box.minX, box.minY],
    [box.maxX, box.minY],
    [box.maxX, box.maxY],
    [box.minX, box.maxY],
  ]
  const zs = samples.map(heightAt)
  const span = Math.max(1, box.maxX - box.minX, box.maxY - box.minY)
  return (Math.max(...zs) - Math.min(...zs)) / span
}

export const civicParkPlan = defineGenerator({
  id: 'civic-park-plan',
  version: '1.0.0',
  description: 'Reserves one civic riverfront flood-memorial park from BSP street blocks before buildings.',
  inputs: {
    blocks: { type: 'Any', runtimeType: 'block-set' },
    parcels: { type: 'Any', runtimeType: 'parcel-set' },
    districts: { type: 'Any', runtimeType: 'region-set' },
    network: { type: 'Any', runtimeType: 'road-network' },
    creek: { type: 'Any', runtimeType: 'point2d-list', access: 'list' },
    heightGrid: { type: 'Any', runtimeType: 'height-grid' },
    cellSize: { type: 'NumberValue', defaultValue: 8 },
  },
  outputs: {
    park: { type: 'Any', runtimeType: 'park-precinct' },
    parkRegion: { type: 'Any', runtimeType: 'region-set' },
    buildableParcels: { type: 'Any', runtimeType: 'parcel-set' },
  },
  run(_ctx, args: {
    blocks?: { blocks?: Block[] }
    parcels?: { parcels?: Parcel[] }
    districts?: { regions?: Region[] }
    network?: { edges?: RoadEdge[] }
    creek?: Point[]
    heightGrid?: number[][]
    cellSize?: number
  }) {
    const civic = (args.districts?.regions ?? []).find((region) => region.key === 'civic')
    const creek = asPointList(args.creek)
    const edges = args.network?.edges ?? []
    const parcels = args.parcels?.parcels ?? []
    const heightGrid = args.heightGrid
    const cellSize = Number(args.cellSize) || 8
    const heightAt = (point: Point) => (heightGrid ? sampleGridHeight(heightGrid, cellSize, point) : 0)
    const hub = civic ? asPoint(civic.attributes?.hub) ?? centroidOf(civic.polygon) : ([0, 0] as Point)
    const civicBlocks = (args.blocks?.blocks ?? []).filter((block) => block.district === 'civic' && block.area >= 700)

    const scoreOf = (block: Block): number => {
      const center = centroidOf(block.polygon)
      const creekD = creek.length >= 2 ? distToPolyline(center, creek) : 80
      const hubD = dist(center, hub)
      const creekScore = creekD >= CREEK_MIN && creekD <= CREEK_MAX
        ? 3 / (1 + Math.abs(creekD - 40) / 20)
        : 0.15 / (1 + Math.abs(creekD - 40) / 40)
      const hubScore = hubD < 28 ? 0.15 : hubD < 70 ? 3.2 : hubD < 95 ? 0.7 : 0.02
      const slope = slopeOf(block.polygon, heightAt)
      const slopeScore = slope < 0.12 ? 1 : slope < 0.2 ? 0.4 : 0.05
      return creekScore + hubScore + slopeScore + Math.min(block.area / 3600, 1)
    }

    const ranked = [...civicBlocks].sort((a, b) => scoreOf(b) - scoreOf(a) || a.key.localeCompare(b.key))
    let chosen: Block[] = []
    for (const seed of ranked.slice(0, 12)) {
      const cluster = [seed]
      const used = new Set([seed.key])
      let area = seed.area
      while (area < TARGET_MIN) {
        const neighbors = civicBlocks
          .filter((block) => !used.has(block.key) && cluster.some((item) => adjacent(item, block)))
          .sort((a, b) => scoreOf(b) - scoreOf(a) || a.key.localeCompare(b.key))
        const next = neighbors[0]
        if (!next) break
        if (area + next.area > TARGET_MAX + 800) break
        cluster.push(next)
        used.add(next.key)
        area += next.area
      }
      const clusterCenter = centroidOf(mergePolygons(cluster))
      if (dist(clusterCenter, hub) > 95) continue
      if (area >= TARGET_MIN && area <= TARGET_MAX + 800) {
        chosen = cluster
        break
      }
      if (area >= TARGET_MIN && chosen.length === 0) chosen = cluster
    }

    const towardCreek = creek.length >= 2
      ? nearestOnEdges(hub, [{ polyline: creek }])?.point ?? [hub[0], hub[1] + 40]
      : [hub[0], hub[1] + 40]
    const riverDir = offsetIn(hub, towardCreek, 1)
    const alongRiver: Point = [-(riverDir[1] - hub[1]), riverDir[0] - hub[0]]
    const alongLen = Math.hypot(alongRiver[0], alongRiver[1]) || 1
    const u: Point = [(riverDir[0] - hub[0]), (riverDir[1] - hub[1])]
    const uLen = Math.hypot(u[0], u[1]) || 1
    const ux = u[0] / uLen
    const uy = u[1] / uLen
    const vx = alongRiver[0] / alongLen
    const vy = alongRiver[1] / alongLen
    const fallbackCenter: Point = [hub[0] + ux * 52, hub[1] + uy * 52]
    const fallbackPoly: Point[] = [
      [fallbackCenter[0] - ux * 32 - vx * 40, fallbackCenter[1] - uy * 32 - vy * 40],
      [fallbackCenter[0] + ux * 32 - vx * 40, fallbackCenter[1] + uy * 32 - vy * 40],
      [fallbackCenter[0] + ux * 32 + vx * 40, fallbackCenter[1] + uy * 32 + vy * 40],
      [fallbackCenter[0] - ux * 32 + vx * 40, fallbackCenter[1] - uy * 32 + vy * 40],
    ]

    let polygon: Point[]
    let area: number
    if (chosen.length > 0) {
      polygon = mergePolygons(chosen)
      area = polygonArea(polygon)
      if (dist(centroidOf(polygon), hub) > 95) {
        polygon = fallbackPoly
        area = polygonArea(polygon)
      }
    } else {
      polygon = fallbackPoly
      area = polygonArea(polygon)
    }

    if (area > TARGET_MAX) {
      const c = centroidOf(polygon)
      const scale = Math.sqrt(TARGET_MAX / area)
      polygon = polygon.map((point) => [
        c[0] + (point[0] - c[0]) * scale,
        c[1] + (point[1] - c[1]) * scale,
      ])
      area = polygonArea(polygon)
    }
    if (area < TARGET_MIN && civic) {
      const c = centroidOf(polygon)
      const scale = Math.sqrt(TARGET_MIN / Math.max(area, 1))
      polygon = polygon.map((point) => [
        c[0] + (point[0] - c[0]) * scale,
        c[1] + (point[1] - c[1]) * scale,
      ])
      area = polygonArea(polygon)
    }

    if (pointInPolygon(hub, polygon) || dist(centroidOf(polygon), hub) < 34) {
      polygon = fallbackPoly
      area = polygonArea(polygon)
    }

    const center = centroidOf(polygon)
    const river = creek.length >= 2 ? nearestOnEdges(center, [{ polyline: creek }]) : null
    const riverPoint = river?.point ?? [center[0], center[1] + 30]
    const axisDx = riverPoint[0] - center[0]
    const axisDy = riverPoint[1] - center[1]
    const axisLen = Math.hypot(axisDx, axisDy) || 1
    const axis: Point = [axisDx / axisLen, axisDy / axisLen]
    const memorial: Point = [center[0] - axis[0] * 8, center[1] - axis[1] * 8]
    const overlook: Point = [
      center[0] + axis[0] * Math.min(22, Math.max(12, (river?.distance ?? 40) * 0.35)),
      center[1] + axis[1] * Math.min(22, Math.max(12, (river?.distance ?? 40) * 0.35)),
    ]
    const gates = roadTouches(polygon, edges)
    const fallbackGates = edges
      .map((edge) => {
        const hit = nearestOnEdges(center, [edge])
        return hit ? { point: hit.point, edge, inward: axis, distance: hit.distance } : null
      })
      .filter((item): item is NonNullable<typeof item> => !!item && item.distance < 70)
      .sort((a, b) => a.distance - b.distance)
    const rawGates = gates.length >= 2
      ? gates
      : fallbackGates.slice(0, 2).map((item) => ({
          point: item.point,
          edge: item.edge,
          inward: item.inward,
        }))
    while (rawGates.length < 2) {
      const t = rawGates.length === 0 ? -1 : 1
      rawGates.push({
        point: [center[0] + sideOffset(axis, t)[0], center[1] + sideOffset(axis, t)[1]],
        edge: { polyline: [center, riverPoint], width: 4, kind: 'local' },
        inward: axis,
      })
    }
    const entrances = rawGates.map((item, index) => ({
      key: `park-gate-${index}`,
      point: item.point,
      inward: item.inward,
      edgeKey: item.edge.key ?? `edge-${index}`,
      kind: item.edge.kind ?? 'local',
    }))

    const park = {
      key: 'civic-riverfront-park',
      polygon,
      centroid: center,
      area,
      axis,
      memorial,
      overlook,
      riverPoint,
      entrances,
      purpose: 'flood-memorial-park',
      story: 'After the last spring flood, the council bought this river block as a detention meadow: a civic walk in dry months, a holding garden when the creek rises.',
      role: 'derived' as const,
      lineage: { source: 'local-streets', via: ['civic', 'bsp-leaf', 'riverfront-park'] },
    }

    const reserved = { regions: [{ key: park.key, polygon, attributes: { purpose: park.purpose, hub: memorial } }] }
    const buildable = parcels.filter((parcel) => !pointInPolygon(centroidOf(parcel.polygon), polygon))

    return {
      park,
      parkRegion: reserved,
      buildableParcels: { parcels: buildable, role: 'derived', lineage: { source: 'parcels', via: ['park-reservation'] } },
    }
  },
})
