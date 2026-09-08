import { defineGenerator } from '@forgeax/project-generator'
import { fabricOf, storyForEdge } from './lib/fabric.generator-lib.ts'
import {
  asPointList,
  buildCoastalTensorField,
  buildRibbonMesh,
  centroidOf,
  dist,
  distToPolyline,
  hashSeed,
  pointInPolygon,
  polygonArea,
  polylineLength,
  resamplePolyline,
  rng,
  sampleGridHeight,
  segmentIntersection,
  type Point,
} from './lib/geom.generator-lib.ts'

type Node = {
  key: string
  x: number
  y: number
  kind: 'hub' | 'crossing' | 'waterfront' | 'bridge'
  role: 'control' | 'derived'
  lineage: { source: string }
}

type Edge = {
  key: string
  from: string
  to: string
  kind: 'arterial' | 'local' | 'waterfront' | 'bridge'
  width: number
  polyline: Point[]
  story?: string
  district?: string
  role: 'derived'
  lineage: { source: string; via?: string[] }
}

type Region = {
  key: string
  polygon: Point[]
  attributes?: { hub?: Point; purpose?: string; density?: number }
}

type Cell = {
  u0: number
  u1: number
  v0: number
  v1: number
  depth: number
}

type Basis = {
  origin: Point
  u: Point
  v: Point
}

