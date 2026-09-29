import { describe, expect, it } from 'vitest'

import { heightfield } from '../../batteries/Modeling/heightfield/heightfield/index.ts'
import { heightfieldMesh } from '../../batteries/Modeling/heightfield/heightfield_mesh/index.ts'
import { heightfieldSetMask } from '../../batteries/Modeling/heightfield/heightfield_set_mask/index.ts'
import { basePlane } from '../../batteries/Modeling/geometry2d/base_plane/index.ts'

function plane(origin: [number, number], width: number, height: number) {
  return basePlane({ origin, width, height }).geometry
}

describe('heightfieldMesh', () => {
  it('weaves plane + height into Geometry kind mesh and ignores mask holes', () => {
    const field = heightfield({
      geometry: plane([0, 0], 10, 8),
      height: [[0, 10], [20, 30]],
    })
    const woven = heightfieldMesh({ heightfield: field.heightfield })
    expect(woven.error).toBeUndefined()
    expect(woven.geometry?.kind).toBe('mesh')
    expect(woven.geometry?.role).toBe('terrain')
    expect(woven.geometry?.positions.length).toBe(27)
    expect(woven.geometry?.uvs?.length).toBe(18)
    expect(woven.geometry?.uvs?.[0]).toBeCloseTo(0, 5)
    expect(woven.geometry?.uvs?.[1]).toBeCloseTo(0, 5)
    expect(woven.geometry?.indices.length).toBe(24)
    expect(woven._warnings?.[0]?.code).toBe('SCENE_GRID_STRETCH')
    const zs = woven.geometry!.positions.filter((_, i) => i % 3 === 2)
    expect(Math.min(...zs)).toBeLessThanOrEqual(0)
    expect(Math.max(...zs)).toBeGreaterThanOrEqual(30)

    const marked = heightfieldSetMask({
      heightfield: field.heightfield,
      mask: [[1, 0], [0, 1]],
    })
    const stillSolid = heightfieldMesh({ heightfield: marked.heightfield })
    expect(stillSolid.geometry?.positions.length).toBe(27)
    expect(stillSolid.geometry?.indices.length).toBe(24)
  })

  it('rejects a missing packet', () => {
    expect(heightfieldMesh({}).error).toMatch(/Heightfield/)
  })

  it('does not warn stretch when plane aspect matches the lattice', () => {
    const field = heightfield({
      geometry: plane([0, 0], 10, 10),
      height: [[0, 10], [20, 30]],
    })
    const woven = heightfieldMesh({ heightfield: field.heightfield })
    expect(woven.error).toBeUndefined()
    expect(woven._warnings).toBeUndefined()
  })
})
