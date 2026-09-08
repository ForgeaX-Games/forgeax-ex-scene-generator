import type { GuidePoint, GuideStyle } from '../types'
import { invertWorldXformToXY, isIdentityXform, type WorldXform } from './sceneWorldXform'

export function parseGuideStyle(raw: unknown): GuideStyle {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return s === 'points' || s === 'point' || s === 'scatter' ? 'points' : 'polyline'
}

export function parseGuidePoints(raw: unknown): GuidePoint[] {
  let list: unknown = raw
  for (let depth = 0; depth < 4; depth++) {
    if (typeof list === 'string') {
      try { list = JSON.parse(list) } catch { return [] }
      continue
    }
    if (Array.isArray(list) && list.length === 1 && !isPointLike(list[0])) {
      list = list[0]
      continue
    }
    break
  }
  if (!Array.isArray(list)) return []
  const out: GuidePoint[] = []
  for (const pt of list) {
    if (Array.isArray(pt) && pt.length >= 2) {
      const x = Number(pt[0]); const y = Number(pt[1])
      const z = pt.length >= 3 ? Number(pt[2]) : undefined
      if (Number.isFinite(x) && Number.isFinite(y)) {
        out.push(Number.isFinite(z) ? { x, y, z } : { x, y })
      }
    } else if (pt && typeof pt === 'object' && 'x' in pt && 'y' in pt) {
      const x = Number((pt as { x: unknown }).x)
      const y = Number((pt as { y: unknown }).y)
      const z = 'z' in pt ? Number((pt as { z: unknown }).z) : undefined
      if (Number.isFinite(x) && Number.isFinite(y)) {
        const sourceNodeId = typeof (pt as { sourceNodeId?: unknown }).sourceNodeId === 'string'
          ? (pt as { sourceNodeId: string }).sourceNodeId
          : undefined
        const sourceOpId = typeof (pt as { sourceOpId?: unknown }).sourceOpId === 'string'
          ? (pt as { sourceOpId: string }).sourceOpId
          : undefined
        const base = Number.isFinite(z) ? { x, y, z } : { x, y }
        out.push(sourceNodeId ? { ...base, sourceNodeId, sourceOpId } : base)
      }
    }
  }
  return out
}

function isPointLike(v: unknown): boolean {
  if (Array.isArray(v)) return v.length >= 2 && Number.isFinite(Number(v[0])) && Number.isFinite(Number(v[1]))
  return !!v && typeof v === 'object' && 'x' in v && 'y' in v
}

export function parseControlPointsParam(raw: unknown): GuidePoint[] {
  if (Array.isArray(raw) && raw.length > 0 && raw[0] && typeof raw[0] === 'object' && 'items' in (raw[0] as object)) {
    const points: GuidePoint[] = []
    for (const branch of raw) {
      const items = (branch as { items?: unknown }).items
      if (items !== undefined) points.push(...parseGuidePoints(items))
    }
    return points
  }
  return parseGuidePoints(raw)
}

function matchXY(pt: GuidePoint): { x: number; y: number } {
  if (Number.isFinite(pt.localX) && Number.isFinite(pt.localY)) {
    return { x: pt.localX!, y: pt.localY! }
  }
  return { x: pt.x, y: pt.y }
}

function controlPointsDistance(guide: GuidePoint[], candidate: GuidePoint[]): number {
  if (guide.length !== candidate.length || guide.length === 0) return Number.POSITIVE_INFINITY
  let sum = 0
  for (let i = 0; i < guide.length; i++) {
    const g = matchXY(guide[i]!)
    const dx = g.x - candidate[i]!.x
    const dy = g.y - candidate[i]!.y
    sum += dx * dx + dy * dy
  }
  return sum
}

/** Translation-invariant match so placed-city world handles still bind to city-local Controls. */
function alignedControlPointsDistance(guide: GuidePoint[], candidate: GuidePoint[]): number {
  if (guide.length !== candidate.length || guide.length === 0) return Number.POSITIVE_INFINITY
  const ox = guide[0]!.x - candidate[0]!.x
  const oy = guide[0]!.y - candidate[0]!.y
  let sum = 0
  for (let i = 0; i < guide.length; i++) {
    const dx = guide[i]!.x - candidate[i]!.x - ox
    const dy = guide[i]!.y - candidate[i]!.y - oy
    sum += dx * dx + dy * dy
  }
  return sum
}

function matchingControlPointsNode(
  points: GuidePoint[],
  nodes: ReadonlyArray<{ id: string; opId: string; params?: Record<string, unknown> }>,
): { id: string; opId: string; aligned: boolean } | undefined {
  if (nodes.length === 1) {
    const only = nodes[0]!
    const candidate = parseControlPointsParam(only.params?.points)
    const exact = controlPointsDistance(points, candidate)
    const aligned = alignedControlPointsDistance(points, candidate)
    return { id: only.id, opId: only.opId, aligned: aligned + 1e-9 < exact }
  }
  let best: { id: string; opId: string; aligned: boolean } | undefined
  let bestDist = Number.POSITIVE_INFINITY
  for (const node of nodes) {
    const candidate = parseControlPointsParam(node.params?.points)
    const exact = controlPointsDistance(points, candidate)
    const aligned = alignedControlPointsDistance(points, candidate)
    const dist = Math.min(exact, aligned)
    if (dist < bestDist) {
      bestDist = dist
      best = { id: node.id, opId: node.opId, aligned: aligned < exact }
    }
  }
  // Same-length polylines that are actually a different path stay unmatched.
  if (!Number.isFinite(bestDist) || bestDist > 4) return undefined
  return best
}

