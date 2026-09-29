import { describe, expect, it } from 'vitest'

import {
  dictEditorSeed,
  formatJsonLiteral,
  isDictPortType,
  isPlainJsonValue,
  parseJsonLiteral,
} from '../utils/jsonLiteral.js'

describe('jsonLiteral', () => {
  it('treats json as the same canvas type as dict', () => {
    expect(isDictPortType('dict')).toBe(true)
    expect(isDictPortType('json')).toBe(true)
    expect(isDictPortType('JSON')).toBe(true)
    expect(isDictPortType('any')).toBe(false)
  })

  it('pretty-prints and rejects invalid JSON', () => {
    expect(formatJsonLiteral([{ from: 0, to: 1 }])).toBe('[\n  {\n    "from": 0,\n    "to": 1\n  }\n]')
    expect(parseJsonLiteral('[{ "from": 0, "to": 2 }]')).toEqual({
      ok: true,
      value: [{ from: 0, to: 2 }],
    })
    expect(parseJsonLiteral('{ from: 0 }').ok).toBe(false)
    expect(parseJsonLiteral('').ok).toBe(false)
  })

  it('keeps geometry and empty seeds out of the editor value', () => {
    expect(isPlainJsonValue({ from: 0, to: 1 })).toBe(true)
    expect(isPlainJsonValue({ kind: 'polyline', points: [[0, 0], [1, 0]] })).toBe(false)
    expect(dictEditorSeed(undefined, [{ from: 0, to: 1 }], 'list')).toEqual([{ from: 0, to: 1 }])
    expect(dictEditorSeed(undefined, undefined, 'list')).toEqual([])
    expect(dictEditorSeed(undefined, undefined, 'item')).toEqual({})
  })
})
