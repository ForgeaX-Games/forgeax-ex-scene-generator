import { describe, expect, it } from 'vitest'

import {
  LOCAL_PARAM_EDIT_BATCH_PREFIX,
  isLocalParamEditBatch,
  nextLocalParamEditBatchId,
} from '../stores/pipelineLiveSync.js'

describe('local param-edit batch identity', () => {
  it('tags slider persists with a stable prefix the preview lane can match', () => {
    const id = nextLocalParamEditBatchId()
    expect(LOCAL_PARAM_EDIT_BATCH_PREFIX).toBe('editor-param-')
    expect(id.startsWith(LOCAL_PARAM_EDIT_BATCH_PREFIX)).toBe(true)
    expect(isLocalParamEditBatch(id)).toBe(true)
    expect(isLocalParamEditBatch('graph-test')).toBe(false)
    expect(isLocalParamEditBatch(undefined)).toBe(false)
  })
})
