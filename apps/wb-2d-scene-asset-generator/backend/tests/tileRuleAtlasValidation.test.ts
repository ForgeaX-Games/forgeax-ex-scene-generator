import { describe, it, expect } from 'vitest'
import { validateTileAtlasDimensions } from '../src/library/tileRuleAtlasValidation.js'

describe('tileRuleAtlasValidation (2d)', () => {
  it('common_16 accepts 64×64 and 64×80', () => {
    expect(validateTileAtlasDimensions('common_16', 64, 64).ok).toBe(true)
    expect(validateTileAtlasDimensions('common_16', 64, 80).ok).toBe(true)
    expect(validateTileAtlasDimensions('common_16', 64, 72).ok).toBe(false)
  })

  it('floor_1 accepts only 16×16', () => {
    expect(validateTileAtlasDimensions('floor_1', 16, 16).ok).toBe(true)
    expect(validateTileAtlasDimensions('floor_1', 64, 64).ok).toBe(false)
  })
})
