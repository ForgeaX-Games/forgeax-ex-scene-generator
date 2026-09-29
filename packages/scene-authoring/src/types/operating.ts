/**
 * Operating-geometry constructors and unreasonableness checks.
 * Width, grade, junctions, and terrain carve belong in a consuming .scene.ts.
 */

import { isShapeBranch, isShapeTree } from './shape.js'
import {
  isOperatingGeometryKind,
  type Geometry,
  type GeometryNetwork,
  type GeometryNetwork3d,
  type GeometryNetwork3dEdge,
  type GeometryNetworkEdge,
  type GeometryPoint,
  type GeometryPoint2d,
  type GeometryPoint3d,
  type GeometryPolygon,
  type GeometryPolygon3d,
  type GeometryPolyline,
  type GeometryPolyline3d,
  type GeometrySpline,
  type GeometrySpline3d,
} from './values.js'

const MIN_LEN = 1e-4
const MIN_AREA = 1e-4
const ENDPOINT_M = 1e-3

export interface GeometryBuild {
  geometry: Geometry
  error?: string
}

export interface GeometryFault {
  code: 'SCENE_GEOMETRY_DEGENERATE'
  message: string
}

function asPoint(value: unknown): GeometryPoint | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const rec = value as { kind?: unknown; geometry?: unknown; x?: unknown; y?: unknown; z?: unknown }
    if (rec.geometry !== undefined) return asPoint(rec.geometry)
    if (rec.kind === 'point2d' || rec.kind === 'point3d' || rec.x !== undefined || rec.y !== undefined) {
      const x = Number(rec.x)
      const y = Number(rec.y)
      const z = rec.z !== undefined ? Number(rec.z) : undefined
      if (![x, y].every(Number.isFinite)) return null
      if (z !== undefined && !Number.isFinite(z)) return null
      return z === undefined ? [x, y] : [x, y, z]
    }
    return null
  }
  if (!Array.isArray(value) || value.length < 2) return null
  const x = Number(value[0])
  const y = Number(value[1])
  const z = value.length > 2 ? Number(value[2]) : undefined
  if (![x, y].every(Number.isFinite)) return null
  if (z !== undefined && !Number.isFinite(z)) return null
  return z === undefined ? [x, y] : [x, y, z]
}

function listItems(value: unknown): unknown[] | null {
  if (isShapeTree(value)) {
    const items = value.flatMap((branch) => [...branch.items])
    return items.length > 0 ? items : null
  }
  if (isShapeBranch(value)) return value.items.length > 0 ? [...value.items] : null
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const rec = value as { items?: unknown; geometry?: unknown; points?: unknown }
    if (Array.isArray(rec.items) && rec.items.length > 0) return rec.items
    if (rec.geometry !== undefined) return listItems(rec.geometry)
    if (rec.points !== undefined) return listItems(rec.points)
    return null
  }
  if (!Array.isArray(value) || value.length === 0) return null
  return value
}

function asPoints(value: unknown): GeometryPoint[] | null {
  const items = listItems(value)
  if (!items) return null
  const points: GeometryPoint[] = []
  for (const item of items) {
    const point = asPoint(item)
    if (!point) return null
    points.push(point)
  }
  return points
}

function asPoint3d(value: unknown): GeometryPoint | null {
  const point = asPoint(value)
  if (!point || !Number.isFinite(point[2])) return null
  return [point[0]!, point[1]!, point[2]!]
}

function asPoints3d(value: unknown): GeometryPoint[] | null {
  const items = listItems(value)
  if (!items) return null
  const points: GeometryPoint[] = []
  for (const item of items) {
    const point = asPoint3d(item)
    if (!point) return null
    points.push(point)
  }
  return points
}

function lengthOf(points: readonly GeometryPoint[]): number {
  let length = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    length += Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!)
  }
  return length
}

function lengthOf3d(points: readonly GeometryPoint[]): number {
  let length = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    length += Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!, (b[2] ?? 0) - (a[2] ?? 0))
  }
  return length
}

