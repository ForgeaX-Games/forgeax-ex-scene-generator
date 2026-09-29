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
  it('renders textured cutouts with depth and shadows while retaining wireframe state', () => {
    for (const wireframe of [false, true]) {
      const mesh = buildTerrainSurfaceMesh({ wireframe, layer: layer({
        positions: [0,0,0, 1,0,0, 0,1,0], indices: [0,1,2], uvs: [0,0, 1,0, 0,1],
        material: { surface: { baseColor: [1,1,1,.8], alphaCutoff: .5,
          baseColorTexture: { width: 1, height: 1, rgba8: '////gA==', colorSpace: 'srgb' } } },
      }) })!
      const material = mesh.material as THREE.MeshStandardMaterial
      expect(material.alphaTest).toBe(.5000000596046448)
      expect(material.depthWrite).toBe(!wireframe)
      expect(material.transparent).toBe(wireframe)
      expect((material.map!.image as { data: Uint8Array }).data[3]).toBe(128)
      expect(mesh.castShadow).toBe(true)
      disposeTerrainSurfaceMesh(mesh)
    }
  })
  it('matches native inclusive cutoff at one while zero remains disabled', () => {
    for (const alphaCutoff of [0, 1]) {
      const mesh = buildTerrainSurfaceMesh({ wireframe: false, layer: layer({
        positions: [0,0,0, 1,0,0, 0,1,0], indices: [0,1,2],
        material: { surface: { baseColor: [1,1,1,1], alphaCutoff } },
      }) })!
      const material = mesh.material as THREE.MeshStandardMaterial
      if (alphaCutoff === 0) expect(material.alphaTest).toBe(0)
      else expect(Math.fround(1) < Math.fround(material.alphaTest)).toBe(true)
      disposeTerrainSurfaceMesh(mesh)
    }
  })
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

  it('does not invent isoline tints or self-shadow a terrain overlay', () => {
    const mesh = buildTerrainSurfaceMesh({
      layer: layer({
        positions: [0, 0, 0, 1, 0, 0, 0, -1, 2],
        indices: [0, 1, 2],
        color: [0.34, 0.52, 0.28],
      }, 'terrain'),
      wireframe: false,
    })
    expect(mesh).not.toBeNull()
    const mat = mesh!.material as THREE.MeshLambertMaterial
    expect(mat.vertexColors).toBe(false)
    expect(mesh!.geometry.getAttribute('color')).toBeUndefined()
    expect(mesh!.castShadow).toBe(false)
    expect(mesh!.receiveShadow).toBe(true)
    expect(mat.transparent).toBe(true)
    expect(mat.opacity).toBeCloseTo(0.58)
    disposeTerrainSurfaceMesh(mesh!)
  })

  it('lets houses cast onto terrain', () => {
    const mesh = buildTerrainSurfaceMesh({
      layer: layer({
        positions: [0, 0, 0, 1, 0, 0, 0, -1, 0],
        indices: [0, 1, 2],
        color: [0.96, 0.96, 0.94],
      }, 'houses'),
      wireframe: false,
    })
    expect(mesh!.castShadow).toBe(true)
    const mat = mesh!.material as THREE.MeshLambertMaterial
    expect(mat.transparent).toBe(false)
    expect(mat.opacity).toBe(1)
    disposeTerrainSurfaceMesh(mesh!)
  })
})

/**
 * The viewport has to agree with the exported pack, and both read the same baked
 * partition: `paintSurface` grouped the index buffer once, so a THREE group and an
 * engine submesh are the same range. Anything that re-derives the split here would
 * be a second implementation free to drift.
 */
describe('buildTerrainSurfaceMesh materials', () => {
  it('casts shadows for ordinary authored meshes without a legacy house role', () => {
    const source = layer({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 1], indices: [0, 1, 2] })
    const { role: _role, ...geometry } = source.mesh
    const mesh = buildTerrainSurfaceMesh({ layer: { ...source, mesh: geometry }, wireframe: false })!
    expect(mesh.castShadow).toBe(true)
    disposeTerrainSurfaceMesh(mesh)
  })

  const PAINTED = {
    positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 10, 1, 0, 10, 1, 1, 10],
    indices: [0, 1, 2, 3, 4, 5],
    material: {
      id: 'alpine',
      palette: [
        { baseColor: [0.4, 0.38, 0.36, 1], roughness: 0.94 },
        { baseColor: [0.93, 0.95, 0.98, 1], roughness: 0.32 },
      ],
      runs: [
        { surface: 0, indexOffset: 0, indexCount: 3 },
        { surface: 1, indexOffset: 3, indexCount: 3 },
      ],
    },
  } as const

  it('draws one group per palette entry, index-aligned with the material array', () => {
    const mesh = buildTerrainSurfaceMesh({ layer: layer(PAINTED), wireframe: false })
    expect(mesh).not.toBeNull()
    const materials = mesh!.material as THREE.MeshStandardMaterial[]
    expect(Array.isArray(materials)).toBe(true)
    expect(materials).toHaveLength(2)
    expect(mesh!.geometry.groups).toEqual([
      { start: 0, count: 3, materialIndex: 0 },
      { start: 3, count: 3, materialIndex: 1 },
    ])
    // Authored 0–1 albedo stays linear, same rule as the vertex-colour path.
    expect(materials[0]!.color.getHex()).toBe(new THREE.Color(0.4, 0.38, 0.36).getHex())
    expect(materials[1]!.color.getHex()).toBe(new THREE.Color(0.93, 0.95, 0.98).getHex())
    expect(materials[0]!.vertexColors).toBe(false)
    expect(materials[0]!.isMeshStandardMaterial).toBe(true)
    expect(materials[0]!.roughness).toBeCloseTo(0.94)
    expect(materials[1]!.roughness).toBeCloseTo(0.32)
    disposeTerrainSurfaceMesh(mesh!)
  })

  it('falls back to the vertex-colour path when the mesh carries no partition', () => {
    const mesh = buildTerrainSurfaceMesh({
      layer: layer({ positions: [0, 0, 0, 1, 0, 0, 0, -1, 0], indices: [0, 1, 2], colors: [1, 0, 0, 0, 1, 0, 0, 0, 1] }),
      wireframe: false,
    })
    expect(Array.isArray(mesh!.material)).toBe(false)
    expect((mesh!.material as THREE.MeshLambertMaterial).vertexColors).toBe(true)
    disposeTerrainSurfaceMesh(mesh!)
  })
})


