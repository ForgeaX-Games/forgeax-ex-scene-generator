import { describe, expect, it } from 'vitest'

import { bindMaterialOp, materialLookOp, previewSurfaceOp } from '../../../../batteries/scene/look/lib.js'

describe('material dialect', () => {
  it('paints a PreviewSurface look onto mesh colors while keeping a hint of existing kind tint', () => {
    const surface = previewSurfaceOp({ r: 0.3, g: 0.29, b: 0.28, roughness: 0.88, metallic: 0.02 }).surface
    const look = materialLookOp({ id: 'cobble', surface }).material
    const painted = bindMaterialOp({
      mesh: {
        positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
        indices: [0, 1, 2],
        colors: [0.66, 0.54, 0.36, 0.66, 0.54, 0.36, 0.66, 0.54, 0.36],
      },
      material: look,
    })
    expect(painted.error).toBeUndefined()
    expect(painted.mesh?.color).toEqual([0.3, 0.29, 0.28])
    expect(painted.mesh?.material).toEqual(look)
    expect(painted.mesh?.colors?.[0]).toBeCloseTo(0.66 * 0.28 + 0.3 * 0.72, 5)
    expect(painted.mesh?.colors?.[1]).toBeCloseTo(0.54 * 0.28 + 0.29 * 0.72, 5)
  })
})
