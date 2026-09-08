/**
 * Serializable spatial protocol for project-local Generators and Scene Script.
 * Coordinates are metres. Control values stay in world/plane metres so changing
 * WorkGrid.cellSize cannot move authored Control points.
 */

export type SpatialRole = 'control' | 'derived'

export interface SpatialLineage {
  source: string
  via?: string[]
}

export interface Plane {
  origin: readonly [number, number, number]
  xAxis: readonly [number, number, number]
  yAxis: readonly [number, number, number]
  width: number
  height: number
  role?: SpatialRole
  lineage?: SpatialLineage
}

export interface WorkGrid {
  plane: Plane
  cellSize: number
  columns: number
  rows: number
  role?: SpatialRole
  lineage?: SpatialLineage
}

export interface Region {
  key: string
  kind: string
  polygon: ReadonlyArray<readonly [number, number]>
  attributes?: Readonly<Record<string, unknown>>
  role?: SpatialRole
  lineage?: SpatialLineage
}

export interface RegionSet {
  regions: readonly Region[]
  role?: SpatialRole
  lineage?: SpatialLineage
}

export interface RoadNode {
  key: string
  x: number
  y: number
  kind: 'hub' | 'intersection' | 'vertex'
  role?: SpatialRole
  lineage?: SpatialLineage
}

export interface RoadEdge {
  key: string
  from: string
  to: string
  kind: 'arterial' | 'local' | 'waterfront'
  width: number
  polyline: ReadonlyArray<readonly [number, number]>
  role?: SpatialRole
  lineage?: SpatialLineage
}

export interface RoadNetwork {
  nodes: readonly RoadNode[]
  edges: readonly RoadEdge[]
  role?: SpatialRole
  lineage?: SpatialLineage
}

export interface Parcel {
  key: string
  district: string
  polygon: ReadonlyArray<readonly [number, number]>
  frontageNormal: readonly [number, number]
  setback: number
  role?: SpatialRole
  lineage?: SpatialLineage
}

export interface ParcelSet {
  parcels: readonly Parcel[]
  role?: SpatialRole
  lineage?: SpatialLineage
}

export interface Placement {
  key: string
  prototypeKey: string
  /** Authoring metres (+Y). The renderer flips Y once; do not pre-negate. */
  x: number
  /** Authoring metres (+Y). The renderer flips Y once; do not pre-negate. */
  y: number
  rotation: number
  /** Height in metres on the same surface as the terrain mesh. */
  z?: number
  scale?: readonly [number, number, number]
  width?: number
  depth?: number
  height?: number
  source?: string
  role?: SpatialRole
  lineage?: SpatialLineage
}

export interface PlacementSet {
  placements: readonly Placement[]
  role?: SpatialRole
  lineage?: SpatialLineage
}

export interface Occupancy {
  key: string
  polygon: ReadonlyArray<readonly [number, number]>
  kind: string
}

export interface Clearance {
  kind: string
  radius: number
  against: readonly string[]
}

export interface Socket {
  key: string
  x: number
  y: number
  kind: string
}

export interface Anchor {
  key: string
  x: number
  y: number
  kind: string
  role?: SpatialRole
  lineage?: SpatialLineage
}

export function makePlane(width: number, height: number, origin: readonly [number, number, number] = [0, 0, 0]): Plane {
  return {
    origin,
    xAxis: [1, 0, 0],
    yAxis: [0, 1, 0],
    width,
    height,
    role: 'derived',
  }
}

export function makeWorkGrid(plane: Plane, cellSize: number): WorkGrid {
  return {
    plane,
    cellSize,
    columns: Math.max(1, Math.round(plane.width / cellSize)),
    rows: Math.max(1, Math.round(plane.height / cellSize)),
    role: 'derived',
    lineage: { source: 'workGrid', via: ['plane'] },
  }
}

export function planePointToWorld(plane: Plane, x: number, y: number): readonly [number, number, number] {
  return [
    plane.origin[0] + plane.xAxis[0] * x + plane.yAxis[0] * y,
    plane.origin[1] + plane.xAxis[1] * x + plane.yAxis[1] * y,
    plane.origin[2] + plane.xAxis[2] * x + plane.yAxis[2] * y,
  ]
}
