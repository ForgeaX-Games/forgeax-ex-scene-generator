/** Structural spatial payloads for Generator ports. Values stay JSON-serializable. */

export type Point = readonly [number, number]

export interface Plane {
  origin: Point
  size: Point
}

export interface WorkGrid {
  origin: Point
  cellSize: number
  columns: number
  rows: number
  /** Metres when present. Framing-only grids omit values. */
  values?: ReadonlyArray<readonly number[]>
}

export interface HeightField {
  values: ReadonlyArray<readonly number[]>
  cellSize: number
  origin?: Point
}

/** JSON-serializable triangle mesh accepted by Scene Script Mesh ports. */
export interface Mesh {
  positions: ReadonlyArray<number>
  indices: ReadonlyArray<number>
  normals?: ReadonlyArray<number>
  uvs?: ReadonlyArray<number>
  colors?: ReadonlyArray<number>
}

export interface Region {
  id: string
  polygon: Point[]
  kind?: string
}

export interface RegionSet {
  regions: Region[]
}

export interface RoadSegment {
  id: string
  points: Point[]
  kind?: string
}

export interface RoadNetwork {
  segments: RoadSegment[]
}

export interface Parcel {
  id: string
  polygon: Point[]
  kind?: string
}

export interface ParcelSet {
  parcels: Parcel[]
}

export interface Placement {
  position: Point
  yaw?: number
  kind?: string
  prototype?: string
}

export interface PlacementSet {
  placements: Placement[]
}

export function isPoint(value: unknown): value is Point {
  return Array.isArray(value)
    && value.length >= 2
    && typeof value[0] === 'number'
    && typeof value[1] === 'number'
    && Number.isFinite(value[0])
    && Number.isFinite(value[1])
}

function isGridLike(value: unknown): value is HeightField | WorkGrid {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Array.isArray((value as HeightField).values))
}

export function asHeightField(
  source: HeightField | WorkGrid | ReadonlyArray<readonly number[]>,
  cellSize = 1,
): HeightField | undefined {
  if (isGridLike(source)) {
    const values = source.values
    if (!values) return undefined
    const origin = isPoint(source.origin) ? source.origin : [0, 0] as const
    const size = typeof source.cellSize === 'number' && Number.isFinite(source.cellSize) && source.cellSize > 0
      ? source.cellSize
      : cellSize
    return { values, cellSize: size, origin }
  }
  if (Array.isArray(source)) {
    return { values: source, cellSize, origin: [0, 0] }
  }
  return undefined
}
