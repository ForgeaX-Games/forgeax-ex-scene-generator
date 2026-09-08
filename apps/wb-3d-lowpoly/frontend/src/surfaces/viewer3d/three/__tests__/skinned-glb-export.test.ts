// 💡 骨骼蒙皮 GLB 导出的端到端验证（无 Blender / GUI glTF viewer 的自动化替代）：
//    1) 结构性检查——真实调用 exportSkinnedGlbBlob 产出 GLB，解出内嵌 JSON chunk，
//       断言 skins/joints/JOINTS_0/WEIGHTS_0/animations 都符合 glTF 标准骨骼蒙皮结构。
//    2) 数值刚性检查——对同一个多关节场景，分别用"经典 joint-motion 节点"（现有
//       urdf-joint-motion.ts 的生产代码路径）和"骨骼蒙皮"（本次新增三个模块）算同一个
//       顶点在同一组关节角度下的世界坐标，两者必须一致，证明蒙皮烘焙 + bind + 动画
//       重采样的整套坐标换算是对的（而不仅仅是"能跑通不报错"）。
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import type { UrdfSpec } from '../urdf-parser'
import { buildRobotSceneGraph } from '../scene-graph-builder'
import { applyJointValuesToNodes, type AuthoredJointAnimationClip } from '../urdf-joint-motion'
import { buildBindSkeleton } from '../skeleton-builder'
import { buildSkinnedMeshes } from '../skinned-mesh-builder'
import { buildBoneAnimationClip } from '../bone-animation'
import {
  buildCharacterAnimationClips,
  buildCharacterSkeleton,
  buildCharacterSkinnedMeshes,
} from '../character-builder'
import { exportCharacterGlbBlob, exportSkinnedGlbBlob } from '../export-glb'
import type { RigSpec } from '../rig-spec'

// GLTFExporter's binary path reads the merged buffer Blob via `FileReader`
// (a browser API). The frontend test project runs under vitest's plain `node`
// environment (no jsdom) — polyfill just enough of FileReader for
// `readAsArrayBuffer` so the real export code path can run unmodified in tests.
if (typeof (globalThis as { FileReader?: unknown }).FileReader === 'undefined') {
  class NodeFileReaderPolyfill {
    result: ArrayBuffer | null = null
    onloadend: (() => void) | null = null
    readAsArrayBuffer(blob: Blob): void {
      void blob.arrayBuffer().then((buf) => {
        this.result = buf
        this.onloadend?.()
      })
    }
  }
  ;(globalThis as { FileReader?: unknown }).FileReader = NodeFileReaderPolyfill
}

// 3 link / 2 revolute joint 的小型链式机构：每个 link 的可视 box 都带一个非零
// origin 偏移，专门用来exercise "mesh 相对 link 的局部变换"这条烘焙路径（如果只用
// origin=0 的 box，mesh-to-link 变换恒为单位矩阵，测不出这段矩阵乘法的 bug）。
function buildSampleSpec(): UrdfSpec {
  return {
    name: 'sample_arm',
    links: [
      {
        name: 'base',
        visuals: [{ origin: { xyz: [0.1, 0, 0] }, geometry: { type: 'box', size: [1, 1, 1] } }],
        collisions: [],
      },
      {
        name: 'armA',
        visuals: [{ origin: { xyz: [0.2, 0, 0] }, geometry: { type: 'box', size: [1, 1, 1] } }],
        collisions: [],
      },
      {
        name: 'armB',
        visuals: [{ origin: { xyz: [0.3, 0.1, 0] }, geometry: { type: 'box', size: [1, 1, 1] } }],
        collisions: [],
      },
    ],
    joints: [
      {
        name: 'shoulder',
        type: 'revolute',
        parent: 'base',
        child: 'armA',
        origin: { xyz: [1, 0, 0], rpy: [0, 0, 0] },
        axis: [0, 0, 1],
        limit: { lower: -Math.PI, upper: Math.PI, effort: 10, velocity: 1 },
      },
      {
        name: 'elbow',
        type: 'revolute',
        parent: 'armA',
        child: 'armB',
        origin: { xyz: [0, 1, 0.5], rpy: [0, 0, 0] },
        axis: [0, 1, 0],
        limit: { lower: -Math.PI, upper: Math.PI, effort: 10, velocity: 1 },
      },
    ],
  }
}

