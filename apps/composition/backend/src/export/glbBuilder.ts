/**
 * glbBuilder.ts — Pure TypeScript glTF 2.0 Binary (.glb) builder for 3D meshes.
 *
 * Implements the glTF 2.0 specification:
 *   - 12-byte GLB container header (magic 0x46546C67, version 2, total length)
 *   - Chunk 0: JSON metadata (0x4E4F534A), padded with 0x20
 *   - Chunk 1: BIN buffer (0x004E4942), padded with 0x00
 *
 * Runs natively in Node / Bun without WebGL / browser dependencies.
 */

export interface GlbMeshInput {
  name: string
  positions: readonly number[] // Flat array of [x, y, z, x, y, z, ...]
  indices: readonly number[]   // Flat array of [i0, i1, i2, ...]
  normals?: readonly number[]  // Flat array of [nx, ny, nz, ...]
  colors?: readonly number[]   // Flat array of [r, g, b, ...] (0.0 .. 1.0)
  material?: {
    name?: string
    baseColorFactor?: readonly [number, number, number, number]
    roughnessFactor?: number
    metallicFactor?: number
    doubleSided?: boolean
  }
}

export interface BuildGlbOptions {
  sceneName?: string
  generatorName?: string
  /**
   * Scene Generator is Z-up (X east, Y north/south, Z elevation).
   * glTF 2.0 standard is Y-up (X right, Y up, Z forward).
   * If true (default), adds a root transformation node with rotation [-90deg around X]
   * so glTF viewers and game engines load the terrain upright.
   */
  orientYUp?: boolean
}

export interface GlbBuildResult {
  buffer: Buffer
  byteLength: number
  meshCount: number
  totalTriangles: number
  totalVertices: number
}

function computeNormals(positions: readonly number[], indices: readonly number[]): number[] {
  const vertCount = Math.floor(positions.length / 3)
  const normals = new Array<number>(vertCount * 3).fill(0)

  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i]!
    const i1 = indices[i + 1]!
    const i2 = indices[i + 2]!

    const p0x = positions[i0 * 3]!
    const p0y = positions[i0 * 3 + 1]!
    const p0z = positions[i0 * 3 + 2]!

    const p1x = positions[i1 * 3]!
    const p1y = positions[i1 * 3 + 1]!
    const p1z = positions[i1 * 3 + 2]!

    const p2x = positions[i2 * 3]!
    const p2y = positions[i2 * 3 + 1]!
    const p2z = positions[i2 * 3 + 2]!

    // Edge vectors: e1 = p1 - p0, e2 = p2 - p0
    const e1x = p1x - p0x
    const e1y = p1y - p0y
    const e1z = p1z - p0z

    const e2x = p2x - p0x
    const e2y = p2y - p0y
    const e2z = p2z - p0z

    // Cross product: n = e1 x e2
    const nx = e1y * e2z - e1z * e2y
    const ny = e1z * e2x - e1x * e2z
    const nz = e1x * e2y - e1y * e2x

    normals[i0 * 3] += nx
    normals[i0 * 3 + 1] += ny
    normals[i0 * 3 + 2] += nz

    normals[i1 * 3] += nx
    normals[i1 * 3 + 1] += ny
    normals[i1 * 3 + 2] += nz

    normals[i2 * 3] += nx
    normals[i2 * 3 + 1] += ny
    normals[i2 * 3 + 2] += nz
  }

  // Normalize all vertex normals
  for (let v = 0; v < vertCount; v++) {
    const nx = normals[v * 3]!
    const ny = normals[v * 3 + 1]!
    const nz = normals[v * 3 + 2]!
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (len > 1e-8) {
      normals[v * 3] = nx / len
      normals[v * 3 + 1] = ny / len
      normals[v * 3 + 2] = nz / len
    } else {
      normals[v * 3] = 0
      normals[v * 3 + 1] = 0
      normals[v * 3 + 2] = 1
    }
  }

  return normals
}

function computeBounds(positions: readonly number[]): { min: [number, number, number]; max: [number, number, number] } {
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]!
    const y = positions[i + 1]!
    const z = positions[i + 2]!
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }

  if (!Number.isFinite(minX)) {
    minX = 0; minY = 0; minZ = 0
    maxX = 0; maxY = 0; maxZ = 0
  }

  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  }
}

/**
 * Builds a valid glTF 2.0 binary (.glb) Buffer from one or more meshes.
 */
