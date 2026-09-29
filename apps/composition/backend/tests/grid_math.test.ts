import { describe, expect, it } from 'vitest'

import { FIRST_BATCH_OP_IDS } from '../src/scene-script/firstBatchBatteries.ts'
import { HOST_BINDING_ALIASES } from '../src/scene-script/adapter/writeLanes.ts'
import { SINO_SPATIAL_FUNCTIONS } from '../src/scene-script/contracts/agentContractCatalog.ts'
import { HOST_FUNCTION_NAMES, HOST_FUNCTION_OP_IDS } from '@forgeax/scene'

import { gridAdd } from '../../batteries/Grid/arith/grid_add/index.ts'
import { gridSub } from '../../batteries/Grid/arith/grid_sub/index.ts'
import { gridMul } from '../../batteries/Grid/arith/grid_mul/index.ts'
import { gridMin } from '../../batteries/Grid/arith/grid_min/index.ts'
import { gridMax } from '../../batteries/Grid/arith/grid_max/index.ts'
import { gridLerp } from '../../batteries/Grid/arith/grid_lerp/index.ts'
import { gridChoose } from '../../batteries/Grid/arith/grid_choose/index.ts'
import { gridMaskDiff } from '../../batteries/Grid/arith/grid_mask_diff/index.ts'
import { gridMaskUnion } from '../../batteries/Grid/arith/grid_mask_union/index.ts'
import { gridAbs } from '../../batteries/Grid/arith/grid_abs/index.ts'
import { gridNeg } from '../../batteries/Grid/arith/grid_neg/index.ts'
import { gridClamp } from '../../batteries/Grid/arith/grid_clamp/index.ts'
import { gridRemap } from '../../batteries/Grid/arith/grid_remap/index.ts'
import { gridSmoothstep } from '../../batteries/Grid/arith/grid_smoothstep/index.ts'
import { gridQuantize } from '../../batteries/Grid/arith/grid_quantize/index.ts'
import { gridBlur } from '../../batteries/Grid/filter/grid_blur/index.ts'
import { gridSharpen } from '../../batteries/Grid/filter/grid_sharpen/index.ts'
import { gridMedian } from '../../batteries/Grid/filter/grid_median/index.ts'
import { gridNeighborhoodMin } from '../../batteries/Grid/filter/grid_neighborhood_min/index.ts'
import { gridNeighborhoodMax } from '../../batteries/Grid/filter/grid_neighborhood_max/index.ts'
import { gridDilate } from '../../batteries/Grid/morph/grid_dilate/index.ts'
import { gridErodeMorph } from '../../batteries/Grid/morph/grid_erode_morph/index.ts'
import { gridOpen } from '../../batteries/Grid/morph/grid_open/index.ts'
import { gridClose } from '../../batteries/Grid/morph/grid_close/index.ts'
import { gridMajority } from '../../batteries/Grid/morph/grid_majority/index.ts'
import { gridOutline } from '../../batteries/Grid/morph/grid_outline/index.ts'
import { gridSlope } from '../../batteries/Grid/derive/grid_slope/index.ts'
import { gridAspect } from '../../batteries/Grid/derive/grid_aspect/index.ts'
import { gridCurvature } from '../../batteries/Grid/derive/grid_curvature/index.ts'
import { gridThreshold } from '../../batteries/Grid/derive/grid_threshold/index.ts'
import { gridRangeSelect } from '../../batteries/Grid/derive/grid_range_select/index.ts'
import { gridEdge } from '../../batteries/Grid/derive/grid_edge/index.ts'
import { gridBBox } from '../../batteries/Grid/derive/grid_bbox/index.ts'
import { gridComponents } from '../../batteries/Grid/partition/grid_components/index.ts'
import { gridZonalMean } from '../../batteries/Grid/zone/grid_zonal_mean/index.ts'
import { gridStats } from '../../batteries/Grid/global/grid_stats/index.ts'
import { gridDistance } from '../../batteries/Grid/global/grid_distance/index.ts'
import { gridResize } from '../../batteries/Grid/lattice/grid_resize/index.ts'

const MATH_FNS = [
  'gridAdd', 'gridSub', 'gridMul', 'gridMin', 'gridMax', 'gridLerp', 'gridChoose',
  'gridMaskDiff', 'gridMaskUnion', 'gridAbs', 'gridNeg', 'gridClamp', 'gridRemap',
  'gridSmoothstep', 'gridQuantize',
  'gridBlur', 'gridSharpen', 'gridMedian', 'gridNeighborhoodMin', 'gridNeighborhoodMax',
  'gridDilate', 'gridErodeMorph', 'gridOpen', 'gridClose', 'gridMajority', 'gridOutline',
  'gridSlope', 'gridAspect', 'gridCurvature', 'gridThreshold', 'gridRangeSelect', 'gridEdge', 'gridBBox',
  'gridComponents', 'gridZonalMean', 'gridStats', 'gridDistance', 'gridResize',
] as const

