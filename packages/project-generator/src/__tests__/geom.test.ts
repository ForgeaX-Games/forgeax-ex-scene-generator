import { describe, expect, it } from 'vitest'

import { createRng, dist, hashSeed, resamplePolyline, sampleHeight } from '../geom.js'
import type { Mesh, PlacementSet, WorkGrid } from '../sdk.js'

describe('Generator geom', () => {
  it('hashes seeds and draws a stable rng stream', () => {
    expect(hashSeed(1, 2)).toBe(hashSeed(1, 2))
    expect(hashSeed(1, 2)).not.toBe(hashSeed(1, 3))
    const a = createRng(7)
    const b = createRng(7)
    expect(a()).toBe(b())
    expect(a()).toBe(b())
  })

  it('resamples a polyline and samples height in metres', () => {
    expect(dist([0, 0], [3, 4])).toBe(5)
    expect(resamplePolyline([[0, 0], [10, 0]], 5).slice(0, 3)).toEqual([[0, 0], [5, 0], [10, 0]])
    expect(sampleHeight([[0, 10], [0, 10]], [1, 0], 2)).toBe(5)
    expect(sampleHeight({ values: [[4]], cellSize: 8, origin: [0, 0] }, [3, 3])).toBe(4)
  })

  it('publishes structural Mesh and spatial port payload types', () => {
    const mesh = {
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      indices: [0, 1, 2],
    } satisfies Mesh
    const grid = {
      origin: [0, 0],
      cellSize: 8,
      columns: 1,
      rows: 1,
    } satisfies WorkGrid
    const placements = { placements: [{ position: [0, 0] }] } satisfies PlacementSet
    expect(mesh.indices).toHaveLength(3)
    expect(grid.cellSize).toBe(8)
    expect(placements.placements).toHaveLength(1)
  })
})
