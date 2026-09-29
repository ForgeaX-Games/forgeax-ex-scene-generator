import { describe, it, expect } from 'vitest'
import { resolveSelectionCandidates } from '../RenderCanvas'
import { stepSelectCycle, type SelectCycleState } from '../../framework/selectionCycle'
import { mergeRenderableVoxelLayerKeys, orderBakedKeysForRender } from '../../framework/layerKeys'
import type { CellQuerySources } from '../../framework/cellAttribution'
import type { BillboardVoxelHit } from '../../framework/geometry/topBillboard'
import type { RendererVoxelLayer, Point3D } from '../../types'

function layer(key: string, cells: Point3D[], visible = true): RendererVoxelLayer {
  const isBaked = key.startsWith('baked:')
  const nodePath = isBaked ? key.slice('baked:'.length) : key.split(':')[1] ?? '/'
  return { key, nodeId: isBaked ? '__baked__' : key.split(':')[0], nodePath, nodeName: nodePath, value: 1, cells, visible, updatedAt: 0, assetName: '' }
}

function sources(output: RendererVoxelLayer[], baked: RendererVoxelLayer[]): CellQuerySources {
  const layers = Object.fromEntries(output.map((l) => [l.key, l]))
  const bakedLayers = Object.fromEntries(baked.map((l) => [l.key, l]))
  return { layers, bakedLayers, orderedKeys: mergeRenderableVoxelLayerKeys(Object.keys(layers), orderBakedKeysForRender(Object.keys(bakedLayers))) }
}

const hit = (x: number, y: number, z: number): BillboardVoxelHit => ({ voxel: { x, y, z }, face: 'top' })

describe('resolveSelectionCandidates (clicked stack → ordered distinct layers)', () => {
  it('attributes each stack voxel to its top-most layer and dedups, top→bottom', () => {
    // Stack top→bottom: an upper baked voxel, then a lower output-floor voxel.
    const baked = layer('baked:/Edit', [{ x: 0, y: 0, z: 1 }])
    const floor = layer('n1:/Floor', [{ x: 0, y: 1, z: 0 }])
    const src = sources([floor], [baked])
    const stack: BillboardVoxelHit[] = [hit(0, 0, 1), hit(0, 1, 0)]
    const candidates = resolveSelectionCandidates(stack, src)
    expect(candidates.map((c) => c.layerKey)).toEqual(['baked:/Edit', 'n1:/Floor'])
    expect(candidates[0].voxels).toEqual([{ x: 0, y: 0, z: 1 }])
    expect(candidates[1].voxels).toEqual([{ x: 0, y: 1, z: 0 }])
  })

  it('merges multiple clicked voxels owned by the same layer', () => {
    const floor = layer('n1:/Floor', [{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }])
    const src = sources([floor], [])
    const candidates = resolveSelectionCandidates([hit(0, 0, 0), hit(0, 1, 0)], src)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].layerKey).toBe('n1:/Floor')
    expect(candidates[0].voxels).toHaveLength(2)
  })

  it('drops stack voxels that no visible layer draws on', () => {
    const floor = layer('n1:/Floor', [{ x: 0, y: 0, z: 0 }])
    const src = sources([floor], [])
    const candidates = resolveSelectionCandidates([hit(0, 0, 0), hit(5, 5, 5)], src)
    expect(candidates.map((c) => c.layerKey)).toEqual(['n1:/Floor'])
  })
})

describe('stepSelectCycle (first click top-most, repeat cycles deeper)', () => {
  it('first click on a new cell selects the top-most candidate (index 0)', () => {
    const step = stepSelectCycle({ cell: null, index: 0 }, '2,3', 3)
    expect(step.index).toBe(0)
    expect(step.next).toEqual({ cell: '2,3', index: 0 })
  })

  it('repeat clicks on the SAME cell step deeper and wrap at the bottom', () => {
    let state: SelectCycleState = { cell: null, index: 0 }
    const picks: number[] = []
    for (let i = 0; i < 4; i++) {
      const step = stepSelectCycle(state, '2,3', 3)
      picks.push(step.index)
      state = step.next
    }
    // top → deeper → deepest → wrap to top.
    expect(picks).toEqual([0, 1, 2, 0])
  })

  it('moving to a DIFFERENT cell resets the cycle to the top-most', () => {
    const first = stepSelectCycle({ cell: null, index: 0 }, '2,3', 3)
    const afterDeep = stepSelectCycle(first.next, '2,3', 3)
    expect(afterDeep.index).toBe(1)
    const moved = stepSelectCycle(afterDeep.next, '7,8', 2)
    expect(moved.index).toBe(0)
    expect(moved.next).toEqual({ cell: '7,8', index: 0 })
  })

  it('an empty candidate list clears the anchor', () => {
    const step = stepSelectCycle({ cell: '2,3', index: 1 }, '2,3', 0)
    expect(step).toEqual({ next: { cell: null, index: 0 }, index: 0 })
  })
})
