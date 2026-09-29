import { describe, expect, it } from 'vitest'
import { isFailedParamEdit, paramEditErrorMessage } from '../paramEditRollback'

describe('paramEditRollback', () => {
  it('treats a missing or error execute as a failed edit', () => {
    expect(isFailedParamEdit(undefined)).toBe(true)
    expect(isFailedParamEdit({
      executionId: 'e',
      status: 'error',
      outputs: {},
      durationMs: 1,
      error: { message: 'cell returned error' },
    })).toBe(true)
    expect(isFailedParamEdit({
      executionId: 'e',
      status: 'completed',
      outputs: {},
      durationMs: 1,
    })).toBe(false)
  })

  it('prefers the execute error message', () => {
    expect(paramEditErrorMessage({
      executionId: 'e',
      status: 'error',
      outputs: {},
      durationMs: 1,
      error: { message: 'no terrace walls generated' },
    })).toBe('no terrace walls generated')
    expect(paramEditErrorMessage(undefined)).toBe('This edit failed. The previous value was restored.')
  })
})
