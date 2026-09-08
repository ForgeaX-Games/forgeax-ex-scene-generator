import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { MeshLayer } from '../../../types'
import { buildTerrainSurfaceMesh, disposeTerrainSurfaceMesh } from '../terrainMesh'

function layer(mesh: MeshLayer['mesh'], role: MeshLayer['mesh']['role'] = 'houses'): MeshLayer {
  return {
    key: 'props:mesh',
    nodeId: 'props',
    portName: 'mesh',
    nodeName: 'Props',
    mesh: { ...mesh, role },
    triangleCount: Math.floor(mesh.indices.length / 3),
    visible: true,
    updatedAt: 1,
  }
}

describe('buildTerrainSurfaceMesh vertex colors', () => {
  it('does not multiply vertex colors by the mesh uniform tint', () => {
    const mesh = buildTerrainSurfaceMesh({
      layer: layer({
        positions: [0, 0, 0, 1, 0, 0, 0, -1, 0],
        indices: [0, 1, 2],
        colors: [0.85, 0.32, 0.28, 0.28, 0.48, 0.78, 0.98, 0.88, 0.45],
        color: [0.62, 0.48, 0.34],
      }),
      wireframe: false,
    })
    expect(mesh).not.toBeNull()
    const mat = mesh!.material as THREE.MeshLambertMaterial
    expect(mat.vertexColors).toBe(true)
    expect(mat.color.getHex()).toBe(0xffffff)
    expect(mesh!.geometry.getAttribute('color').colorSpace).toBe(THREE.NoColorSpace)
    const attr = mesh!.geometry.getAttribute('color')
    expect(attr.getX(0)).toBeCloseTo(0.85)
    expect(attr.getY(0)).toBeCloseTo(0.32)
    expect(attr.getZ(0)).toBeCloseTo(0.28)
    expect(attr.getX(1)).toBeCloseTo(0.28)
    expect(attr.getY(1)).toBeCloseTo(0.48)
    expect(attr.getZ(1)).toBeCloseTo(0.78)
    disposeTerrainSurfaceMesh(mesh!)
  })

  it('keeps the uniform color when a house mesh has no vertex colors', () => {
    const mesh = buildTerrainSurfaceMesh({
      layer: layer({
        positions: [0, 0, 0, 1, 0, 0, 0, -1, 0],
        indices: [0, 1, 2],
        color: [0.96, 0.96, 0.94],
      }),
      wireframe: false,
    })
    expect(mesh).not.toBeNull()
    const mat = mesh!.material as THREE.MeshLambertMaterial
    expect(mat.vertexColors).toBe(false)
    expect(mat.color.r).toBeCloseTo(0.96)
    expect(mat.color.g).toBeCloseTo(0.96)
    expect(mat.color.b).toBeCloseTo(0.94)
    disposeTerrainSurfaceMesh(mesh!)
  })
})
