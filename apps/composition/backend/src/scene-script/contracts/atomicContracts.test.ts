import { describe, expect, it } from 'vitest'

import { FIRST_BATCH_OP_IDS, resolveSceneContractRoots } from '../firstBatchBatteries.js'
import { loadAtomicContracts } from './atomicContracts.js'

describe('atomic Scene Contract loader', () => {
  it('loads every first-batch battery from a co-located static TS contract', async () => {
    const contracts = await loadAtomicContracts(resolveSceneContractRoots())
    const opIds = new Set(contracts.map((item) => item.opId))
    expect([...opIds].sort()).toEqual([...FIRST_BATCH_OP_IDS].sort())
  })
})
