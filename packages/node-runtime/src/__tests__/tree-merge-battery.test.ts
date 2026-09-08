import { describe, it, expect } from 'vitest'
import { DataTree } from '../index.js'
import { treeMerge } from '../../../batteries-common/batteries/common/datatree/tree_merge/index.js'

// tree_merge 是类型无关的 DataTree 维度算子：只在结构层面升一维，对承载的元素类型
// （number / string / scene / ...）一视同仁，从不解读 item 的语义。
function scenePortItem() {
  return { tree: { id: 'root', children: [] }, focus: 'root' }
}

describe('tree_merge battery', () => {
  it('item-access concat merges plain DataTrees by path', () => {
    const a = DataTree.fromEntries([{ path: [0], items: ['A'] }])
    const b = DataTree.fromEntries([{ path: [0], items: ['B'] }])
    const out = treeMerge({ portCount: 2, inferredAccess: 'item', item_0: a, item_1: b })
    expect(out.error).toBeUndefined()
    expect((out.tree as DataTree<unknown>).toJSON()).toEqual([{ path: [0], items: ['A', 'B'] }])
  })

  it('default/structure pack prefixes each slot with its index', () => {
    const a = DataTree.fromEntries([{ path: [0], items: ['A'] }])
    const b = DataTree.fromEntries([{ path: [0], items: ['B'] }])
    const out = treeMerge({ portCount: 2, item_0: a, item_1: b })
    expect(out.error).toBeUndefined()
    expect((out.tree as DataTree<unknown>).toJSON()).toEqual([
      { path: [0, 0], items: ['A'] },
      { path: [1, 0], items: ['B'] },
    ])
  })

  it('collects scene-shaped items into a list in item-access mode', () => {
    const sceneItem = scenePortItem()
    const scene = DataTree.fromEntries([{ path: [0], items: [sceneItem] }])
    const plain = DataTree.fromEntries([{ path: [0], items: ['A'] }])
    const out = treeMerge({ portCount: 2, inferredAccess: 'item', item_0: plain, item_1: scene })
    expect(out.error).toBeUndefined()
    expect((out.tree as DataTree<unknown>).toJSON()).toEqual([{ path: [0], items: ['A', sceneItem] }])
  })

  it('packs scene-shaped items by lifting one dimension (type-agnostic, no special-casing)', () => {
    // scene 不特殊：pack 档对 scene 形状的 item 也只是升一维，slot i 的 path P → [i, ...P]。
    const s0 = scenePortItem()
    const s1 = scenePortItem()
    const a = DataTree.fromEntries([{ path: [0], items: [s0] }])
    const b = DataTree.fromEntries([{ path: [0], items: [s1] }])
    const out = treeMerge({ portCount: 2, item_0: a, item_1: b })
    expect(out.error).toBeUndefined()
    expect((out.tree as DataTree<unknown>).toJSON()).toEqual([
      { path: [0, 0], items: [s0] },
      { path: [1, 0], items: [s1] },
    ])
  })

  it('still errors on non-DataTree slot inputs', () => {
    const out = treeMerge({ portCount: 1, item_0: { not: 'a tree' } })
    expect(out.error).toMatch(/must be a DataTree/)
  })
})
