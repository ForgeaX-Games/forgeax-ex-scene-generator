import { describe, it, expect } from 'vitest'
import { DataTree } from '../index.js'
import { treeFlatten } from '../../../batteries-common/batteries/common/datatree/tree_flatten/index.js'

describe('tree_flatten battery', () => {
  it('collapses a multi-branch (single-item) tree into one list at path [0]', () => {
    // tree_merge 升一维后的典型形状：多 branch、每 branch 单 item。
    const tree = DataTree.fromEntries([
      { path: [0, 0], items: ['s0'] },
      { path: [1, 0], items: ['s1'] },
    ])
    const out = treeFlatten({ tree })
    expect(out.error).toBeUndefined()
    expect((out.tree as DataTree<unknown>).toJSON()).toEqual([{ path: [0], items: ['s0', 's1'] }])
  })

  it('keeps an empty tree empty', () => {
    const out = treeFlatten({ tree: DataTree.empty() })
    expect(out.error).toBeUndefined()
    expect((out.tree as DataTree<unknown>).toJSON()).toEqual([])
  })

  it('accepts cross-module/duck-typed DataTree (no instanceof reliance)', () => {
    const real = DataTree.fromEntries([
      { path: [0, 0], items: ['a'] },
      { path: [1, 0], items: ['b'] },
    ])
    // 模拟跨模块实例：instanceof 会失败，但鸭子类型方法齐全。
    const foreign = {
      branches: () => real.branches(),
      branchCount: () => real.branchCount(),
      flatten: () => real.flatten(),
      toJSON: () => real.toJSON(),
    } as unknown as DataTree<unknown>
    const out = treeFlatten({ tree: foreign })
    expect(out.error).toBeUndefined()
    expect((out.tree as DataTree<unknown>).toJSON()).toEqual([{ path: [0], items: ['a', 'b'] }])
  })

  it('errors on non-DataTree input', () => {
    const out = treeFlatten({ tree: { not: 'a tree' } })
    expect(out.error).toMatch(/must be a DataTree/)
  })
})
