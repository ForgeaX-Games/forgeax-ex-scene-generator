// 💡 测地蒙皮回归：验证 auto-skin.ts 的顶点焊接 + 邻接图 + 多源 Dijkstra 升级——
//    核心动机（见 plan）：欧氏距离会把"表皮上路径很远、但空间直线距离很近"的两根骨
//    错误混权重（手贴大腿、尾巴卷曲贴身）；测地距离沿网格表面走，能正确排除它们。
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { computeSkinWeights, type BoneSegment } from '../auto-skin'
import { buildCharacterSkeleton, buildCharacterSkinnedMeshes } from '../character-builder'
import type { RigSpec } from '../rig-spec'

/**
 * 造一条"发夹形"带状网格：从 (0,0) 沿 +Y 走到 (0,L)，在顶端折返到 (D,L)，再沿 -Y
 * 走回 (D,0)。两条腿末端在欧氏空间上只差 D（很近），但沿网格表面要走 ≈2L+D（很远）。
 * 每条 centerline 复制两行（z=0 / z=w）做成有宽度的三角带，好建出真实邻接图。
 */
function buildHairpinStrip(segmentsPerLeg: number, legLength: number, gap: number, width: number) {
  const centerline: Array<[number, number]> = []
  for (let i = 0; i <= segmentsPerLeg; i += 1) centerline.push([0, (legLength * i) / segmentsPerLeg])
  for (let i = 0; i <= segmentsPerLeg; i += 1) centerline.push([gap, legLength - (legLength * i) / segmentsPerLeg])

  const cl = centerline.length
  const positions: number[] = []
  for (const [x, y] of centerline) positions.push(x, y, 0)
  for (const [x, y] of centerline) positions.push(x, y, width)

  const index: number[] = []
  for (let i = 0; i < cl - 1; i += 1) {
    const a0 = i
    const a1 = i + 1
    const b0 = i + cl
    const b1 = i + 1 + cl
    index.push(a0, b0, a1)
    index.push(b0, b1, a1)
  }
  return {
    positions: new Float32Array(positions),
    index: new Uint32Array(index),
    leg1StartVertex: 0,
    leg2StartVertex: cl - 1, // leg2 的 y=0 端（欧氏上紧贴 leg1StartVertex，但沿面要绕一整圈）
  }
}

/**
 * 按顶点取某根骨的权重。⚠️ 未写满 4 个 influence 时，尾部空位的 skinIndex 保持
 * Uint16Array 默认值 0——不能用"遍历累加/覆盖赋值"取 boneIndex=0 的权重（会被尾部空位
 * 的默认 0 覆盖成 0），必须命中第一个匹配即返回（真实赋值总是排在尾部空位之前）。
 */
function weightForBone(skinIndex: ArrayLike<number>, skinWeight: ArrayLike<number>, vertex: number, boneIndex: number): number {
  for (let k = 0; k < 4; k += 1) {
    if (skinIndex[vertex * 4 + k] === boneIndex) return skinWeight[vertex * 4 + k]
  }
  return 0
}