function ringArea(points: readonly GeometryPoint[]): number {
  let area = 0
  const n = points.length
  if (n < 3) return 0
  for (let i = 0; i < n; i++) {
    const a = points[i]!
    const b = points[(i + 1) % n]!
    area += a[0]! * b[1]! - b[0]! * a[1]!
  }
  return Math.abs(area) / 2
}

function segmentsCross(
  a0: GeometryPoint,
  a1: GeometryPoint,
  b0: GeometryPoint,
  b1: GeometryPoint,
): boolean {
  const ax = a1[0]! - a0[0]!
  const ay = a1[1]! - a0[1]!
  const bx = b1[0]! - b0[0]!
  const by = b1[1]! - b0[1]!
  const den = ax * by - ay * bx
  if (Math.abs(den) < 1e-12) return false
  const dx = b0[0]! - a0[0]!
  const dy = b0[1]! - a0[1]!
  const t = (dx * by - dy * bx) / den
  const u = (dx * ay - dy * ax) / den
  return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6
}

function ringSelfIntersects(points: readonly GeometryPoint[]): boolean {
  const n = points.length
  if (n < 4) return false
  for (let i = 0; i < n; i++) {
    const a0 = points[i]!
    const a1 = points[(i + 1) % n]!
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue
      const b0 = points[j]!
      const b1 = points[(j + 1) % n]!
      if (segmentsCross(a0, a1, b0, b1)) return true
    }
  }
  return false
}

export function buildPoint2d(input: Record<string, unknown>): GeometryBuild {
  const x = Number(input.x ?? 0)
  const y = Number(input.y ?? 0)
  const geometry: GeometryPoint2d = { kind: 'point2d', x, y }
  if (![x, y].every(Number.isFinite)) {
    return { geometry: { kind: 'point2d', x: 0, y: 0 }, error: 'point2d requires finite x and y in authoring metres' }
  }
  return { geometry }
}

export function buildPolyline(input: Record<string, unknown>): GeometryBuild {
  const points = asPoints(input.points)
  if (!points || points.length < 2) {
    return {
      geometry: { kind: 'polyline', points: points ?? [] },
      error: 'polyline requires at least two points ([x, y], [x, y, z], or Geometry point2d) in authoring metres',
    }
  }
  const geometry: GeometryPolyline = { kind: 'polyline', points }
  const fault = diagnoseGeometry(geometry)
  return fault ? { geometry, error: fault.message } : { geometry }
}

export function buildSpline(input: Record<string, unknown>): GeometryBuild {
  const points = asPoints(input.points)
  const degree = Number.isFinite(Number(input.degree)) ? Math.max(1, Math.floor(Number(input.degree))) : 3
  if (!points || points.length < 2) {
    return {
      geometry: { kind: 'spline', points: points ?? [], degree },
      error: 'spline requires at least two control points ([x, y], [x, y, z], or Geometry point2d) in authoring metres',
    }
  }
  const geometry: GeometrySpline = { kind: 'spline', points, degree }
  const fault = diagnoseGeometry(geometry)
  return fault ? { geometry, error: fault.message } : { geometry }
}

function asRings(value: unknown): GeometryPoint[][] | null | undefined {
  if (value === undefined) return undefined
  if (Array.isArray(value) && value.length === 0) return []
  const items = listItems(value)
  if (!items) return null
  const rings: GeometryPoint[][] = []
  for (const item of items) {
    const ring = asPoints(item)
    if (!ring) return null
    rings.push(ring)
  }
  return rings
}

export function buildPolygon(input: Record<string, unknown>): GeometryBuild {
  const points = asPoints(input.points)
  const holes = asRings(input.holes)
  if (input.holes !== undefined && holes === null) {
    return {
      geometry: { kind: 'polygon', points: points ?? [] },
      error: 'polygon holes must be rings of [x, y], [x, y, z], or Geometry point2d',
    }
  }
  const holeRings = holes ?? []
  if (!points || points.length < 3) {
    return {
      geometry: { kind: 'polygon', points: points ?? [], ...(holeRings.length > 0 ? { holes: holeRings } : {}) },
      error: 'polygon requires at least three points ([x, y], [x, y, z], or Geometry point2d) in authoring metres',
    }
  }
  const geometry: GeometryPolygon = {
    kind: 'polygon',
    points,
    ...(holeRings.length > 0 ? { holes: holeRings } : {}),
  }
  const fault = diagnoseGeometry(geometry)
  return fault ? { geometry, error: fault.message } : { geometry }
}

