// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  readSelectedRule,
  writeSelectedRule,
  subscribeSelectedRule,
  type RuleListItem,
} from '../rulesApi'

const KEY = 'wb-scene-generator.assetstore.selectedRule'

const RULE: RuleListItem = {
  alias: 'common_16',
  name: 'common_16',
  schemaVersion: 2,
  ppu: 16,
  spriteCount: 20,
  faces: { top: { basePieces: 16, mapEntries: 47, variants: 0, hasRandom: false } },
  regions: [],
}

beforeEach(() => localStorage.clear())
afterEach(() => localStorage.clear())

describe('rulesApi selected-rule bus', () => {
  it('round-trips a selection through localStorage and clears on null', () => {
    expect(readSelectedRule()).toBeNull()
    writeSelectedRule(RULE)
    expect(readSelectedRule()?.alias).toBe('common_16')
    writeSelectedRule(null)
    expect(readSelectedRule()).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('returns null on an unparseable value rather than throwing', () => {
    localStorage.setItem(KEY, '{not json')
    expect(readSelectedRule()).toBeNull()
  })

  it('notifies subscribers on a cross-document storage event for the key only', () => {
    const seen: (RuleListItem | null)[] = []
    const unsub = subscribeSelectedRule((r) => seen.push(r))

    // Simulate the AssetStore pane (another document) publishing a selection.
    localStorage.setItem(KEY, JSON.stringify(RULE))
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }))
    // An unrelated key must be ignored.
    window.dispatchEvent(new StorageEvent('storage', { key: 'some.other.key' }))

    expect(seen).toHaveLength(1)
    expect(seen[0]?.alias).toBe('common_16')
    unsub()
  })
})
