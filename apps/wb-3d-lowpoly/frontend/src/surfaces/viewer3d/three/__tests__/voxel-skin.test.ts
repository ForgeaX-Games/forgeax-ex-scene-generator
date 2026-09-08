// 💡 体素测地蒙皮回归：验证 voxel-skin.ts 的体素化 + flood fill + 26-邻域 Dijkstra，
//    以及 auto-skin.ts 里 method='auto' 主路径切到体素实现、旧表面图实现降级为 fallback
//    的接线是否正确。核心用例：对比体素测地绑定与纯欧氏绑定的差异——
//    构造两个几何上贴合（在顶部经一段桥体连通）但顶点完全不重合的独立"腿部" box part，
//    验证体素测地距离能正确排除"空间上近、但体内路径很远"的骨，而纯欧氏路径会把它错误
//    纳入候选——这正是"手臂搭在身体上但两个 part 独立 bake、没有共享顶点"场景的最小复现。
import { describe, it, expect, vi, afterEach } from 'vitest'
import * as THREE from 'three'
import { computeSkinWeights, type BoneSegment } from '../auto-skin'
import { computeSkinWeightsVoxel } from '../voxel-skin'

/** 生成一个轴对齐 box 的三角面网格（12 个三角形，独立的一套顶点——不与其它 box 共享）。 */
function boxMesh(
  xMin: number, xMax: number,
  yMin: number, yMax: number,
  zMin: number, zMax: number,
): { positions: number[]; index: number[] } {
  const corners: Array<[number, number, number]> = [
    [xMin, yMin, zMin], [xMax, yMin, zMin], [xMax, yMax, zMin], [xMin, yMax, zMin],
    [xMin, yMin, zMax], [xMax, yMin, zMax], [xMax, yMax, zMax], [xMin, yMax, zMax],
  ]
  const positions: number[] = []
  for (const c of corners) positions.push(...c)
  // 12 triangles covering the 6 faces; winding direction is irrelevant here (voxelization
  // only cares about which cells the surface touches, not consistent outward normals).
  const index = [
    0, 1, 2, 0, 2, 3, // bottom
    4, 6, 5, 4, 7, 6, // top
    0, 4, 5, 0, 5, 1, // -y
    3, 2, 6, 3, 6, 7, // +y
    0, 3, 7, 0, 7, 4, // -x
    1, 5, 6, 1, 6, 2, // +x
  ]
  return { positions, index }
}

/** 拼接多个独立 part（各自顶点，互不共享）为一份 combinedPositions/combinedIndex，
 * 模拟 character-builder.ts 里多个独立 bake part 合并求解蒙皮的路径。 */
function combineParts(parts: Array<{ positions: number[]; index: number[] }>): {
  positions: Float32Array
  index: Uint32Array
} {
  let vertexOffset = 0
  const positions: number[] = []
  const index: number[] = []
  for (const part of parts) {
    positions.push(...part.positions)
    for (const i of part.index) index.push(i + vertexOffset)
    vertexOffset += part.positions.length / 3
  }
  return { positions: new Float32Array(positions), index: new Uint32Array(index) }
}

/** 按顶点取某根骨的权重（同 geodesic-skin.test.ts 的 weightForBone 写法）。 */
function weightForBone(skinIndex: ArrayLike<number>, skinWeight: ArrayLike<number>, vertex: number, boneIndex: number): number {
  for (let k = 0; k < 4; k += 1) {
    if (skinIndex[vertex * 4 + k] === boneIndex) return skinWeight[vertex * 4 + k]
  }
  return 0
}

/** 找到坐标最接近 (x,y,z) 的顶点下标（用于定位测试断言点）。 */
function findVertex(positions: Float32Array, x: number, y: number, z: number): number {
  let best = -1
  let bestD2 = Infinity
  const n = positions.length / 3
  for (let v = 0; v < n; v += 1) {
    const dx = positions[v * 3] - x
    const dy = positions[v * 3 + 1] - y
    const dz = positions[v * 3 + 2] - z
    const d2 = dx * dx + dy * dy + dz * dz
    if (d2 < bestD2) { bestD2 = d2; best = v }
  }
  return best
}

