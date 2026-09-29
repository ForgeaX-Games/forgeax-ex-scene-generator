/** First-batch Generator helpers. Agent-facing types are Geometry / Grid / Heightfield / Scene. */

export type Point = readonly [number, number]

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

export function isPoint(value: unknown): value is Point {
  return Array.isArray(value)
    && value.length >= 2
    && typeof value[0] === 'number'
    && typeof value[1] === 'number'
    && Number.isFinite(value[0])
    && Number.isFinite(value[1])
}

export function isHeightField(value: unknown): value is HeightField {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Array.isArray((value as Partial<HeightField>).values)
}

export function asHeightField(
  source: HeightField | ReadonlyArray<readonly number[]>,
  cellSize = 1,
): HeightField | undefined {
  if (isHeightField(source)) {
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
  // Reached only when `isHeightField` said no AND it is not an array — i.e. a
  // non-object, or an object whose `values` is not an array. Both are unusable.
  // (This is a real runtime boundary: `geom.ts` re-exports us into the
  // `.generator.ts` subprocess sandbox, where inputs are not type-guaranteed.)
  return undefined
}
