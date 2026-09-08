import { describe, it, expect } from 'vitest'
import { isWorkbenchMessage } from '../protocol'

describe('workbench protocol', () => {
  it('accepts well-formed workbench:* messages', () => {
    expect(isWorkbenchMessage({ type: 'workbench:request-focus', target: 'renderer' })).toBe(true)
    expect(isWorkbenchMessage({ type: 'workbench:query-focus' })).toBe(true)
    expect(isWorkbenchMessage({ type: 'workbench:focus-changed', focus: null })).toBe(true)
    expect(isWorkbenchMessage({ type: 'workbench:status-report', source: 'renderer', payload: {} })).toBe(true)
    expect(isWorkbenchMessage({ type: 'workbench:project-changed', projectId: 'main' })).toBe(true)
    expect(isWorkbenchMessage({ type: 'workbench:toggle-editor' })).toBe(true)
    expect(isWorkbenchMessage({ type: 'workbench:request-close-editor' })).toBe(true)
    expect(isWorkbenchMessage({ type: 'workbench:query-editor-visibility' })).toBe(true)
    expect(isWorkbenchMessage({ type: 'workbench:editor-visibility-changed', visible: true })).toBe(true)
    expect(isWorkbenchMessage({ type: 'workbench:restore-layout' })).toBe(true)
    expect(isWorkbenchMessage({ type: 'workbench:set-param', nodeId: 'n1', key: 'x', value: 8 })).toBe(true)
    expect(isWorkbenchMessage({ type: 'workbench:select-nodes', nodeIds: ['n-houses'] })).toBe(true)
    expect(isWorkbenchMessage({ type: 'workbench:capture-preview', requestId: 'r1' })).toBe(true)
    expect(isWorkbenchMessage({
      type: 'workbench:preview-captured',
      requestId: 'r1',
      capturedAt: 'now',
      dataUrl: 'data:image/png;base64,x',
      width: 10,
      height: 10,
    })).toBe(true)
  })
  it('rejects non-workbench / malformed payloads', () => {
    expect(isWorkbenchMessage(null)).toBe(false)
    expect(isWorkbenchMessage(undefined)).toBe(false)
    expect(isWorkbenchMessage('workbench:request-focus')).toBe(false)
    expect(isWorkbenchMessage({ type: 'other:event' })).toBe(false)
    expect(isWorkbenchMessage({ foo: 'bar' })).toBe(false)
  })
})
