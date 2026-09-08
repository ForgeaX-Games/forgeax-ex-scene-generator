import { describe, expect, it } from 'vitest'
import { hashString, packFamilyStem, pickModelVariant } from './modelVariants'

const CATALOG = ['firtree1', 'firtree2', 'firtree3', 'firtree4', 'firtree5', 'firtree6']

const FULL_SEED = [
  'bushtree1', 'bushtree2',
  'firtree1', 'firtree3',
  'moss_rock1', 'rock1', 'rock2',
  'real_tree1',
  'realistic_hd_black_poplar_1',
  'realistic_hd_northern_red_oak_1',
  'realistic_high_poly_tree_1',
  'shrub_01_1', 'shrub_01_2', 'shrub_02_1',
  'shrub_sorrel_01_1', 'shrub_sorrel_01_2',
]

describe('packFamilyStem', () => {
  it('strips decorative prefixes and trailing numbers', () => {
    expect(packFamilyStem('realistic_hd_northern_red_oak_1')).toBe('northern_red_oak')
    expect(packFamilyStem('realistic_hd_black_poplar_1')).toBe('black_poplar')
    expect(packFamilyStem('realistic_high_poly_tree_1')).toBe('high_poly_tree')
    expect(packFamilyStem('real_tree1')).toBe('real_tree')
    expect(packFamilyStem('firtree4')).toBe('firtree')
    expect(packFamilyStem('shrub_01_3')).toBe('shrub')
    expect(packFamilyStem('shrub_sorrel_01_11')).toBe('shrub_sorrel')
  })
})

describe('pickModelVariant', () => {
  it('maps family stem to a numbered variant', () => {
    const a = pickModelVariant('firtree', 'inst_a', CATALOG)
    expect(CATALOG).toContain(a)
    expect(a).toMatch(/^firtree\d+$/)
  })

  it('maps clean shrub stem across series (shrub → shrub_01_N / shrub_02_N)', () => {
    const shrubs = ['shrub_01_1', 'shrub_01_2', 'shrub_02_1', 'shrub_sorrel_01_1']
    const a = pickModelVariant('shrub', 'inst_x', shrubs)
    expect(['shrub_01_1', 'shrub_01_2', 'shrub_02_1']).toContain(a)
    expect(a.startsWith('shrub_sorrel')).toBe(false)
  })

  it('maps shrub_sorrel without trailing series number', () => {
    const pool = ['shrub_sorrel_01_1', 'shrub_sorrel_01_2', 'shrub_01_1']
    const a = pickModelVariant('shrub_sorrel', 'inst_y', pool)
    expect(['shrub_sorrel_01_1', 'shrub_sorrel_01_2']).toContain(a)
  })

  it('is stable for the same instanceKey', () => {
    const a = pickModelVariant('firtree', 'layer|inst_42|firtree', CATALOG)
    const b = pickModelVariant('firtree', 'layer|inst_42|firtree', CATALOG)
    expect(a).toBe(b)
  })

  it('spreads across variants for different keys', () => {
    const picks = new Set(
      Array.from({ length: 40 }, (_, i) => pickModelVariant('firtree', `inst_${i}`, CATALOG)),
    )
    expect(picks.size).toBeGreaterThan(1)
  })

  it('keeps explicit variant names', () => {
    expect(pickModelVariant('firtree3', 'anything', CATALOG)).toBe('firtree3')
    expect(pickModelVariant('shrub_01_2', 'x', ['shrub_01_1', 'shrub_01_2'])).toBe('shrub_01_2')
  })

  it('maps all short stems for seed HD / real packs via derived family stem', () => {
    expect(pickModelVariant('northern_red_oak', 't1', FULL_SEED)).toBe('realistic_hd_northern_red_oak_1')
    expect(pickModelVariant('black_poplar', 't2', FULL_SEED)).toBe('realistic_hd_black_poplar_1')
    expect(pickModelVariant('high_poly_tree', 't3', FULL_SEED)).toBe('realistic_high_poly_tree_1')
    expect(pickModelVariant('real_tree', 't4', FULL_SEED)).toBe('real_tree1')
    expect(pickModelVariant('moss_rock', 't5', FULL_SEED)).toBe('moss_rock1')
    expect(['rock1', 'rock2', 'moss_rock1']).toContain(pickModelVariant('rock', 't6', FULL_SEED))
  })
})

describe('hashString', () => {
  it('is deterministic', () => {
    expect(hashString('abc')).toBe(hashString('abc'))
    expect(hashString('abc')).not.toBe(hashString('abd'))
  })
})
