/**
 * Vertical lift Φ(u,v)=(xy,h) from 2D operating Geometry onto a Heightfield.
 * Densify by XY arc length so shared network nodes stay one table.
 */

import {
  sampleHeightfieldWorld,
  unwrapHeightfield,
  type Heightfield,
} from './heightfieldField.js'
import { asPlane } from './spatial.js'

type Point = readonly number[]

function peelGeometry(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  const rec = value as { kind?: unknown; geometry?: unknown }
  if (rec.geometry && typeof rec.geometry === 'object' && rec.kind === undefined) {
    return peelGeometry(rec.geometry)
  }
  return rec.kind ? (value as Record<string, unknown>) : null
}

function xy(point: Point): [number, number] {
  return [Number(point[0]) || 0, Number(point[1]) || 0]
}

function cellSpacing(field: Heightfield): number {
  const plane = asPlane(field.geometry) ?? field.geometry
  const columns = Math.max(1, field.columns)
  const rows = Math.max(1, field.rows)
  return Math.min(plane.width / columns, plane.height / rows)
}

export function densifyPolylineXY(points: readonly Point[], spacing: number): Point[] {
  if (points.length === 0) return []
  const step = spacing > 1e-6 ? spacing : 1
  const out: Point[] = [xy(points[0]!)]
  for (let i = 1; i < points.length; i++) {
    const a = xy(points[i - 1]!)
    const b = xy(points[i]!)
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const n = Math.max(1, Math.ceil(len / step))
    for (let k = 1; k <= n; k++) {
      const t = k / n
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    }
  }
  return out
}

function liftXY(field: Heightfield, x: number, y: number): [number, number, number] | null {
  const z = sampleHeightfieldWorld(field, x, y)
  if (z === undefined) return null
  return [x, y, z]
}

function liftPoints(field: Heightfield, points: readonly Point[], densify: boolean): Point[] | { error: string } {
  const spaced = densify ? densifyPolylineXY(points, cellSpacing(field)) : points.map((p) => xy(p))
  const lifted: Point[] = []
  for (const point of spaced) {
    const xyz = liftXY(field, point[0]!, point[1]!)
    if (!xyz) {
      return { error: `SCENE_NOT_ON_SURFACE: (${point[0]}, ${point[1]}) is outside the Heightfield` }
    }
    lifted.push(xyz)
  }
  return lifted
}

function liftPointRecord(field: Heightfield, rec: Record<string, unknown>): Record<string, unknown> | { error: string } {
  const x = Number(rec.x)
  const y = Number(rec.y)
  const xyz = liftXY(field, x, y)
  if (!xyz) return { error: `SCENE_NOT_ON_SURFACE: (${x}, ${y}) is outside the Heightfield` }
  return { kind: 'point3d', x: xyz[0], y: xyz[1], z: xyz[2] }
}

function liftCurve(
  field: Heightfield,
  rec: Record<string, unknown>,
  densify: boolean,
): Record<string, unknown> | { error: string } {
  const points = Array.isArray(rec.points) ? rec.points as Point[] : []
  const lifted = liftPoints(field, points, densify)
  if ('error' in lifted) return lifted
  if (rec.kind === 'spline' || rec.kind === 'spline3d') {
    return { kind: 'spline3d', points: lifted, degree: Number(rec.degree) || 3 }
  }
  return { kind: 'polyline3d', points: lifted }
}

function liftRing(field: Heightfield, points: readonly Point[]): Point[] | { error: string } {
  if (points.length < 3) return { error: 'polygon ring is degenerate' }
  const closed = densifyPolylineXY([...points, points[0]!], cellSpacing(field))
  closed.pop()
  const lifted = liftPoints(field, closed, false)
  return lifted
}

export function liftOperatingGeometry(
  rawGeometry: unknown,
  rawSurface: unknown,
): { geometry?: Record<string, unknown>; error?: string } {
  const field = unwrapHeightfield(rawSurface)
  if (!field) return { error: 'liftToSurface requires a Heightfield surface' }
  const rec = peelGeometry(rawGeometry)
  if (!rec) return { error: 'liftToSurface requires 2D operating Geometry' }
  const kind = String(rec.kind)

  if (kind === 'point2d' || kind === 'point3d') {
    const built = liftPointRecord(field, rec)
    if ('error' in built) return built
    return { geometry: built }
  }
  if (kind === 'polyline' || kind === 'spline' || kind === 'polyline3d' || kind === 'spline3d') {
    const built = liftCurve(field, rec, kind === 'polyline' || kind === 'polyline3d')
    if ('error' in built) return built
    return { geometry: built }
  }
  if (kind === 'polygon' || kind === 'polygon3d') {
    const points = Array.isArray(rec.points) ? rec.points as Point[] : []
    const outer = liftRing(field, points)
    if ('error' in outer) return outer
    const holesIn = Array.isArray(rec.holes) ? rec.holes as Point[][] : []
    const holes: Point[][] = []
    for (const ring of holesIn) {
      const lifted = liftRing(field, ring)
      if ('error' in lifted) return lifted
      holes.push(lifted)
    }
    return {
      geometry: {
        kind: 'polygon3d',
        points: outer,
        ...(holes.length > 0 ? { holes } : {}),
      },
    }
  }
  if (kind === 'network' || kind === 'network3d') {
    const nodes = Array.isArray(rec.nodes) ? rec.nodes as Point[] : []
    const liftedNodes: Point[] = []
    for (const node of nodes) {
      const [x, y] = xy(node)
      const xyz = liftXY(field, x, y)
      if (!xyz) return { error: `SCENE_NOT_ON_SURFACE: node (${x}, ${y}) is outside the Heightfield` }
      liftedNodes.push(xyz)
    }
    const edgesIn = Array.isArray(rec.edges) ? rec.edges as Array<Record<string, unknown>> : []
    const edges: Array<Record<string, unknown>> = []
    for (const edge of edgesIn) {
      const from = Number(edge.from)
      const to = Number(edge.to)
      const a = liftedNodes[from]
      const b = liftedNodes[to]
      if (!a || !b) return { error: 'liftToSurface: network edge has an out-of-range node index' }
      if (edge.curve && typeof edge.curve === 'object') {
        const curve = liftCurve(field, edge.curve as Record<string, unknown>, true)
        if ('error' in curve) return curve
        edges.push({ from, to, curve })
        continue
      }
      const chord = liftPoints(field, [xy(nodes[from]!), xy(nodes[to]!)], true)
      if ('error' in chord) return chord
      if (chord.length <= 2) {
        edges.push({ from, to })
      } else {
        edges.push({ from, to, curve: { kind: 'polyline3d', points: chord } })
      }
    }
    return { geometry: { kind: 'network3d', nodes: liftedNodes, edges } }
  }
  return { error: `liftToSurface cannot lift Geometry kind ${kind}` }
}
