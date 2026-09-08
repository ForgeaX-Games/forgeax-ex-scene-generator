import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createViewGuides3d, disposeViewGuides3d } from './guides3d'

describe('createViewGuides3d', () => {
  it('creates an XY grid and XYZ axes for a Z-up scene', () => {
    const guides = createViewGuides3d({ size: 80, divisions: 10, axisLength: 16 })
    const grid = guides.getObjectByName('xy-grid') as THREE.GridHelper
    const axes = guides.getObjectByName('xyz-axes') as THREE.AxesHelper

    expect(grid).toBeInstanceOf(THREE.GridHelper)
    expect(grid.rotation.x).toBeCloseTo(Math.PI / 2)
    expect(grid.position.z).toBeGreaterThan(0)
    expect(axes).toBeInstanceOf(THREE.AxesHelper)
    expect(new THREE.Box3().setFromObject(guides).isEmpty()).toBe(false)

    disposeViewGuides3d(guides)
    expect(guides.children).toHaveLength(0)
  })
})
