import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { BASE_CELL_SIZE } from '../../framework/geometry/constants'
import {
  buildTerrainMesh,
  disposeTerrainMesh,
  dominantAssetName,
  ownerTopZ,
  pushIsotropicQuad,
  TERRAIN_SUBDIV,
  terrainMeshStats,
} from './buildTerrainMesh'
import type { TileCellSample } from './surfaceOwner'

function s(
  x: number, y: number, z: number, layerIdx: number,
  value = layerIdx + 1, assetName = `Mat${layerIdx}`,
): TileCellSample {
  return { x, y, z, layerIdx, value, assetName, layerKey: `L${layerIdx}`, nodeId: `n${layerIdx}` }
}

describe('ownerTopZ', () => {
  it('maps voxel z to top-face world Z', () => {
    expect(ownerTopZ({ z: 0 })).toBe(BASE_CELL_SIZE)
    expect(ownerTopZ({ z: 2 })).toBe(3 * BASE_CELL_SIZE)
  })
})

describe('dominantAssetName', () => {
  it('returns assetName of globally dominant surface owner', () => {
    expect(dominantAssetName([
      s(0, 0, 0, 0, 1, 'Grass'),
      s(1, 0, 2, 1, 2, 'Rock'),
    ])).toBe('Rock')
  })
})

describe('pushIsotropicQuad', () => {
  it('picks the shorter 3D diagonal', () => {
    // Flat square → diagonals equal; either split is fine (stable: dA <= dB).
    const posFlat = [
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      1, 1, 0,
    ]
    const idx1: number[] = []
    pushIsotropicQuad(idx1, posFlat, 0, 1, 2, 3)
    expect(idx1).toEqual([0, 1, 3, 0, 3, 2])

    // Raise only 11 → diagonal 00—11 is longer → use 10—01.
    const posCliff = [
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      1, 1, 5,
    ]
    const idx2: number[] = []
    pushIsotropicQuad(idx2, posCliff, 0, 1, 2, 3)
    expect(idx2).toEqual([0, 1, 2, 1, 3, 2])
  })
})

describe('buildTerrainMesh', () => {
  it('returns null for empty samples', () => {
    expect(buildTerrainMesh({ samples: [], wireframe: false, colorMode: true })).toBeNull()
  })

  it('builds triangles and uvs for occupied cells', () => {
    const stats = terrainMeshStats([
      s(0, 0, 0, 0),
      s(1, 0, 0, 0),
      s(0, 1, 1, 0),
    ])
    expect(stats.ownerCount).toBe(3)
    // Each occupied cell → SUBDIV² micro-quads × 2 tris.
    expect(stats.triangleCount).toBe(3 * TERRAIN_SUBDIV * TERRAIN_SUBDIV * 2)
    expect(stats.vertexCount).toBeGreaterThan(0)

    const mesh = buildTerrainMesh({ samples: [s(0, 0, 0, 0)], wireframe: false, colorMode: true })
    expect(mesh!.geometry.getAttribute('uv')).toBeTruthy()
    disposeTerrainMesh(mesh!)
  })

  it('wireframe material flag is applied', () => {
    const mesh = buildTerrainMesh({ samples: [s(0, 0, 0, 0)], wireframe: true, colorMode: false })
    expect(mesh).not.toBeNull()
    const mat = mesh!.material as THREE.MeshLambertMaterial
    expect(mat.wireframe).toBe(true)
    disposeTerrainMesh(mesh!)
  })
})
