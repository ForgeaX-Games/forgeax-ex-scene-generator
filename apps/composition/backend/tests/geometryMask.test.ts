import { describe, expect, it } from 'vitest'

import { geometryMask } from '../../batteries/Modeling/geometry2d/geometry_mask/index.js'
import { basePlane } from '../../batteries/Modeling/geometry2d/base_plane/index.js'
import { network2d } from '../../batteries/Modeling/geometry2d/network2d/index.js'
import { polygon2d } from '../../batteries/Modeling/geometry2d/polygon2d/index.js'
import { polyline2d } from '../../batteries/Modeling/geometry2d/polyline2d/index.js'
import { spline2d } from '../../batteries/Modeling/geometry2d/spline2d/index.js'
import { gridMul } from '../../batteries/Grid/arith/grid_mul/index.js'
import { gridRangeSelect } from '../../batteries/Grid/derive/grid_range_select/index.js'
import { gridSlope } from '../../batteries/Grid/derive/grid_slope/index.js'
import { valueNoise } from '../../batteries/Grid/noise/value_noise/index.js'
import { buildGeometryMask } from '../../vendor/shared/types/scene/geometryMask.js'

function plane(origin: [number, number], width: number, height: number) {
  return basePlane({ origin, width, height }).geometry
}

function cell(grid: number[][], col: number, row: number): number {
  return grid[row]![col]!
}

function sum(grid: number[][]): number {
  return grid.flat().reduce((acc, value) => acc + value, 0)
}

