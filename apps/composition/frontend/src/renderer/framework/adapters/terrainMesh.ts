import { decodeSurfaceTexture, projectSurfaceUvs, type SurfaceTexture } from '../../../../../vendor/dist/shared/types/scene/surfaceTexture.js'
// Terrain / road / house adapter: MeshLayer → THREE.Mesh (lit Standard).
// Shared by Default. Do not import this from a mode into another mode.

import * as THREE from 'three'
import type { MeshLayer } from '../../types'
import type { SurfaceAppearance } from '../../../../../vendor/dist/shared/types/scene/content'

const SELECT_EMISSIVE = 0x2f8f62

// Native standard shaders discard alpha <= cutoff; Three's color and shadow
// chunks use alpha < alphaTest. The next f32 threshold makes both comparisons
// identical, including fully opaque pixels at cutoff=1, without shader forks.
function previewAlphaTest(cutoff: number): number {
  const value = new Float32Array([cutoff])
  if (value[0]! <= 0) return 0
  const bits = new Uint32Array(value.buffer)
  bits[0] = bits[0]! + 1
  return value[0]!
}

function isRgbAttribute(value: unknown, vertexCount: number): value is ArrayLike<number> {
  return !!value
    && typeof value === 'object'
    && 'length' in value
    && Number((value as { length: unknown }).length) === vertexCount
}

function toColorAttribute(rgb: ArrayLike<number>): THREE.BufferAttribute {
  // Authored 0–1 albedo stays in working/linear space. Tagging sRGB here made
  // pines / water / roofs convert twice (sRGB→linear→ACES) and look grey.
  return new THREE.Float32BufferAttribute(rgb as number[], 3)
}

function surfaceTexture(source: SurfaceTexture): THREE.DataTexture {
  const texture = new THREE.DataTexture(decodeSurfaceTexture(source), source.width, source.height, THREE.RGBAFormat)
  texture.colorSpace = source.colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = 8
  texture.repeat.set(...(source.scale ?? [1, 1]))
  texture.needsUpdate = true
  return texture
}

function surfaceMaterial(
  entry: SurfaceAppearance,
  base: THREE.MeshStandardMaterialParameters,
): THREE.MeshStandardMaterial {
  const [r, g, b, alpha] = entry.baseColor
  const alphaCutoff = entry.alphaCutoff ?? 0
  const emissive = new THREE.Color(...(entry.emissive ?? [0, 0, 0]))
    .multiplyScalar(entry.emissiveIntensity ?? 1)
  if (base.emissiveIntensity) emissive.add(new THREE.Color(base.emissive).multiplyScalar(base.emissiveIntensity))
  const map = entry.baseColorTexture ? surfaceTexture(entry.baseColorTexture) : null
  const normalMap = entry.normalTexture ? surfaceTexture(entry.normalTexture) : null
  const mrMap = entry.metallicRoughnessTexture ? surfaceTexture(entry.metallicRoughnessTexture) : null
  const material = new THREE.MeshStandardMaterial({
    map, normalMap, roughnessMap: mrMap, metalnessMap: mrMap,
    ...base,
    color: new THREE.Color(r, g, b),
    roughness: entry.roughness ?? 0.85,
    metalness: entry.metallic ?? 0,
    emissive,
    emissiveIntensity: 1,
    opacity: (base.opacity ?? 1) * alpha,
    alphaTest: previewAlphaTest(alphaCutoff),
    transparent: Boolean(base.transparent) || (alphaCutoff <= 0 && alpha < 1),
    depthWrite: base.depthWrite !== false && (alphaCutoff > 0 || alpha === 1),
  })
  material.addEventListener('dispose', () => { map?.dispose(); normalMap?.dispose(); mrMap?.dispose() })
  return material
}

/** Use the native material slot partition without reordering authored surfaces. */
function applySurfacePalette(
  geom: THREE.BufferGeometry,
  mesh: MeshLayer['mesh'],
  base: THREE.MeshStandardMaterialParameters,
): THREE.Material | THREE.Material[] | null {
  const palette = mesh.material?.palette
  const runs = mesh.material?.runs
  if (palette?.length && runs?.length) {
    geom.clearGroups()
    for (const run of runs) geom.addGroup(run.indexOffset, run.indexCount, run.surface)
    return palette.map((entry) => surfaceMaterial(entry, base))
  }
  return mesh.material?.surface ? surfaceMaterial(mesh.material.surface, base) : null
}

