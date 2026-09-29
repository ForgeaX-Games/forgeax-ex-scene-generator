// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  DEFAULT_CONTROL,
  DEFAULT_SELECTION,
  readControl,
  readRefresh,
  readSelection,
  requestRefresh,
  writeControl,
  writeSelection,
} from '../assetControlBus.js'

describe('assetControlBus', () => {
  beforeEach(() => localStorage.clear())

  it('defaults when nothing has been written', () => {
    expect(readControl()).toEqual(DEFAULT_CONTROL)
    expect(readSelection()).toEqual(DEFAULT_SELECTION)
    expect(readRefresh().seq).toBe(0)
  })

  it('round-trips control state (left → surface)', () => {
    writeControl({ search: 'couch', fieldFilters: [{ fieldIdx: 8, value: 'wall' }], batchMode: true })
    const c = readControl()
    expect(c.search).toBe('couch')
    expect(c.batchMode).toBe(true)
    expect(c.fieldFilters).toEqual([{ fieldIdx: 8, value: 'wall' }])
  })

  it('round-trips selection mirror (surface → left)', () => {
    writeSelection({ asset: null, selectedIds: ['a', 'b'], batchMode: true, zone: 'trash' })
    const s = readSelection()
    expect(s.selectedIds).toEqual(['a', 'b'])
    expect(s.zone).toBe('trash')
  })

  it('requestRefresh bumps a monotonic seq + carries clearSelection', () => {
    requestRefresh(true)
    const r = readRefresh()
    expect(r.seq).toBeGreaterThan(0)
    expect(r.clearSelection).toBe(true)
  })
})