/** GLB (binary glTF) 容器：12 字节 header + 一个或多个 4 字节对齐的 chunk。取出 JSON chunk 并 parse。 */
function extractGlbJson(buffer: ArrayBuffer): any {
  const dv = new DataView(buffer)
  const magic = dv.getUint32(0, true)
  expect(magic).toBe(0x46546c67) // 'glTF'
  let offset = 12
  while (offset < buffer.byteLength) {
    const chunkLength = dv.getUint32(offset, true)
    const chunkType = dv.getUint32(offset + 4, true)
    const chunkStart = offset + 8
    if (chunkType === 0x4e4f534a) { // 'JSON'
      const text = new TextDecoder().decode(new Uint8Array(buffer, chunkStart, chunkLength))
      return JSON.parse(text)
    }
    offset = chunkStart + chunkLength
  }
  throw new Error('no JSON chunk found in GLB')
}

function findMeshOwnedByLink(root: THREE.Object3D, linkName: string): THREE.Mesh {
  let found: THREE.Mesh | null = null
  root.traverse((obj) => {
    if (found) return
    if (obj instanceof THREE.Mesh && obj.userData.urdfLinkName === linkName) found = obj
  })
  if (!found) throw new Error(`no mesh found for link ${linkName}`)
  return found
}

describe('exportSkinnedGlbBlob — structural glTF skin validation', () => {
  it('produces a GLB with standard skins/joints/JOINTS_0/WEIGHTS_0 (+animation) matching the URDF joint tree', async () => {
    const spec = buildSampleSpec()
    const graph = buildRobotSceneGraph(spec, { showVisuals: true, showCollisions: false })

    // 与 useViewer3DScene.ts 的 __viewer_robot__ 包裹方式一致：外层套一层 Y-up 旋转 +
    // 任意落地位移，验证 exportSkinnedGlbBlob 确实只套一次、不会被烘进骨骼/几何体。
    const robotGroup = new THREE.Group()
    robotGroup.name = '__viewer_robot__'
    robotGroup.rotation.x = -Math.PI / 2
    robotGroup.position.set(0.42, 0.17, -0.05)
    robotGroup.add(graph.root)
    robotGroup.updateMatrixWorld(true)

    const blob = await exportSkinnedGlbBlob(robotGroup, spec, null)
    expect(blob.size).toBeGreaterThan(0)
    const json = extractGlbJson(await blob.arrayBuffer())

    // GLTFExporter 给每个 SkinnedMesh node 各生成一条 `skins[]` 条目（即使它们共享
    // 同一个 THREE.Skeleton），所以条目数 == 蒙皮 mesh 数，不是 1；但每条 skin 的
    // joints 数必须一致，都等于骨骼总数（root + 每个 joint 一根 = 3）。
    expect(json.skins).toBeInstanceOf(Array)
    expect(json.skins.length).toBe(spec.links.length)
    for (const skin of json.skins) {
      expect(skin.joints.length).toBe(3)
      expect(skin.inverseBindMatrices).toBeDefined()
    }

    expect(json.meshes).toBeInstanceOf(Array)
    expect(json.meshes.length).toBeGreaterThan(0)
    for (const mesh of json.meshes) {
      for (const primitive of mesh.primitives) {
        expect(primitive.attributes.JOINTS_0).toBeDefined()
        expect(primitive.attributes.WEIGHTS_0).toBeDefined()
      }
    }

    // 每个用到 skin 的 node 都指向一个存在的 skins[] 条目。
    const skinnedNodes = (json.nodes ?? []).filter((n: any) => n.skin !== undefined)
    expect(skinnedNodes.length).toBeGreaterThan(0)
    for (const node of skinnedNodes) expect(json.skins[node.skin]).toBeDefined()

    // 没传 authoredClip，但 revolute 关节存在 → 应该回退到程序化预览动画。
    expect(json.animations).toBeInstanceOf(Array)
    expect(json.animations.length).toBeGreaterThan(0)
    expect(json.animations[0].channels.length).toBeGreaterThan(0)
  })

  it('bakes rigid skinWeight = [1,0,0,0] for every vertex (no smoothing / blending)', async () => {
    const spec = buildSampleSpec()
    const graph = buildRobotSceneGraph(spec, { showVisuals: true, showCollisions: false })
    graph.root.updateMatrixWorld(true)

    const bindSkeleton = buildBindSkeleton(spec)
    const skinnedMeshes = buildSkinnedMeshes(graph.root, spec, bindSkeleton)
    expect(skinnedMeshes.length).toBe(spec.links.length)

    for (const mesh of skinnedMeshes) {
      const skinWeight = mesh.geometry.attributes.skinWeight
      const skinIndex = mesh.geometry.attributes.skinIndex
      expect(skinWeight).toBeDefined()
      expect(skinIndex).toBeDefined()
      for (let v = 0; v < skinWeight.count; v += 1) {
        expect(skinWeight.getX(v)).toBe(1)
        expect(skinWeight.getY(v)).toBe(0)
        expect(skinWeight.getZ(v)).toBe(0)
        expect(skinWeight.getW(v)).toBe(0)
      }
    }
  })
})