function asCurve(value: unknown): GeometryPolyline | GeometrySpline | null {
  if (!value || typeof value !== 'object') {
    const points = asPoints(value)
    return points && points.length >= 2 ? { kind: 'polyline', points } : null
  }
  const rec = value as { kind?: unknown; geometry?: unknown; points?: unknown; degree?: unknown }
  if (rec.geometry !== undefined && rec.kind === undefined) return asCurve(rec.geometry)
  if (rec.kind !== 'polyline' && rec.kind !== 'spline') return null
  const points = asPoints(rec.points)
  if (!points || points.length < 2) return null
  return rec.kind === 'spline'
    ? { kind: 'spline', points, degree: Number(rec.degree) || 3 }
    : { kind: 'polyline', points }
}

function asNodeIndex(value: unknown): number | null {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0) return null
  return n
}

function asNetworkEdge(value: unknown): GeometryNetworkEdge | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const rec = value as { from?: unknown; to?: unknown; curve?: unknown }
  const from = asNodeIndex(rec.from)
  const to = asNodeIndex(rec.to)
  if (from === null || to === null) return null
  if (rec.curve === undefined) return { from, to }
  const curve = asCurve(rec.curve)
  return curve ? { from, to, curve } : null
}

function xyDist(a: GeometryPoint, b: GeometryPoint): number {
  return Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!)
}

function curveMeetsNodes(
  curve: GeometryPolyline | GeometrySpline,
  from: GeometryPoint,
  to: GeometryPoint,
): boolean {
  const start = curve.points[0]
  const end = curve.points[curve.points.length - 1]
  if (!start || !end) return false
  const aligned = xyDist(start, from) <= ENDPOINT_M && xyDist(end, to) <= ENDPOINT_M
  const reversed = xyDist(start, to) <= ENDPOINT_M && xyDist(end, from) <= ENDPOINT_M
  return aligned || reversed
}

function emptyNetwork(
  nodes: readonly GeometryPoint[] = [],
  edges: readonly GeometryNetworkEdge[] = [],
): GeometryNetwork {
  return { kind: 'network', nodes, edges }
}

export function buildNetwork(input: Record<string, unknown>): GeometryBuild {
  const nodes = asPoints(input.nodes)
  if (!nodes || nodes.length === 0) {
    return {
      geometry: emptyNetwork(),
      error: 'network requires a nodes array of [x, y], [x, y, z], or Geometry point2d in authoring metres',
    }
  }
  const edgeItems = listItems(input.edges)
  if (!edgeItems || edgeItems.length === 0) {
    return {
      geometry: emptyNetwork(nodes),
      error: 'network requires a non-empty edges array of { from, to, curve? }',
    }
  }
  const edges: GeometryNetworkEdge[] = []
  for (const item of edgeItems) {
    const edge = asNetworkEdge(item)
    if (!edge) {
      return {
        geometry: emptyNetwork(nodes, edges),
        error: 'network edges must be { from, to, curve? }. from/to are node indices. A curve list is not a network.',
      }
    }
    edges.push(edge)
  }
  const geometry: GeometryNetwork = { kind: 'network', nodes, edges }
  const fault = diagnoseGeometry(geometry)
  return fault ? { geometry, error: fault.message } : { geometry }
}

export function buildPoint3d(input: Record<string, unknown>): GeometryBuild {
  const x = Number(input.x ?? 0)
  const y = Number(input.y ?? 0)
  const z = Number(input.z ?? 0)
  const geometry: GeometryPoint3d = { kind: 'point3d', x, y, z }
  if (![x, y, z].every(Number.isFinite)) {
    return { geometry: { kind: 'point3d', x: 0, y: 0, z: 0 }, error: 'point3d requires finite x, y, and z in authoring metres' }
  }
  return { geometry }
}