describe('voxel-skin: computeSkinWeightsVoxel core regression (hairpin, independently-vertexed parts)', () => {
  // 两条"腿"（legA/legB）分别是独立 box mesh（各自一套顶点，互不共享），只在顶部经
  // 一段 bridge box 连通（bridge 与两腿的顶部区域有重叠，保证体素化后判定为同一个连通
  // solid，而不要求任何顶点坐标重合）。腿的横截面选得足够粗（0.2×0.2），保证体素化后
  // solid/surface 比值能通过"近似封闭体"前置检查。
  const legA = boxMesh(-0.25, -0.05, -0.1, 0.1, 0, 1.0)
  const legB = boxMesh(0.05, 0.25, -0.1, 0.1, 0, 1.0)
  const bridge = boxMesh(-0.25, 0.25, -0.1, 0.1, 0.85, 1.15)
  const { positions, index } = combineParts([legA, legB, bridge])
  const RESOLUTION = 48

  const bones: BoneSegment[] = [
    { head: new THREE.Vector3(-0.15, 0, 0), tail: new THREE.Vector3(-0.15, 0, 0.85) }, // boneA: legA 轴线
    { head: new THREE.Vector3(0.15, 0, 0), tail: new THREE.Vector3(0.15, 0, 0.85) },   // boneB: legB 轴线
  ]

  it('voxelizes into a single connected solid (both bones reachable, no unreachable vertices)', () => {
    const result = computeSkinWeightsVoxel(positions, index, bones, 4, 2, 5, RESOLUTION)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.diagnostics.unreachableBones).toHaveLength(0)
    expect(result.diagnostics.unreachableVertexCount).toBe(0)
    expect(result.diagnostics.solidVoxelCount).toBeGreaterThan(0)
  })

  it('correctly excludes the euclidean-near-but-geodesically-far bone (no arm→torso leakage)', () => {
    // 该点是 legA 内侧面（靠近 legB 一侧）、远离顶部 bridge 的一个 box 角顶点：
    // - 欧氏距离到 boneA≈0.14，到 boneB≈0.22（只差约 1.6 倍，radiusFactor=5 时欧氏路径
    //   会把 boneB 错误纳入候选并分到可观权重）；
    // - 体素测地距离到 boneA 是局部路径（沿腿内即可到达），到 boneB 必须先走到顶部 bridge
    //   再绕下 legB，实际路径长度 ≈ 2（远超任何合理的相对截止半径），应被完全排除。
    const v = findVertex(positions, -0.05, -0.1, 0)
    expect(v).toBeGreaterThanOrEqual(0)

    const voxelResult = computeSkinWeightsVoxel(positions, index, bones, 4, 2, 5, RESOLUTION)
    expect(voxelResult.ok).toBe(true)
    if (!voxelResult.ok) return
    const boneAWeightVoxel = weightForBone(voxelResult.binding.skinIndex, voxelResult.binding.skinWeight, v, 0)
    const boneBWeightVoxel = weightForBone(voxelResult.binding.skinIndex, voxelResult.binding.skinWeight, v, 1)
    expect(boneAWeightVoxel).toBeGreaterThan(0.99)
    expect(boneBWeightVoxel).toBe(0)

    // 对照：同样的几何/参数走纯欧氏路径（不传 index）会把空间上更近的 boneB 错误纳入候选——
    // 这正是体素测地路径要解决的"手臂→胸口"权重串门问题。
    const euclideanBinding = computeSkinWeights(positions, bones, { method: 'auto', maxInfluences: 4, falloff: 2, radiusFactor: 5 })
    const boneBWeightEuclidean = weightForBone(euclideanBinding.skinIndex, euclideanBinding.skinWeight, v, 1)
    expect(boneBWeightEuclidean).toBeGreaterThan(0.01)
  })

  it('symmetric vertex on legB correctly excludes boneA', () => {
    const v = findVertex(positions, 0.05, -0.1, 0)
    expect(v).toBeGreaterThanOrEqual(0)
    const voxelResult = computeSkinWeightsVoxel(positions, index, bones, 4, 2, 5, RESOLUTION)
    expect(voxelResult.ok).toBe(true)
    if (!voxelResult.ok) return
    const boneAWeight = weightForBone(voxelResult.binding.skinIndex, voxelResult.binding.skinWeight, v, 0)
    const boneBWeight = weightForBone(voxelResult.binding.skinIndex, voxelResult.binding.skinWeight, v, 1)
    expect(boneBWeight).toBeGreaterThan(0.99)
    expect(boneAWeight).toBe(0)
  })

  it('weights normalize to 1 per vertex within 1e-6', () => {
    const voxelResult = computeSkinWeightsVoxel(positions, index, bones, 4, 2, 5, RESOLUTION)
    expect(voxelResult.ok).toBe(true)
    if (!voxelResult.ok) return
    const { skinWeight } = voxelResult.binding
    const vertexCount = positions.length / 3
    for (let v = 0; v < vertexCount; v += 1) {
      const sum = skinWeight[v * 4] + skinWeight[v * 4 + 1] + skinWeight[v * 4 + 2] + skinWeight[v * 4 + 3]
      expect(Math.abs(sum - 1)).toBeLessThan(1e-6)
    }
  })
})

