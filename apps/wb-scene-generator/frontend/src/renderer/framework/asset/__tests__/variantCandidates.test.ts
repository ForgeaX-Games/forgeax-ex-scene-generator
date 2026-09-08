import { describe, expect, it } from 'vitest'
import {
  MIN_VISIBLE_PIXELS,
  computeValidVariantIdxsByTileId,
  computeValidVariantPool,
  faceForRandomRulePool,
  pickWeightedVariant,
  spriteHasVisiblePixel,
} from '../variantCandidates'
import type { FaceRule, RandomRule } from '../ruleCache'

const sprites = [
  { x: 0, y: 0, w: 16, h: 16 },
  { x: 16, y: 0, w: 16, h: 16 },
  { x: 32, y: 0, w: 16, h: 16 },
  { x: 48, y: 0, w: 16, h: 16 },
]

describe('computeValidVariantIdxsByTileId', () => {
  it('builds separate pools when randomRules declare per-tileId variantIdxs', () => {
    const face: FaceRule = {
      basePieces: 2,
      map: { '*,*,*,*': 0 },
      variantIdxs: [2, 3],
      randomRules: [
        { tileId: 0, keepProbability: 0.5, variantIdxs: [2] },
        { tileId: 1, keepProbability: 0.5, variantIdxs: [3] },
      ],
    }
    const byTile = computeValidVariantIdxsByTileId(face, sprites, null)
    expect(byTile.get(0)).toEqual([2])
    expect(byTile.get(1)).toEqual([3])
  })

  it('falls back to face pool for entries without variantIdxs', () => {
    const face: FaceRule = {
      basePieces: 1,
      map: { '*,*,*,*': 0 },
      variantIdxs: [2, 3],
      randomRules: [{ tileId: 0, keepProbability: 0.5 }],
    }
    const byTile = computeValidVariantIdxsByTileId(face, sprites, null)
    expect(byTile.get(0)).toEqual([2, 3])
  })
})

describe('computeValidVariantPool', () => {
  it('keeps variantWeights aligned with variantIdxs after pixel filter', () => {
    const face: FaceRule = {
      basePieces: 2,
      map: { '*,*,*,*': 0 },
      variantIdxs: [2, 3],
      variantWeights: [4, 2],
    }
    const pool = computeValidVariantPool(face, sprites, null)
    expect(pool.idxs).toEqual([2, 3])
    expect(pool.weights).toEqual([4, 2])
  })
})

describe('spriteHasVisiblePixel', () => {
  /** 64×16 RGBA sheet with `count` opaque pixels inside the 16px slot at `slotX`. */
  const sheetWith = (slotX: number, count: number) => {
    const width = 64, height = 16
    const data = new Uint8Array(width * height * 4)
    for (let n = 0; n < count; n++) {
      const i = ((Math.floor(n / 16) * width) + slotX + (n % 16)) * 4
      data[i + 3] = 255
    }
    return { width, height, data }
  }

  it('rejects slots below the noise threshold', () => {
    expect(spriteHasVisiblePixel(sheetWith(16, 0), sprites[1]!)).toBe(false)
    expect(spriteHasVisiblePixel(sheetWith(16, MIN_VISIBLE_PIXELS - 1), sprites[1]!)).toBe(false)
  })

  it('accepts slots at or above the noise threshold', () => {
    expect(spriteHasVisiblePixel(sheetWith(16, MIN_VISIBLE_PIXELS), sprites[1]!)).toBe(true)
  })

  it('drops sub-threshold variants from the pool', () => {
    const face: FaceRule = { basePieces: 1, map: { '*,*,*,*': 0 }, variantIdxs: [1, 2] }
    expect(computeValidVariantPool(face, sprites, sheetWith(32, 8)).idxs).toEqual([2])
  })
})

describe('pickWeightedVariant', () => {
  it('samples uniformly when weights are absent', () => {
    expect(pickWeightedVariant({ idxs: [2, 3] }, 0)).toBe(2)
    expect(pickWeightedVariant({ idxs: [2, 3] }, 0.5)).toBe(3)
  })

  it('respects variantWeights proportions', () => {
    const pool = { idxs: [16, 17, 18, 19], weights: [4, 2, 2, 2] }
    expect(pickWeightedVariant(pool, 0)).toBe(16)
    expect(pickWeightedVariant(pool, 0.39)).toBe(16)
    expect(pickWeightedVariant(pool, 0.41)).toBe(17)
    expect(pickWeightedVariant(pool, 0.59)).toBe(17)
    expect(pickWeightedVariant(pool, 0.61)).toBe(18)
    expect(pickWeightedVariant(pool, 0.79)).toBe(18)
    expect(pickWeightedVariant(pool, 0.81)).toBe(19)
  })
})

describe('faceForRandomRulePool', () => {
  it('overrides variantIdxs when the randomRule declares its own pool', () => {
    const face: FaceRule = { basePieces: 1, map: {}, variantIdxs: [2, 3] }
    const rule: RandomRule = { tileId: 6, keepProbability: 0.5, variantIdxs: [3] }
    expect(faceForRandomRulePool(face, rule).variantIdxs).toEqual([3])
  })

  it('carries variantWeights when the randomRule declares them', () => {
    const face: FaceRule = { basePieces: 1, map: {}, variantIdxs: [2, 3], variantWeights: [1, 1] }
    const rule: RandomRule = { tileId: 6, keepProbability: 0.5, variantIdxs: [3], variantWeights: [5] }
    expect(faceForRandomRulePool(face, rule).variantWeights).toEqual([5])
  })
})