export function buildPolyline3d(input: Record<string, unknown>): GeometryBuild {
  const points = asPoints3d(input.points)
  if (!points || points.length < 2) {
    return {
      geometry: { kind: 'polyline3d', points: points ?? [] },
      error: 'polyline3d requires at least two points ([x, y, z] or Geometry point3d) in authoring metres',
    }
  }
  const geometry: GeometryPolyline3d = { kind: 'polyline3d', points }
  const fault = diagnoseGeometry(geometry)
  return fault ? { geometry, error: fault.message } : { geometry }
}

export function buildSpline3d(input: Record<string, unknown>): GeometryBuild {
  const points = asPoints3d(input.points)
  const degree = Number.isFinite(Number(input.degree)) ? Math.max(1, Math.floor(Number(input.degree))) : 3
  if (!points || points.length < 2) {
    return {
      geometry: { kind: 'spline3d', points: points ?? [], degree },
      error: 'spline3d requires at least two control points ([x, y, z] or Geometry point3d) in authoring metres',
    }
  }
  const geometry: GeometrySpline3d = { kind: 'spline3d', points, degree }
  const fault = diagnoseGeometry(geometry)
  return fault ? { geometry, error: fault.message } : { geometry }
}

function asRings3d(value: unknown): GeometryPoint[][] | null | undefined {
  if (value === undefined) return undefined
  if (Array.isArray(value) && value.length === 0) return []
  const items = listItems(value)
  if (!items) return null
  const rings: GeometryPoint[][] = []
  for (const item of items) {
    const ring = asPoints3d(item)
    if (!ring) return null
    rings.push(ring)
  }
  return rings
}

export function buildPolygon3d(input: Record<string, unknown>): GeometryBuild {
  const points = asPoints3d(input.points)
  const holes = asRings3d(input.holes)
  if (input.holes !== undefined && holes === null) {
    return {
      geometry: { kind: 'polygon3d', points: points ?? [] },
      error: 'polygon3d holes must be rings of [x, y, z] or Geometry point3d',
    }
  }
  const holeRings = holes ?? []
  if (!points || points.length < 3) {
    return {
      geometry: { kind: 'polygon3d', points: points ?? [], ...(holeRings.length > 0 ? { holes: holeRings } : {}) },
      error: 'polygon3d requires at least three points ([x, y, z] or Geometry point3d) in authoring metres',
    }
  }
  const geometry: GeometryPolygon3d = {
    kind: 'polygon3d',
    points,
    ...(holeRings.length > 0 ? { holes: holeRings } : {}),
  }
  const fault = diagnoseGeometry(geometry)
  return fault ? { geometry, error: fault.message } : { geometry }
}

function asCurve3d(value: unknown): GeometryPolyline3d | GeometrySpline3d | null {
  if (!value || typeof value !== 'object') {
    const points = asPoints3d(value)
    return points && points.length >= 2 ? { kind: 'polyline3d', points } : null
  }
  const rec = value as { kind?: unknown; geometry?: unknown; points?: unknown; degree?: unknown }
  if (rec.geometry !== undefined && rec.kind === undefined) return asCurve3d(rec.geometry)
  if (rec.kind !== 'polyline3d' && rec.kind !== 'spline3d') return null
  const points = asPoints3d(rec.points)
  if (!points || points.length < 2) return null
  return rec.kind === 'spline3d'
    ? { kind: 'spline3d', points, degree: Number(rec.degree) || 3 }
    : { kind: 'polyline3d', points }
}

function asNetwork3dEdge(value: unknown): GeometryNetwork3dEdge | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const rec = value as { from?: unknown; to?: unknown; curve?: unknown }
  const from = asNodeIndex(rec.from)
  const to = asNodeIndex(rec.to)
  if (from === null || to === null) return null
  if (rec.curve === undefined) return { from, to }
  const curve = asCurve3d(rec.curve)
  return curve ? { from, to, curve } : null
}