describe('exportSkinnedGlbBlob — numeric rigidity cross-check vs. classic joint-motion nodes', () => {
  it('matches the classic joint-node world position of a link vertex under the same joint values', () => {
    const spec = buildSampleSpec()
    const q = { shoulder: 0.6, elbow: -0.9 }

    // ── 参照值：现有生产代码路径（scene-graph-builder + urdf-joint-motion） ──
    const referenceGraph = buildRobotSceneGraph(spec, { showVisuals: true, showCollisions: false })
    applyJointValuesToNodes(referenceGraph.jointNodes, spec, new Map(Object.entries(q)))
    referenceGraph.root.updateMatrixWorld(true)
    const referenceMesh = findMeshOwnedByLink(referenceGraph.root, 'armB')
    const localCorner = new THREE.Vector3(0.5, 0.5, 0.5) // box 几何体的一个顶点（半边长 0.5）
    const referenceWorldPos = localCorner.clone().applyMatrix4(referenceMesh.matrixWorld)

    // ── 骨骼蒙皮路径：必须在 q=0（rest）时读取活跃场景来烘焙 ──
    const bakeGraph = buildRobotSceneGraph(spec, { showVisuals: true, showCollisions: false })
    bakeGraph.root.updateMatrixWorld(true) // rest pose, 所有 jointNodes 都还是默认 identity

    const bindSkeleton = buildBindSkeleton(spec)
    const skinnedMeshes = buildSkinnedMeshes(bakeGraph.root, spec, bindSkeleton)
    const armBSkinned = skinnedMeshes.find((m) => m.name.includes('armB')) ?? skinnedMeshes[skinnedMeshes.length - 1]

    // 用一段 2 帧的 authored clip 把 (shoulder, elbow) 从 0 精确采到 (q.shoulder, q.elbow)，
    // 复用真实的 buildBoneAnimationClip（而不是在测试里重新手写关节合成公式）。
    const authoredClip: AuthoredJointAnimationClip = {
      name: 'probe',
      fps: 1,
      frameCount: 2,
      loop: false,
      channels: { shoulder: [0, q.shoulder], elbow: [0, q.elbow] },
    }
    const clip = buildBoneAnimationClip(spec, bindSkeleton.boneByJointName, authoredClip)
    expect(clip).not.toBeNull()

    // 把骨骼手动 scrub 到 clip 的第二帧（t=1s，对应 authoredClip 的 frame 1），
    // 而不用 AnimationMixer——直接读 track 里烘好的四元数/位置值。
    for (const track of clip!.tracks) {
      const bone = bindSkeleton.bones.find((b) => track.name.startsWith(`${b.name}.`))
      if (!bone) continue
      if (track instanceof THREE.QuaternionKeyframeTrack) {
        bone.quaternion.set(track.values[4], track.values[5], track.values[6], track.values[7])
      } else if (track instanceof THREE.VectorKeyframeTrack) {
        bone.position.set(track.values[3], track.values[4], track.values[5])
      }
    }
    bindSkeleton.rootBone.updateMatrixWorld(true)

    // 蒙皮公式（无外层容器变换时，meshNodeGlobalTransform = I，per glTF 2.0 skinning spec）：
    //   worldPos = boneMatrixWorld(now) · boneInverse(bind) · bakedVertexLocal
    const boneIdx = bindSkeleton.boneIndex.get(bindSkeleton.boneByJointName.get('elbow')!)!
    const elbowBone = bindSkeleton.bones[boneIdx]
    const boneInverse = bindSkeleton.skeleton.boneInverses[boneIdx]
    const skinMatrix = new THREE.Matrix4().multiplyMatrices(elbowBone.matrixWorld, boneInverse)

    // 烘焙（applyMatrix4）只变换坐标、不改变顶点顺序，所以先从"未烘焙"的原始几何体里
    // 按已知局部坐标 (0.5,0.5,0.5) 找到顶点下标，再用同一下标去读烘焙后的坐标。
    const posAttr = armBSkinned.geometry.attributes.position
    const rawMesh = findMeshOwnedByLink(bakeGraph.root, 'armB')
    const rawPos = rawMesh.geometry.attributes.position
    let vertexIndex = -1
    for (let i = 0; i < rawPos.count; i += 1) {
      if (
        Math.abs(rawPos.getX(i) - 0.5) < 1e-9
        && Math.abs(rawPos.getY(i) - 0.5) < 1e-9
        && Math.abs(rawPos.getZ(i) - 0.5) < 1e-9
      ) {
        vertexIndex = i
        break
      }
    }
    expect(vertexIndex).toBeGreaterThanOrEqual(0)
    const bakedVertexLocal = new THREE.Vector3(posAttr.getX(vertexIndex), posAttr.getY(vertexIndex), posAttr.getZ(vertexIndex))

    const skinnedWorldPos = bakedVertexLocal.clone().applyMatrix4(skinMatrix)

    expect(skinnedWorldPos.x).toBeCloseTo(referenceWorldPos.x, 5)
    expect(skinnedWorldPos.y).toBeCloseTo(referenceWorldPos.y, 5)
    expect(skinnedWorldPos.z).toBeCloseTo(referenceWorldPos.z, 5)
  })
})

