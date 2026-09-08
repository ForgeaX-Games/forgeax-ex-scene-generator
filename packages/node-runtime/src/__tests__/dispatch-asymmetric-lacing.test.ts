import { describe, it, expect } from 'vitest'
import { executeWithDataTreeDispatch } from '../layer1/dispatcher.js'
import { DataTree } from '../layer1/datatree/tree.js'
import type { OpSpec } from '../layer1/types/op-spec.js'

// Mirrors basic_math_op: two access:item operands + an access:tree op selector,
// lacing 'longest', a single access:item result. Used to lock in that an
// asymmetric lace (scalar + list) fans out one result per list element instead
// of collapsing every result onto the short port's single branch.
function mathOp(): OpSpec {
  return {
    id: 'basic_math_op',
    lacing: 'longest',
    inputs: [
      { name: 'a', type: 'number', required: true, access: 'item' },
      { name: 'b', type: 'number', required: true, access: 'item' },
      { name: 'op', type: 'string', access: 'tree' },
    ],
    outputs: [{ name: 'result', type: 'number', access: 'item' }],
    params: [],
    execute: () => ({}),
  } as unknown as OpSpec
}

const add = (i: Record<string, unknown>) => {
  const a = typeof i.a === 'number' ? i.a : 0
  const b = typeof i.b === 'number' ? i.b : 0
  return { result: a + b }
}

function listTree(values: number[]): DataTree<unknown> {
  return DataTree.fromJSON(values.map((v, idx) => ({ path: [idx], items: [v] })))
}

describe('dispatcher: asymmetric (scalar + list) longest lacing', () => {
  it('produces one result branch per list element when the list is on the non-principal port', async () => {
    const res = await executeWithDataTreeDispatch(
      mathOp(),
      { a: DataTree.fromItem(0), b: listTree([5, 4, 10]) },
      { op: '+' },
      add,
    )
    const items = (res.result as DataTree<unknown>).toJSON().map((e) => e.items[0])
    expect(items).toEqual([5, 4, 10])
  })

  it('fans out when the list is on the principal (first) port', async () => {
    const res = await executeWithDataTreeDispatch(
      mathOp(),
      { a: listTree([1, 2, 3]), b: DataTree.fromItem(10) },
      { op: '+' },
      add,
    )
    const items = (res.result as DataTree<unknown>).toJSON().map((e) => e.items[0])
    expect(items).toEqual([11, 12, 13])
  })

  it('keeps a plain scalar + scalar lace as a single result', async () => {
    const res = await executeWithDataTreeDispatch(
      mathOp(),
      { a: DataTree.fromItem(3), b: DataTree.fromItem(4) },
      { op: '+' },
      add,
    )
    const items = (res.result as DataTree<unknown>).toJSON().map((e) => e.items[0])
    expect(items).toEqual([7])
  })

  it('zips two equal-length lists element-wise', async () => {
    const res = await executeWithDataTreeDispatch(
      mathOp(),
      { a: listTree([1, 2, 3]), b: listTree([10, 20, 30]) },
      { op: '+' },
      add,
    )
    const items = (res.result as DataTree<unknown>).toJSON().map((e) => e.items[0])
    expect(items).toEqual([11, 22, 33])
  })

  // Regression (point2rect): the FANNING port is SHALLOWER than a constant
  // single-branch port. Here `a` is grafted deep at [0,0,0] (depth 3, 1 branch)
  // while `b` is a flattened list normalised to [0,k] (depth 2, N branches).
  // The output must follow `b`'s N distinct branches, not collapse onto `a`'s
  // single deep path. Depth-first principal selection regressed this (every
  // result overwrote [0,0,0] → one output); count-first fixes it.
  it('fans out when the multi-branch port is shallower than a deep single-branch port', async () => {
    const deepScalar = DataTree.fromJSON([{ path: [0, 0, 0], items: [100] }])
    const flatList = DataTree.fromJSON([{ path: [0], items: [5, 4, 10] }]) // → [0,0],[0,1],[0,2]
    const res = await executeWithDataTreeDispatch(
      mathOp(),
      { a: deepScalar, b: flatList },
      { op: '+' },
      add,
    )
    const entries = (res.result as DataTree<unknown>).toJSON()
    expect(entries.map((e) => e.path)).toEqual([[0, 0], [0, 1], [0, 2]])
    expect(entries.map((e) => e.items[0])).toEqual([105, 104, 110])
  })
})
