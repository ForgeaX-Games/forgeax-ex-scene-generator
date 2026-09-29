import { describe, expect, it } from 'vitest'
import { buildGlbBuffer, type GlbMeshInput } from '../src/export/glbBuilder.js'

describe('glbBuilder', () => {
  it('builds a valid glTF 2.0 binary (.glb) buffer from a single mesh', () => {
    const mesh: GlbMeshInput = {
      name: 'ground',
      // Quad with 2 triangles (4 vertices)
      positions: [
        0, 0, 0,
        10, 0, 2,
        10, 10, 5,
        0, 10, 3,
      ],
      indices: [
        0, 1, 2,
        0, 2, 3,
      ],
      colors: [
        0.2, 0.8, 0.3,
        0.3, 0.7, 0.2,
        0.4, 0.6, 0.1,
        0.2, 0.8, 0.3,
      ],
    }

    const result = buildGlbBuffer([mesh], { sceneName: 'TestScene' })

    expect(result.meshCount).toBe(1)
    expect(result.totalTriangles).toBe(2)
    expect(result.totalVertices).toBe(4)
    expect(result.buffer.length).toBe(result.byteLength)

    // Check 12-byte header
    const buf = result.buffer
    expect(buf.readUInt32LE(0)).toBe(0x46546c67) // magic "glTF"
    expect(buf.readUInt32LE(4)).toBe(2)          // version 2
    expect(buf.readUInt32LE(8)).toBe(result.byteLength)

    // Check Chunk 0 (JSON)
    const jsonLength = buf.readUInt32LE(12)
    expect(buf.readUInt32LE(16)).toBe(0x4e4f534a) // "JSON"
    const jsonStr = buf.subarray(20, 20 + jsonLength).toString('utf8').trim()
    const gltf = JSON.parse(jsonStr)

    expect(gltf.asset.version).toBe('2.0')
    expect(gltf.scenes[0].name).toBe('TestScene')
    expect(gltf.meshes[0].name).toBe('ground_mesh')
    expect(gltf.accessors[0].count).toBe(4) // positions
    expect(gltf.accessors[0].type).toBe('VEC3')
    expect(gltf.accessors[0].min).toEqual([0, 0, 0])
    expect(gltf.accessors[0].max).toEqual([10, 10, 5])

    // Check Chunk 1 (BIN)
    const binOffset = 20 + jsonLength
    const binLength = buf.readUInt32LE(binOffset)
    expect(buf.readUInt32LE(binOffset + 4)).toBe(0x004e4942) // "BIN\0"
    expect(binOffset + 8 + binLength).toBe(result.byteLength)
  })

  it('builds a multi-mesh GLB with separate ground and water nodes', () => {
    const ground: GlbMeshInput = {
      name: 'ground',
      positions: [0, 0, 10, 50, 0, 20, 50, 50, 30],
      indices: [0, 1, 2],
    }
    const water: GlbMeshInput = {
      name: 'water',
      positions: [10, 10, 5, 20, 10, 5, 20, 20, 5],
      indices: [0, 1, 2],
      material: {
        name: 'water_mat',
        baseColorFactor: [0.1, 0.4, 0.9, 0.7],
      },
    }

    const result = buildGlbBuffer([ground, water], { sceneName: 'MountainWithLake' })
    expect(result.meshCount).toBe(2)
    expect(result.totalTriangles).toBe(2)
    expect(result.totalVertices).toBe(6)

    const jsonLength = result.buffer.readUInt32LE(12)
    const jsonStr = result.buffer.subarray(20, 20 + jsonLength).toString('utf8').trim()
    const gltf = JSON.parse(jsonStr)

    expect(gltf.meshes).toHaveLength(2)
    expect(gltf.materials).toHaveLength(2)
    expect(gltf.materials[1].pbrMetallicRoughness.baseColorFactor).toEqual([0.1, 0.4, 0.9, 0.7])
  })

  it('throws descriptive error if no meshes are provided', () => {
    expect(() => buildGlbBuffer([])).toThrow(/No valid non-empty 3D meshes/)
  })
})
