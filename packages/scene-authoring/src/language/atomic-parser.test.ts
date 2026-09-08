import { describe, expect, it } from 'vitest'

import { parseAtomicContractSource } from './atomic-parser.js'

describe('parseAtomicContractSource', () => {
  it('loads exported static contracts without executing module code', () => {
    const result = parseAtomicContractSource(`
      import { defineAtomic } from '@forgeax/scene-authoring'
      throw new Error('must not execute')
      export default defineAtomic({
        functionName: "rangeList",
        contractVersion: "1.1.0",
        opId: "range_list",
        description: "Range.",
        inputs: [{ name: "start", type: "number", access: "item", defaultValue: 1 }],
        outputs: [{ name: "list", type: "number", access: "list" }],
      })
    `, 'scene.contract.ts')

    expect(result.diagnostics).toEqual([])
    expect(result.contracts).toEqual([
      expect.objectContaining({
        kind: 'atomic',
        functionName: 'rangeList',
        opId: 'range_list',
        inputs: [expect.objectContaining({ defaultValue: 1 })],
      }),
    ])
  })

  it('rejects dynamic contract expressions', () => {
    const result = parseAtomicContractSource(`
      export default defineAtomic({
        functionName: makeName(),
        contractVersion: "1",
        opId: "dynamic",
        description: "Invalid.",
        inputs: [],
        outputs: [],
      })
    `, 'dynamic.scene.contract.ts')

    expect(result.contracts).toEqual([])
    expect(result.diagnostics[0]?.code).toBe('SCENE_ATOMIC_CONTRACT_STATIC')
  })
})
