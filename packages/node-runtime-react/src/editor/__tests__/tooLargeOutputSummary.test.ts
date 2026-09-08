import { describe, expect, it } from 'vitest'

import {
  formatTooLargeOutputSummaryText,
  isTooLargeOutputSummary,
  makeTooLargeOutputSummary,
  stripTooLargeSummaries,
} from '../utils/tooLargeOutputSummary.js'

describe('tooLargeOutputSummary', () => {
  it('detects and formats a summary sentinel', () => {
    const summary = makeTooLargeOutputSummary({
      nodeId: 'g_veg_1',
      portId: 'out_1',
      portType: 'decoration',
      sharded: true,
      dataChunks: 12,
      estimatedBytes: 276 * 1024 * 1024,
    })
    expect(isTooLargeOutputSummary(summary)).toBe(true)
    expect(formatTooLargeOutputSummaryText(summary, 'en')).toContain('decoration')
    expect(formatTooLargeOutputSummaryText(summary, 'en')).toContain('too large (summary only)')
    expect(formatTooLargeOutputSummaryText(summary, 'zh')).toContain('过大，仅摘要')
  })

  it('strips summary sentinels from output bags', () => {
    const summary = makeTooLargeOutputSummary({ nodeId: 'n', portId: 'tree', portType: 'scene' })
    const bag = { tree: summary, scene: { focus: '/' } }
    expect(stripTooLargeSummaries(bag)).toEqual({ scene: { focus: '/' } })
  })
})
