// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { buildBakedVoxelGlbBlob } from '../bakedVoxelGlb.js'
import type { RendererVoxelLayer } from '../../types.js'

function bakedLayer(key: string, nodePath: string, value: number, cells: RendererVoxelLayer['cells']): RendererVoxelLayer {
  return {
    key,
    nodeId: '__baked__',
    nodePath,
    nodeName: nodePath.slice(1),
    value,
    cells,
    visible: true,
    updatedAt: 1,
    assetName: '',
  }
}

async function glbJson(blob: Blob): Promise<{
  meshes?: Array<{ name?: string }>
  materials?: Array<{
    name?: string
    pbrMetallicRoughness?: { baseColorFactor?: number[] }
  }>
  nodes?: Array<{
    name?: string
    matrix?: number[]
    extensions?: { EXT_mesh_gpu_instancing?: { attributes?: Record<string, number> } }
  }>
}> {
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.readAsArrayBuffer(blob)
  })
  const view = new DataView(buffer)
  const jsonLength = view.getUint32(12, true)
  const json = new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)).trim()
  return JSON.parse(json) as {
    meshes?: Array<{ name?: string }>
    materials?: Array<{ name?: string }>
  }
}

describe('baked voxel GLB export', () => {
  it('rejects an empty baked scene', async () => {
    await expect(buildBakedVoxelGlbBlob({})).rejects.toThrow('No baked voxel cells')
  })

  it('exports every baked layer as binary GLB voxel geometry', async () => {
    const blob = await buildBakedVoxelGlbBlob({
      'baked:/Floor': bakedLayer('baked:/Floor', '/Floor', 1, [{ x: 0, y: 0, z: 0 }]),
      'baked:/Object': bakedLayer('baked:/Object', '/Object', 2, [{ x: 1, y: 2, z: 3, state: { instanceId: 'tree' } }]),
    })

    expect(blob.type).toBe('model/gltf-binary')
    expect(blob.size).toBeGreaterThan(100)
    const json = await glbJson(blob)
    const meshNames = json.meshes?.map((mesh) => mesh.name) ?? []
    const materialNames = json.materials?.map((material) => material.name) ?? []
    expect(meshNames).toHaveLength(2)
    expect(materialNames).toHaveLength(2)
    expect(meshNames.every(Boolean)).toBe(true)
    expect(materialNames.every(Boolean)).toBe(true)
    expect(new Set(meshNames).size).toBe(meshNames.length)
    expect(new Set(materialNames).size).toBe(materialNames.length)
    expect(json.materials?.every((material) =>
      material.pbrMetallicRoughness?.baseColorFactor?.length === 4,
    )).toBe(true)
    expect(json.nodes?.every((node) =>
      node.extensions?.EXT_mesh_gpu_instancing?.attributes?._COLOR_0 === undefined,
    )).toBe(true)
    const axisMatrix = json.nodes?.find((node) => node.name === 'baked_voxel_scene_y_up')?.matrix
    expect(axisMatrix).toHaveLength(16)
    expect(axisMatrix?.[6]).toBeCloseTo(-1)
    expect(axisMatrix?.[9]).toBeCloseTo(1)
  })
})
