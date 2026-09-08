import { describe, it, expect } from 'vitest'
import { isWorkbenchMessage } from '../protocol'

describe('workbench protocol', () => {
  it('accepts well-formed workbench:* messages', () => {
    expect(isWorkbenchMessage({ type: 'workbench:request-focus', target: 'renderer' })).toBe(true)
    expect(isWorkbenchMessage({ type: 'workbench:query-focus' })).toBe(true)
    expect(isWorkbenchMessage({ type: 'workbench:focus-changed', focus: null })).toBe(true)
    expect(
      isWorkbenchMessage({ type: 'workbench:status-report', source: 'assetstore', payload: {} }),
    ).toBe(true)
  })
  it('rejects non-workbench / malformed payloads', () => {
    expect(isWorkbenchMessage(null)).toBe(false)
    expect(isWorkbenchMessage(undefined)).toBe(false)
    expect(isWorkbenchMessage('workbench:request-focus')).toBe(false)
    expect(isWorkbenchMessage({ type: 'other:event' })).toBe(false)
    expect(isWorkbenchMessage({ foo: 'bar' })).toBe(false)
  })
})
