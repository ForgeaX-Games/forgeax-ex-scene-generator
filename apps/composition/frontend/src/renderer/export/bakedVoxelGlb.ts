import * as THREE from 'three'
import { orderBakedKeysForRender } from '../framework/layerKeys.js'
import { buildVoxelMesh, disposeMesh } from '../framework/adapters/voxelMesh.js'
import { colorForValue } from '../framework/palette.js'
import type { RendererVoxelLayer } from '../types.js'

function gltfNodeName(raw: string): string {
  const normalized = raw
    .replace(/[^a-zA-Z0-9_-]+/gu, '_')
    .replace(/_+/gu, '_')
    .replace(/^_+|_+$/gu, '')
  return normalized || 'layer'
}

function stableNameSuffix(raw: string): string {
  let hash = 2166136261
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function disposeExportGroup(group: THREE.Group): void {
  group.traverse((child) => {
    if (child instanceof THREE.InstancedMesh) disposeMesh(child)
  })
  group.clear()
}

function nameAnonymousGlbMeshes(binary: ArrayBuffer): ArrayBuffer {
  const source = new Uint8Array(binary)
  const view = new DataView(binary)
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(16, true) !== 0x4e4f534a) return binary
  const jsonLength = view.getUint32(12, true)
  const json = JSON.parse(
    new TextDecoder().decode(source.subarray(20, 20 + jsonLength)).trim(),
  ) as {
    nodes?: Array<{ name?: string; mesh?: number }>
    meshes?: Array<{ name?: string }>
  }
  for (const node of json.nodes ?? []) {
    if (typeof node.mesh !== 'number' || !node.name) continue
    const mesh = json.meshes?.[node.mesh]
    if (mesh && !mesh.name) mesh.name = `${node.name}_mesh`
  }

  const encodedJson = new TextEncoder().encode(JSON.stringify(json))
  const paddedJsonLength = Math.ceil(encodedJson.length / 4) * 4
  const remainderOffset = 20 + jsonLength
  const remainder = source.subarray(remainderOffset)
  const result = new Uint8Array(20 + paddedJsonLength + remainder.length)
  result.set(source.subarray(0, 12), 0)
  const resultView = new DataView(result.buffer)
  resultView.setUint32(8, result.length, true)
  resultView.setUint32(12, paddedJsonLength, true)
  resultView.setUint32(16, 0x4e4f534a, true)
  result.set(encodedJson, 20)
  result.fill(0x20, 20 + encodedJson.length, 20 + paddedJsonLength)
  result.set(remainder, 20 + paddedJsonLength)
  return result.buffer
}

async function exportBinaryGlb(root: THREE.Object3D): Promise<Blob> {
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js')
  const binary = await new Promise<ArrayBuffer>((resolve, reject) => {
    new GLTFExporter().parse(
      root,
      (result) => {
        if (result instanceof ArrayBuffer) resolve(result)
        else reject(new Error('GLTF exporter returned JSON instead of binary GLB'))
      },
      reject,
      { binary: true, onlyVisible: true },
    )
  })
  return new Blob([nameAnonymousGlbMeshes(binary)], { type: 'model/gltf-binary' })
}

/**
 * Exports the current baked scene as a Z-up voxel GLB. Every baked cell becomes
 * a unit cube regardless of asset metadata, so object and tile layers retain
 * their authored sparse-voxel form instead of loading external model assets.
 */
export async function buildBakedVoxelGlbBlob(bakedLayers: Record<string, RendererVoxelLayer>): Promise<Blob> {
  const keys = orderBakedKeysForRender(Object.keys(bakedLayers))
  const root = new THREE.Group()
  root.name = 'baked_voxel_scene'
  const axisRoot = new THREE.Group()
  axisRoot.name = 'baked_voxel_scene_y_up'
  // Scene Generator is Z-up; the Editor's imported glTF scene is Y-up.
  // GLTFExporter serializes its input root as the scene, so this child carries
  // the conversion transform and remains present in the output node hierarchy.
  axisRoot.rotation.x = -Math.PI / 2
  root.add(axisRoot)
  let exportedCellCount = 0

  try {
    for (const key of keys) {
      const layer = bakedLayers[key]
      if (!layer?.cells.length) continue
      const mesh = buildVoxelMesh({
        layer,
        maxRows: 0,
        maxCols: 0,
        heightScale: 1,
        isSelected: false,
        colorMode: true,
        wireframe: false,
      })
      if (!mesh) continue
      const previewMaterial = mesh.material
      const semanticName = `${gltfNodeName(layer.nodePath || layer.nodeName || key)}_${stableNameSuffix(key)}`
      const rgba = colorForValue(layer.value, { selected: false })
      const exportMaterial = new THREE.MeshStandardMaterial({
        flatShading: true,
        color: new THREE.Color(rgba.r / 255, rgba.g / 255, rgba.b / 255),
        roughness: 0.9,
        metalness: 0,
      })
      exportMaterial.name = `voxel_material_${semanticName}`
      mesh.material = exportMaterial
      // The Editor's glTF importer reads EXT_mesh_gpu_instancing transforms but
      // not its _COLOR_0 attribute. Bake this layer's swatch into the PBR
      // material above instead of exporting colors that would be discarded.
      mesh.instanceColor = null
      if (Array.isArray(previewMaterial)) previewMaterial.forEach((material) => material.dispose())
      else previewMaterial.dispose()
      mesh.name = `voxel_${semanticName}`
      mesh.geometry.name = `voxel_geometry_${semanticName}`
      axisRoot.add(mesh)
      exportedCellCount += layer.cells.length
    }

    if (exportedCellCount === 0) {
      throw new Error('No baked voxel cells to export. Bake or create an editable layer first.')
    }
    return await exportBinaryGlb(root)
  } finally {
    disposeExportGroup(root)
  }
}