describe('geodesic auto-skin (weld + adjacency + multi-source Dijkstra)', () => {
  const N = 10
  const L = 1.0
  const GAP = 0.01
  const W = 0.02
  const strip = buildHairpinStrip(N, L, GAP, W)

  // boneA 贴着 leg1 的近端（vertex0 所在处）；boneB 贴着 leg2 的近端——空间上只隔 GAP=0.01，
  // 但沿发夹表面要绕 ≈2L+GAP≈2.01，是模型里"手贴大腿"场景的最小复现。
  const bones: BoneSegment[] = [
    { head: new THREE.Vector3(0, 0, 0), tail: new THREE.Vector3(0, 0.05, 0) },
    { head: new THREE.Vector3(GAP, 0, 0), tail: new THREE.Vector3(GAP, 0.05, 0) },
  ]

  it('Euclidean-only baseline (no index) wrongly blends the spatially-near-but-far-along-mesh bone', () => {
    const { skinIndex, skinWeight } = computeSkinWeights(strip.positions, bones, {
      method: 'auto', maxInfluences: 4, falloff: 4,
    })
    const v = strip.leg1StartVertex
    const boneBWeight = weightForBone(skinIndex, skinWeight, v, 1)
    // 欧氏基线下，boneB（空间距离仅 GAP=0.01 < 绝对地板 0.02）会被错误纳入候选。
    expect(boneBWeight).toBeGreaterThan(0)
  })

  it('geodesic path (with triangle index) correctly excludes the far-along-mesh bone', () => {
    const { skinIndex, skinWeight } = computeSkinWeights(strip.positions, bones, {
      method: 'auto', maxInfluences: 4, falloff: 4,
    }, strip.index)
    const v = strip.leg1StartVertex
    const boneAWeight = weightForBone(skinIndex, skinWeight, v, 0)
    const boneBWeight = weightForBone(skinIndex, skinWeight, v, 1)
    // 测地距离沿表面绕了 ≈2L，远超相对截止半径，boneB 应被排除；boneA 几乎独占权重。
    expect(boneAWeight).toBeCloseTo(1, 3)
    expect(boneBWeight).toBe(0)
  })

  it('weights still normalize to 1 per vertex on the geodesic path for every vertex', () => {
    const { skinWeight } = computeSkinWeights(strip.positions, bones, {
      method: 'auto', maxInfluences: 4, falloff: 4,
    }, strip.index)
    const vertexCount = strip.positions.length / 3
    for (let v = 0; v < vertexCount; v += 1) {
      const sum = skinWeight[v * 4] + skinWeight[v * 4 + 1] + skinWeight[v * 4 + 2] + skinWeight[v * 4 + 3]
      expect(sum).toBeCloseTo(1, 4)
    }
  })

  it('a vertex near the fold (equidistant along the mesh to both legs) can blend both bones', () => {
    // 折返点本身沿表面到两条腿近端都约等于 L，测地距离下不再是"死判 0/1"，说明算法
    // 不是简单地把远骨一刀切掉，而是按（可能很大的）真实表面距离参与截止/权重计算。
    const foldVertexIndex = N // leg1 的最后一个 centerline 点，就是折返处
    const { skinIndex, skinWeight } = computeSkinWeights(strip.positions, bones, {
      method: 'auto', maxInfluences: 4, falloff: 1, radiusFactor: 100,
    }, strip.index)
    const boneAWeight = weightForBone(skinIndex, skinWeight, foldVertexIndex, 0)
    const boneBWeight = weightForBone(skinIndex, skinWeight, foldVertexIndex, 1)
    expect(boneAWeight).toBeGreaterThan(0)
    expect(boneBWeight).toBeGreaterThan(0)
  })

  it('rigid mode stays pure-Euclidean nearest-bone even when an index is supplied', () => {
    const { skinIndex, skinWeight } = computeSkinWeights(strip.positions, bones, {
      method: 'rigid', maxInfluences: 4, falloff: 4,
    }, strip.index)
    const v = strip.leg1StartVertex
    expect(skinIndex[v * 4]).toBe(0)
    expect(skinWeight[v * 4]).toBeCloseTo(1, 6)
    expect(skinWeight[v * 4 + 1]).toBe(0)
  })
})