describe('exportCharacterGlbBlob — root motion', () => {
  it('exports a root-bone translation channel from bind pose even during preview playback', async () => {
    const rig: RigSpec = {
      version: 1,
      meshFilename: 'character.glb',
      skeletonRoot: 'root',
      bones: [{ name: 'root', parent: null, head: [1, 2, 3], tail: [1, 2, 4] }],
      boneCount: 1,
      skin: { method: 'rigid', resolution: 32, maxInfluences: 1, falloff: 4 },
      clips: [{
        name: 'jump',
        fps: 2,
        frameCount: 3,
        loop: false,
        channels: {},
        rootTranslation: [[0, 0, 0], [0.5, 0, 1], [1, 0, 0]],
      }],
    }
    const characterSkeleton = buildCharacterSkeleton(rig)
    const loaded = new THREE.Group()
    loaded.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshBasicMaterial()))
    const meshes = buildCharacterSkinnedMeshes(
      loaded,
      characterSkeleton,
      rig.skin,
      'root-motion-export',
    )
    const root = new THREE.Group()
    root.add(characterSkeleton.rootBone)
    for (const mesh of meshes) root.add(mesh)
    const clips = buildCharacterAnimationClips(rig, characterSkeleton.boneByName)

    // Simulate exporting halfway through preview playback. Export must restore bind position first.
    characterSkeleton.rootBone.position.set(99, 98, 97)
    root.updateMatrixWorld(true)
    const blob = await exportCharacterGlbBlob(root, clips)
    expect(characterSkeleton.rootBone.position.toArray()).toEqual([1, 2, 3])

    const json = extractGlbJson(await blob.arrayBuffer())
    const animation = json.animations[0]
    const translationChannel = animation.channels.find(
      (channel: any) => channel.target.path === 'translation',
    )
    expect(translationChannel).toBeDefined()
    expect(json.nodes[translationChannel.target.node].name).toBe('root')
  })
})
