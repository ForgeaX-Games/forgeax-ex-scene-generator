import { describe, expect, it } from 'vitest'

import { applyWorldXformToPositions, authoringToRendererXY } from '../sceneWorldXform'

describe('authoring ↔ renderer frame', () => {
  it('keeps Geometry in authoring metres and flips Y only for the viewport', () => {
    expect(authoringToRendererXY(1185, 1612)).toEqual({ x: 1185, y: -1612 })
    const moved = applyWorldXformToPositions(
      [0, 0, 0],
      { tx: 1185, ty: 1612, tz: 4.5, yaw: 0 },
    )
    expect(moved).toEqual([1185, -1612, 4.5])
  })

  it('flips identity meshes so hand-built Geometry matches authoring +Y on screen', () => {
    expect(applyWorldXformToPositions([10, 40, 2], { tx: 0, ty: 0, tz: 0, yaw: 0 })).toEqual([10, -40, 2])
  })
})
