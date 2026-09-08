import { describe, it, expect } from 'vitest'
import { flattenWire, flattenWireList } from '../flattenWire'

describe('flattenWire', () => {
  it('flattens DataTree {path,items} entries into a flat array', () => {
    expect(flattenWire([{ path: [0], items: [{ a: 1 }, { a: 2 }] }, { path: [1], items: [{ a: 3 }] }]))
      .toEqual([{ a: 1 }, { a: 2 }, { a: 3 }])
  })
  it('passes a plain array through unchanged', () => {
    expect(flattenWire([{ a: 1 }])).toEqual([{ a: 1 }])
  })
  it('returns [] for null/undefined', () => {
    expect(flattenWire(null)).toEqual([])
    expect(flattenWire(undefined)).toEqual([])
  })

  // A `grid` port is `fromItem(number[][])` → items:[grid]. The leaf array IS
  // the grid; flattenWire must keep it as ONE element (do not spread rows).
  it('keeps a grid leaf (number[][]) as a single element (single-wrap)', () => {
    const grid = [[0, 1], [1, 0]]
    const out = flattenWire<number[][]>([{ path: [0], items: [grid] }])
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual(grid)
  })
})

describe('flattenWireList', () => {
  // `voxel_layers` is `fromItem(VoxelLayer[])` → items:[[ …layers ]] (double-
  // wrapped). flattenWireList must return the real VoxelLayer objects, each with
  // an iterable `cells` array — the exact shape that previously crashed with
  // `layer.cells is not iterable`.
  it('unwraps a double-wrapped voxel_layers leaf into real VoxelLayer objects', () => {
    const layers = [
      { nodePath: '/A', nodeName: 'A', value: 1, schema: {}, cells: [{ x: 0, y: 0, z: 0 }] },
      { nodePath: '/B', nodeName: 'B', value: 2, schema: {}, cells: [{ x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }] },
    ]
    const out = flattenWireList<{ cells: unknown[] }>([{ path: [0], items: [layers] }])
    expect(out).toHaveLength(2)
    expect(Array.isArray(out[0].cells)).toBe(true)
    expect(out[0].cells).toHaveLength(1)
    expect(out[1].cells).toHaveLength(2)
  })
  it('unwraps a double-wrapped name_list leaf consistently with layers', () => {
    const names = [{ id: 1, name: 'wall', type: 'tile' }]
    expect(flattenWireList([{ path: [0], items: [names] }])).toEqual(names)
  })
  it('also handles a list-form wire (fromList: each item is one element)', () => {
    expect(flattenWireList([{ path: [0], items: [{ id: 1 }, { id: 2 }] }]))
      .toEqual([{ id: 1 }, { id: 2 }])
  })
})