describe('geometryMask', () => {
  it('fills a polygon including a hole', () => {
    const out = geometryMask({
      plane: plane([0, 0], 10, 10),
      geometry: polygon2d({
        points: [[1, 1], [9, 1], [9, 9], [1, 9]],
        holes: [[[4, 4], [6, 4], [6, 6], [4, 6]]],
      }).geometry,
      columns: 10,
      rows: 10,
    })
    expect(out.error).toBeUndefined()
    expect(out.grid).toHaveLength(10)
    expect(out.grid[0]).toHaveLength(10)
    expect(cell(out.grid as number[][], 5, 2)).toBe(1)
    expect(cell(out.grid as number[][], 5, 5)).toBe(0)
    expect(cell(out.grid as number[][], 0, 0)).toBe(0)
  })

  it('burns a width-0 polyline through the cells it crosses', () => {
    const out = geometryMask({
      plane: plane([0, 0], 10, 10),
      geometry: polyline2d({ points: [[0, 5], [10, 5]] }).geometry,
      columns: 10,
      rows: 10,
      width: 0,
    })
    expect(out.error).toBeUndefined()
    const grid = out.grid as number[][]
    expect(grid.some((row) => row.some((value) => value === 1))).toBe(true)
    expect(cell(grid, 5, 0)).toBe(0)
    expect(grid[5]!.some((value) => value === 1) || grid[4]!.some((value) => value === 1)).toBe(true)
  })

  it('samples a spline corridor through the control points', () => {
    const out = geometryMask({
      plane: plane([0, 0], 10, 10),
      geometry: spline2d({ points: [[0, 0], [5, 8], [10, 0]], degree: 3 }).geometry,
      columns: 20,
      rows: 20,
      width: 1,
    })
    expect(out.error).toBeUndefined()
    const grid = out.grid as number[][]
    expect(sum(grid)).toBeGreaterThan(0)
    expect(cell(grid, 10, 16)).toBeGreaterThan(0)
  })

  it('unions network edge corridors', () => {
    const out = geometryMask({
      plane: plane([0, 0], 10, 10),
      geometry: network2d({
        nodes: [[1, 1], [9, 1], [9, 9]],
        edges: [{ from: 0, to: 1 }, { from: 1, to: 2 }],
      }).geometry,
      columns: 10,
      rows: 10,
      width: 2,
    })
    expect(out.error).toBeUndefined()
    const grid = out.grid as number[][]
    expect(cell(grid, 5, 1)).toBe(1)
    expect(cell(grid, 8, 5)).toBe(1)
    expect(cell(grid, 2, 7)).toBe(0)
  })

  it('burns a point2d as a disk', () => {
    const out = geometryMask({
      plane: plane([0, 0], 10, 10),
      geometry: { kind: 'point2d', x: 5, y: 5 },
      columns: 10,
      rows: 10,
      width: 4,
    })
    expect(out.error).toBeUndefined()
    const grid = out.grid as number[][]
    expect(cell(grid, 5, 5)).toBe(1)
    expect(cell(grid, 5, 6)).toBe(1)
    expect(cell(grid, 0, 0)).toBe(0)
  })

  it('feathers falloff outside the hard region', () => {
    const out = geometryMask({
      plane: plane([0, 0], 10, 10),
      geometry: { kind: 'point2d', x: 5, y: 5 },
      columns: 10,
      rows: 10,
      width: 0,
      feather: 3,
    })
    expect(out.error).toBeUndefined()
    const grid = out.grid as number[][]
    expect(cell(grid, 5, 5)).toBe(1)
    expect(cell(grid, 5, 7)).toBeGreaterThan(0)
    expect(cell(grid, 5, 7)).toBeLessThan(1)
    expect(cell(grid, 0, 0)).toBe(0)
  })

  it('rejects mesh and voxel with { error }', () => {
    const mesh = geometryMask({
      plane: plane([0, 0], 10, 10),
      geometry: { kind: 'mesh', positions: [], indices: [] },
      columns: 4,
      rows: 4,
    })
    expect(mesh.error).toMatch(/operating Geometry/)
    expect(sum(mesh.grid as number[][])).toBe(0)

    const voxel = geometryMask({
      plane: plane([0, 0], 10, 10),
      geometry: { kind: 'voxel', cells: [] },
      columns: 4,
      rows: 4,
    })
    expect(voxel.error).toMatch(/operating Geometry/)
  })

  it('emits zeros and SCENE_GEOMETRY_DEGENERATE for a collapsed polyline', () => {
    const out = geometryMask({
      plane: plane([0, 0], 10, 10),
      geometry: { kind: 'polyline', points: [[3, 3]] },
      columns: 8,
      rows: 8,
    })
    expect(out.error).toBeUndefined()
    expect(sum(out.grid as number[][])).toBe(0)
    expect(out._warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCENE_GEOMETRY_DEGENERATE' }),
    ]))
  })

  it('warns SCENE_GRID_STRETCH on an anisotropic lattice without stretching geometry', () => {
    const out = geometryMask({
      plane: plane([0, 0], 12, 4),
      geometry: polygon2d({ points: [[1, 1], [3, 1], [3, 3], [1, 3]] }).geometry,
      columns: 6,
      rows: 6,
    })
    expect(out.error).toBeUndefined()
    expect(out._warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCENE_GRID_STRETCH' }),
    ]))
  })

  it('ignores width when filling a polygon', () => {
    const tight = geometryMask({
      plane: plane([0, 0], 10, 10),
      geometry: polygon2d({ points: [[3, 3], [7, 3], [7, 7], [3, 7]] }).geometry,
      columns: 10,
      rows: 10,
      width: 0,
    })
    const wide = geometryMask({
      plane: plane([0, 0], 10, 10),
      geometry: polygon2d({ points: [[3, 3], [7, 3], [7, 7], [3, 7]] }).geometry,
      columns: 10,
      rows: 10,
      width: 8,
    })
    expect(tight.grid).toEqual(wide.grid)
  })

  it('intersects a plane geometry with the lattice frame', () => {
    const out = geometryMask({
      plane: plane([0, 0], 10, 10),
      geometry: plane([2, 2], 4, 4),
      columns: 10,
      rows: 10,
    })
    expect(out.error).toBeUndefined()
    const grid = out.grid as number[][]
    expect(cell(grid, 3, 3)).toBe(1)
    expect(cell(grid, 8, 8)).toBe(0)
  })

  it('does not eat or return a Heightfield packet', () => {
    const built = buildGeometryMask({
      plane: plane([0, 0], 10, 10),
      geometry: { kind: 'point2d', x: 1, y: 1 },
      columns: 4,
      rows: 4,
    })
    expect(built).not.toHaveProperty('heightfield')
    expect(Array.isArray(built.grid)).toBe(true)
  })

  it('can gridMul a lot mask with a slope mask on the same lattice', () => {
    const columns = 16
    const rows = 12
    const world = plane([0, 0], 80, 60)
    const lot = polygon2d({
      points: [[28, 22], [52, 22], [52, 38], [28, 38]],
    }).geometry
    const lotMask = geometryMask({
      plane: world,
      geometry: lot,
      columns,
      rows,
      feather: 4,
    })
    const hills = valueNoise({ columns, rows, seed: 3, frequency: 0.08 }).grid as number[][]
    const slope = gridSlope({ grid: hills }).grid as number[][]
    const slopeMask = gridRangeSelect({ grid: slope, min: 0, max: 1 }).grid as number[][]
    const combined = gridMul({ a: lotMask.grid, b: slopeMask })
    expect(lotMask.error).toBeUndefined()
    expect(combined.error).toBeUndefined()
    expect(combined.grid).toHaveLength(rows)
    expect(combined.grid![0]).toHaveLength(columns)
    expect(sum(lotMask.grid as number[][])).toBeGreaterThan(0)
    expect(sum(combined.grid as number[][])).toBeGreaterThan(0)
    expect(sum(combined.grid as number[][])).toBeLessThanOrEqual(sum(lotMask.grid as number[][]))
  })
})
