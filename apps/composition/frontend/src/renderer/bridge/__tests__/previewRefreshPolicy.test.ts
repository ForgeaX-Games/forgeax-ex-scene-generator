import { describe, expect, it } from 'vitest'
import {
  LOCAL_PARAM_EDIT_BATCH_PREFIX,
  cancelStructuralDebounceOnExecStart,
  execCompletedRefresh,
  graphAppliedAction,
  previewLaneForGraphBatch,
} from '../previewRefreshPolicy'

describe('previewRefreshPolicy', () => {
  it('treats kernel slider batch ids as the param-drag lane', () => {
    expect(LOCAL_PARAM_EDIT_BATCH_PREFIX).toBe('editor-param-')
    expect(previewLaneForGraphBatch(`${LOCAL_PARAM_EDIT_BATCH_PREFIX}1-abc`)).toBe('param-drag')
    expect(graphAppliedAction(`${LOCAL_PARAM_EDIT_BATCH_PREFIX}1-abc`)).toBe('defer-to-param-settle')
  })

  it('treats drop/delete/connect batches as structural, including a missing id', () => {
    expect(previewLaneForGraphBatch('graph-test')).toBe('structural')
    expect(previewLaneForGraphBatch(undefined)).toBe('structural')
    expect(graphAppliedAction('graph-test')).toBe('structural-refresh')
  })

  it('does not let a structural execute cancel the graph:applied debounce', () => {
    expect(cancelStructuralDebounceOnExecStart(false)).toBe(false)
    expect(cancelStructuralDebounceOnExecStart(true)).toBe(true)
  })

  it('defers GET refresh only while a slider is active', () => {
    expect(execCompletedRefresh(true)).toBe('settle')
    expect(execCompletedRefresh(false)).toBe('refresh')
  })
})