export function buildTerrainSurfaceMesh(opts: {
  layer: MeshLayer
  wireframe: boolean
  selected?: boolean
}): THREE.Mesh | null {
  const { layer, wireframe, selected = false } = opts
  const { positions, indices, color, role } = layer.mesh
  if (!positions.length || !indices.length) return null

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions as number[], 3))
  geom.setIndex(indices as number[])
  if (layer.mesh.normals && layer.mesh.normals.length === positions.length) {
    geom.setAttribute('normal', new THREE.Float32BufferAttribute(layer.mesh.normals as number[], 3))
  } else {
    geom.computeVertexNormals()
  }
  const uv = layer.mesh.uvs ?? projectSurfaceUvs(positions, geom.getAttribute('normal').array)
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uv as number[], 2))
  const hasVertColors = isRgbAttribute(layer.mesh.colors, positions.length)
  const useVertexColors = hasVertColors
  if (hasVertColors) {
    geom.setAttribute('color', toColorAttribute(layer.mesh.colors!))
  }

  // Vertex colors are multiplied by material.color. A leftover uniform tint
  // (plaza beige, wood brown) washes red roofs / blue water / gold lanterns.
  // Lambert + flat shading matches the low-poly capture; Standard+ACES crushed chroma.
  const rgb = color ?? [0.82, 0.82, 0.8]
  const adsorb = role === 'road' || role === 'houses'
  const terrainOverlay = role === 'terrain'
  const overlayOpacity = 0.58
  const base: THREE.MeshStandardMaterialParameters = {
    flatShading: true,
    wireframe,
    transparent: wireframe || terrainOverlay,
    opacity: wireframe ? 0.55 : terrainOverlay ? overlayOpacity : 1,
    depthWrite: !wireframe,
    side: THREE.DoubleSide,
    emissive: selected ? SELECT_EMISSIVE : 0x000000,
    emissiveIntensity: selected ? 0.42 : 0,
    polygonOffset: adsorb,
    polygonOffsetFactor: adsorb ? -2 : 0,
    polygonOffsetUnits: adsorb ? -4 : 0,
    vertexColors: hasVertColors,
  }
  // Native Standard multiplies surface albedo and texture by authored vertex RGB.
  const painted = applySurfacePalette(geom, layer.mesh, base)
  const material: THREE.Material | THREE.Material[] = painted ?? new THREE.MeshLambertMaterial({
    ...base,
    color: useVertexColors ? 0xffffff : new THREE.Color(rgb[0], rgb[1], rgb[2]),
    vertexColors: useVertexColors,
  })
  const mesh = new THREE.Mesh(geom, material)
  mesh.name = `terrain:${layer.key}`
  mesh.userData = { layerKey: layer.key, nodeId: layer.nodeId, schema: role ?? 'terrain' }
  mesh.frustumCulled = false
  // Terrain overlay must not self-shadow: a sharpened Grid plus a diagonal
  // sun draws a second set of streaks that are not the lattice.
  // Generic Scene Script meshes (buildings, props) have no legacy role tag.
  // Only terrain/road overlays opt out of casting; native Pack meshes cast too.
  mesh.castShadow = role !== 'terrain' && role !== 'road'
  mesh.receiveShadow = true
  mesh.renderOrder = role === 'houses' ? 2 : role === 'road' ? 1 : 0

  if (selected) {
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geom, 28),
      new THREE.LineBasicMaterial({ color: 0x7dffb0, transparent: true, opacity: 0.85 }),
    )
    edges.name = `terrain-outline:${layer.key}`
    edges.raycast = () => {}
    mesh.add(edges)
  }
  return mesh
}

export function buildInstancedSurfaceMesh(opts: {
  layer: MeshLayer
  wireframe: boolean
  selected?: boolean
}): THREE.InstancedMesh | null {
  const { layer, wireframe, selected = false } = opts
  const instances = layer.instances
  if (!instances || instances.length === 0) return null
  const proto = buildTerrainSurfaceMesh({ layer: { ...layer, instances: undefined }, wireframe, selected })
  if (!proto) return null
  const instanced = new THREE.InstancedMesh(proto.geometry, proto.material, instances.length)
  instanced.name = `instances:${layer.key}`
  instanced.userData = { layerKey: layer.key, nodeId: layer.nodeId, schema: layer.mesh.role ?? 'houses' }
  instanced.frustumCulled = false
  instanced.castShadow = layer.mesh.role !== 'road'
  instanced.receiveShadow = true
  instanced.renderOrder = 2
  const matrix = new THREE.Matrix4()
  const quat = new THREE.Quaternion()
  const pos = new THREE.Vector3()
  const scale = new THREE.Vector3(1, 1, 1)
  for (let i = 0; i < instances.length; i++) {
    const inst = instances[i]!
    pos.set(inst.tx, -inst.ty, inst.tz)
    quat.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -inst.yaw)
    if (inst.matrix) {
      matrix.fromArray(inst.matrix)
      const flip = new THREE.Matrix4().makeScale(1, -1, 1)
      matrix.premultiply(flip).multiply(flip)
    } else matrix.compose(pos, quat, scale)
    instanced.setMatrixAt(i, matrix)
  }
  instanced.instanceMatrix.needsUpdate = true
  return instanced
}

export function disposeTerrainSurfaceMesh(mesh: THREE.Mesh): void {
  mesh.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
      child.geometry.dispose()
      const mat = child.material
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
      else mat.dispose()
    }
  })
}
