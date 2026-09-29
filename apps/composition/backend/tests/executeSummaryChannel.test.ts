import { describe, expect, it } from 'vitest'

import {
  EXECUTE_SUMMARY_CHANNEL_HOWTOFIX,
  SCENE_EXECUTE_SUMMARY_CHANNEL,
  executeSummaryChannelFailure,
  parseSceneBackendPayload,
} from '../src/execute-summary-channel.js'

describe('execute-summary channel failures', () => {
  it('parses empty or HTML 500 bodies without throwing', () => {
    expect(parseSceneBackendPayload('')).toBeNull()
    expect(parseSceneBackendPayload('<html>gateway timeout</html>')).toEqual({
      error: '<html>gateway timeout</html>',
      parseError: true,
    })
    expect(parseSceneBackendPayload('{"status":"completed"}')).toEqual({ status: 'completed' })
  })

  it('tells Sino to keep applied source instead of probing scale', () => {
    const payload = executeSummaryChannelFailure(new Error('lineage write failed'))
    expect(payload.code).toBe(SCENE_EXECUTE_SUMMARY_CHANNEL)
    expect(payload.retryable).toBe(false)
    expect(payload.howToFix).toEqual([...EXECUTE_SUMMARY_CHANNEL_HOWTOFIX])
    expect(JSON.stringify(payload.howToFix)).toMatch(/verify once/)
    expect(JSON.stringify(payload.howToFix)).toMatch(/Do not draft/)
    expect(JSON.stringify(payload.howToFix)).toMatch(/cellSize/)
  })
})