const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`)
const clamp = (value: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, value))

function project(point: Point, basis: Basis): Point {
  const x = point[0] - basis.origin[0]
  const y = point[1] - basis.origin[1]
  return [x * basis.u[0] + y * basis.u[1], x * basis.v[0] + y * basis.v[1]]
}

function unproject(point: Point, basis: Basis): Point {
  return [
    basis.origin[0] + point[0] * basis.u[0] + point[1] * basis.v[0],
    basis.origin[1] + point[0] * basis.u[1] + point[1] * basis.v[1],
  ]
}

function boundsInBasis(polygon: Point[], basis: Basis): Cell {
  let u0 = Infinity
  let u1 = -Infinity
  let v0 = Infinity
  let v1 = -Infinity
  for (const point of polygon) {
    const [u, v] = project(point, basis)
    u0 = Math.min(u0, u)
    u1 = Math.max(u1, u)
    v0 = Math.min(v0, v)
    v1 = Math.max(v1, v)
  }
  return { u0, u1, v0, v1, depth: 0 }
}

function averageMainRoadTangent(region: Region, trunkEdges: Edge[], fallback: Point): Point {
  let sx = 0
  let sy = 0
  let weight = 0
  for (const edge of trunkEdges) {
    const points = edge.polyline
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!
      const b = points[i]!
      const mid: Point = [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5]
      if (!pointInPolygon(mid, region.polygon)) continue
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      const length = Math.hypot(dx, dy)
      if (length < 1) continue
      let tx = dx / length
      let ty = dy / length
      if (tx * fallback[0] + ty * fallback[1] < 0) {
        tx = -tx
        ty = -ty
      }
      const w = length * Math.max(1, edge.width)
      sx += tx * w
      sy += ty * w
      weight += w
    }
  }
  if (weight <= 0) return fallback
  const length = Math.hypot(sx, sy) || 1
  return [sx / length, sy / length]
}

function polygonPrincipalAxis(polygon: Point[], fallback: Point): { axis: Point; elongation: number } {
  const center = centroidOf(polygon)
  let xx = 0
  let xy = 0
  let yy = 0
  let count = 0
  for (const point of polygon) {
    const x = point[0] - center[0]
    const y = point[1] - center[1]
    xx += x * x
    xy += x * y
    yy += y * y
    count += 1
  }
  if (count === 0) return { axis: fallback, elongation: 0 }
  xx /= count
  xy /= count
  yy /= count
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy)
  let axis: Point = [Math.cos(angle), Math.sin(angle)]
  if (axis[0] * fallback[0] + axis[1] * fallback[1] < 0) axis = [-axis[0], -axis[1]]
  const trace = xx + yy
  const delta = Math.sqrt(Math.max(0, (xx - yy) ** 2 + 4 * xy * xy))
  return { axis, elongation: trace > 1e-6 ? clamp(delta / trace, 0, 1) : 0 }
}

function nearestPointOnRoads(point: Point, edges: Edge[]): { point: Point; distance: number } | null {
  let nearest: Point | null = null
  let best = Infinity
  for (const edge of edges) {
    for (let i = 1; i < edge.polyline.length; i++) {
      const a = edge.polyline[i - 1]!
      const b = edge.polyline[i]!
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      const length2 = dx * dx + dy * dy || 1
      const t = clamp(((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2, 0, 1)
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

function contiguousRuns(
  raw: Point[],
  polygon: Point[],
  frame: Point[],
  heightAt: (point: Point) => number,
): Point[][] {
  const sampled = resamplePolyline(raw, 5)
  const runs: Point[][] = []
  let current: Point[] = []
  let previous: Point | null = null
  for (const point of sampled) {
    const inside = pointInPolygon(point, polygon) && (frame.length < 3 || pointInPolygon(point, frame))
    const slope = previous
      ? Math.abs(heightAt(point) - heightAt(previous)) / Math.max(1, dist(point, previous))
      : 0
    if (inside && slope < 0.18) {
      current.push(point)
    } else {
      if (current.length >= 2 && polylineLength(current) >= 18) runs.push(current)
      current = []
    }
    previous = point
  }
  if (current.length >= 2 && polylineLength(current) >= 18) runs.push(current)
  return runs
}

function roadGrade(line: Point[], heightAt: (point: Point) => number): number {
  const samples = resamplePolyline(line, 8)
  let worst = 0
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!
    const b = samples[i]!
    worst = Math.max(worst, Math.abs(heightAt(b) - heightAt(a)) / Math.max(1, dist(a, b)))
  }
  return worst
}

export const localStreets = defineGenerator({
  id: 'local-streets',
  version: '2.0.0',
  description: 'Terrain-aware BSP street fabric aligned to each district main-road frame.',
  inputs: {
    network: { type: 'Any', runtimeType: 'road-network' },
    districts: { type: 'Any', runtimeType: 'region-set' },
    coastline: { type: 'Any', runtimeType: 'point2d-list', access: 'list' },
    creek: { type: 'Any', runtimeType: 'point2d-list', access: 'list' },
    cityBoundary: { type: 'Any', runtimeType: 'point2d-list', access: 'list' },
    heightGrid: { type: 'Any', runtimeType: 'height-grid' },
    cellSize: { type: 'NumberValue', defaultValue: 8 },
    seed: { type: 'NumberValue', defaultValue: 11, control: true },
  },
  outputs: {
    network: { type: 'Any', runtimeType: 'road-network' },
    mesh: { type: 'Mesh' },
    blocks: { type: 'Any', runtimeType: 'block-set' },
  },
  run(_ctx, args: {
    network: { nodes?: Node[]; edges?: Edge[]; bridges?: Array<{ key: string; span: number }> }
    districts: { regions?: Region[] }
    coastline?: Point[]
    creek?: Point[]
    cityBoundary?: Point[]
    heightGrid?: number[][]
    cellSize?: number
    seed: number
  }) {
    const trunk = args.network ?? { nodes: [], edges: [], bridges: [] }
    const trunkEdges = trunk.edges ?? []
    const regions = args.districts?.regions ?? []
    const shore = asPointList(args.coastline)
    const creek = asPointList(args.creek)
    const frame = asPointList(args.cityBoundary)
    const cellSize = Number(args.cellSize) || 8
    const heightGrid = args.heightGrid
    const heightAt = (point: Point): number =>
      heightGrid ? sampleGridHeight(heightGrid, cellSize, point) : 0
    const tensor = buildCoastalTensorField({
      shoreline: shore,
      creek,
      heightGrid,
      cellSize,
      cityBoundary: frame,
    })

    const nodes: Node[] = (trunk.nodes ?? []).map((node) => ({ ...node }))
    const edges: Edge[] = trunkEdges.map((edge) => ({ ...edge, story: edge.story ?? 'arterial' }))
    const seen = new Set(edges.map((edge) => pairKey(edge.from, edge.to)))
    const nodeBuckets = new Map<string, Node[]>()

    const bucketKey = (point: Point): string =>
      `${Math.round(point[0] / 8)}:${Math.round(point[1] / 8)}`
    for (const node of nodes) {
      const key = bucketKey([node.x, node.y])
      const bucket = nodeBuckets.get(key)
      if (bucket) bucket.push(node)
      else nodeBuckets.set(key, [node])
    }

    const addNode = (point: Point, prefix: string): Node => {
      const key = bucketKey(point)
      for (const node of nodeBuckets.get(key) ?? []) {
        if (dist(point, [node.x, node.y]) < 5) return node
      }
      const node: Node = {
        key: `${prefix}-${Math.round(point[0])}-${Math.round(point[1])}`,
        x: point[0],
        y: point[1],
        kind: 'crossing',
        role: 'derived',
        lineage: { source: 'local-streets' },
      }
      nodes.push(node)
      const bucket = nodeBuckets.get(key)
      if (bucket) bucket.push(node)
      else nodeBuckets.set(key, [node])
      return node
    }

    const generated: Edge[] = []
    const blocks: Array<{
      key: string
      district: string
      polygon: Point[]
      area: number
      axis: Point
      depth: number
      role: 'derived'
      lineage: { source: string; via: string[] }
    }> = []
    let blockIndex = 0
    const addRoad = (
      line: Point[],
      region: Region,
      width: number,
      hierarchy: string,
      index: number,
      forceConnection = false,
    ): void => {
      if (line.length < 2 || (!forceConnection && polylineLength(line) < 18)) return
      const samples = resamplePolyline(line, 6)
      let nearTrunk = 0
      for (const point of samples) {
        if (
          trunkEdges.some((edge) =>
            distToPolyline(point, edge.polyline) < edge.width * 0.5 + width * 0.5 + 0.8
          )
        ) nearTrunk += 1
      }
      // Keep true crossings, reject seams that merely run on top of a main road.
      if (!forceConnection && nearTrunk / Math.max(1, samples.length) > 0.3) return

      const a = addNode(line[0]!, `bsp-${region.key}-${index}-a`)
      const b = addNode(line[line.length - 1]!, `bsp-${region.key}-${index}-b`)
      if (a.key === b.key) return
      const id = pairKey(a.key, b.key)
      if (seen.has(id)) return
      seen.add(id)
      const story = storyForEdge(region.key, 'local')
      generated.push({
        key: `local-${region.key}-${hierarchy}-${index}`,
        from: a.key,
        to: b.key,
        kind: 'local',
        width,
        polyline: line,
        story,
        district: region.key,
        role: 'derived',
        lineage: { source: 'local-streets', via: [region.key, 'bsp', hierarchy, story] },
      })
    }

    for (const region of regions) {
      if (region.polygon.length < 4) continue
      const random = rng(hashSeed(Number(args.seed) || 11, 101 + region.key.length * 17))
      const center = centroidOf(region.polygon)
      const field = tensor(center)
      const roadAxis = averageMainRoadTangent(region, trunkEdges, field.primary)
      const shape = polygonPrincipalAxis(region.polygon, roadAxis)
      const shapeWeight = 0.28 + shape.elongation * 0.42
      const terrainWeight = clamp((field.shoreDist - 120) / 520, 0.08, 0.22)
      const roadWeight = Math.max(0.18, 1 - shapeWeight - terrainWeight)
      const tx =
        roadAxis[0] * roadWeight
        + shape.axis[0] * shapeWeight
        + field.primary[0] * terrainWeight
      const ty =
        roadAxis[1] * roadWeight
        + shape.axis[1] * shapeWeight
        + field.primary[1] * terrainWeight
      const length = Math.hypot(tx, ty) || 1
      const basis: Basis = {
        origin: center,
        u: [tx / length, ty / length],
        v: [-ty / length, tx / length],
      }
      const root = boundsInBasis(region.polygon, basis)
      const urban = !region.key.startsWith('suburb')
      const harbor = region.key === 'harbor'
      const minBlock = urban ? (harbor ? 34 : 42) : 54
      const maxDepth = urban ? 5 : 4
      const fabric = fabricOf(region.key)
      let roadIndex = 0

      // Guarantee one explicit relationship to the existing arterial graph.
      // This is intentionally a single collector, not another radial fan.
      const access = nearestPointOnRoads(center, trunkEdges)
      if (access && access.distance > 0.5 && access.distance < 420) {
        const midpoint: Point = [
          center[0] * 0.52 + access.point[0] * 0.48,
          center[1] * 0.52 + access.point[1] * 0.48,
        ]
        addRoad(
          [center, midpoint, access.point],
          region,
          Math.min(4.2, fabric.localWidth * 0.78),
          'arterial-access',
          roadIndex++,
          true,
        )
      }

      // One shape-oriented collector crosses the district short axis. Because
      // the long axis already follows the boundary/main-road grain, this road
      // meets the arterial system approximately perpendicularly and becomes the
      // topological spine to which recursive BSP seams attach.
      const anchorRaw: Point[] = [
        unproject([0, root.v0], basis),
        unproject([0, root.v1], basis),
      ]
      const anchorRuns = contiguousRuns(anchorRaw, region.polygon, frame, heightAt)
      for (const run of anchorRuns) {
        addRoad(
          run,
          region,
          Math.min(4.2, fabric.localWidth * 0.78),
          'collector-anchor',
          roadIndex++,
        )
      }

      const emitLeaf = (cell: Cell): void => {
        const polygon: Point[] = [
          unproject([cell.u0, cell.v0], basis),
          unproject([cell.u1, cell.v0], basis),
          unproject([cell.u1, cell.v1], basis),
          unproject([cell.u0, cell.v1], basis),
        ]
        const center = centroidOf(polygon)
        if (!pointInPolygon(center, region.polygon)) return
        const area = polygonArea(polygon)
        if (area < 400) return
        blocks.push({
          key: `block-${region.key}-${blockIndex++}`,
          district: region.key,
          polygon,
          area,
          axis: basis.u,
          depth: cell.depth,
          role: 'derived',
          lineage: { source: 'local-streets', via: [region.key, 'bsp-leaf'] },
        })
      }

      const subdivide = (cell: Cell): void => {
        const widthU = cell.u1 - cell.u0
        const widthV = cell.v1 - cell.v0
        if (cell.depth >= maxDepth) {
          emitLeaf(cell)
          return
        }
        if (widthU < minBlock * 1.65 && widthV < minBlock * 1.65) {
          emitLeaf(cell)
          return
        }

        // Leaving selected large leaves intact is the BSP equivalent of merging
        // adjacent cells: it creates a deliberate mix of superblocks and fine blocks.
        const mergeChance = urban ? 0.08 + cell.depth * 0.07 : 0.18 + cell.depth * 0.09
        if (cell.depth >= 2 && random() < mergeChance) {
          emitLeaf(cell)
          return
        }

        const midU = (cell.u0 + cell.u1) * 0.5
        const midV = (cell.v0 + cell.v1) * 0.5
        const candidateU: Point[] = [
          unproject([midU, cell.v0], basis),
          unproject([midU, cell.v1], basis),
        ]
        const candidateV: Point[] = [
          unproject([cell.u0, midV], basis),
          unproject([cell.u1, midV], basis),
        ]
        const gradeU = roadGrade(candidateU, heightAt)
        const gradeV = roadGrade(candidateV, heightAt)
        const aspectBias = widthU / Math.max(1, widthV)
        let splitU = aspectBias > 1.18 || (aspectBias > 0.84 && gradeU + 0.015 < gradeV)
        if (widthU < minBlock * 1.65) splitU = false
        if (widthV < minBlock * 1.65) splitU = true

        const span = splitU ? widthU : widthV
        const minRatio = clamp(minBlock / Math.max(1, span), 0.32, 0.46)
        const ratio = minRatio + random() * Math.max(0.02, 1 - minRatio * 2)
        const split = splitU
          ? cell.u0 + widthU * ratio
          : cell.v0 + widthV * ratio
        const raw = splitU
          ? [unproject([split, cell.v0], basis), unproject([split, cell.v1], basis)]
          : [unproject([cell.u0, split], basis), unproject([cell.u1, split], basis)]

        // A restrained terrain bend avoids ruler-straight roads while preserving
        // readable blocks. It moves the midpoint to the lower of two alternatives.
        const a = raw[0]!
        const b = raw[1]!
        const midpoint: Point = [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5]
        const dx = b[0] - a[0]
        const dy = b[1] - a[1]
        const lineLength = Math.hypot(dx, dy) || 1
        const normal: Point = [-dy / lineLength, dx / lineLength]
        const bend = Math.min(6, lineLength * 0.035) * (0.45 + random() * 0.55)
        const left: Point = [midpoint[0] + normal[0] * bend, midpoint[1] + normal[1] * bend]
        const right: Point = [midpoint[0] - normal[0] * bend, midpoint[1] - normal[1] * bend]
        const control = heightAt(left) <= heightAt(right) ? left : right
        const runs = contiguousRuns([a, control, b], region.polygon, frame, heightAt)

        const hierarchy = cell.depth === 0 ? 'collector' : cell.depth === 1 ? 'street' : 'lane'
        const width = cell.depth === 0
          ? Math.min(4.2, fabric.localWidth * 0.78)
          : cell.depth === 1
            ? Math.min(3.2, fabric.localWidth * 0.6)
            : Math.min(2.35, fabric.localWidth * 0.44)
        for (const run of runs) addRoad(run, region, width, hierarchy, roadIndex++)

        if (splitU) {
          subdivide({ ...cell, u1: split, depth: cell.depth + 1 })
          subdivide({ ...cell, u0: split, depth: cell.depth + 1 })
        } else {
          subdivide({ ...cell, v1: split, depth: cell.depth + 1 })
          subdivide({ ...cell, v0: split, depth: cell.depth + 1 })
        }
      }

      subdivide(root)
    }

    const sourceEdges = [...edges, ...generated]
    const lengths = new Map<Edge, number[]>()
    const cuts = new Map<Edge, Array<{ s: number; point: Point }>>()
    const edgeBox = (edge: Edge): [number, number, number, number] => {
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const point of edge.polyline) {
        minX = Math.min(minX, point[0])
        minY = Math.min(minY, point[1])
        maxX = Math.max(maxX, point[0])
        maxY = Math.max(maxY, point[1])
      }
      return [minX, minY, maxX, maxY]
    }
    const boxes = new Map<Edge, [number, number, number, number]>()
    for (const edge of sourceEdges) {
      const cumulative = [0]
      for (let i = 1; i < edge.polyline.length; i++) {
        cumulative.push(cumulative[i - 1]! + dist(edge.polyline[i - 1]!, edge.polyline[i]!))
      }
      lengths.set(edge, cumulative)
      boxes.set(edge, edgeBox(edge))
      cuts.set(edge, [
        { s: 0, point: edge.polyline[0]! },
        { s: cumulative[cumulative.length - 1]!, point: edge.polyline[edge.polyline.length - 1]! },
      ])
    }

    // Planarize every junction involving a BSP street. A shared intersection
    // point becomes one graph node and both the trunk and local edge are split
    // there, so a visual crossing is also a navigable topological connection.
    for (let i = 0; i < sourceEdges.length; i++) {
      const aEdge = sourceEdges[i]!
      for (let j = i + 1; j < sourceEdges.length; j++) {
        const bEdge = sourceEdges[j]!
        const aLocal = aEdge.lineage.source === 'local-streets'
        const bLocal = bEdge.lineage.source === 'local-streets'
        if (!aLocal && !bLocal) continue
        const aBox = boxes.get(aEdge)!
        const bBox = boxes.get(bEdge)!
        if (aBox[2] < bBox[0] || bBox[2] < aBox[0] || aBox[3] < bBox[1] || bBox[3] < aBox[1]) continue
        const aLengths = lengths.get(aEdge)!
        const bLengths = lengths.get(bEdge)!
        for (let ai = 1; ai < aEdge.polyline.length; ai++) {
          const a0 = aEdge.polyline[ai - 1]!
          const a1 = aEdge.polyline[ai]!
          const aMinX = Math.min(a0[0], a1[0])
          const aMaxX = Math.max(a0[0], a1[0])
          const aMinY = Math.min(a0[1], a1[1])
          const aMaxY = Math.max(a0[1], a1[1])
          for (let bi = 1; bi < bEdge.polyline.length; bi++) {
            const b0 = bEdge.polyline[bi - 1]!
            const b1 = bEdge.polyline[bi]!
            if (
              aMaxX < Math.min(b0[0], b1[0])
              || Math.max(b0[0], b1[0]) < aMinX
              || aMaxY < Math.min(b0[1], b1[1])
              || Math.max(b0[1], b1[1]) < aMinY
            ) continue
            const point = segmentIntersection(a0, a1, b0, b1)
            if (!point) continue
            cuts.get(aEdge)!.push({
              s: aLengths[ai - 1]! + dist(a0, point),
              point,
            })
            cuts.get(bEdge)!.push({
              s: bLengths[bi - 1]! + dist(b0, point),
              point,
            })
          }
        }
      }
    }

    const planarEdges: Edge[] = []
    for (const edge of sourceEdges) {
      const cumulative = lengths.get(edge)!
      const ordered = cuts.get(edge)!.sort((a, b) => a.s - b.s)
      const uniqueCuts: Array<{ s: number; point: Point }> = []
      for (const cut of ordered) {
        const previous = uniqueCuts[uniqueCuts.length - 1]
        if (!previous || cut.s - previous.s > 1) uniqueCuts.push(cut)
      }
      for (let i = 1; i < uniqueCuts.length; i++) {
        const start = uniqueCuts[i - 1]!
        const end = uniqueCuts[i]!
        if (end.s - start.s < 2) continue
        const line: Point[] = [start.point]
        for (let p = 1; p < edge.polyline.length - 1; p++) {
          if (cumulative[p]! > start.s + 0.5 && cumulative[p]! < end.s - 0.5) {
            line.push(edge.polyline[p]!)
          }
        }
        line.push(end.point)
        const from = addNode(start.point, 'junction')
        const to = addNode(end.point, 'junction')
        if (from.key === to.key) continue
        planarEdges.push({
          ...edge,
          key: `${edge.key}-part-${i - 1}`,
          from: from.key,
          to: to.key,
          polyline: line,
          lineage: {
            ...edge.lineage,
            via: [...(edge.lineage.via ?? []), 'planar-junctions'],
          },
        })
      }
    }

    const adjacency = new Map<string, Set<string>>()
    const connect = (a: string, b: string): void => {
      const aa = adjacency.get(a)
      if (aa) aa.add(b)
      else adjacency.set(a, new Set([b]))
      const bb = adjacency.get(b)
      if (bb) bb.add(a)
      else adjacency.set(b, new Set([a]))
    }
    for (const edge of planarEdges) connect(edge.from, edge.to)
    const connectedNodes = new Set<string>()
    const queue: string[] = []
    for (const edge of planarEdges) {
      if (edge.lineage.source === 'local-streets') continue
      for (const key of [edge.from, edge.to]) {
        if (!connectedNodes.has(key)) {
          connectedNodes.add(key)
          queue.push(key)
        }
      }
    }
    while (queue.length > 0) {
      const key = queue.shift()!
      for (const next of adjacency.get(key) ?? []) {
        if (connectedNodes.has(next)) continue
        connectedNodes.add(next)
        queue.push(next)
      }
    }
    const connectedEdges = planarEdges.filter((edge) =>
      connectedNodes.has(edge.from) && connectedNodes.has(edge.to)
    )
    const connectedLocalEdges = connectedEdges.filter((edge) =>
      edge.lineage.source === 'local-streets'
    )
    const usedNodeKeys = new Set(connectedEdges.flatMap((edge) => [edge.from, edge.to]))

    const mesh = buildRibbonMesh(
      connectedLocalEdges.flatMap((edge) => [
        { points: edge.polyline, width: edge.width + 0.9, kind: 'kerb' },
        { points: edge.polyline, width: edge.width, kind: edge.kind },
      ]),
      {
        lift: 0.72,
        role: 'road',
        heightAt,
      },
    )

    return {
      network: {
        nodes: nodes.filter((node) => usedNodeKeys.has(node.key)).map((node) => ({
          key: node.key,
          x: node.x,
          y: node.y,
          kind: node.kind,
          role: node.role,
          lineage: node.lineage,
        })),
        edges: connectedEdges.map((edge) => ({
          key: edge.key,
          from: edge.from,
          to: edge.to,
          kind: edge.kind,
          width: edge.width,
          polyline: edge.polyline,
          story: edge.story,
          district: edge.district,
          role: edge.role,
          lineage: edge.lineage,
        })),
        bridges: trunk.bridges ?? [],
      },
      mesh,
      blocks: { blocks, role: 'derived', lineage: { source: 'local-streets', via: ['bsp-leaves'] } },
    }
  },
})