function stampAlignedFrame(
  points: GuidePoint[],
  candidate: GuidePoint[],
): Pick<GuidePoint, 'parentTx' | 'parentTy' | 'parentYaw' | 'localX' | 'localY'> | null {
  if (points.length === 0 || candidate.length === 0) return null
  if (points[0]!.parentTx !== undefined) return null
  return {
    parentTx: points[0]!.x - candidate[0]!.x,
    parentTy: points[0]!.y - candidate[0]!.y,
    parentYaw: 0,
  }
}

export function attachGuideSources(
  points: GuidePoint[],
  manuals: ReadonlyArray<{ id: string; x: number; y: number }>,
  controlPointsNodes?: ReadonlyArray<{ id: string; opId: string; params?: Record<string, unknown> }>,
): GuidePoint[] {
  if (controlPointsNodes && controlPointsNodes.length > 0) {
    const cp = matchingControlPointsNode(points, controlPointsNodes)
    if (cp) {
      const candidate = parseControlPointsParam(
        controlPointsNodes.find((node) => node.id === cp.id)?.params?.points,
      )
      const inferred = cp.aligned ? stampAlignedFrame(points, candidate) : null
      return points.map((pt, idx) => ({
        ...pt,
        sourceNodeId: pt.sourceNodeId || cp.id,
        sourceOpId: 'control_points',
        sourceIndex: idx,
        ...(inferred && pt.parentTx === undefined
          ? {
              parentTx: inferred.parentTx,
              parentTy: inferred.parentTy,
              parentYaw: inferred.parentYaw,
              localX: pt.x - (inferred.parentTx ?? 0),
              localY: pt.y - (inferred.parentTy ?? 0),
            }
          : {}),
      }))
    }
  }
  return points.map((pt) => {
    if (pt.sourceNodeId) return pt
    const src = manuals.find((m) => Math.abs(m.x - pt.x) < 1e-6 && Math.abs(m.y - pt.y) < 1e-6)
    return src ? { ...pt, sourceNodeId: src.id, sourceOpId: 'manual_points' } : pt
  })
}

function parentFrameOf(pt: GuidePoint): WorldXform | null {
  if (pt.parentTx === undefined && pt.parentTy === undefined && (pt.parentYaw ?? 0) === 0) {
    return null
  }
  return {
    tx: pt.parentTx ?? 0,
    ty: pt.parentTy ?? 0,
    tz: 0,
    yaw: pt.parentYaw ?? 0,
  }
}

/** Convert a displayed (world / authoring) handle back to Control-local metres. */
export function guidePointToControlXY(
  pt: GuidePoint,
  world: { x: number; y: number } = { x: pt.x, y: pt.y },
): [number, number] {
  const frame = parentFrameOf(pt)
  if (frame && !isIdentityXform(frame)) {
    const local = invertWorldXformToXY(world.x, world.y, frame)
    return [local.x, local.y]
  }
  if (
    world.x === pt.x &&
    world.y === pt.y &&
    Number.isFinite(pt.localX) &&
    Number.isFinite(pt.localY)
  ) {
    return [pt.localX!, pt.localY!]
  }
  return [world.x, world.y]
}

export function guideLayerToControlPoints(
  points: readonly GuidePoint[],
  movedIndex?: number,
  movedWorld?: { x: number; y: number },
): Array<[number, number]> {
  return points.map((pt, i) => {
    if (i === movedIndex && movedWorld) return guidePointToControlXY(pt, movedWorld)
    return guidePointToControlXY(pt)
  })
}

export function collectManualPointNodes(
  nodes: ReadonlyArray<{ id: string; opId: string; params?: Record<string, unknown> }>,
): Array<{ id: string; x: number; y: number }> {
  const out: Array<{ id: string; x: number; y: number }> = []
  for (const node of nodes) {
    if (node.opId !== 'manual_points') continue
    const x = Number(node.params?.x)
    const y = Number(node.params?.y)
    if (Number.isFinite(x) && Number.isFinite(y)) out.push({ id: node.id, x, y })
  }
  return out
}

export function collectControlPointsNodes(
  nodes: ReadonlyArray<{ id: string; opId: string; params?: Record<string, unknown> }>,
): Array<{ id: string; opId: string; params?: Record<string, unknown> }> {
  const out: Array<{ id: string; opId: string; params?: Record<string, unknown> }> = []
  for (const node of nodes) {
    if (node.opId === 'control_points') {
      out.push({ id: node.id, opId: node.opId, params: node.params })
    }
  }
  return out
}