function xyzDist(a: GeometryPoint, b: GeometryPoint): number {
  return Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!, (b[2] ?? 0) - (a[2] ?? 0))
}

function curveMeetsNodes3d(
  curve: GeometryPolyline3d | GeometrySpline3d,
  from: GeometryPoint,
  to: GeometryPoint,
): boolean {
  const start = curve.points[0]
  const end = curve.points[curve.points.length - 1]
  if (!start || !end) return false
  const aligned = xyzDist(start, from) <= ENDPOINT_M && xyzDist(end, to) <= ENDPOINT_M
  const reversed = xyzDist(start, to) <= ENDPOINT_M && xyzDist(end, from) <= ENDPOINT_M
  return aligned || reversed
}

function emptyNetwork3d(
  nodes: readonly GeometryPoint[] = [],
  edges: readonly GeometryNetwork3dEdge[] = [],
): GeometryNetwork3d {
  return { kind: 'network3d', nodes, edges }
}

export function buildNetwork3d(input: Record<string, unknown>): GeometryBuild {
  const nodes = asPoints3d(input.nodes)
  if (!nodes || nodes.length === 0) {
    return {
      geometry: emptyNetwork3d(),
      error: 'network3d requires a nodes array of [x, y, z] or Geometry point3d in authoring metres',
    }
  }
  const edgeItems = listItems(input.edges)
  if (!edgeItems || edgeItems.length === 0) {
    return {
      geometry: emptyNetwork3d(nodes),
      error: 'network3d requires a non-empty edges array of { from, to, curve? }',
    }
  }
  const edges: GeometryNetwork3dEdge[] = []
  for (const item of edgeItems) {
    const edge = asNetwork3dEdge(item)
    if (!edge) {
      return {
        geometry: emptyNetwork3d(nodes, edges),
        error: 'network3d edges must be { from, to, curve? }. from/to are node indices. A curve list is not a network.',
      }
    }
    edges.push(edge)
  }
  const geometry: GeometryNetwork3d = { kind: 'network3d', nodes, edges }
  const fault = diagnoseGeometry(geometry)
  return fault ? { geometry, error: fault.message } : { geometry }
}

