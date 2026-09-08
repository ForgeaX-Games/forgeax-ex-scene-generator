import { describe, it, expect } from 'vitest'
import {
  getAllowedAtlasSizes,
  validateTileAtlasDimensions,
} from '../src/library/tileRuleAtlasValidation.js'

describe('tileRuleAtlasValidation', () => {
  it('common_16 accepts its complete 64×320 production atlas', () => {
    expect(getAllowedAtlasSizes('common_16')).toEqual([
      { widthPx: 64, heightPx: 320 },
    ])
    expect(validateTileAtlasDimensions('common_16', 64, 320).ok).toBe(true)
    const bad = validateTileAtlasDimensions('common_16', 64, 64)
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toContain('64×320px')
  })

  it('floor_1 accepts only its complete 48×48 variant atlas', () => {
    expect(validateTileAtlasDimensions('floor_1', 48, 48).ok).toBe(true)
    expect(validateTileAtlasDimensions('floor_1', 32, 32).ok).toBe(false)
  })

  it('fence_7 accepts 64×32', () => {
    expect(validateTileAtlasDimensions('fence_7', 64, 32).ok).toBe(true)
    expect(validateTileAtlasDimensions('fence_7', 64, 64).ok).toBe(false)
  })

  it('slope_9 accepts 48×48', () => {
    expect(validateTileAtlasDimensions('slope_9', 48, 48).ok).toBe(true)
  })

  it('rejects unknown rules and missing dimensions', () => {
    expect(validateTileAtlasDimensions('not_a_rule', 64, 64).ok).toBe(false)
    expect(validateTileAtlasDimensions('common_16', undefined, 64).ok).toBe(false)
  })
})
