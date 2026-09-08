import { describe, it, expect } from 'vitest'
import { DataTree } from '../index.js'
import { multiRandomInt } from '../../../batteries-common/batteries/common/number/multi_random_int/index.js'

// multi_random_int 借用 shape 树的形状（paths + 每分支 items.length），逐分支输出一个
// 确定可复现的 [0, count) 整数。下游 lacing 按分支序号配对，故 paths 与 items.length 必须零变换。

function shapeTree() {
  // 多分支、且各分支 items.length 不同，用来校验形状被严格保持。
  return DataTree.fromEntries([
    { path: [0], items: ['a'] },
    { path: [1], items: ['b', 'c'] },
    { path: [2, 0], items: ['d', 'e', 'f'] },
  ])
}

describe('multi_random_int battery', () => {
  it('errors when shape is not a DataTree', () => {
    const out = multiRandomInt({ shape: { not: 'a tree' }, seed: 1, count: 4 })
    expect(out.error).toMatch(/must be a DataTree/)
  })

  it('output keeps the same shape as input (paths + per-branch items.length)', () => {
    const shape = shapeTree()
    const out = multiRandomInt({ shape, seed: 12345, count: 4 })
    expect(out.error).toBeUndefined()
    const tree = out.value as DataTree<number>
    const inJson = shape.toJSON()
    const outJson = tree.toJSON()
    expect(outJson.length).toBe(inJson.length)
    for (let i = 0; i < inJson.length; i++) {
      expect(outJson[i].path).toEqual(inJson[i].path)
      expect(outJson[i].items.length).toBe(inJson[i].items.length)
    }
  })

  it('all values are integers within [0, count)', () => {
    const count = 7
    const out = multiRandomInt({ shape: shapeTree(), seed: 999, count })
    const tree = out.value as DataTree<number>
    for (const branch of tree.branches()) {
      for (const v of branch.items) {
        expect(Number.isInteger(v)).toBe(true)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThan(count)
      }
    }
  })

  it('same seed + same path → same value (reproducible)', () => {
    const a = multiRandomInt({ shape: shapeTree(), seed: 42, count: 5 }).value as DataTree<number>
    const b = multiRandomInt({ shape: shapeTree(), seed: 42, count: 5 }).value as DataTree<number>
    expect(b.toJSON()).toEqual(a.toJSON())
    // 同分支内（同 path）所有 item 取值一致：逐分支一个整数。
    for (const branch of a.branches()) {
      const first = branch.items[0]
      for (const v of branch.items) expect(v).toBe(first)
    }
  })

  it('different paths can produce different values', () => {
    // 用较大 count 降低偶然碰撞概率，验证逐分支多样化能力。
    const out = multiRandomInt({ shape: shapeTree(), seed: 7, count: 100 })
    const tree = out.value as DataTree<number>
    const perBranchValues = [...tree.branches()].map((b) => b.items[0])
    const distinct = new Set(perBranchValues)
    expect(distinct.size).toBeGreaterThan(1)
  })

  it('seed=0 takes the timestamp branch without throwing', () => {
    const out = multiRandomInt({ shape: shapeTree(), seed: 0, count: 4 })
    expect(out.error).toBeUndefined()
    const tree = out.value as DataTree<number>
    for (const branch of tree.branches()) {
      for (const v of branch.items) {
        expect(Number.isInteger(v)).toBe(true)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThan(4)
      }
    }
  })

  it('count <= 0 falls back to 0', () => {
    const out = multiRandomInt({ shape: shapeTree(), seed: 1, count: 0 })
    const tree = out.value as DataTree<number>
    for (const branch of tree.branches()) {
      for (const v of branch.items) expect(v).toBe(0)
    }
  })
})
