// Terrain / road / house adapter: MeshLayer → THREE.Mesh (lit Standard).
// Shared by Default. Do not import this from a mode into another mode.

import * as THREE from 'three'
import type { MeshLayer } from '../../types'

const SELECT_EMISSIVE = 0x2f8f62

function isRgbAttribute(value: unknown, vertexCount: number): value is ArrayLike<number> {
  return !!value
    && typeof value === 'object'
    && 'length' in value
    && Number((value as { length: unknown }).length) === vertexCount
}

function toColorAttribute(rgb: ArrayLike<number>): THREE.BufferAttribute {
  // Authored 0–1 albedo stays in working/linear space. Tagging sRGB here made
  // pines / water / roofs convert twice (sRGB→linear→ACES) and look grey.
  const attr = new THREE.Float32BufferAttribute(rgb as number[], 3)
  attr.colorSpace = THREE.NoColorSpace
  return attr
}

function heightColors(positions: ArrayLike<number>): Float32Array {
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (let i = 2; i < positions.length; i += 3) {
    const z = positions[i]!
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  const span = Math.max(1e-4, maxZ - minZ)
  const colors = new Float32Array(positions.length)
  for (let i = 0; i < positions.length; i += 3) {
    const t = (positions[i + 2]! - minZ) / span
    const rgb = t < 0.34
      ? [0.28, 0.58, 0.20] as const
      : t < 0.52
        ? [0.40, 0.50, 0.26] as const
        : t < 0.76
          ? [0.72, 0.71, 0.68] as const
          : [0.95, 0.96, 0.98] as const
    colors[i] = rgb[0]
    colors[i + 1] = rgb[1]
    colors[i + 2] = rgb[2]
  }
  return colors
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
  const useHeightTint = (role ?? 'terrain') === 'terrain'
  const hasVertColors = isRgbAttribute(layer.mesh.colors, positions.length)
  const useVertexColors = hasVertColors || useHeightTint
  if (hasVertColors) {
    geom.setAttribute('color', toColorAttribute(layer.mesh.colors))
  } else if (useHeightTint) {
    geom.setAttribute('color', toColorAttribute(heightColors(positions)))
  }

  // Vertex colors are multiplied by material.color. A leftover uniform tint
  // (plaza beige, wood brown) washes red roofs / blue water / gold lanterns.
  // Lambert + flat shading matches the low-poly capture; Standard+ACES crushed chroma.
  const rgb = color ?? [0.82, 0.82, 0.8]
  const adsorb = role === 'road' || role === 'houses'
  const material = new THREE.MeshLambertMaterial({
    color: useVertexColors ? 0xffffff : new THREE.Color(rgb[0], rgb[1], rgb[2]),
    vertexColors: useVertexColors,
    flatShading: true,
    wireframe,
    transparent: wireframe,
    opacity: wireframe ? 0.55 : 1,
    side: THREE.DoubleSide,
    emissive: selected ? SELECT_EMISSIVE : 0x000000,
    emissiveIntensity: selected ? 0.42 : 0,
    polygonOffset: adsorb,
    polygonOffsetFactor: adsorb ? -2 : 0,
    polygonOffsetUnits: adsorb ? -4 : 0,
  })
  const mesh = new THREE.Mesh(geom, material)
  mesh.name = `terrain:${layer.key}`
  mesh.userData = { layerKey: layer.key, nodeId: layer.nodeId, schema: role ?? 'terrain' }
  mesh.frustumCulled = false
  mesh.castShadow = role !== 'road'
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
    matrix.compose(pos, quat, scale)
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
