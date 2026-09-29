import { describe, expect, it } from 'vitest'

import { applySceneSourceEdits, type SourceEdit } from './writeback.js'

describe('null literal source edits', () => {
  it('inserts null and allows subsequent replacement through its stable id', () => {
    const edits = [{ type: 'insertLiteral', id: 'record', binding: 'record', value: null }] satisfies SourceEdit[]
    const inserted = applySceneSourceEdits('', edits)
    expect(inserted.diagnostics).toEqual([])
    expect(inserted.applied).toBe(1)
    expect(inserted.source).toContain('const record = null')

    const updated = applySceneSourceEdits(inserted.source, [
      { type: 'updateLiteral', id: 'record', value: { enabled: true } },
    ])
    expect(updated.diagnostics).toEqual([])
    expect(updated.applied).toBe(1)
    expect(updated.source).toContain('const record = { enabled: true }')
  })

  it('replaces an object with null without changing neighboring statements', () => {
    const source = '// @scene-id record\nconst record = { enabled: true }\nconst neighbor = 42\n'
    const result = applySceneSourceEdits(source, [
      { type: 'updateLiteral', id: 'record', value: null },
    ])
    expect(result.diagnostics).toEqual([])
    expect(result.applied).toBe(1)
    expect(result.source).toContain('const record = null')
    expect(result.source).toContain('const neighbor = 42')
  })
})
