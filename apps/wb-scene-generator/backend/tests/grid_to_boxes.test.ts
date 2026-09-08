import { describe, expect, it } from 'vitest'
import { hillContourGenerate } from '../../batteries/components/elements/hill_contour_generate/index.ts'
import { sampleHeight } from '../../batteries/scene/bridge/sample_height/index.ts'
import { gridToBoxes } from '../../batteries/scene/bridge/grid_to_boxes/index.ts'
import { buildBoxesMesh } from '../../vendor/shared/types/scene/boxes.ts'

function filled(n = 16): number[][] {
  return Array.from({ length: n }, () => Array.from({ length: n }, () => 1))
}

describe('sample_height + grid_to_boxes', () => {
  it('builds white boxes whose height only comes from buildingHeight', () => {
    const mesh = buildBoxesMesh([[2, 2], [6, 3]], { heights: [1, 2], buildingHeight: 4, footprint: 2 })
    expect(mesh).not.toBeNull()
    expect(mesh!.role).toBe('houses')
    expect(mesh!.color).toEqual([0.96, 0.96, 0.94])
    expect(mesh!.indices.length / 36).toBe(2)
    const zs = []
    for (let i = 2; i < mesh!.positions.length; i += 3) zs.push(mesh!.positions[i]!)
    expect(Math.min(...zs)).toBe(1)
    expect(Math.max(...zs)).toBe(6)
  })

  it('sits boxes on a hillside so raising buildingHeight does not bury them', () => {
    const ground = filled(16)
    const hill = hillContourGenerate({ inputGrid: ground, contourLevels: 4, seed: 1, hillCount: 1, peakPosition: 5 })
    const points = [[4, 8], [10, 7], [12, 10], [6, 12]]
    const sampled = sampleHeight({ grid: hill.outputGrid, points })
    expect(sampled.error).toBeUndefined()
    expect(sampled.count).toBe(4)
    expect(sampled.heights.every((z) => Number.isFinite(z) && z >= 0)).toBe(true)

    const short = gridToBoxes({ points, z: sampled.heights, buildingHeight: 2, footprint: 2 })
    const tall = gridToBoxes({ points, z: sampled.heights, buildingHeight: 5, footprint: 2 })
    expect(short.error).toBeUndefined()
    expect(tall.error).toBeUndefined()
    expect(short.boxCount).toBe(4)
    expect(tall.boxCount).toBe(4)
    expect(short.mesh?.role).toBe('houses')

    const shortZ: number[] = []
    const tallZ: number[] = []
    for (let i = 2; i < short.mesh!.positions.length; i += 3) shortZ.push(short.mesh!.positions[i]!)
    for (let i = 2; i < tall.mesh!.positions.length; i += 3) tallZ.push(tall.mesh!.positions[i]!)
    expect(Math.min(...shortZ)).toBe(Math.min(...tallZ))
    expect(Math.max(...tallZ) - Math.min(...tallZ)).toBeGreaterThan(Math.max(...shortZ) - Math.min(...shortZ))
  })
})
