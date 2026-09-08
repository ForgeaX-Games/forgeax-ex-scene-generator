import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadAtomicContracts } from './atomicContracts.js'

const appRoot = resolve(import.meta.dirname, '..', '..', '..', '..')
const nodeEditorRoot = resolve(appRoot, '..', '..')

describe('atomic Scene Contract loader', () => {
  it('loads every target atomic battery from a co-located static TS contract', async () => {
    const contracts = await loadAtomicContracts([
      resolve(nodeEditorRoot, 'packages', 'batteries-common', 'batteries', 'common'),
      resolve(appRoot, 'batteries'),
    ])

    const opIds = new Set(contracts.map((item) => item.opId))
    expect(opIds.size).toBeGreaterThan(0)
    expect(contracts.find((item) => item.opId === 'range_list')?.functionName).toBe('rangeList')
    expect(contracts.filter((item) => item.opId === 'tree_merge')).toHaveLength(4)
  })
})