describe('geodesic auto-skin: cross-part weld via buildCharacterSkinnedMeshes', () => {
  // 两个分别 bake 的 part：partA 是一条沿 Z 的带状网格（骨 root 贴着它），partB 是另一条
  // 带状网格，起点与 partA 的终点坐标重合（模拟"手贴大腿"物理接触，靠焊接缝进同一张图）。
  // 验证：① 两个本不共享顶点的 part 确实被焊接缝进同一张连通图（权重能跨 part 传播、
  // 处处归一化，不会因为"图不连通"而整体退化/报错）；② 沿表面越靠近哪根骨，哪根骨权重
  // 越占优（图上的远近关系符合几何直觉）。
  function stripMesh(xOffset: number, zFrom: number, zTo: number, segments: number, width: number): THREE.Mesh {
    const geom = new THREE.BufferGeometry()
    const positions: number[] = []
    const index: number[] = []
    for (let i = 0; i <= segments; i += 1) {
      const z = zFrom + ((zTo - zFrom) * i) / segments
      positions.push(xOffset, 0, z)
      positions.push(xOffset + width, 0, z)
    }
    for (let i = 0; i < segments; i += 1) {
      const a0 = i * 2
      const a1 = a0 + 1
      const b0 = a0 + 2
      const b1 = a0 + 3
      index.push(a0, a1, b0)
      index.push(a1, b1, b0)
    }
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geom.setIndex(index)
    return new THREE.Mesh(geom, new THREE.MeshStandardMaterial())
  }

  const RIG: RigSpec = {
    version: 1,
    meshFilename: 'test.glb',
    skeletonRoot: 'root',
    bones: [
      { name: 'root', parent: null, head: [0, 0, 0], tail: [0, 0, 1] },
      { name: 'tip', parent: 'root', head: [0, 0, 1.25], tail: [0, 0, 1.5] },
    ],
    boneCount: 2,
    skin: { method: 'auto', resolution: 48, maxInfluences: 4, falloff: 4 },
    clips: [],
  }

  function findVertexAtZ(mesh: THREE.SkinnedMesh, z: number): number {
    const pos = mesh.geometry.attributes.position.array as Float32Array
    for (let v = 0; v < pos.length / 3; v += 1) {
      if (Math.abs(pos[v * 3 + 2] - z) < 1e-6) return v
    }
    return -1
  }

  function weightOf(mesh: THREE.SkinnedMesh, vertex: number, boneIndex: number): number {
    const idx = mesh.geometry.attributes.skinIndex.array as Uint16Array
    const w = mesh.geometry.attributes.skinWeight.array as Float32Array
    for (let k = 0; k < 4; k += 1) {
      if (idx[vertex * 4 + k] === boneIndex) return w[vertex * 4 + k]
    }
    return 0
  }

  it('welds two touching parts into one connected graph and normalizes weights across both', () => {
    const partA = stripMesh(0, 0, 1, 8, 0.05) // z: 0..1, touches partB at z=1
    const partB = stripMesh(0, 1, 3, 8, 0.05) // z: 1..3, seam at z=1 coincides with partA's end

    const loaded = new THREE.Group()
    loaded.add(partA)
    loaded.add(partB)

    const cs = buildCharacterSkeleton(RIG)
    const meshes = buildCharacterSkinnedMeshes(loaded, cs, RIG.skin, 'k')
    expect(meshes).toHaveLength(2)

    for (const m of meshes) {
      const weight = m.geometry.attributes.skinWeight.array as Float32Array
      const vertexCount = weight.length / 4
      for (let v = 0; v < vertexCount; v += 1) {
        const sum = weight[v * 4] + weight[v * 4 + 1] + weight[v * 4 + 2] + weight[v * 4 + 3]
        expect(sum).toBeCloseTo(1, 4)
      }
    }

    const meshA = meshes.find((m) => findVertexAtZ(m, 0) >= 0)!
    const meshB = meshes.find((m) => findVertexAtZ(m, 3) >= 0)!
    expect(meshA).toBeTruthy()
    expect(meshB).toBeTruthy()

    // partA 起点（z=0）正贴着 root 骨的 head：root 权重应几乎独占。
    const startVertex = findVertexAtZ(meshA, 0)
    expect(weightOf(meshA, startVertex, 0)).toBeGreaterThan(0.9)

    // partB 远端（z=3）沿焊接后的连通图离 tip 骨（z≈1.05）比离 root 骨（z:0..1）近得多，
    // tip 权重应明显占优——证明焊接后的测地距离场确实跨 part 传播、且符合几何直觉。
    const farVertex = findVertexAtZ(meshB, 3)
    const rootWeightFar = weightOf(meshB, farVertex, 0)
    const tipWeightFar = weightOf(meshB, farVertex, 1)
    expect(tipWeightFar).toBeGreaterThan(rootWeightFar)
  })

  it('a fully disconnected floating part still gets valid normalized fallback weights', () => {
    const partA = stripMesh(0, 0, 1, 6, 0.05)
    const floatingProp = stripMesh(5, 0, 1, 4, 0.05) // 远离，不接触也不共享顶点

    const loaded = new THREE.Group()
    loaded.add(partA)
    loaded.add(floatingProp)

    const cs = buildCharacterSkeleton(RIG)
    const meshes = buildCharacterSkinnedMeshes(loaded, cs, RIG.skin, 'k2')
    expect(meshes).toHaveLength(2)

    for (const m of meshes) {
      const weight = m.geometry.attributes.skinWeight.array as Float32Array
      const vertexCount = weight.length / 4
      for (let v = 0; v < vertexCount; v += 1) {
        expect(Number.isFinite(weight[v * 4])).toBe(true)
        const sum = weight[v * 4] + weight[v * 4 + 1] + weight[v * 4 + 2] + weight[v * 4 + 3]
        expect(sum).toBeCloseTo(1, 4)
      }
    }
  })

  it('does not weld nearby disconnected surfaces or leak an unreachable hand bone into the body', () => {
    // 两片表面只隔 1mm：旧默认焊接容差在约 1m bbox 下是 2.6mm，会把它们错误缝合。
    // 两根骨分别精确落在各自表面；body 顶点不应因为 hand 在欧氏空间很近而获得 hand 权重。
    const body = stripMesh(0, 0, 1, 8, 0.05)
    const hand = stripMesh(0.001, 0, 1, 8, 0.05)
    const loaded = new THREE.Group()
    loaded.add(body)
    loaded.add(hand)

    const closeRig: RigSpec = {
      version: 1,
      meshFilename: 'nearby-surfaces.glb',
      skeletonRoot: 'body',
      bones: [
        { name: 'body', parent: null, head: [0, 0, 0], tail: [0, 0, 1] },
        { name: 'hand', parent: 'body', head: [0.001, 0, 0], tail: [0.001, 0, 1] },
      ],
      boneCount: 2,
      skin: { method: 'auto', resolution: 48, maxInfluences: 2, falloff: 5 },
      clips: [],
    }
    const cs = buildCharacterSkeleton(closeRig)
    const meshes = buildCharacterSkinnedMeshes(loaded, cs, closeRig.skin, 'nearby-disconnected')
    const bodyMesh = meshes.find((mesh) => {
      const pos = mesh.geometry.attributes.position.array as Float32Array
      return Math.abs(pos[0]) < 1e-7
    })!
    expect(bodyMesh).toBeTruthy()

    const bodyVertex = findVertexAtZ(bodyMesh, 0.5)
    expect(bodyVertex).toBeGreaterThanOrEqual(0)
    expect(weightOf(bodyMesh, bodyVertex, 0)).toBeCloseTo(1, 6)
    expect(weightOf(bodyMesh, bodyVertex, 1)).toBe(0)
  })
})
