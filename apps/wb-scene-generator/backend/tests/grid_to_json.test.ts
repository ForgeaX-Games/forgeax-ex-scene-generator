import { describe, it, expect } from 'vitest'

import { gridToJson } from '../../batteries/basic/trans/grid_to_json/index.js'

describe('grid_to_json', () => {
  it('serializes grid to JSON string', () => {
    const grid = [
      [0, 2, 0],
      [1, 1, 1],
    ]
    const out = gridToJson({ grid })
    expect(out.error).toBe('')
    expect(out.json).toBe(JSON.stringify(grid))
    expect(JSON.parse(out.json as string)).toEqual(grid)
  })

  it('rejects invalid grid', () => {
    const out = gridToJson({ grid: [] })
    expect(out.json).toBe('')
    expect(out.error).toMatch(/required/)
  })
})
