import { describe, expect, it } from 'vitest'

import { applyWorldXformToPositions, authoringToRendererXY } from '../sceneWorldXform'

describe('authoring ↔ renderer frame', () => {
  it('flips authoring +Y once onto the same frame as heightfield vertices', () => {
    expect(authoringToRendererXY(1185, 1612)).toEqual({ x: 1185, y: -1612 })
    const moved = applyWorldXformToPositions(
      [0, 0, 0],
      { tx: 1185, ty: 1612, tz: 4.5, yaw: 0 },
    )
    expect(moved).toEqual([1185, -1612, 4.5])
  })
})
