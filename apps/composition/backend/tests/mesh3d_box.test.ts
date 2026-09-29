import { describe, expect, it } from 'vitest'

import { box } from '../../batteries/Modeling/geometry3d/box/index.ts'
import { placeOnGround } from '../../batteries/Modeling/pose/place_on_ground/index.ts'
import { transform } from '../../batteries/Modeling/pose/transform/index.ts'
import { heightfield } from '../../batteries/Modeling/heightfield/heightfield/index.ts'
import { basePlane } from '../../batteries/Modeling/geometry2d/base_plane/index.ts'
import { meshAabb, peelHangableMesh } from '../../vendor/shared/types/scene/mesh3d.ts'
import { sampleHeightfieldWorld } from '../../vendor/shared/types/scene/heightfieldField.ts'

function packet() {
  return heightfield({
    geometry: basePlane({ origin: [0, 0], width: 20, height: 20 }).geometry,
    height: [
      [0, 0],
      [10, 10],
    ],
  }).heightfield
}

describe('Modeling box construction and pose', () => {
  it('keeps the box in local metres with the origin at the floor centre', () => {
    const solid = peelHangableMesh(box({ width: 4, depth: 6, height: 3 }))
    expect(solid?.kind).toBe('mesh')
    const aabb = meshAabb(solid!.positions)
    expect(aabb).toEqual({ minX: -2, maxX: 2, minY: -3, maxY: 3, minZ: 0, maxZ: 3 })
    expect(box({ width: 0 }).error).toMatch(/positive/)
  })

  it('moves the local origin with transform and keeps the object upright', () => {
    const local = box({ width: 2, depth: 2, height: 4 }).geometry
    const posed = peelHangableMesh(transform({ geometry: local, x: 10, y: 8, z: 5, yaw: Math.PI / 2 }))
    const aabb = meshAabb(posed!.positions)!
    expect((aabb.minX + aabb.maxX) / 2).toBeCloseTo(10, 5)
    expect((aabb.minY + aabb.maxY) / 2).toBeCloseTo(8, 5)
    expect(aabb.minZ).toBeCloseTo(5, 5)
    expect(aabb.maxZ).toBeCloseTo(9, 5)
    expect(aabb.maxX - aabb.minX).toBeCloseTo(2, 5)
    expect(aabb.maxY - aabb.minY).toBeCloseTo(2, 5)
  })

  it('sits the mesh bottom on the same Heightfield sampleHeight reads', () => {
    const field = packet()!
    const x = 15
    const y = 15
    const z = sampleHeightfieldWorld(field, x, y)
    expect(z).toBeGreaterThan(0)
    const grounded = peelHangableMesh(placeOnGround({
      geometry: box({ width: 2, depth: 2, height: 3 }).geometry,
      heightfield: field,
      x,
      y,
    }))
    const aabb = meshAabb(grounded!.positions)!
    expect((aabb.minX + aabb.maxX) / 2).toBeCloseTo(x, 5)
    expect((aabb.minY + aabb.maxY) / 2).toBeCloseTo(y, 5)
    expect(aabb.minZ).toBeCloseTo(z!, 5)
    expect(aabb.maxZ).toBeCloseTo(z! + 3, 5)
  })

  it('rejects a site outside the Heightfield', () => {
    const field = packet()!
    expect(placeOnGround({
      geometry: box({ width: 1, depth: 1, height: 1 }).geometry,
      heightfield: field,
      x: -4,
      y: 2,
    }).error).toMatch(/outside/)
  })
})
