// 💡 角色路前端验证：auto-skin 权重求解 + character-builder 骨架/蒙皮/clip 构建。
//    覆盖：① 每顶点权重归一化（和≈1）；② rigid 模式单骨 100%；③ 骨架拓扑挂链正确、
//    boneInverses 就绪；④ SkinnedMesh 顶点属性齐备；⑤ 骨骼名通道 → AnimationClip track。
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { computeSkinWeights } from '../auto-skin'
import {
  buildCharacterSkeleton,
  buildCharacterSkinnedMeshes,
  buildCharacterAnimationClips,
} from '../character-builder'
import { disposeObject3D } from '../three-dispose'
import type { RigSpec } from '../rig-spec'

// 一条两段骨链（沿 Z）：root [0,0,0]→[0,0,1]，child [0,0,1]→[0,0,2]。
const RIG: RigSpec = {
  version: 1,
  meshFilename: 'test.glb',
  skeletonRoot: 'root',
  bones: [
    { name: 'root', parent: null, head: [0, 0, 0], tail: [0, 0, 1] },
    { name: 'tip', parent: 'root', head: [0, 0, 1], tail: [0, 0, 2] },
  ],
  boneCount: 2,
  skin: { method: 'auto', resolution: 32, maxInfluences: 4, falloff: 2 },
  clips: [
    { name: 'bend', fps: 30, frameCount: 3, loop: true, channels: { tip: [0, 0.5, 1.0] } },
  ],
}

describe('auto-skin computeSkinWeights', () => {
  const bones = [
    { head: new THREE.Vector3(0, 0, 0), tail: new THREE.Vector3(0, 0, 1) },
    { head: new THREE.Vector3(0, 0, 1), tail: new THREE.Vector3(0, 0, 2) },
  ]

  it('normalizes per-vertex weights to sum ≈ 1 (auto)', () => {
    // 3 vertices at z=0, z=1 (joint), z=2.
    const positions = new Float32Array([0, 0, 0, 0.1, 0, 1, 0, 0, 2])
    const { skinWeight } = computeSkinWeights(positions, bones, { method: 'auto', maxInfluences: 4, falloff: 2 })
    for (let v = 0; v < 3; v += 1) {
      const s = skinWeight[v * 4] + skinWeight[v * 4 + 1] + skinWeight[v * 4 + 2] + skinWeight[v * 4 + 3]
      expect(s).toBeCloseTo(1, 5)
    }
  })

  it('rigid mode binds each vertex 100% to the nearest single bone', () => {
    const positions = new Float32Array([0, 0, 0.1, 0, 0, 1.9])
    const { skinIndex, skinWeight } = computeSkinWeights(positions, bones, { method: 'rigid', maxInfluences: 4, falloff: 2 })
    expect(skinWeight[0]).toBeCloseTo(1, 6)
    expect(skinWeight[1]).toBe(0)
    expect(skinIndex[0]).toBe(0)          // near root
    expect(skinWeight[4]).toBeCloseTo(1, 6)
    expect(skinIndex[4]).toBe(1)          // near tip
  })

  it('relative distance cutoff ignores far bones (stops distant legs from pulling the body)', () => {
    // 顶点贴着 bone0；bone1 很远。即使 maxInfluences=4，远骨也不应分到权重。
    const nearFar = [
      { head: new THREE.Vector3(0, 0, 0), tail: new THREE.Vector3(0, 0, 0.2) },
      { head: new THREE.Vector3(2, 0, 0), tail: new THREE.Vector3(2, 0, 0.2) },
    ]
    const positions = new Float32Array([0.01, 0, 0.1])
    const { skinIndex, skinWeight } = computeSkinWeights(positions, nearFar, {
      method: 'auto', maxInfluences: 4, falloff: 4, radiusFactor: 2.5,
    })
    expect(skinIndex[0]).toBe(0)
    expect(skinWeight[0]).toBeCloseTo(1, 5)
    expect(skinWeight[1]).toBe(0)
  })

  it('preserves near-bone distance ratios with high falloff instead of flattening to 50:50', () => {
    // 顶点到两根骨分别为 5mm / 15mm。falloff=5 时理论近骨权重约
    // 15^5/(5^5+15^5)=0.996；旧公式在 d^5 后加 1e-6，会错误得到约 0.5。
    const closeBones = [
      { head: new THREE.Vector3(0.005, 0, 0), tail: new THREE.Vector3(0.005, 0, 0.1) },
      { head: new THREE.Vector3(0.015, 0, 0), tail: new THREE.Vector3(0.015, 0, 0.1) },
    ]
    const { skinIndex, skinWeight } = computeSkinWeights(
      new Float32Array([0, 0, 0.05]),
      closeBones,
      { method: 'auto', maxInfluences: 2, falloff: 5 },
    )
    expect(skinIndex[0]).toBe(0)
    expect(skinWeight[0]).toBeGreaterThan(0.99)
    expect(skinWeight[1]).toBeLessThan(0.01)
  })
})