export function buildGlbBuffer(
  meshInputs: readonly GlbMeshInput[],
  options?: BuildGlbOptions,
): GlbBuildResult {
  const validMeshes = meshInputs.filter(
    (m) => m && Array.isArray(m.positions) && m.positions.length >= 9 && Array.isArray(m.indices) && m.indices.length >= 3,
  )

  if (validMeshes.length === 0) {
    throw new Error('No valid non-empty 3D meshes to export to GLB.')
  }

  const orientYUp = options?.orientYUp !== false
  const sceneName = options?.sceneName ?? 'Scene'
  const generatorName = options?.generatorName ?? 'ForgeaX Scene Generator'

  interface BufferViewDef {
    buffer: number
    byteOffset: number
    byteLength: number
    target?: number
  }

  interface AccessorDef {
    bufferView: number
    byteOffset: number
    componentType: number // 5126=FLOAT, 5125=UNSIGNED_INT, 5123=UNSIGNED_SHORT
    count: number
    type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4'
    min?: number[]
    max?: number[]
  }

  interface PrimitiveDef {
    attributes: Record<string, number>
    indices: number
    material?: number
  }

  interface MeshDef {
    name: string
    primitives: PrimitiveDef[]
  }

  interface MaterialDef {
    name: string
    pbrMetallicRoughness: {
      baseColorFactor: number[]
      roughnessFactor: number
      metallicFactor: number
    }
    doubleSided?: boolean
  }

  interface NodeDef {
    name: string
    mesh?: number
    children?: number[]
    rotation?: number[]
  }

  const bufferViews: BufferViewDef[] = []
  const accessors: AccessorDef[] = []
  const meshes: MeshDef[] = []
  const materials: MaterialDef[] = []
  const nodes: NodeDef[] = []

  const binBuffers: Buffer[] = []
  let currentBinOffset = 0

  function appendBufferView(rawBytes: Uint8Array, target?: number): number {
    const viewIndex = bufferViews.length
    const byteLength = rawBytes.byteLength
    const paddedLength = Math.ceil(byteLength / 4) * 4

    bufferViews.push({
      buffer: 0,
      byteOffset: currentBinOffset,
      byteLength,
      ...(target !== undefined ? { target } : {}),
    })

    const viewBuffer = Buffer.alloc(paddedLength)
    viewBuffer.set(rawBytes, 0)
    binBuffers.push(viewBuffer)
    currentBinOffset += paddedLength

    return viewIndex
  }

  let totalTriangles = 0
  let totalVertices = 0

  for (let meshIdx = 0; meshIdx < validMeshes.length; meshIdx++) {
    const input = validMeshes[meshIdx]!
    const vertCount = Math.floor(input.positions.length / 3)
    const triangleCount = Math.floor(input.indices.length / 3)
    totalVertices += vertCount
    totalTriangles += triangleCount

    // 1. POSITION Accessor
    const posBounds = computeBounds(input.positions)
    const posArray = new Float32Array(input.positions)
    const posViewIdx = appendBufferView(new Uint8Array(posArray.buffer), 34962) // ARRAY_BUFFER
    const posAccessorIdx = accessors.length
    accessors.push({
      bufferView: posViewIdx,
      byteOffset: 0,
      componentType: 5126, // FLOAT
      count: vertCount,
      type: 'VEC3',
      min: posBounds.min,
      max: posBounds.max,
    })

    // 2. NORMAL Accessor
    const normals = input.normals && input.normals.length === input.positions.length
      ? input.normals
      : computeNormals(input.positions, input.indices)
    const normArray = new Float32Array(normals)
    const normViewIdx = appendBufferView(new Uint8Array(normArray.buffer), 34962)
    const normAccessorIdx = accessors.length
    accessors.push({
      bufferView: normViewIdx,
      byteOffset: 0,
      componentType: 5126, // FLOAT
      count: vertCount,
      type: 'VEC3',
    })

    // 3. COLOR_0 Accessor (optional)
    let colorAccessorIdx: number | undefined
    if (input.colors && input.colors.length >= vertCount * 3) {
      const colArray = new Float32Array(input.colors.slice(0, vertCount * 3))
      const colViewIdx = appendBufferView(new Uint8Array(colArray.buffer), 34962)
      colorAccessorIdx = accessors.length
      accessors.push({
        bufferView: colViewIdx,
        byteOffset: 0,
        componentType: 5126, // FLOAT
        count: vertCount,
        type: 'VEC3',
      })
    }

    // 4. INDICES Accessor
    const indArray = new Uint32Array(input.indices)
    const indViewIdx = appendBufferView(new Uint8Array(indArray.buffer), 34963) // ELEMENT_ARRAY_BUFFER
    const indAccessorIdx = accessors.length
    accessors.push({
      bufferView: indViewIdx,
      byteOffset: 0,
      componentType: 5125, // UNSIGNED_INT
      count: input.indices.length,
      type: 'SCALAR',
    })

    // 5. Material
    const matIdx = materials.length
    const matDef = input.material
    materials.push({
      name: matDef?.name ?? `${input.name}_material`,
      pbrMetallicRoughness: {
        baseColorFactor: matDef?.baseColorFactor ? [...matDef.baseColorFactor] : [1, 1, 1, 1],
        roughnessFactor: matDef?.roughnessFactor ?? 0.85,
        metallicFactor: matDef?.metallicFactor ?? 0.0,
      },
      doubleSided: matDef?.doubleSided ?? false,
    })

    // 6. Mesh Definition
    const attributes: Record<string, number> = {
      POSITION: posAccessorIdx,
      NORMAL: normAccessorIdx,
    }
    if (colorAccessorIdx !== undefined) {
      attributes.COLOR_0 = colorAccessorIdx
    }

    meshes.push({
      name: `${input.name}_mesh`,
      primitives: [
        {
          attributes,
          indices: indAccessorIdx,
          material: matIdx,
        },
      ],
    })

    // 7. Node
    nodes.push({
      name: input.name,
      mesh: meshIdx,
    })
  }

  // Root Scene Structure
  let rootNodeIndices: number[] = []
  if (orientYUp) {
    // Add Y-Up conversion root node rotating -90 deg around X-axis: [sin(-pi/4), 0, 0, cos(-pi/4)]
    const meshNodeIndices = nodes.map((_, i) => i)
    const rootNodeIdx = nodes.length
    nodes.push({
      name: 'Root_ZUp_to_YUp',
      rotation: [-0.7071067811865475, 0, 0, 0.7071067811865476],
      children: meshNodeIndices,
    })
    rootNodeIndices = [rootNodeIdx]
  } else {
    rootNodeIndices = nodes.map((_, i) => i)
  }

  const gltfDoc = {
    asset: {
      version: '2.0',
      generator: generatorName,
    },
    scene: 0,
    scenes: [
      {
        name: sceneName,
        nodes: rootNodeIndices,
      },
    ],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [
      {
        byteLength: currentBinOffset,
      },
    ],
  }

  const jsonStr = JSON.stringify(gltfDoc)
  const jsonRawBuf = Buffer.from(jsonStr, 'utf8')
  const jsonPadding = (4 - (jsonRawBuf.length % 4)) % 4
  const jsonChunkLength = jsonRawBuf.length + jsonPadding
  const jsonChunkBuf = Buffer.alloc(jsonChunkLength, 0x20) // Space padded per glTF spec
  jsonRawBuf.copy(jsonChunkBuf, 0)

  const binBuf = Buffer.concat(binBuffers)
  const binPadding = (4 - (binBuf.length % 4)) % 4
  const binChunkLength = binBuf.length + binPadding
  const binChunkBuf = Buffer.alloc(binChunkLength, 0x00) // Zero padded per glTF spec
  binBuf.copy(binChunkBuf, 0)

  const totalLength = 12 + 8 + jsonChunkLength + 8 + binChunkLength
  const glbBuffer = Buffer.alloc(totalLength)

  // GLB Header (12 bytes)
  glbBuffer.writeUInt32LE(0x46546c67, 0) // magic "glTF"
  glbBuffer.writeUInt32LE(2, 4)          // version 2
  glbBuffer.writeUInt32LE(totalLength, 8) // total length

  // Chunk 0: JSON (8 + jsonChunkLength bytes)
  glbBuffer.writeUInt32LE(jsonChunkLength, 12)
  glbBuffer.writeUInt32LE(0x4e4f534a, 16) // "JSON"
  jsonChunkBuf.copy(glbBuffer, 20)

  // Chunk 1: BIN (8 + binChunkLength bytes)
  const binChunkHeaderOffset = 20 + jsonChunkLength
  glbBuffer.writeUInt32LE(binChunkLength, binChunkHeaderOffset)
  glbBuffer.writeUInt32LE(0x004e4942, binChunkHeaderOffset + 4) // "BIN\0"
  binChunkBuf.copy(glbBuffer, binChunkHeaderOffset + 8)

  return {
    buffer: glbBuffer,
    byteLength: totalLength,
    meshCount: validMeshes.length,
    totalTriangles,
    totalVertices,
  }
}
