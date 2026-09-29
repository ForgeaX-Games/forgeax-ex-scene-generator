import { describe, expect, it } from 'vitest'
import { pickFaceSpriteIndex, type PickFaceContext } from './pickFaceSprite'
import type { FaceRule } from '../../../framework/asset/ruleCache'
import type { CollectedCell } from './types'

/**
 * Regression for the `cellRng` salt-correlation bug: the "keep base tile?"
 * roll (saltBase) and the "which variant?" roll (saltBase+1) for the SAME
 * (x,y) used to be `h1 = h0 xor constant` — a deterministic function of each
 * other, not independent draws. Conditioning on the keep-roll's range (e.g.
 * `keepProbability`) then deterministically confined the variant-roll to a
 * sub-range, so high-weight (or even entire) variant slots could never be
 * picked (simple_common_16's `4:2:2:2` weights on tile 6: idx with weight 4
 * was selected 0% of the time, not ~40%). See CHANGELOG for the write-up.
 */
function faceWith(randomRules: FaceRule['randomRules']): FaceRule {
  return {
    basePieces: 16,
    map: { '1,1,1,1': 6 },
    variantIdxs: [16, 17, 18, 19],
    variantWeights: [4, 2, 2, 2],
    randomRules,
  }
}

function fullyEnclosedCtx(face: FaceRule, x: number, y: number): PickFaceContext {
  const cell: CollectedCell = { layerIdx: 0, x, y, z: 0 }
  const layerSet = new Set<string>()
  for (const [dx, dy] of [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
    layerSet.add(`${x + dx},${y + dy},0`)
  }
  return {
    face,
    faceTag: 'top',
    sprites: Array.from({ length: 20 }, () => ({ x: 0, y: 0, w: 16, h: 16 })),
    validVariantIdxs: face.variantIdxs ?? [],
    validVariantWeights: face.variantWeights,
    cell,
    coordsByLayerIdx: new Map([[0, layerSet]]),
    regions: new Map(),
  }
}

describe('pickFaceSpriteIndex — weighted variant sampling over many cells', () => {
  it('reaches every weighted variant idx, roughly matching the declared weights', () => {
    const face = faceWith([{ tileId: 6, keepProbability: 0.6 }])
    const counts = new Map<number, number>()
    for (let x = 0; x < 300; x++) {
      for (let y = 0; y < 300; y++) {
        const idx = pickFaceSpriteIndex(fullyEnclosedCtx(face, x, y))
        counts.set(idx, (counts.get(idx) ?? 0) + 1)
      }
    }
    const total = 300 * 300
    // Base tile kept ~60% of the time (keepProbability).
    expect(counts.get(6)! / total).toBeGreaterThan(0.55)
    expect(counts.get(6)! / total).toBeLessThan(0.65)
    // Every declared variant idx must be reachable — the bug made idx 16
    // (the highest-weighted slot) unreachable (0 picks) no matter the sample size.
    const substituted = total - counts.get(6)!
    for (const [idx, weight] of [[16, 4], [17, 2], [18, 2], [19, 2]] as const) {
      const share = (counts.get(idx) ?? 0) / substituted
      const expected = weight / 10
      expect(share).toBeGreaterThan(expected * 0.7)
      expect(share).toBeLessThan(expected * 1.3)
    }
  })

  it('keepProbability roll and variant-pick roll are not correlated for other thresholds', () => {
    for (const keepProbability of [0.3, 0.5, 0.7]) {
      const face = faceWith([{ tileId: 6, keepProbability }])
      const seen = new Set<number>()
      for (let x = 0; x < 150; x++) {
        for (let y = 0; y < 150; y++) {
          seen.add(pickFaceSpriteIndex(fullyEnclosedCtx(face, x, y)))
        }
      }
      // All 4 variant idxs + the kept base idx must show up regardless of keepProbability.
      expect(seen).toEqual(new Set([6, 16, 17, 18, 19]))
    }
  })
})
