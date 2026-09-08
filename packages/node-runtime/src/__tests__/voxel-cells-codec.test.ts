import { describe, expect, it } from 'vitest'

import {
  compressPayload,
  compressVoxelCells,
  expandPayload,
  expandVoxelCells,
  type VoxelCellsCompactV1,
} from '../layer1/storage/voxel-cells-codec.js'

const sampleCells = [
  { x: 0, y: 0, z: 0, token: 'ground' },
  { x: 1, y: 0, z: 0, token: 'wall' },
  { x: 2, y: 0, z: 1, token: 'wall' },
] as const

describe('voxel-cells-codec', () => {
  it('round-trips a cell array through compact encoding', () => {
    const compact = compressVoxelCells(sampleCells)
    expect(compact).toMatchObject({ __voxelCells: 1, t: ['ground', 'wall'] })
    expect((compact as VoxelCellsCompactV1).d).toEqual([0, 0, 0, 0, 1, 0, 0, 1, 2, 0, 1, 1])
    expect(expandVoxelCells(compact)).toEqual(sampleCells)
  })

  it('preserves optional cell state', () => {
    const cells = [
      { x: 0, y: 0, z: 0, token: 'obj', state: { instanceId: 'a' } },
      { x: 1, y: 0, z: 0, token: 'obj' },
    ]
    const compact = compressVoxelCells(cells)
    expect(expandVoxelCells(compact)).toEqual(cells)
  })

  it('passes through legacy uncompressed cell arrays', () => {
    expect(expandVoxelCells(sampleCells)).toEqual(sampleCells)
  })

  it('compresses cells inside a scene tree without changing other fields', () => {
    const scene = {
      tree: {
        name: '',
        path: '/',
        version: 1,
        children: [
          {
            name: 'Layer',
            path: '/Layer',
            version: 2,
            schema: 'layer',
            cells: sampleCells,
            children: [],
          },
        ],
      },
      focus: '/Layer',
    }
    const compressed = compressPayload(scene) as typeof scene
    const layer = compressed.tree.children[0] as { cells: VoxelCellsCompactV1 }
    expect(layer.cells.__voxelCells).toBe(1)
    expect(expandPayload(compressed)).toEqual(scene)
  })

  it('calls .toJSON() instead of walking a class instance\'s private fields', () => {
    class MockPersistentMap {
      // Private-looking internal fields that must NEVER leak into the output —
      // only the flattened toJSON() shape should be serialized.
      private root = { fake: 'trie-internals' }
      private size = 1
      toJSON(): Record<string, { name: string; cells: typeof sampleCells }> {
        return { id1: { name: 'Layer', cells: sampleCells } }
      }
    }
    const scene = { graph: new MockPersistentMap(), focus: 'id1' }
    const compressed = compressPayload(scene) as {
      graph: Record<string, { name: string; cells: VoxelCellsCompactV1 }>
      focus: string
    }
    expect(compressed.graph).not.toHaveProperty('root')
    expect(compressed.graph).not.toHaveProperty('size')
    expect(compressed.graph.id1?.name).toBe('Layer')
    // The `cells` field nested inside the toJSON() output must still get compressed.
    expect(compressed.graph.id1?.cells.__voxelCells).toBe(1)
    expect(expandPayload(compressed)).toEqual({
      graph: { id1: { name: 'Layer', cells: sampleCells } },
      focus: 'id1',
    })
  })

  it('shrinks serialized size versus verbose {x,y,z,token} objects', () => {
    const cells = Array.from({ length: 5000 }, (_, i) => ({
      x: i % 100,
      y: (i * 3) % 80,
      z: i % 12,
      token: i % 5 === 0 ? 'ground' : 'wall',
    }))
    const verbose = JSON.stringify(cells)
    const compact = JSON.stringify(compressVoxelCells(cells))
    expect(compact.length).toBeLessThan(verbose.length * 0.45)
  })
})
