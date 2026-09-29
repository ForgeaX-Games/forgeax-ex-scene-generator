import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { BASE_CELL_SIZE } from '../../framework/geometry/constants'
import { normalizeTemplate } from './loadObjectModel'

describe('normalizeTemplate', () => {
  it('puts bbox bottom-center at local origin (feet on z=0)', () => {
    // Centered Y-up "tree": origin at centroid, like firtree GLBs.
    const geo = new THREE.BoxGeometry(2, 10, 2)
    const mesh = new THREE.Mesh(geo)
    const scene = new THREE.Group()
    scene.add(mesh)

    const root = normalizeTemplate(scene, 4)
    expect(root.position.x).toBeCloseTo(0)
    expect(root.position.y).toBeCloseTo(0)
    expect(root.position.z).toBeCloseTo(0)
    expect(root.scale.x).toBeCloseTo(1)

    root.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(root)
    expect(box.min.z).toBeCloseTo(0, 3)
    expect(box.max.z).toBeCloseTo(4 * BASE_CELL_SIZE, 2)
    const c = box.getCenter(new THREE.Vector3())
    expect(c.x).toBeCloseTo(0, 3)
    expect(c.y).toBeCloseTo(0, 3)
  })
})
