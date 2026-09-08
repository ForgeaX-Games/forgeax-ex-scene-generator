import { describe, it, expect } from 'vitest'
import { executeWithDataTreeDispatch } from '../layer1/dispatcher.js'
import { DataTree } from '../layer1/datatree/tree.js'
import type { DataTreeEntry } from '../layer1/datatree/types.js'
import type { OpSpec } from '../layer1/types/op-spec.js'

// Mirrors grid2node: grid is access:item (fans out per leaf), zRange is
// access:list (per-call it receives the children of the matched parent branch),
// lacing defaults to 'longest'.
function grid2nodeLike(): OpSpec {
  return {
    id: 'grid2node_like',
    inputs: [
      { name: 'grid', type: 'grid', required: true, access: 'item' },
      { name: 'zRange', type: 'number', required: true, access: 'list' },
    ],
    outputs: [
      { name: 'room', type: 'number', access: 'item' },
      { name: 'zfirst', type: 'number', access: 'item' },
    ],
    params: [],
    execute: () => ({}),
  } as unknown as OpSpec
}

const probe = (i: Record<string, unknown>) => {
  const zs = Array.isArray(i.zRange) ? (i.zRange as number[]) : []
  return { room: i.grid as number, zfirst: zs[0] }
}

function pathMap(tree: DataTree<unknown>): Map<string, unknown> {
  const m = new Map<string, unknown>()
  for (const e of tree.toJSON() as DataTreeEntry<unknown>[]) {
    m.set(JSON.stringify(e.path), e.items[0])
  }
  return m
}

describe('dispatcher: prefix-aware longest lacing (hierarchy broadcast)', () => {
  it('broadcasts a per-building zRange across that building rooms (3 buildings x 4 rooms)', async () => {
    // grid: 12 room leaves at depth-2 paths [b, r], value encodes b*10+r.
    const gridEntries: DataTreeEntry<unknown>[] = []
    for (let b = 0; b < 3; b++) {
      for (let r = 0; r < 4; r++) gridEntries.push({ path: [b, r], items: [b * 10 + r] })
    }
    const grid = DataTree.fromJSON(gridEntries)

    // zRange: one branch per building (parent paths [0],[1],[2]); building b's
    // single z layer = 3 / 4 / 5. Leaves at depth-2 [b, 0] so parentPaths = {b}.
    const zRange = DataTree.fromJSON([
      { path: [0, 0], items: [3] },
      { path: [1, 0], items: [4] },
      { path: [2, 0], items: [5] },
    ])

    const res = await executeWithDataTreeDispatch(grid2nodeLike(), { grid, zRange }, {}, probe)

    const rooms = pathMap(res.room as DataTree<unknown>)
    const zs = pathMap(res.zfirst as DataTree<unknown>)
    const expectedZ = [3, 4, 5]

    expect(rooms.size).toBe(12)
    expect(zs.size).toBe(12)
    for (let b = 0; b < 3; b++) {
      for (let r = 0; r < 4; r++) {
        const key = JSON.stringify([b, r])
        expect(rooms.get(key)).toBe(b * 10 + r)
        // every room of building b must get building b's z, not a clamped tail value
        expect(zs.get(key)).toBe(expectedZ[b])
      }
    }
  })

  it('keeps flat-list semantics unchanged: an un-grafted zRange feeds the whole list to every grid leaf', async () => {
    // zRange is flat depth-1 → as a list port it has a single root parent, so
    // every fanned grid call receives the entire [3,4,5] list. The root parent
    // ([]) is a prefix of every spine path, so the prefix-aware path picks it —
    // identical to the previous behaviour (no per-building info ⇒ no broadcast).
    const grid = DataTree.fromJSON([
      { path: [0], items: [100] },
      { path: [1], items: [101] },
      { path: [2], items: [102] },
      { path: [3], items: [103] },
    ])
    const zRange = DataTree.fromJSON([
      { path: [0], items: [3] },
      { path: [1], items: [4] },
      { path: [2], items: [5] },
    ])
    const res = await executeWithDataTreeDispatch(grid2nodeLike(), { grid, zRange }, {}, probe)
    const zs = pathMap(res.zfirst as DataTree<unknown>)
    expect(zs.size).toBe(4)
    for (const k of [[0], [1], [2], [3]]) {
      expect(zs.get(JSON.stringify(k))).toBe(3) // first of the whole [3,4,5] list
    }
  })

  // Regression (add_child duplicate basename): equal-count peer lists must zip
  // POSITIONALLY even when one is nested one level deeper. Here `scene` fans out
  // at [0,0],[0,1],[0,2] (3 siblings under one parent) and `name` is a flat list
  // [0],[1],[2]. Prefix matching would feed name[0] to all three (only [0] is a
  // prefix of every {0;k}) → every scene gets the same name → downstream
  // duplicate-name collision. Equal cardinality ⇒ positional zip ⇒ distinct.
  it('zips equal-count peer lists positionally despite a one-level nesting mismatch', async () => {
    const op = {
      id: 'name_scene',
      lacing: 'longest',
      inputs: [
        { name: 'scene', type: 'scene', required: true, access: 'item' },
        { name: 'name', type: 'string', required: true, access: 'item' },
      ],
      outputs: [{ name: 'named', type: 'string', access: 'item' }],
      params: [],
      execute: () => ({}),
    } as unknown as OpSpec
    // scene: 3 siblings under one parent (e.g. flattened then normalised).
    const scene = DataTree.fromJSON([{ path: [0], items: ['s0', 's1', 's2'] }]) // → [0,0],[0,1],[0,2]
    const name = DataTree.fromJSON([
      { path: [0], items: ['building1'] },
      { path: [1], items: ['building2'] },
      { path: [2], items: ['building3'] },
    ])
    const res = await executeWithDataTreeDispatch(
      op,
      { scene, name },
      {},
      (i) => ({ named: `${i.scene}:${i.name}` }),
    )
    const named = (res.named as DataTree<unknown>).toJSON().map((e) => e.items[0])
    expect(named).toEqual(['s0:building1', 's1:building2', 's2:building3'])
  })

  it('positionally clamps two flat item ports of differing length (legacy behaviour preserved)', async () => {
    const op = {
      id: 'two_item',
      lacing: 'longest',
      inputs: [
        { name: 'a', type: 'number', required: true, access: 'item' },
        { name: 'b', type: 'number', required: true, access: 'item' },
      ],
      outputs: [{ name: 'pair', type: 'number', access: 'item' }],
      params: [],
      execute: () => ({}),
    } as unknown as OpSpec
    const a = DataTree.fromJSON([
      { path: [0], items: [0] },
      { path: [1], items: [1] },
      { path: [2], items: [2] },
      { path: [3], items: [3] },
    ])
    const b = DataTree.fromJSON([
      { path: [0], items: [10] },
      { path: [1], items: [20] },
      { path: [2], items: [30] },
    ])
    const res = await executeWithDataTreeDispatch(
      op,
      { a, b },
      {},
      (i) => ({ pair: (i.a as number) * 100 + (i.b as number) }),
    )
    const pairs = (res.pair as DataTree<unknown>).toJSON().map((e) => e.items[0])
    // a index zips, b: 0,1,2 then clamps to last (30) for index 3
    expect(pairs).toEqual([10, 120, 230, 330])
  })
})