export function diagnoseGeometry(value: unknown): GeometryFault | null {
  if (!value || typeof value !== 'object') return null
  const rec = value as Geometry & {
    points?: GeometryPoint[]
    holes?: GeometryPoint[][]
    nodes?: GeometryPoint[]
    edges?: GeometryNetworkEdge[]
    width?: number
    height?: number
  }
  if (rec.kind === 'point2d') {
    const x = Number((rec as GeometryPoint2d).x)
    const y = Number((rec as GeometryPoint2d).y)
    if (![x, y].every(Number.isFinite)) {
      return { code: 'SCENE_GEOMETRY_DEGENERATE', message: 'point2d requires finite x and y in authoring metres.' }
    }
    return null
  }
  if (rec.kind === 'point3d') {
    const point = rec as GeometryPoint3d
    if (![Number(point.x), Number(point.y), Number(point.z)].every(Number.isFinite)) {
      return { code: 'SCENE_GEOMETRY_DEGENERATE', message: 'point3d requires finite x, y, and z in authoring metres.' }
    }
    return null
  }
  if (rec.kind === 'polyline') {
    const points = Array.isArray(rec.points) ? rec.points : []
    if (points.length < 2) {
      return { code: 'SCENE_GEOMETRY_DEGENERATE', message: 'polyline has fewer than two points.' }
    }
    if (lengthOf(points) < MIN_LEN) {
      return { code: 'SCENE_GEOMETRY_DEGENERATE', message: 'polyline has zero length in XY.' }
    }
    return null
  }
  if (rec.kind === 'spline') {
    const points = Array.isArray(rec.points) ? rec.points : []
    if (points.length < 2) {
      return { code: 'SCENE_GEOMETRY_DEGENERATE', message: 'spline has fewer than two control points.' }
    }
    if (lengthOf(points) < MIN_LEN) {
      return { code: 'SCENE_GEOMETRY_DEGENERATE', message: 'spline control polygon has zero length in XY.' }
    }
    return null
  }
  if (rec.kind === 'polygon') {
    const points = Array.isArray(rec.points) ? rec.points : []
    if (points.length < 3) {
      return { code: 'SCENE_GEOMETRY_DEGENERATE', message: 'polygon has fewer than three points.' }
    }
    if (ringSelfIntersects(points)) {
      return { code: 'SCENE_GEOMETRY_DEGENERATE', message: 'polygon rings cross themselves.' }
    }
    if (ringArea(points) < MIN_AREA) {
      return { code: 'SCENE_GEOMETRY_DEGENERATE', message: 'polygon has zero area.' }
    }
    const holes = Array.isArray(rec.holes) ? rec.holes : []
    for (const hole of holes) {
      if (!Array.isArray(hole) || hole.length < 3 || ringArea(hole) < MIN_AREA) {
        return { code: 'SCENE_GEOMETRY_DEGENERATE', message: 'polygon hole is degenerate.' }
      }
      if (ringSelfIntersects(hole)) {
        return { code: 'SCENE_GEOMETRY_DEGENERATE', message: 'polygon hole crosses itself.' }
      }
    }
    return null
  }
  if (rec.kind === 'network') {
    const nodes = Array.isArray(rec.nodes) ? rec.nodes : []
    const edges = Array.isArray(rec.edges) ? rec.edges : []
    if (nodes.length === 0) {
      return { code: 'SCENE_GEOMETRY_DEGENERATE', message: 'network has no nodes.' }
    }
    if (edges.length === 0) {
      return { code: 'SCENE_GEOMETRY_DEGENERATE', message: 'network has no edges.' }
    }
    for (let i = 0; i < nodes.length; i++) {
      if (!asPoint(nodes[i])) {
        return { code: 'SCENE_GEOMETRY_DEGENERATE', message: `network node ${i} is not an authoring-metre point.` }
      }
    }
    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i]
      if (!edge || typeof edge !== 'object') {
        return { code: 'SCENE_GEOMETRY_DEGENERATE', message: `network edge ${i} is not { from, to, curve? }.` }
      }
      const from = asNodeIndex(edge.from)
      const to = asNodeIndex(edge.to)
      if (from === null || to === null || from >= nodes.length || to >= nodes.length) {
        return { code: 'SCENE_GEOMETRY_DEGENERATE', message: `network edge ${i} has an out-of-range node index.` }
      }
      const a = nodes[from]!
      const b = nodes[to]!
      if (edge.curve) {
        const fault = diagnoseGeometry(edge.curve)
        if (fault) {
          return { code: 'SCENE_GEOMETRY_DEGENERATE', message: `network edge ${i}: ${fault.message}` }
        }
        if (!curveMeetsNodes(edge.curve, a, b)) {
          return {
            code: 'SCENE_GEOMETRY_DEGENERATE',
            message: `network edge ${i} curve endpoints must meet nodes[${from}] and nodes[${to}].`,
          }
        }
      } else if (from === to || lengthOf([a, b]) < MIN_LEN) {
        return { code: 'SCENE_GEOMETRY_DEGENERATE', message: `network edge ${i} has zero length in XY.` }
      }
    }
    return null
  }
  if (rec.kind === 'polyline3d') {
    const points = Array.isArray(rec.points) ? rec.points : []
    if (points.length < 2) {
      return { code: 'SCENE_GEOMETRY_DEGENERATE', message: 'polyline3d has fewer than two points.' }
    }
    if (lengthOf3d(points) < MIN_LEN) {
      return { code: 'SCENE_GEOMETRY_DEGENERATE', message: 'polyline3d has zero length.' }
    }
    return null
  }
  if (rec.kind === 'spline3d') {
    const points = Array.isArray(rec.points) ? rec.points : []
    if (points.length < 2) {
      return { code: 'SCENE_GEOMETRY_DEGENERATE', message: 'spline3d has fewer than two control points.' }
    }
    if (lengthOf3d(points) < MIN_LEN) {
      return { code: 'SCENE_GEOMETRY_DEGENERATE', message: 'spline3d control polygon has zero length.' }
    }
    return null
  }
  if (rec.kind === 'polygon3d') {
    const points = Array.isArray(rec.points) ? rec.points : []
    if (points.length < 3) {
      return { code: 'SCENE_GEOMETRY_DEGENERATE', message: 'polygon3d has fewer than three points.' }
    }
    if (ringSelfIntersects(points)) {
      return { code: 'SCENE_GEOMETRY_DEGENERATE', message: 'polygon3d rings cross themselves in XY.' }
    }
    if (ringArea(points) < MIN_AREA) {
      return { code: 'SCENE_GEOMETRY_DEGENERATE', message: 'polygon3d has zero area in XY.' }
    }
    const holes = Array.isArray(rec.holes) ? rec.holes : []
    for (const hole of holes) {
      if (!Array.isArray(hole) || hole.length < 3 || ringArea(hole) < MIN_AREA) {
        return { code: 'SCENE_GEOMETRY_DEGENERATE', message: 'polygon3d hole is degenerate.' }
      }
      if (ringSelfIntersects(hole)) {
        return { code: 'SCENE_GEOMETRY_DEGENERATE', message: 'polygon3d hole crosses itself in XY.' }
      }
    }
    return null
  }
  if (rec.kind === 'network3d') {
    const nodes = Array.isArray(rec.nodes) ? rec.nodes : []
    const edges = Array.isArray(rec.edges) ? rec.edges : []
    if (nodes.length === 0) {
      return { code: 'SCENE_GEOMETRY_DEGENERATE', message: 'network3d has no nodes.' }
    }
    if (edges.length === 0) {
      return { code: 'SCENE_GEOMETRY_DEGENERATE', message: 'network3d has no edges.' }
    }
    for (let i = 0; i < nodes.length; i++) {
      if (!asPoint3d(nodes[i])) {
        return { code: 'SCENE_GEOMETRY_DEGENERATE', message: `network3d node ${i} is not an authoring-metre [x, y, z].` }
      }
    }
    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i] as GeometryNetwork3dEdge | undefined
      if (!edge || typeof edge !== 'object') {
        return { code: 'SCENE_GEOMETRY_DEGENERATE', message: `network3d edge ${i} is not { from, to, curve? }.` }
      }
      const from = asNodeIndex(edge.from)
      const to = asNodeIndex(edge.to)
      if (from === null || to === null || from >= nodes.length || to >= nodes.length) {
        return { code: 'SCENE_GEOMETRY_DEGENERATE', message: `network3d edge ${i} has an out-of-range node index.` }
      }
      const a = nodes[from]!
      const b = nodes[to]!
      if (edge.curve) {
        const fault = diagnoseGeometry(edge.curve)
        if (fault) {
          return { code: 'SCENE_GEOMETRY_DEGENERATE', message: `network3d edge ${i}: ${fault.message}` }
        }
        if (!curveMeetsNodes3d(edge.curve, a, b)) {
          return {
            code: 'SCENE_GEOMETRY_DEGENERATE',
            message: `network3d edge ${i} curve endpoints must meet nodes[${from}] and nodes[${to}].`,
          }
        }
      } else if (from === to || lengthOf3d([a, b]) < MIN_LEN) {
        return { code: 'SCENE_GEOMETRY_DEGENERATE', message: `network3d edge ${i} has zero length.` }
      }
    }
    return null
  }
  if (rec.kind === 'plane') {
    const width = Number((rec as { width?: unknown }).width)
    const height = Number((rec as { height?: unknown }).height)
    if (!(width > 0) || !(height > 0)) {
      return { code: 'SCENE_GEOMETRY_DEGENERATE', message: 'plane width and height must be positive metres.' }
    }
  }
  return null
}

export function operatingKindOf(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const kind = (value as { kind?: unknown }).kind
  return typeof kind === 'string' && isOperatingGeometryKind(kind) ? kind : undefined
}
