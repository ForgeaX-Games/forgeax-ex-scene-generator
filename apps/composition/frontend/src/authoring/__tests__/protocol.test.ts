import { describe, it, expect } from 'vitest'
import { isAuthoringMessage } from '../protocol'

describe('authoring protocol', () => {
  it('accepts well-formed authoring:* messages', () => {
    expect(isAuthoringMessage({ type: 'authoring:request-focus', target: 'renderer' })).toBe(true)
    expect(isAuthoringMessage({ type: 'authoring:query-focus' })).toBe(true)
    expect(isAuthoringMessage({ type: 'authoring:focus-changed', focus: null })).toBe(true)
    expect(isAuthoringMessage({ type: 'authoring:status-report', source: 'renderer', payload: {} })).toBe(true)
    expect(isAuthoringMessage({ type: 'authoring:project-changed', projectId: 'main' })).toBe(true)
    expect(isAuthoringMessage({ type: 'authoring:toggle-editor' })).toBe(true)
    expect(isAuthoringMessage({ type: 'authoring:request-close-editor' })).toBe(true)
    expect(isAuthoringMessage({ type: 'authoring:query-editor-visibility' })).toBe(true)
    expect(isAuthoringMessage({ type: 'authoring:editor-visibility-changed', visible: true })).toBe(true)
    expect(isAuthoringMessage({ type: 'authoring:restore-layout' })).toBe(true)
    expect(isAuthoringMessage({ type: 'authoring:set-param', nodeId: 'n1', key: 'x', value: 8 })).toBe(true)
    expect(isAuthoringMessage({ type: 'authoring:select-nodes', nodeIds: ['n-houses'] })).toBe(true)
    expect(isAuthoringMessage({ type: 'authoring:capture-preview', requestId: 'r1' })).toBe(true)
    expect(isAuthoringMessage({
      type: 'authoring:preview-captured',
      requestId: 'r1',
      capturedAt: 'now',
      dataUrl: 'data:image/png;base64,x',
      width: 10,
      height: 10,
    })).toBe(true)
  })
  it('rejects non-authoring / malformed payloads', () => {
    expect(isAuthoringMessage(null)).toBe(false)
    expect(isAuthoringMessage(undefined)).toBe(false)
    expect(isAuthoringMessage('authoring:request-focus')).toBe(false)
    expect(isAuthoringMessage({ type: 'other:event' })).toBe(false)
    expect(isAuthoringMessage({ foo: 'bar' })).toBe(false)
  })
})
