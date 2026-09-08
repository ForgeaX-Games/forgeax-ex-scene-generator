import { defineGenerator } from '@forgeax/project-generator'
import {
  alongPolyline,
  asPointList,
  buildRibbonMesh,
  chaikin,
  centroidOf,
  dist,
  distToPolyline,
  nearestAlongT,
  pointInPolygon,
  polylineLength,
  rectBoundary,
  resamplePolyline,
  sampleGridHeight,
  tangentNormal,
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
  role: 'derived'
  lineage: { source: string; via?: string[] }
}

type Stroke = {
  key: string
  points: Point[]
  width: number
  kind: Edge['kind']
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

function splitByPredicate(points: readonly Point[], keep: (pt: Point) => boolean): Point[][] {
  const runs: Point[][] = []
  let current: Point[] = []
  for (const pt of points) {
    if (keep(pt)) {
      current.push(pt)
    } else if (current.length >= 2) {
      runs.push(current)
      current = []
    } else {
      current = []
    }
  }
  if (current.length >= 2) runs.push(current)
  return runs
}

function slicePolyline(points: readonly Point[], startIdx: number, endIdx: number): Point[] {
  if (endIdx < startIdx) return slicePolyline(points, endIdx, startIdx).reverse()
  return points.slice(startIdx, endIdx + 1)
}

function nearestPointIndex(points: readonly Point[], target: Point): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < points.length; i++) {
    const d = dist(points[i]!, target)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

export const roadNetwork = defineGenerator({
  id: 'road-network',
  version: '6.0.0',
  description: 'Sparse three-tier arterial skeleton; district interiors are delegated to terrain-aware BSP local streets.',
  inputs: {
    hubs: { type: 'Any', runtimeType: 'point2d-list', access: 'list' },
    coastline: { type: 'Any', runtimeType: 'point2d-list', access: 'list' },
    creek: { type: 'Any', runtimeType: 'point2d-list', access: 'list' },
    arterial: { type: 'Any', runtimeType: 'point2d-list', access: 'list' },
    cityBoundary: { type: 'Any', runtimeType: 'point2d-list', access: 'list' },
    districts: { type: 'Any', runtimeType: 'region-set' },
    heightGrid: { type: 'Any', runtimeType: 'height-grid' },
    cellSize: { type: 'NumberValue', defaultValue: 8 },
    seed: { type: 'NumberValue', defaultValue: 11, control: true },
    width: { type: 'NumberValue', defaultValue: 600 },
    height: { type: 'NumberValue', defaultValue: 450 },
  },
  outputs: {
    network: { type: 'Any', runtimeType: 'road-network' },
    mesh: { type: 'Mesh' },
  },
  run(_ctx, args: {
    hubs: Point[]
    coastline: Point[]
    creek?: Point[]
    arterial?: Point[]
    cityBoundary?: Point[]
    districts?: { regions?: Array<{ key: string; polygon: Point[]; attributes?: any }> }
    heightGrid?: number[][]
    cellSize?: number
    seed: number
    width: number
    height: number
  }) {
    const rawHubs = asPointList(args.hubs)
    const coastline = asPointList(args.coastline)
    const creek = asPointList(args.creek)
    const width = Number(args.width) || 600
    const height = Number(args.height) || 450
    const cellSize = Number(args.cellSize) || 8
    const heightGrid = args.heightGrid
    const rawBoundary = asPointList(args.cityBoundary)
    const frame = rawBoundary.length >= 4 ? rawBoundary : rectBoundary(width, height, 12)
    const midCity = centroidOf(frame)

    const nodes: Node[] = []
    const edges: Edge[] = []
    const nodeMap = new Map<string, Node>()
    const seenEdges = new Set<string>()
    const meshStrokes: Stroke[] = []

    const addNode = (node: Node): Node => {
      const existing = nodeMap.get(node.key)
      if (existing) return existing
      nodeMap.set(node.key, node)
      nodes.push(node)
      return node
    }

    const findOrCreateNode = (
      pt: Point,
      prefix: string,
      kind: Node['kind'] = 'crossing',
      role: Node['role'] = 'derived',
      source = 'roads',
      snap = 10,
    ): Node => {
      for (const n of nodes) {
        if (dist([n.x, n.y], pt) < snap) {
          if (kind === 'hub' || kind === 'bridge' || kind === 'waterfront') n.kind = kind
          return n
        }
      }
      return addNode({
        key: `${prefix}-${Math.round(pt[0])}-${Math.round(pt[1])}`,
        x: pt[0],
        y: pt[1],
        kind,
        role,
        lineage: { source },
      })
    }

    const linkNodes = (
      fromNode: Node,
      toNode: Node,
      rawPolyline: readonly Point[],
      kind: Edge['kind'],
      widthM: number,
      source: string,
    ) => {
      if (fromNode.key === toNode.key) return
      const id = pairKey(fromNode.key, toNode.key)
      if (seenEdges.has(id) || rawPolyline.length < 2) return
      if (dist([fromNode.x, fromNode.y], [toNode.x, toNode.y]) < 2) return
      seenEdges.add(id)
      const pts = [...rawPolyline]
      pts[0] = [fromNode.x, fromNode.y]
      pts[pts.length - 1] = [toNode.x, toNode.y]
      edges.push({
        key: `${kind}-${fromNode.key}-${toNode.key}`,
        from: fromNode.key,
        to: toNode.key,
        kind,
        width: widthM,
        polyline: resamplePolyline(pts, 10),
        role: 'derived',
        lineage: { source, via: ['continuous-curve-network'] },
      })
    }

    const rawShore = coastline.length >= 2 ? coastline : [[0, 0], [width, 0]] as Point[]
    const smoothShore = chaikin(resamplePolyline(rawShore, 8), 2)

    let t0 = 1
    let t1 = 0
    for (const pt of frame) {
      const t = nearestAlongT(smoothShore, pt)
      if (t < t0) t0 = t
      if (t > t1) t1 = t
    }
    if (t0 >= t1) {
      t0 = 0.05
      t1 = 0.95
    } else {
      t0 = Math.max(0.02, t0)
      t1 = Math.min(0.98, t1)
    }

    const mouth = creek[creek.length - 1] ?? midCity
    const mouthT = creek.length >= 2 ? nearestAlongT(smoothShore, mouth) : 0.5
    const westT = t0 + (mouthT - t0) * 0.48
    const eastT = mouthT + (t1 - mouthT) * 0.52
    const riverGap = 0.055
    const riverClearance = 22

    const getMacroInlandNormal = (t: number): Point => {
      const tA = Math.max(0, t - 0.18)
      const tB = Math.min(1, t + 0.18)
      const pA = alongPolyline(smoothShore, tA)
      const pB = alongPolyline(smoothShore, tB)
      const p = alongPolyline(smoothShore, t)
      const tan: Point = [(pB[0] - pA[0]) / (dist(pA, pB) || 1), (pB[1] - pA[1]) / (dist(pA, pB) || 1)]
      const n1: Point = [-tan[1], tan[0]]
      const n2: Point = [tan[1], -tan[0]]
      const probe1: Point = [p[0] + n1[0] * 24, p[1] + n1[1] * 24]
      const probe2: Point = [p[0] + n2[0] * 24, p[1] + n2[1] * 24]
      const in1 = pointInPolygon(probe1, frame)
      const in2 = pointInPolygon(probe2, frame)
      if (in1 && !in2) return n1
      if (in2 && !in1) return n2
      return dist(probe1, midCity) <= dist(probe2, midCity) ? n1 : n2
    }

    const getCurvilinearPoint = (t: number, d: number): Point => {
      const shorePt = alongPolyline(smoothShore, t)
      const norm = getMacroInlandNormal(t)
      return [shorePt[0] + norm[0] * d, shorePt[1] + norm[1] * d]
    }

    const onLand = (pt: Point): boolean => {
      if (frame.length >= 3 && !pointInPolygon(pt, frame)) return false
      if (creek.length >= 2 && distToPolyline(pt, creek) < riverClearance) return false
      return true
    }

    const sampleCompleteCurve = (tStart: number, tEnd: number, d: number): Point[] => {
      const steps = Math.max(28, Math.round(Math.abs(tEnd - tStart) * 90))
      const raw: Point[] = []
      for (let i = 0; i <= steps; i++) {
        raw.push(getCurvilinearPoint(tStart + (tEnd - tStart) * (i / steps), d))
      }
      const kept = splitByPredicate(raw, onLand)
        .filter((run) => run.length >= 4 && polylineLength(run) > 36)
        .sort((a, b) => polylineLength(b) - polylineLength(a))[0]
      if (!kept) return []
      return chaikin(resamplePolyline(kept, 8), 2)
    }

    const levels: Array<{ key: string; depth: number; width: number; kind: Edge['kind'] }> = [
      { key: 'waterfront', depth: 18, width: 10.0, kind: 'waterfront' },
      { key: 'spine', depth: 105, width: 9.2, kind: 'arterial' },
      { key: 'inland', depth: 265, width: 8.2, kind: 'arterial' },
    ]

    const banks: Array<{ key: string; tStart: number; tEnd: number }> = [
      { key: 'west', tStart: t0, tEnd: mouthT - riverGap },
      { key: 'east', tStart: mouthT + riverGap, tEnd: t1 },
    ]

    const boulevardCurves: Array<{ key: string; points: Point[]; width: number; kind: Edge['kind'] }> = []
    for (const bank of banks) {
      for (const level of levels) {
        const points = sampleCompleteCurve(bank.tStart, bank.tEnd, level.depth)
        if (points.length < 4) continue
        const curve = {
          key: `${level.key}-${bank.key}`,
          points,
          width: level.width,
          kind: level.kind,
        }
        boulevardCurves.push(curve)
        meshStrokes.push(curve)
      }
    }

    const stationTs = [
      t0 + (westT - t0) * 0.28,
      westT,
      mouthT - riverGap * 1.6,
      mouthT + riverGap * 1.6,
      eastT,
      eastT + (t1 - eastT) * 0.72,
    ]

    const transverseCurves: Array<{ key: string; points: Point[] }> = []
    for (let si = 0; si < stationTs.length; si++) {
      const t = stationTs[si]!
      const raw: Point[] = []
      for (const d of [18, 105, 265]) {
        raw.push(getCurvilinearPoint(t, d))
      }
      const kept = splitByPredicate(raw, onLand).sort((a, b) => polylineLength(b) - polylineLength(a))[0]
      if (!kept || kept.length < 2) continue
      const points = chaikin(kept, 1)
      const curve = { key: `transverse-${si}`, points }
      transverseCurves.push(curve)
      meshStrokes.push({ key: curve.key, points, width: 8.0, kind: 'arterial' })
    }

    let bridges: Array<{ key: string; span: number }> = []
    if (creek.length >= 4) {
      const target = getCurvilinearPoint(mouthT, 68)
      let bestIdx = 0
      let bestD = Infinity
      for (let i = 0; i < creek.length; i++) {
        const d = dist(creek[i]!, target)
        if (d < bestD) {
          bestD = d
          bestIdx = i
        }
      }
      const riverPt = creek[bestIdx]!
      const rawN = tangentNormal(creek, bestIdx)
      const n: Point = rawN[0] < 0 ? rawN : [-rawN[0], -rawN[1]]
      const halfSpan = 16
      const leftBank: Point = [riverPt[0] + n[0] * halfSpan, riverPt[1] + n[1] * halfSpan]
      const rightBank: Point = [riverPt[0] - n[0] * halfSpan, riverPt[1] - n[1] * halfSpan]
      const westSpine = boulevardCurves.find((c) => c.key === 'spine-west')
      const eastSpine = boulevardCurves.find((c) => c.key === 'spine-east')
      const westEnd = westSpine ? westSpine.points[westSpine.points.length - 1]! : leftBank
      const eastStart = eastSpine ? eastSpine.points[0]! : rightBank
      const crossing = chaikin([westEnd, leftBank, rightBank, eastStart], 2)
      meshStrokes.push({ key: 'river-crossing', points: crossing, width: 9.0, kind: 'bridge' })
      bridges = [{ key: 'central-bridge', span: dist(leftBank, rightBank) }]

      const nW = findOrCreateNode(westEnd, 'br-w-end', 'crossing', 'derived', 'bridge', 14)
      const nL = findOrCreateNode(leftBank, 'br-l', 'bridge', 'derived', 'creek', 8)
      const nR = findOrCreateNode(rightBank, 'br-r', 'bridge', 'derived', 'creek', 8)
      const nE = findOrCreateNode(eastStart, 'br-e-end', 'crossing', 'derived', 'bridge', 14)
      linkNodes(nW, nL, [westEnd, leftBank], 'arterial', 9.0, 'bridge-approach-west')
      linkNodes(nL, nR, [leftBank, rightBank], 'bridge', 9.0, 'bridge-span')
      linkNodes(nR, nE, [rightBank, eastStart], 'arterial', 9.0, 'bridge-approach-east')
    }

    const attachCurveAsGraph = (
      curve: { key: string; points: Point[]; width: number; kind: Edge['kind'] },
      extraStops: Point[] = [],
    ) => {
      if (curve.points.length < 2) return
      const stops: Array<{ idx: number; node: Node }> = []
      const start = curve.points[0]!
      const end = curve.points[curve.points.length - 1]!
      const startKind: Node['kind'] = curve.kind === 'waterfront' ? 'waterfront' : 'crossing'
      stops.push({
        idx: 0,
        node: findOrCreateNode(start, `${curve.key}-a`, startKind, 'derived', curve.key, 12),
      })
      for (const stop of extraStops) {
        const idx = nearestPointIndex(curve.points, stop)
        if (idx <= 1 || idx >= curve.points.length - 2) continue
        if (dist(curve.points[idx]!, stop) > 22) continue
        stops.push({
          idx,
          node: findOrCreateNode(curve.points[idx]!, `${curve.key}-x`, 'crossing', 'derived', curve.key, 12),
        })
      }
      stops.push({
        idx: curve.points.length - 1,
        node: findOrCreateNode(end, `${curve.key}-b`, startKind, 'derived', curve.key, 12),
      })
      stops.sort((a, b) => a.idx - b.idx)
      const unique: typeof stops = []
      for (const stop of stops) {
        const prev = unique[unique.length - 1]
        if (prev && (prev.node.key === stop.node.key || stop.idx - prev.idx < 2)) continue
        unique.push(stop)
      }
      for (let i = 0; i < unique.length - 1; i++) {
        const a = unique[i]!
        const b = unique[i + 1]!
        linkNodes(a.node, b.node, slicePolyline(curve.points, a.idx, b.idx), curve.kind, curve.width, curve.key)
      }
    }

    const transverseStops: Point[] = transverseCurves.flatMap((c) => c.points)
    for (const curve of boulevardCurves) {
      attachCurveAsGraph(curve, transverseStops)
    }
    for (const curve of transverseCurves) {
      attachCurveAsGraph({ key: curve.key, points: curve.points, width: 8.0, kind: 'arterial' }, boulevardCurves.flatMap((c) => c.points))
    }

    for (let hi = 0; hi < rawHubs.length; hi++) {
      const hPt = rawHubs[hi]!
      if (nodes.some((n) => dist(hPt, [n.x, n.y]) < 40)) continue
      let best: { pt: Point; curveKey: string } | null = null
      let bestD = Infinity
      for (const curve of boulevardCurves) {
        const idx = nearestPointIndex(curve.points, hPt)
        const pt = curve.points[idx]!
        const d = dist(hPt, pt)
        if (d < bestD) {
          bestD = d
          best = { pt, curveKey: curve.key }
        }
      }
      if (!best || bestD < 12 || bestD > 160) continue
      const hubNode = findOrCreateNode(hPt, `hub-${hi}`, 'hub', 'control', 'hubs', 8)
      const target = findOrCreateNode(best.pt, `hub-on-${best.curveKey}`, 'crossing', 'derived', best.curveKey, 12)
      linkNodes(hubNode, target, [hPt, best.pt], 'local', 6.5, `hub-spur-${hi}`)
      meshStrokes.push({ key: `hub-spur-${hi}`, points: [hPt, best.pt], width: 6.5, kind: 'local' })
    }

    const getComponents = () => {
      const adj = new Map<string, Set<string>>()
      for (const node of nodes) adj.set(node.key, new Set())
      for (const edge of edges) {
        adj.get(edge.from)?.add(edge.to)
        adj.get(edge.to)?.add(edge.from)
      }
      const comps: Array<Set<string>> = []
      const vis = new Set<string>()
      for (const node of nodes) {
        if (vis.has(node.key)) continue
        const comp = new Set<string>()
        const q = [node.key]
        vis.add(node.key)
        while (q.length > 0) {
          const curr = q.shift()!
          comp.add(curr)
          for (const neighbor of adj.get(curr) ?? []) {
            if (!vis.has(neighbor)) {
              vis.add(neighbor)
              q.push(neighbor)
            }
          }
        }
        comps.push(comp)
      }
      return comps
    }

    let components = getComponents()
    while (components.length > 1) {
      components.sort((a, b) => b.size - a.size)
      const mainComp = components[0]!
      const subComp = components[1]!
      let bestMain = ''
      let bestSub = ''
      let bestD = Infinity
      for (const mKey of mainComp) {
        const mNode = nodeMap.get(mKey)
        if (!mNode) continue
        for (const sKey of subComp) {
          const sNode = nodeMap.get(sKey)
          if (!sNode) continue
          const d = dist([mNode.x, mNode.y], [sNode.x, sNode.y])
          if (d < bestD) {
            bestD = d
            bestMain = mKey
            bestSub = sKey
          }
        }
      }
      if (!bestMain || !bestSub) break
      const nm = nodeMap.get(bestMain)!
      const ns = nodeMap.get(bestSub)!
      const stitch: Point[] = [[nm.x, nm.y], [ns.x, ns.y]]
      linkNodes(nm, ns, stitch, 'local', 6.5, 'connectivity-stitch')
      meshStrokes.push({ key: `stitch-${bestMain}-${bestSub}`, points: stitch, width: 6.5, kind: 'local' })
      components = getComponents()
    }

    const incidentWidths = new Map<string, { maxW: number; count: number; kind: Edge['kind'] }>()
    for (const e of edges) {
      for (const nKey of [e.from, e.to]) {
        const prev = incidentWidths.get(nKey) ?? { maxW: 0, count: 0, kind: e.kind }
        prev.maxW = Math.max(prev.maxW, e.width)
        prev.count += 1
        incidentWidths.set(nKey, prev)
      }
    }
    const junctions = nodes
      .filter((n) => (incidentWidths.get(n.key)?.count ?? 0) >= 2)
      .map((n) => {
        const info = incidentWidths.get(n.key)!
        return { center: [n.x, n.y] as Point, radius: info.maxW * 0.55 + 0.8, kind: info.kind }
      })

    const mesh = buildRibbonMesh(
      meshStrokes.map((s) => ({ points: s.points, width: s.width, kind: s.kind })),
      {
        lift: 0.9,
        role: 'road',
        junctions,
        heightAt: (pt: Point) => (heightGrid ? sampleGridHeight(heightGrid, cellSize, pt) : 0),
      },
    )

    return {
      network: {
        nodes: nodes.map((n) => ({
          key: n.key,
          x: n.x,
          y: n.y,
          kind: n.kind,
          role: n.role,
          lineage: n.lineage,
        })),
        edges: edges.map((e) => ({
          key: e.key,
          from: e.from,
          to: e.to,
          kind: e.kind,
          width: e.width,
          polyline: e.polyline,
          role: e.role,
          lineage: e.lineage,
        })),
        bridges,
      },
      mesh,
    }
  },
})
