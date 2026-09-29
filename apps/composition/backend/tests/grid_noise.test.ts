import { describe, expect, it } from 'vitest'

import { HOST_FUNCTION_NAMES, HOST_FUNCTION_OP_IDS } from '@forgeax/scene'

import { FIRST_BATCH_OP_IDS } from '../src/scene-script/firstBatchBatteries.ts'
import { HOST_BINDING_ALIASES } from '../src/scene-script/adapter/writeLanes.ts'
import { SINO_SPATIAL_FUNCTIONS } from '../src/scene-script/contracts/agentContractCatalog.ts'
import { cellularNoise } from '../../batteries/Grid/noise/cellular_noise/index.ts'
import { hashNoise } from '../../batteries/Grid/noise/hash_noise/index.ts'
import { openSimplex2Noise } from '../../batteries/Grid/noise/opensimplex2_noise/index.ts'
import { perlinNoise } from '../../batteries/Grid/noise/perlin_noise/index.ts'
import { valueNoise } from '../../batteries/Grid/noise/value_noise/index.ts'

const NOISE_FNS = [
  'hashNoise',
  'valueNoise',
  'valueCubicNoise',
  'perlinNoise',
  'openSimplex2Noise',
  'openSimplex2sNoise',
  'cellularNoise',
] as const

function shapeOf(grid: number[][]): [number, number] {
  return [grid.length, grid[0]?.length ?? 0]
}

describe('Grid/noise', () => {
  it('emits columns×rows and is deterministic', () => {
    const a = perlinNoise({ columns: 8, rows: 5, seed: 11, frequency: 0.2 })
    const b = perlinNoise({ columns: 8, rows: 5, seed: 11, frequency: 0.2 })
    expect(shapeOf(a.grid)).toEqual([5, 8])
    expect(a.grid).toEqual(b.grid)
    expect(perlinNoise({ columns: 8, rows: 5, seed: 12, frequency: 0.2 }).grid).not.toEqual(a.grid)
  })

  it('hash ≠ perlin for the same seed and size', () => {
    const hash = hashNoise({ columns: 6, rows: 4, seed: 9, scale: 1 }).grid
    const perlin = perlinNoise({ columns: 6, rows: 4, seed: 9, frequency: 0.2 }).grid
    expect(shapeOf(hash)).toEqual([4, 6])
    expect(hash).not.toEqual(perlin)
  })

  it('treats seed <= 0 as 1337', () => {
    const fallback = perlinNoise({ columns: 4, rows: 4, seed: 0 }).grid
    expect(perlinNoise({ columns: 4, rows: 4, seed: -3 }).grid).toEqual(fallback)
    expect(perlinNoise({ columns: 4, rows: 4, seed: 1337 }).grid).toEqual(fallback)
  })

  it('ignores mask on the sampler', () => {
    const open = perlinNoise({ columns: 5, rows: 5, seed: 3, frequency: 0.15 }).grid
    const masked = perlinNoise({
      columns: 5,
      rows: 5,
      seed: 3,
      frequency: 0.15,
      mask: [[0, 0, 0, 0, 0], [0, 1, 1, 1, 0], [0, 1, 1, 1, 0], [0, 1, 1, 1, 0], [0, 0, 0, 0, 0]],
    }).grid
    expect(masked).toEqual(open)
    expect(hashNoise({ columns: 4, rows: 3, seed: 2, scale: 1, mask: [[1]] }).grid).toEqual(
      hashNoise({ columns: 4, rows: 3, seed: 2, scale: 1 }).grid,
    )
  })

  it('cellular options change the field', () => {
    const base = cellularNoise({ columns: 8, rows: 8, seed: 4, frequency: 0.2 }).grid
    const manhattan = cellularNoise({
      columns: 8,
      rows: 8,
      seed: 4,
      frequency: 0.2,
      distanceFunction: 'manhattan',
    }).grid
    const cells = cellularNoise({
      columns: 8,
      rows: 8,
      seed: 4,
      frequency: 0.2,
      returnType: 'cellValue',
    }).grid
    expect(manhattan).not.toEqual(base)
    expect(cells).not.toEqual(base)
    expect(cellularNoise({ columns: 8, rows: 8, seed: 4, frequency: 0.2, distanceFunction: 'EuclideanSq' }).grid).toEqual(base)
  })

  it('value and simplex stay on the same lattice contract', () => {
    expect(shapeOf(valueNoise({ columns: 7, rows: 3, seed: 1 }).grid)).toEqual([3, 7])
    expect(shapeOf(openSimplex2Noise({ columns: 7, rows: 3, seed: 1 }).grid)).toEqual([3, 7])
  })

  it('registers host names, first-batch ids, Sino, and writeback aliases', () => {
    for (const name of NOISE_FNS) {
      expect(HOST_FUNCTION_NAMES).toContain(name)
      expect(SINO_SPATIAL_FUNCTIONS).toContain(name)
      expect(HOST_BINDING_ALIASES[name]).toBeTruthy()
    }
    expect(HOST_FUNCTION_OP_IDS.perlinNoise).toBe('perlin_noise')
    expect(HOST_FUNCTION_OP_IDS.hashNoise).toBe('hash_noise')
    expect(HOST_FUNCTION_OP_IDS.cellularNoise).toBe('cellular_noise')
    expect(FIRST_BATCH_OP_IDS).toEqual(expect.arrayContaining([
      'hash_noise',
      'value_noise',
      'value_cubic_noise',
      'perlin_noise',
      'opensimplex2_noise',
      'opensimplex2s_noise',
      'cellular_noise',
    ]))
    expect(HOST_BINDING_ALIASES.perlinNoise).toBe('perlin')
    expect(HOST_BINDING_ALIASES.hashNoise).toBe('hash')
  })
})