describe('voxel-skin: real air gap keeps weights from cross-contaminating', () => {
  // legA / legB 完全不连通（中间有 0.1 的真实空气间隙，无 bridge），各自一根骨。
  // 体素分辨率下 step ≈ 1/48 ≈ 0.021，远小于 0.1 的间隙，flood fill 应能正确判定两腿
  // 是两个不连通的 solid 分量：任一顶点都不应获得对面那根骨的权重，即使空间上很近。
  const legA = boxMesh(-0.3, -0.1, -0.05, 0.05, 0, 1.0)
  const legB = boxMesh(0.0, 0.2, -0.05, 0.05, 0, 1.0)
  const { positions, index } = combineParts([legA, legB])

  const bones: BoneSegment[] = [
    { head: new THREE.Vector3(-0.2, 0, 0), tail: new THREE.Vector3(-0.2, 0, 1.0) },
    { head: new THREE.Vector3(0.1, 0, 0), tail: new THREE.Vector3(0.1, 0, 1.0) },
  ]

  it('a vertex on legA (near the gap) gets 100% boneA, 0% boneB despite the small euclidean gap', () => {
    const v = findVertex(positions, -0.1, 0, 0.5)
    expect(v).toBeGreaterThanOrEqual(0)
    const result = computeSkinWeightsVoxel(positions, index, bones, 4, 4, 3, 48)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(weightForBone(result.binding.skinIndex, result.binding.skinWeight, v, 0)).toBeCloseTo(1, 6)
    expect(weightForBone(result.binding.skinIndex, result.binding.skinWeight, v, 1)).toBe(0)
    // 两条腿各自独立可达，没有顶点整体不可达。
    expect(result.diagnostics.unreachableVertexCount).toBe(0)
  })

  it('a vertex on legB (near the gap) gets 100% boneB, 0% boneA', () => {
    const v = findVertex(positions, 0.0, 0, 0.5)
    expect(v).toBeGreaterThanOrEqual(0)
    const result = computeSkinWeightsVoxel(positions, index, bones, 4, 4, 3, 48)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(weightForBone(result.binding.skinIndex, result.binding.skinWeight, v, 1)).toBeCloseTo(1, 6)
    expect(weightForBone(result.binding.skinIndex, result.binding.skinWeight, v, 0)).toBe(0)
  })
})

describe('voxel-skin: front-door wiring in computeSkinWeights (method=auto)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses the voxel path by default for a real closed volume and reports diagnostics', () => {
    const box = boxMesh(-0.2, 0.2, -0.2, 0.2, 0, 1.0)
    const positions = new Float32Array(box.positions)
    const index = new Uint32Array(box.index)
    const bones: BoneSegment[] = [{ head: new THREE.Vector3(0, 0, 0), tail: new THREE.Vector3(0, 0, 1.0) }]
    const binding = computeSkinWeights(positions, bones, { method: 'auto', maxInfluences: 4, falloff: 2, resolution: 24 }, index)
    expect(binding.diagnostics).toBeTruthy()
    expect(binding.diagnostics!.unreachableBones).toHaveLength(0)
  })

  it('falls back to the surface-graph geodesic path (with a console.warn) for a degenerate/open mesh', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // 退化包围盒（一条线，无体积）：voxel 前置检查必然失败。
    const positions = new Float32Array([0, 0, 0, 0.1, 0, 1, 0, 0, 2])
    const index = new Uint32Array([0, 1, 2])
    const bones: BoneSegment[] = [
      { head: new THREE.Vector3(0, 0, 0), tail: new THREE.Vector3(0, 0, 1) },
      { head: new THREE.Vector3(0, 0, 1), tail: new THREE.Vector3(0, 0, 2) },
    ]
    const binding = computeSkinWeights(positions, bones, { method: 'auto', maxInfluences: 4, falloff: 2 }, index)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0][0]).toContain('falling back to surface-graph geodesic path')
    // 旧表面图路径不产生 diagnostics 字段。
    expect(binding.diagnostics).toBeUndefined()
    const sum = binding.skinWeight[0] + binding.skinWeight[1] + binding.skinWeight[2] + binding.skinWeight[3]
    expect(sum).toBeCloseTo(1, 5)
  })
})