describe('authored surface channels', () => {
  const geometry = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] }
  it('combines vertex RGB with constant and palette surfaces, including textures', () => {
    const surface = {
      baseColor: [0.8, 0.6, 0.4, 1] as const, roughness: 0.72, metallic: 0.15,
      baseColorTexture: { width: 1, height: 1, rgba8: '/////w==', colorSpace: 'srgb' as const },
    }
    for (const material of [
      { surface },
      { palette: [surface], runs: [{ surface: 0, indexOffset: 0, indexCount: 3 }] },
    ]) {
      const mesh = buildTerrainSurfaceMesh({ layer: layer({
        ...geometry, colors: [1, 0, 0, 0, 1, 0, 0, 0, 1], material,
      }), wireframe: false })!
      const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[]
      for (const rendered of materials) {
        expect(rendered.vertexColors).toBe(true)
        expect(rendered.color.toArray()).toEqual([0.8, 0.6, 0.4])
        expect(rendered.roughness).toBe(0.72)
        expect(rendered.metalness).toBe(0.15)
        expect(rendered.map?.colorSpace).toBe(THREE.SRGBColorSpace)
      }
      expect([...mesh.geometry.getAttribute('color').array]).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1])
      disposeTerrainSurfaceMesh(mesh)
    }
  })
  it('renders a constant surface including metalness, emission and alpha', () => {
    const mesh = buildTerrainSurfaceMesh({ layer: layer({ ...geometry, material: { surface: {
      baseColor: [0.2, 0.3, 0.4, 0.6], roughness: 0.12, metallic: 0.7,
      emissive: [0.1, 0.2, 0.3], emissiveIntensity: 2,
    } } }), wireframe: false })!
    const mat = mesh.material as THREE.MeshStandardMaterial
    expect(mat.isMeshStandardMaterial).toBe(true)
    expect(mat.roughness).toBe(0.12)
    expect(mat.metalness).toBe(0.7)
    expect(mat.opacity).toBe(0.6)
    expect(mat.transparent).toBe(true)
    expect(mat.depthWrite).toBe(false)
    expect(mat.emissive.toArray()).toEqual([0.2, 0.4, 0.6])
    disposeTerrainSurfaceMesh(mesh)
  })
  it('uses run.surface rather than the order of a run', () => {
    const mesh = buildTerrainSurfaceMesh({ layer: layer({ ...geometry, indices: [0, 1, 2, 0, 1, 2], material: {
      palette: [{ baseColor: [1, 0, 0, 1] }, { baseColor: [0, 1, 0, 1] }],
      runs: [{ surface: 1, indexOffset: 0, indexCount: 3 }, { surface: 1, indexOffset: 3, indexCount: 3 }],
    } }), wireframe: false })!
    expect(mesh.geometry.groups.map(group => group.materialIndex)).toEqual([1, 1])
    expect((mesh.material as THREE.MeshStandardMaterial[])[1]!.color.g).toBe(1)
    disposeTerrainSurfaceMesh(mesh)
  })
})

it('preserves procedural pixel data and metre UVs, and releases textures with the mesh', () => {
  const mesh=buildTerrainSurfaceMesh({layer:layer({
    positions:[0,0,0,2,0,0,0,0,3],normals:[0,-1,0,0,-1,0,0,-1,0],indices:[0,1,2],
    material:{surface:{baseColor:[1,1,1,1],normalTexture:{width:1,height:1,rgba8:'gID//w==',colorSpace:'linear',scale:[2,3]}}},
  }),wireframe:false})!
  const material=mesh.material as THREE.MeshStandardMaterial
  const texture=material.normalMap as THREE.DataTexture
  expect([...texture.image.data as Uint8Array]).toEqual([128,128,255,255])
  expect(texture.repeat.toArray()).toEqual([2,3])
  expect(texture.colorSpace).toBe(THREE.NoColorSpace)
  expect([...mesh.geometry.getAttribute('uv').array]).toEqual([0,0,2,0,0,3])
  let releases=0;texture.addEventListener('dispose',()=>releases++)
  disposeTerrainSurfaceMesh(mesh)
  expect(releases).toBe(1)
})
