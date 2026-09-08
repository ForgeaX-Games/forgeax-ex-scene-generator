import { describe, it, expect } from 'vitest'
import { executeWithDataTreeDispatch } from '../layer1/dispatcher.js'
import { DataTree } from '../layer1/datatree/tree.js'
import type { OpSpec } from '../layer1/types/op-spec.js'

function twoInputOp(): OpSpec {
  return {
    id: 'test_two_input',
    inputs: [
      { name: 'a', type: 'image', required: true, access: 'item' },
      { name: 'b', type: 'image', required: true, access: 'item' },
    ],
    outputs: [
      { name: 'out', type: 'image' },
      { name: 'error', type: 'string' },
    ],
    params: [],
    execute: () => ({ out: 'composed', error: '' }),
  }
}

const fn = (i: Record<string, unknown>) => {
  const a = i.a
  const b = i.b
  if (a === undefined || a === '') return { error: 'missing a input' }
  if (b === undefined || b === '') return { error: 'missing b input' }
  return { out: 'composed', error: '' }
}

describe('dispatcher: multi-input missing-value handling', () => {
  it('runs when both required item inputs have a value', async () => {
    const res = await executeWithDataTreeDispatch(
      twoInputOp(),
      { a: DataTree.fromItem('imgA'), b: DataTree.fromItem('imgB') },
      {},
      fn,
    )
    expect(res.out).toBeInstanceOf(DataTree)
    expect((res.out as DataTree<unknown>).toJSON()[0].items[0]).toBe('composed')
  })

  it('THROWS (no longer silently no-ops) when one required item input is an empty tree while the other has data', async () => {
    await expect(
      executeWithDataTreeDispatch(
        twoInputOp(),
        { a: DataTree.fromItem('imgA'), b: DataTree.empty() },
        {},
        fn,
      ),
    ).rejects.toThrow(/required input "b" has no value/)
  })

  it('stays a silent no-op when ALL aligned inputs are empty (node not wired yet)', async () => {
    const res = await executeWithDataTreeDispatch(
      twoInputOp(),
      { a: DataTree.empty(), b: DataTree.empty() },
      {},
      fn,
    )
    expect(res).toEqual({})
  })
})
