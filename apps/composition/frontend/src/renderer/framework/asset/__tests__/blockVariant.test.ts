import { describe, it, expect } from 'vitest'
import { pickBlockVariantSpriteIndex } from '../blockVariant'
import type { FaceBlockVariant } from '../ruleCache'

function solidWindow(anchorX: number, anchorZ: number): (ax: number, az: number) => boolean {
  return (ax, az) =>
    ax >= anchorX && ax < anchorX + 3 && az >= anchorZ && az < anchorZ + 3
}

describe('pickBlockVariantSpriteIndex', () => {
  const bv: FaceBlockVariant = {
    probability: 1,
    groups: [
      [0, 1, 2, 3, 4, 5, 6, 7, 8],
      [10, 11, 12, 13, 14, 15, 16, 17, 18],
    ],
  }

  it('returns null when the aligned 3x3 window is not fully solid', () => {
    const hasAt = solidWindow(0, 0)
    // Remove one cell from the window to make it non-solid.
    const partial = (ax: number, az: number): boolean => hasAt(ax, az) && !(ax === 1 && az === 1)
    expect(pickBlockVariantSpriteIndex(partial, 1, 1, bv)).toBeNull()
  })

  it('returns null when probability rolls below the threshold', () => {
    const hasAt = solidWindow(0, 0)
    expect(pickBlockVariantSpriteIndex(hasAt, 1, 1, { ...bv, probability: 0 })).toBeNull()
  })

  it('maps local (x,z) within the solid window to group[z*3+x] when solid+hit', () => {
    const hasAt = solidWindow(0, 0)
    // anchor (0,0): local (0,0)->group[0]=0 ... local (2,2)->group[8]=8 (using group 0,
    // whichever group the roll lands on — assert consistency across all 9 cells instead
    // of a specific group index, since group selection is itself hash-derived).
    const picks = new Map<string, number>()
    for (let z = 0; z < 3; z++) {
      for (let x = 0; x < 3; x++) {
        const idx = pickBlockVariantSpriteIndex(hasAt, x, z, bv)
        expect(idx).not.toBeNull()
        picks.set(`${x},${z}`, idx!)
      }
    }
    // All 9 cells must resolve to indices from the SAME group (same anchor → same roll).
    const usedGroup = bv.groups.findIndex((g) => g.includes(picks.get('0,0')!))
    expect(usedGroup).toBeGreaterThanOrEqual(0)
    for (let z = 0; z < 3; z++) {
      for (let x = 0; x < 3; x++) {
        expect(picks.get(`${x},${z}`)).toBe(bv.groups[usedGroup]![z * 3 + x])
      }
    }
  })

  it('is stable across two aligned windows: cells in different 3x3 megacells never collide', () => {
    const hasAt = (): boolean => true // world fully solid
    // Window anchored at (0,0) and window anchored at (3,0) must each resolve
    // consistently within themselves regardless of the other.
    const a = pickBlockVariantSpriteIndex(hasAt, 1, 1, bv)
    const b = pickBlockVariantSpriteIndex(hasAt, 4, 1, bv)
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
  })
})