describe('character-builder', () => {
  it('builds a parented bone tree with boneInverses ready', () => {
    const cs = buildCharacterSkeleton(RIG)
    expect(cs.bones).toHaveLength(2)
    const root = cs.boneByName.get('root')!
    const tip = cs.boneByName.get('tip')!
    expect(tip.parent).toBe(root)                    // parented
    expect(tip.position.z).toBeCloseTo(1, 6)         // local = head - parentHead
    expect(cs.skeleton.boneInverses).toHaveLength(2) // bind pose ready
    expect(cs.rootBone).toBe(root)
  })

  it('builds SkinnedMeshes with skinIndex/skinWeight attributes bound to the skeleton', () => {
    const cs = buildCharacterSkeleton(RIG)
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 1, 0, 0, 2], 3))
    const loaded = new THREE.Group()
    loaded.add(new THREE.Mesh(geom, new THREE.MeshStandardMaterial()))
    const meshes = buildCharacterSkinnedMeshes(loaded, cs, RIG.skin, 'k')
    expect(meshes).toHaveLength(1)
    const sm = meshes[0]
    expect(sm).toBeInstanceOf(THREE.SkinnedMesh)
    expect(sm.geometry.attributes.skinIndex).toBeTruthy()
    expect(sm.geometry.attributes.skinWeight).toBeTruthy()
    expect(sm.skeleton).toBe(cs.skeleton)
  })

  it('clones materials so disposing the loader root afterwards does not break the persisted SkinnedMesh (regression)', () => {
    // useViewer3DScene.ts calls buildCharacterSkinnedMeshes(loaded, ...) then immediately
    // disposeObject3D(loaded) — the intermediate GLB Group is only used to bake geometry/
    // weights and is thrown away. If the SkinnedMesh kept the loader's own material
    // instance instead of a clone, disposing `loaded` would dispose a material the
    // persisted SkinnedMesh still renders with (regression from commit 520094d9: cloned
    // `c.material` was built but the SkinnedMesh ctor used `c.object.material` instead).
    const cs = buildCharacterSkeleton(RIG)
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 1, 0, 0, 2], 3))
    const originalMaterial = new THREE.MeshStandardMaterial()
    const loaded = new THREE.Group()
    loaded.add(new THREE.Mesh(geom, originalMaterial))

    const meshes = buildCharacterSkinnedMeshes(loaded, cs, RIG.skin, 'material-lifecycle')
    const sm = meshes[0]

    // must be a distinct clone, not the loader's own material reference
    expect(sm.material).not.toBe(originalMaterial)
    expect(sm.material).toBeInstanceOf(THREE.MeshStandardMaterial)

    let originalDisposed = false
    let skinnedMaterialDisposed = false
    originalMaterial.addEventListener('dispose', () => { originalDisposed = true })
    ;(sm.material as THREE.Material).addEventListener('dispose', () => { skinnedMaterialDisposed = true })

    disposeObject3D(loaded)

    expect(originalDisposed).toBe(true)        // loader root's own material is freed
    expect(skinnedMaterialDisposed).toBe(false) // the persisted SkinnedMesh's clone survives
  })

  it('builds an AnimationClip with a quaternion track for the bone channel', () => {
    const cs = buildCharacterSkeleton(RIG)
    const clips = buildCharacterAnimationClips(RIG, cs.boneByName)
    expect(clips).toHaveLength(1)
    const clip = clips[0]
    expect(clip.name).toBe('bend')
    const track = clip.tracks.find((t) => t.name === 'tip.quaternion')
    expect(track).toBeTruthy()
    expect(track!.values.length).toBe(3 * 4) // 3 frames × quaternion(4)
  })

  it('builds a bind-relative position track on RigSpec.skeletonRoot', () => {
    const rig: RigSpec = {
      ...RIG,
      bones: [
        { name: 'root', parent: null, head: [1, 2, 3], tail: [1, 2, 4] },
        RIG.bones[1],
      ],
      clips: [{
        name: 'jump',
        fps: 2,
        frameCount: 3,
        loop: false,
        channels: {},
        rootTranslation: [[0, 0, 0], [0.5, 0, 1], [1, 0, 0]],
      }],
    }
    const cs = buildCharacterSkeleton(rig)
    const clips = buildCharacterAnimationClips(rig, cs.boneByName)
    expect(clips).toHaveLength(1)
    const track = clips[0].tracks.find((t) => t.name === 'root.position') as THREE.VectorKeyframeTrack
    expect(track).toBeTruthy()
    expect(Array.from(track.times)).toEqual([0, 0.5, 1])
    expect(Array.from(track.values)).toEqual([
      1, 2, 3,
      1.5, 2, 4,
      2, 2, 3,
    ])
  })

  it('bends about a per-bone axis perpendicular to head→tail (not a fixed global X)', () => {
    // 一根沿 +X 伸出的水平骨：弯曲轴应垂直于骨向（不再是固定的模型 X 轴），
    // 否则绕自身长轴“弯曲”对肢体不产生可见摆动。
    const rig: RigSpec = {
      ...RIG,
      bones: [{ name: 'arm', parent: null, head: [0, 0, 0], tail: [1, 0, 0] }],
      boneCount: 1,
      skeletonRoot: 'arm',
      clips: [{ name: 'swing', fps: 30, frameCount: 2, loop: true, channels: { arm: [0, 1.0] } }],
    }
    const cs = buildCharacterSkeleton(rig)
    const clips = buildCharacterAnimationClips(rig, cs.boneByName)
    const track = clips[0].tracks.find((t) => t.name === 'arm.quaternion') as THREE.QuaternionKeyframeTrack
    expect(track).toBeTruthy()
    // 第 2 帧（q=1rad）的四元数虚部 ∝ 旋转轴；对沿 X 的骨，轴的 X 分量必须≈0（垂直于骨向）。
    const q = new THREE.Quaternion(track.values[4], track.values[5], track.values[6], track.values[7])
    const axis = new THREE.Vector3(q.x, q.y, q.z)
    expect(axis.length()).toBeGreaterThan(1e-3)     // 确有旋转
    expect(Math.abs(q.x)).toBeLessThan(1e-6)         // 轴垂直于骨的 +X 方向
  })

  it('vertical leg (along −Z) swings fore/aft: bend axis ≈ ±Y (X–Z plane), not lateral', () => {
    // 回归护栏：模型约定 +X=前方、±Y=侧向、+Z=上。竖直腿绕 Y 摆 → 在 X–Z 平面前后摆（走路）。
    // 早期取 ref=+Y 会得 axis=±X → 腿在 Y–Z 平面左右摆（本次修复的 bug）。
    const rig: RigSpec = {
      ...RIG,
      bones: [{ name: 'leg', parent: null, head: [0, 0, 0], tail: [0, 0, -0.4] }],
      boneCount: 1,
      skeletonRoot: 'leg',
      clips: [{ name: 'walk', fps: 30, frameCount: 2, loop: true, channels: { leg: [0, 0.5] } }],
    }
    const cs = buildCharacterSkeleton(rig)
    const clips = buildCharacterAnimationClips(rig, cs.boneByName)
    const track = clips[0].tracks.find((t) => t.name === 'leg.quaternion') as THREE.QuaternionKeyframeTrack
    expect(track).toBeTruthy()
    // 第 2 帧（q=0.5rad）四元数虚部 ∝ 旋转轴：竖直腿应绕 ±Y（侧向轴）转 → 前后摆。
    const q = new THREE.Quaternion(track.values[4], track.values[5], track.values[6], track.values[7])
    expect(Math.abs(q.y)).toBeGreaterThan(1e-3)     // 轴主分量在 Y
    expect(Math.abs(q.x)).toBeLessThan(1e-6)         // 不含 X（否则会左右摆）
    expect(Math.abs(q.z)).toBeLessThan(1e-6)         // 不含 Z（轴沿骨向无可见摆动）
  })

  it('authored RigBone.axis wins over the head→tail heuristic', () => {
    // 竖直腿若走启发式 → ±Y 前后摆；作者显式写 axis=[1,0,0] 则强制左右摆（证明作者轴优先）。
    const rig: RigSpec = {
      ...RIG,
      bones: [{
        name: 'leg', parent: null, head: [0, 0, 0], tail: [0, 0, -0.4],
        axis: [1, 0, 0],
      }],
      boneCount: 1,
      skeletonRoot: 'leg',
      clips: [{ name: 'side', fps: 30, frameCount: 2, loop: true, channels: { leg: [0, 0.5] } }],
    }
    const cs = buildCharacterSkeleton(rig)
    const clips = buildCharacterAnimationClips(rig, cs.boneByName)
    const track = clips[0].tracks.find((t) => t.name === 'leg.quaternion') as THREE.QuaternionKeyframeTrack
    const q = new THREE.Quaternion(track.values[4], track.values[5], track.values[6], track.values[7])
    expect(Math.abs(q.x)).toBeGreaterThan(1e-3)     // 作者轴 = X
    expect(Math.abs(q.y)).toBeLessThan(1e-6)
    expect(Math.abs(q.z)).toBeLessThan(1e-6)
  })
})
