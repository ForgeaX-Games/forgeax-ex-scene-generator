/**
 * First-batch payload types Agent writes against.
 * Graph ports of the same name are Item projections of these values.
 *
 * Geometry is the only geometry payload. New shapes are a new `kind` on this
 * value, not a sibling top-level type (no Mesh / Voxel / Volume / Plane port).
 * Mesh vertices are authoring metres (x, y, z), the same +Y as basePlane.
 */

import type { SceneMesh } from './scene-tree.js'

export type Grid = readonly (readonly number[])[]

/** Literal spelling of a plan site (`[x, y]`). Same value as Geometry kind `point2d`. */
export type Point2d = readonly [number, number]

/** Literal spelling of a world site (`[x, y, z]`). Same value as Geometry kind `point3d`. */
export type Point3d = readonly [number, number, number]

/**
 * Known Geometry kinds.
 * Operating (select, then expand): point2d, plane, polyline, spline, polygon, network,
 * plus 3d counterparts point3d / polyline3d / spline3d / polygon3d / network3d.
 * Hangable scene content: mesh, voxel.
 * A road / building / tunnel is a .scene.ts that consumes these, not a new kind.
 */
export const OPERATING_GEOMETRY_KINDS = [
  'point2d',
  'plane',
  'polyline',
  'spline',
  'polygon',
  'network',
  'point3d',
  'polyline3d',
  'spline3d',
  'polygon3d',
  'network3d',
] as const
export const HANGABLE_GEOMETRY_KINDS = ['mesh', 'voxel'] as const
export const GEOMETRY_KINDS = [...OPERATING_GEOMETRY_KINDS, ...HANGABLE_GEOMETRY_KINDS] as const
export type OperatingGeometryKind = (typeof OPERATING_GEOMETRY_KINDS)[number]
export type HangableGeometryKind = (typeof HANGABLE_GEOMETRY_KINDS)[number]
export type GeometryKind = (typeof GEOMETRY_KINDS)[number]

/** Authoring metres. `[x, y]` or `[x, y, z]`. Same +Y as basePlane. */
export type GeometryPoint = readonly number[]

/** Plan-site Geometry. Identity is XY; z is not required. */
export interface GeometryPoint2d {
  readonly kind: 'point2d'
  readonly x: number
  readonly y: number
}

/** World-site Geometry. Identity is XYZ in authoring metres. Not hangable. */
export interface GeometryPoint3d {
  readonly kind: 'point3d'
  readonly x: number
  readonly y: number
  readonly z: number
}

export interface GeometryPlane {
  readonly kind: 'plane'
  readonly origin?: readonly number[]
  readonly width: number
  readonly height: number
}

export interface GeometryPolyline {
  readonly kind: 'polyline'
  readonly points: readonly GeometryPoint[]
}

export interface GeometrySpline {
  readonly kind: 'spline'
  readonly points: readonly GeometryPoint[]
  readonly degree: number
}

export interface GeometryPolygon {
  readonly kind: 'polygon'
  readonly points: readonly GeometryPoint[]
  readonly holes?: readonly (readonly GeometryPoint[])[]
}

/**
 * Graph in authoring metres. Nodes are points; edges are { from, to } indices.
 * Optional `curve` embeds a polyline or spline on that edge. No width, grade, or use.
 */
export interface GeometryNetworkEdge {
  readonly from: number
  readonly to: number
  readonly curve?: GeometryPolyline | GeometrySpline
}

export interface GeometryNetwork {
  readonly kind: 'network'
  readonly nodes: readonly GeometryPoint[]
  readonly edges: readonly GeometryNetworkEdge[]
}

export interface GeometryPolyline3d {
  readonly kind: 'polyline3d'
  readonly points: readonly GeometryPoint[]
}

export interface GeometrySpline3d {
  readonly kind: 'spline3d'
  readonly points: readonly GeometryPoint[]
  readonly degree: number
}

export interface GeometryPolygon3d {
  readonly kind: 'polygon3d'
  readonly points: readonly GeometryPoint[]
  readonly holes?: readonly (readonly GeometryPoint[])[]
}

export interface GeometryNetwork3dEdge {
  readonly from: number
  readonly to: number
  readonly curve?: GeometryPolyline3d | GeometrySpline3d
}

export interface GeometryNetwork3d {
  readonly kind: 'network3d'
  readonly nodes: readonly GeometryPoint[]
  readonly edges: readonly GeometryNetwork3dEdge[]
}

/** One payload source. Top-level buffers are the normal TS authoring form. */
export type GeometryMesh = { readonly kind: 'mesh'; readonly origin?: readonly number[]; readonly width?: number; readonly height?: number } & (
  | (SceneMesh & { readonly mesh?: never })
  | { readonly mesh: SceneMesh; readonly positions?: never; readonly indices?: never; readonly uvs?: never; readonly colors?: never }
)

export interface GeometryVoxel {
  readonly kind: 'voxel'
  readonly volume?: unknown
  readonly cells?: readonly unknown[]
}

/** Discriminated by `kind`. New supported shapes add a discriminated branch here. */
export type Geometry =
  | GeometryPoint2d
  | GeometryPoint3d
  | GeometryPlane
  | GeometryPolyline
  | GeometrySpline
  | GeometryPolygon
  | GeometryNetwork
  | GeometryPolyline3d
  | GeometrySpline3d
  | GeometryPolygon3d
  | GeometryNetwork3d
  | GeometryMesh
  | GeometryVoxel

export function isOperatingGeometryKind(kind: string): kind is OperatingGeometryKind {
  return (OPERATING_GEOMETRY_KINDS as readonly string[]).includes(kind)
}

export function isHangableGeometryKind(kind: string): kind is HangableGeometryKind {
  return (HANGABLE_GEOMETRY_KINDS as readonly string[]).includes(kind)
}

/** World-bound packet: region + lattice + height + mask + named attribute Grids. */
export interface Heightfield {
  readonly type: 'heightfield'
  readonly geometry: GeometryPlane
  readonly columns: number
  readonly rows: number
  readonly height: Grid
  readonly mask: Grid
  readonly attributes: Readonly<Record<string, Grid>>
}

export function isGeometry(value: unknown): value is Geometry {
  return Boolean(value && typeof value === 'object' && typeof (value as { kind?: unknown }).kind === 'string')
}

export function geometryKind(value: unknown): string | undefined {
  if (!isGeometry(value)) return undefined
  return value.kind
}

export function isGrid(value: unknown): value is Grid {
  return Array.isArray(value) && (value.length === 0 || Array.isArray(value[0]))
}

export function isHeightfield(value: unknown): value is Heightfield {
  if (!value || typeof value !== 'object') return false
  const rec = value as { type?: unknown; height?: unknown }
  return rec.type === 'heightfield' && Array.isArray(rec.height)
}