const A = [
  [0, 2],
  [4, 6],
]
const B = [
  [1, 1],
  [0, 2],
]

describe('Grid math families', () => {
  it('adds a scalar or a same-lattice Grid and errors on stretch', () => {
    expect(gridAdd({ a: A, b: 1 }).grid).toEqual([[1, 3], [5, 7]])
    expect(gridAdd({ a: A, value: 1 }).grid).toEqual([[1, 3], [5, 7]])
    expect(gridAdd({ a: A, b: B }).grid).toEqual([[1, 3], [4, 8]])
    expect(gridAdd({ a: A, b: [[1]] }).error).toBe('grids must share the same lattice')
    expect(gridAdd({ b: 1 }).error).toMatch(/requires/)
  })

  it('covers the rest of arith', () => {
    expect(gridSub({ a: A, b: 1 }).grid).toEqual([[-1, 1], [3, 5]])
    expect(gridMul({ a: [[1, 0], [1, 1]], b: [[1, 1], [0, 1]] }).grid).toEqual([[1, 0], [0, 1]])
    expect(gridMin({ a: A, b: 3 }).grid).toEqual([[0, 2], [3, 3]])
    expect(gridMax({ a: A, b: 3 }).grid).toEqual([[3, 3], [4, 6]])
    expect(gridLerp({ a: [[0, 0]], b: [[10, 10]], t: 0.25 }).grid).toEqual([[2.5, 2.5]])
    expect(gridLerp({ a: [[0, 0]], b: [[10, 10]], weight: [[0.25, 0.25]] }).grid).toEqual([[2.5, 2.5]])
    expect(gridChoose({ a: A, b: B, mask: [[0, 1], [1, 0]] }).grid).toEqual([[0, 1], [0, 6]])
    expect(gridMaskDiff({ a: [[1, 1], [0, 1]], b: [[0, 1], [0, 0]] }).grid).toEqual([[1, 0], [0, 1]])
    expect(gridMaskUnion({ a: [[1, 0], [0, 0]], b: [[0, 1], [0, 0]] }).grid).toEqual([[1, 1], [0, 0]])
    expect(gridAbs({ grid: [[-2, 3]] }).grid).toEqual([[2, 3]])
    expect(gridNeg({ grid: [[-2, 3]] }).grid).toEqual([[2, -3]])
    expect(gridClamp({ grid: [[-1, 0.4, 2]], min: 0, max: 1 }).grid).toEqual([[0, 0.4, 1]])
    expect(gridRemap({ grid: [[0, 1]], fromMin: 0, fromMax: 1, toMin: 10, toMax: 20 }).grid).toEqual([[10, 20]])
    expect(gridSmoothstep({ grid: [[0, 0.5, 1]], edge0: 0, edge1: 1 }).grid?.[0]?.[1]).toBeCloseTo(0.5)
    expect(gridQuantize({ grid: [[0.24, 0.76]], steps: 2 }).grid).toEqual([[0, 1]])
  })

  it('blends arith through an optional writeback mask', () => {
    expect(gridAdd({ a: [[0, 0]], b: 4, mask: [[0, 1]] }).grid).toEqual([[0, 4]])
  })

  it('filters in cell radius and keeps shape', () => {
    const spike = [
      [0, 0, 0],
      [0, 9, 0],
      [0, 0, 0],
    ]
    const blurred = gridBlur({ grid: spike, radius: 1, kind: 'box' }).grid
    expect(blurred?.[1]?.[1]).toBeLessThan(9)
    expect(blurred?.length).toBe(3)
    expect(gridSharpen({ grid: spike, radius: 1, amount: 1 }).grid?.[1]?.[1]).toBeGreaterThan(9)
    expect(gridMedian({ grid: spike, radius: 1 }).grid?.[1]?.[1]).toBe(0)
    expect(gridNeighborhoodMin({ grid: spike, radius: 1 }).grid?.[1]?.[1]).toBe(0)
    expect(gridNeighborhoodMax({ grid: spike, radius: 1 }).grid?.[1]?.[1]).toBe(9)
  })

  it('does morphological set ops without using the erodeGrid name', () => {
    const blob = [
      [0, 1, 0],
      [1, 1, 1],
      [0, 1, 0],
    ]
    expect(gridDilate({ grid: blob, radius: 1 }).grid?.[0]?.[0]).toBe(1)
    expect(gridErodeMorph({ grid: blob, radius: 1, connectivity: 4 }).grid?.[1]?.[1]).toBe(1)
    expect(gridErodeMorph({ grid: blob, radius: 1, connectivity: 4 }).grid?.[0]?.[1]).toBe(0)
    expect(gridOpen({ grid: blob, radius: 1 }).grid).toBeDefined()
    expect(gridClose({ grid: [[1, 0, 1]], radius: 1 }).grid?.[0]?.[1]).toBe(1)
    expect(gridMajority({ grid: blob, radius: 1 }).grid?.[1]?.[1]).toBe(1)
    const ring = gridOutline({ grid: blob, thickness: 1, connectivity: 4 }).grid
    expect(ring?.[1]?.[1]).toBe(0)
    expect(ring?.[0]?.[1]).toBeGreaterThan(0)
  })

  it('derives slope, masks, and a nonzero bbox', () => {
    const ramp = [
      [0, 1, 2],
      [0, 1, 2],
    ]
    expect(gridSlope({ grid: ramp }).grid?.[0]?.[1]).toBeGreaterThan(0)
    expect(gridAspect({ grid: ramp }).grid?.[0]?.[1]).toBeGreaterThanOrEqual(0)
    expect(gridCurvature({ grid: ramp }).grid).toBeDefined()
    expect(gridThreshold({ grid: ramp, value: 1 }).grid).toEqual([[0, 1, 1], [0, 1, 1]])
    expect(gridRangeSelect({ grid: ramp, min: 1, max: 1 }).grid).toEqual([[0, 1, 0], [0, 1, 0]])
    expect(gridEdge({ grid: ramp }).grid?.[0]?.[1]).toBeGreaterThan(0)
    expect(gridBBox({ grid: [[0, 0, 0], [0, 2, 0], [0, 0, 0]] })).toEqual({
      columns: 1, rows: 1, col: 1, row: 1,
    })
  })

  it('registers host names, first-batch ids, Sino, and writeback aliases', () => {
    for (const name of MATH_FNS) {
      expect(HOST_FUNCTION_NAMES).toContain(name)
      expect(SINO_SPATIAL_FUNCTIONS).toContain(name)
      expect(HOST_BINDING_ALIASES[name]).toBeTruthy()
    }
    expect(HOST_FUNCTION_OP_IDS.gridAdd).toBe('grid_add')
    expect(HOST_FUNCTION_OP_IDS.gridErodeMorph).toBe('grid_erode_morph')
    expect(FIRST_BATCH_OP_IDS).toEqual(expect.arrayContaining([
      'grid_add', 'grid_blur', 'grid_dilate', 'grid_threshold',
      'grid_components', 'grid_zonal_mean', 'grid_stats', 'grid_distance', 'grid_resize',
    ]))
  })

  it('reduces stats, resizes, walks distance, labels components, and fills zonal mean', () => {
    expect(gridStats({ grid: [[1, 3], [5, 7]] })).toEqual({
      min: 1, max: 7, mean: 4, sum: 16, count: 4, coverage: 1,
    })
    expect(gridStats({ grid: [[1, 3], [5, 7]], mask: [[0, 1], [1, 0]] })).toEqual({
      min: 3, max: 5, mean: 4, sum: 8, count: 2, coverage: 0.5,
    })
    expect(gridStats({ grid: [[1, 2]], mask: [[1]] }).error).toBe('grids must share the same lattice')

    expect(gridResize({ grid: [[0, 10]], columns: 4, rows: 1, mode: 'nearest' }).grid).toEqual([[0, 0, 10, 10]])
    const bilinear = gridResize({ grid: [[0, 10]], columns: 3, rows: 1, mode: 'bilinear' }).grid
    expect(bilinear?.[0]?.[0]).toBeCloseTo(0)
    expect(bilinear?.[0]?.[1]).toBeCloseTo(5)
    expect(bilinear?.[0]?.[2]).toBeCloseTo(10)

    const seeds = [
      [1, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]
    expect(gridDistance({ seeds, connectivity: 4 }).grid).toEqual([
      [0, 1, 2],
      [1, 2, 3],
      [2, 3, 4],
    ])
    const walls = [
      [1, 1, 1],
      [1, 0, 1],
      [1, 1, 1],
    ]
    const blocked = gridDistance({ seeds, mask: walls, connectivity: 4 }).grid
    expect(blocked?.[0]?.[0]).toBe(0)
    expect(blocked?.[1]?.[1]).toBe(1e9)
    expect(blocked?.[2]?.[2]).toBe(4)

    const blobs = [
      [1, 1, 0, 1],
      [0, 0, 0, 1],
    ]
    expect(gridComponents({ grid: blobs, connectivity: 4 }).grid).toEqual([
      [1, 1, 0, 2],
      [0, 0, 0, 2],
    ])
    const diag = [
      [1, 0],
      [0, 1],
    ]
    expect(gridComponents({ grid: diag, connectivity: 4 }).grid).toEqual([
      [1, 0],
      [0, 2],
    ])
    expect(gridComponents({ grid: diag, connectivity: 8 }).grid).toEqual([
      [1, 0],
      [0, 1],
    ])

    const values = [
      [2, 4, 9],
      [6, 8, 1],
    ]
    const zones = [
      [1, 1, 0],
      [1, 1, 0],
    ]
    expect(gridZonalMean({ grid: values, zones }).grid).toEqual([
      [5, 5, 9],
      [5, 5, 1],
    ])
    expect(gridZonalMean({ grid: values, zones: [[1]] }).error).toBe('grids must share the same lattice')
  })
})
