import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { BASE_CELL_SIZE } from '../../framework/geometry/constants'
import type { GridLayer } from '../../types'
import {
  buildGridHeightMesh,
  disposeGridHeightMesh,
  getGridHeightMeshStats,
} from './buildGridHeightMesh'

function grid(data: number[][]): GridLayer {
  return {
    key: 'noise:grid',
    nodeId: 'noise',
    portName: 'grid',
    nodeName: 'Noise',
    data,
    rows: data.length,
    cols: Math.max(0, ...data.map((row) => row.length)),
    outputType: 'grid',
    visible: true,
    updatedAt: 1,
  }
}

describe('buildGridHeightMesh', () => {
  it('keeps zero values and greedily merges an all-zero plane', () => {
    const mesh = buildGridHeightMesh({
      layer: grid([[0, 0], [0, 0]]),
      wireframe: false,
    })
    expect(mesh).not.toBeNull()
    expect(getGridHeightMeshStats(mesh!)).toEqual({
      cellCount: 4,
      topQuadCount: 1,
      sideQuadCount: 0,
      vertexCount: 4,
      triangleCount: 2,
    })
    const positions = mesh!.geometry.getAttribute('position')
    for (let i = 0; i < positions.count; i++) expect(positions.getZ(i)).toBe(0)
    disposeGridHeightMesh(mesh!)
  })

  it('preserves negative Z samples and emits boundary skirts to z=0', () => {
    const mesh = buildGridHeightMesh({
      layer: grid([[-2]]),
      wireframe: false,
    })
    expect(mesh).not.toBeNull()
    const positions = mesh!.geometry.getAttribute('position')
    const zs = Array.from({ length: positions.count }, (_, i) => positions.getZ(i))
    expect(Math.min(...zs)).toBe(-2 * BASE_CELL_SIZE)
    expect(Math.max(...zs)).toBe(0)
    expect(getGridHeightMeshStats(mesh!)).toMatchObject({
      cellCount: 1,
      topQuadCount: 1,
      sideQuadCount: 4,
      triangleCount: 10,
    })
    disposeGridHeightMesh(mesh!)
  })

  it('emits only the shared height difference between adjacent samples', () => {
    const mesh = buildGridHeightMesh({
      layer: grid([[2, 1]]),
      wireframe: false,
      cellSize: 1,
      heightScale: 1,
    })
    expect(mesh).not.toBeNull()

    const positions = mesh!.geometry.getAttribute('position')
    const normals = mesh!.geometry.getAttribute('normal')
    // Grid cell coordinates map directly to metre coordinates: the shared
    // boundary after column 0 is x=1m, not the content-centred origin.
    const internalX = 1
    const internalWallZ: number[] = []
    for (let i = 0; i < positions.count; i++) {
      if (positions.getX(i) === internalX && Math.abs(normals.getX(i)) === 1) {
        internalWallZ.push(positions.getZ(i))
      }
    }
    expect(internalWallZ).toEqual([1, 1, 2, 2])
    disposeGridHeightMesh(mesh!)
  })

  it('merges a large equal-height platform into one top and four side quads', () => {
    const layer = grid(Array.from({ length: 20 }, () => Array(30).fill(3) as number[]))
    const mesh = buildGridHeightMesh({ layer, wireframe: false })
    expect(mesh).not.toBeNull()
    expect(getGridHeightMeshStats(mesh!)).toMatchObject({
      cellCount: 600,
      topQuadCount: 1,
      sideQuadCount: 4,
      triangleCount: 10,
    })
    disposeGridHeightMesh(mesh!)
  })

  it('uses one mesh and applies wireframe mode', () => {
    const mesh = buildGridHeightMesh({
      layer: grid([[0, 1], [-1, 2]]),
      wireframe: true,
    })
    expect(mesh).toBeInstanceOf(THREE.Mesh)
    expect((mesh!.material as THREE.MeshLambertMaterial).wireframe).toBe(true)
    disposeGridHeightMesh(mesh!)
  })

  it('returns null for invisible or dimensionless layers', () => {
    expect(buildGridHeightMesh({
      layer: { ...grid([[1]]), visible: false },
      wireframe: false,
    })).toBeNull()
    expect(buildGridHeightMesh({
      layer: grid([]),
      wireframe: false,
    })).toBeNull()
  })
})
