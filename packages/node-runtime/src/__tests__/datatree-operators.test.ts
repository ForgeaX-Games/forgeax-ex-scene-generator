import { describe, it, expect } from 'vitest'
import { DataTree, concatEntriesByPath, flattenEntries } from '../index.js'

// DataTree 的维度算子是类型无关的结构契约：只动 path / items 的排布，从不解读 item 的语义。
// 这里守的是内核不变量本身（形状保持、concat-by-path vs prefix-merge、flatten 收到 [0]、
// 鸭子类型识别），不是任何一个电池的行为。

// 用 scene 形状的 item 验证「类型无关」：算子不认识它，只搬运引用。
function sceneItem() {
  return { tree: { id: 'root', children: [] }, focus: 'root' }
}

describe('DataTree.flatten', () => {
  it('collapses a multi-branch (single-item) tree into one list at path [0]', () => {
    // prefix-merge 升一维后的典型形状：多 branch、每 branch 单 item。
    const tree = DataTree.fromEntries([
      { path: [0, 0], items: ['s0'] },
      { path: [1, 0], items: ['s1'] },
    ])
    expect(tree.flatten().toJSON()).toEqual([{ path: [0], items: ['s0', 's1'] }])
  })

  it('keeps an empty tree empty rather than producing an empty branch [0]', () => {
    expect(DataTree.empty().flatten().toJSON()).toEqual([])
    expect(flattenEntries([])).toEqual([])
  })
})

describe('DataTree.concatByPath', () => {
  it('merges slots at the item level, preserving each path', () => {
    const a = DataTree.fromEntries([{ path: [0], items: ['A'] }])
    const b = DataTree.fromEntries([{ path: [0], items: ['B'] }])
    expect(DataTree.concatByPath([a, b]).toJSON()).toEqual([{ path: [0], items: ['A', 'B'] }])
  })

  it('unions paths across slots and skips slots lacking a path', () => {
    const a = DataTree.fromEntries([
      { path: [0], items: ['a', 'b'] },
      { path: [1], items: ['c'] },
    ])
    const b = DataTree.fromEntries([
      { path: [1], items: ['y', 'z'] },
      { path: [2], items: ['w'] },
    ])
    expect(DataTree.concatByPath([a, b]).toJSON()).toEqual([
      { path: [0], items: ['a', 'b'] },
      { path: [1], items: ['c', 'y', 'z'] },
      { path: [2], items: ['w'] },
    ])
  })

  it('is type-agnostic: scene-shaped items are carried by reference, not interpreted', () => {
    const s = sceneItem()
    const plain = DataTree.fromEntries<unknown>([{ path: [0], items: ['A'] }])
    const scene = DataTree.fromEntries<unknown>([{ path: [0], items: [s] }])
    const out = DataTree.concatByPath([plain, scene]).toJSON()
    expect(out).toEqual([{ path: [0], items: ['A', s] }])
    expect(out[0]!.items[1]).toBe(s)
  })
})

describe('DataTree.mergeWithPrefix', () => {
  it('lifts one dimension: slot i keeps its own paths under [i]', () => {
    // 与 concatByPath 的分工：pack 档升维（path P → [i, ...P]），不在 item 层合并。
    const a = DataTree.fromEntries([{ path: [0], items: ['A'] }])
    const b = DataTree.fromEntries([{ path: [0], items: ['B'] }])
    const packed = DataTree.empty<string>().mergeWithPrefix(a, 0).mergeWithPrefix(b, 1)
    expect(packed.toJSON()).toEqual([
      { path: [0, 0], items: ['A'] },
      { path: [1, 0], items: ['B'] },
    ])
  })

  it('throws on path collision instead of silently dropping a branch', () => {
    const base = DataTree.fromEntries([{ path: [0, 0], items: ['A'] }])
    const other = DataTree.fromEntries([{ path: [0], items: ['B'] }])
    expect(() => base.mergeWithPrefix(other, 0)).toThrow(/merge collision at/)
  })

  it('rejects a prefix that is not a non-negative integer', () => {
    const t = DataTree.fromItem('A')
    expect(() => DataTree.empty<string>().mergeWithPrefix(t, -1)).toThrow(/merge prefix/)
    expect(() => DataTree.empty<string>().mergeWithPrefix(t, 1.5)).toThrow(/merge prefix/)
  })
})

describe('DataTree.map', () => {
  it('preserves paths and per-branch items.length', () => {
    // 下游 lacing 按分支序号配对，逐项算子必须零形变。
    const shape = DataTree.fromEntries([
      { path: [0], items: ['a'] },
      { path: [1], items: ['b', 'c'] },
      { path: [2, 0], items: ['d', 'e', 'f'] },
    ])
    const mapped = shape.map((v) => v.length)
    const before = shape.toJSON()
    const after = mapped.toJSON()
    expect(after.length).toBe(before.length)
    for (let i = 0; i < before.length; i++) {
      expect(after[i]!.path).toEqual(before[i]!.path)
      expect(after[i]!.items.length).toBe(before[i]!.items.length)
    }
  })
})

describe('DataTree.isDataTree', () => {
  it('duck-types instead of relying on instanceof', () => {
    // 动态 import 会产出独立模块实例，instanceof 必假；识别只能看形状。
    const real = DataTree.fromEntries([{ path: [0], items: ['a'] }])
    const foreign = {
      branches: () => real.branches(),
      branchCount: () => real.branchCount(),
      toJSON: () => real.toJSON(),
    }
    expect(DataTree.isDataTree(foreign)).toBe(true)
    expect(DataTree.isDataTree(real)).toBe(true)
    // 跨模块树按 entries 互操作：算子吃裸 entries 数组，不吃类实例。
    expect(flattenEntries(foreign.toJSON())).toEqual([{ path: [0], items: ['a'] }])
    expect(concatEntriesByPath([foreign.toJSON(), real.toJSON()])).toEqual([
      { path: [0], items: ['a', 'a'] },
    ])
  })

  it('rejects non-trees', () => {
    expect(DataTree.isDataTree({ not: 'a tree' })).toBe(false)
    expect(DataTree.isDataTree(null)).toBe(false)
    expect(DataTree.isDataTree('[0]')).toBe(false)
  })
})
