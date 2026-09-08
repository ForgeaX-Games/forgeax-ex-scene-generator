// 💡 角色渲染构建：RigSpec → THREE.Skeleton（自由骨树）+ SkinnedMesh（前端求权重）+ 动画 clip。
//    与 skeleton-builder.ts / skinned-mesh-builder.ts（URDF 刚性蒙皮）并列，区别：
//    - 骨骼是自由骨（无 joint 轴/限位），local 变换 = head 相对父 head 的平移，rest 旋转为单位；
//      动画弯曲轴**不是**固定 X，而是每根骨按 head→tail 方向算出的垂直铰链轴（见
//      computeBoneBendAxis），使 tail 真正决定摆动平面；rest 为单位不影响蒙皮 bind；
//    - 权重不是 100% 刚性，而是 auto-skin.ts 求得的每顶点 4 骨平滑权重；
//    - 骨与网格都在「模型根帧」（Z-up，与 g_bake_object 合并网格一致）；weights 在模型根帧
//      求解。boneInverses 在挂进外层 Y-up group 之前算好（纯模型根帧，boneMatrix=group）；
//      SkinnedMesh 用默认 AttachedBindMode——three 每帧把 bindMatrixInverse 重设为
//      inverse(mesh.matrixWorld)，正好抵消网格自身的 group 变换，于是最终渲染 = boneMatrix·pos
//      = group·pos，与骨架/SkeletonHelper（同样只套一次 group）严丝合缝。切勿在挂 group 后再
//      calculateInverses（会让 boneMatrix=I，group 被 bindMatrixInverse 抵消掉 → 网格塌回模型帧）。
import * as THREE from 'three'
import type { RigSpec, RigClip, RigBone } from './rig-spec'
import { computeSkinWeightsCached, type BoneSegment, type AutoSkinParams } from './auto-skin'

export interface CharacterSkeleton {
  rootBone: THREE.Bone
  bones: THREE.Bone[]
  boneByName: Map<string, THREE.Bone>
  /** 与 bones 同序：每根骨在模型根帧的 head/tail 线段，供 auto-skin 求权重。 */
  segments: BoneSegment[]
  skeleton: THREE.Skeleton
  /** 根骨绑定姿态下的局部位置，用于停止/切换动画后精确复位根运动。 */
  rootBindPosition: THREE.Vector3
}

/**
 * 从 RigSpec 构建绑定姿态骨树。每根 bone 的 local 位置 = head − parentHead（rest 旋转
 * 为单位四元数，骨骼原点落在 head）；未按拓扑排序时用定点循环反复消费"父已存在"的骨。
 */
export function buildCharacterSkeleton(rigSpec: RigSpec): CharacterSkeleton {
  const boneByName = new Map<string, THREE.Bone>()
  const headByName = new Map<string, THREE.Vector3>()
  const specByName = new Map(rigSpec.bones.map((b) => [b.name, b]))

  for (const b of rigSpec.bones) {
    const bone = new THREE.Bone()
    bone.name = b.name
    boneByName.set(b.name, bone)
    headByName.set(b.name, new THREE.Vector3(b.head[0], b.head[1], b.head[2]))
  }

  // 拓扑挂链：父存在才挂，反复扫直到无进展。
  const bones: THREE.Bone[] = []
  const pending = [...rigSpec.bones]
  let guard = 0
  const attached = new Set<string>()
  while (pending.length > 0 && guard <= rigSpec.bones.length + 1) {
    guard += 1
    let progressed = false
    for (let i = pending.length - 1; i >= 0; i -= 1) {
      const b = pending[i]
      const parentName = b.parent
      const isRoot = parentName === null || !specByName.has(parentName)
      if (!isRoot && !attached.has(parentName!)) continue
      const bone = boneByName.get(b.name)!
      const head = headByName.get(b.name)!
      if (isRoot) {
        bone.position.copy(head)
      } else {
        const parentBone = boneByName.get(parentName!)!
        const parentHead = headByName.get(parentName!)!
        bone.position.copy(head).sub(parentHead)
        parentBone.add(bone)
      }
      attached.add(b.name)
      bones.push(bone)
      pending.splice(i, 1)
      progressed = true
    }
    if (!progressed) break
  }

  // 根骨：优先 skeletonRoot；否则第一根被当作根挂载的骨。
  const rootBone = boneByName.get(rigSpec.skeletonRoot) ?? bones[0]
  if (pending.length > 0) {
    console.warn('[viewer/character-builder] some bones could not resolve their parent chain', {
      unresolved: pending.map((b) => b.name),
    })
    // 兜底：把剩余骨直接挂到根骨。
    for (const b of pending) {
      const bone = boneByName.get(b.name)!
      const head = headByName.get(b.name)!
      bone.position.copy(head).sub(rootBone.position)
      rootBone.add(bone)
      bones.push(bone)
    }
  }

  // 绑定姿态：此刻骨树未挂进任何父节点，matrixWorld = 纯模型根帧变换（不含外层 Y-up 旋转）。
  rootBone.updateMatrixWorld(true)
  const skeleton = new THREE.Skeleton(bones)

  // 骨段（模型根帧）与 bones 同序。
  const segments: BoneSegment[] = bones.map((bone) => {
    const spec = specByName.get(bone.name)
    if (spec) {
      return {
        head: new THREE.Vector3(spec.head[0], spec.head[1], spec.head[2]),
        tail: new THREE.Vector3(spec.tail[0], spec.tail[1], spec.tail[2]),
      }
    }
    const p = new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld)
    return { head: p.clone(), tail: p.clone().add(new THREE.Vector3(0, 0, 0.05)) }
  })

  return { rootBone, bones, boneByName, segments, skeleton, rootBindPosition: rootBone.position.clone() }
}

/** 三角面顶点下标数组化：有 `geometry.index` 就用它，否则该几何体是非索引三角面（每 3 个
 * 连续顶点 = 一个三角形，无顶点共享），合成一个等价的顺序 index，好让 auto-skin 的邻接图
 * 照样能建（各 part 网格内部/彼此之间靠焊接去重）。 */
function triangleIndexOf(geometry: THREE.BufferGeometry): Uint32Array {
  if (geometry.index) return Uint32Array.from(geometry.index.array)
  const vertexCount = geometry.attributes.position.count
  const triCount = Math.floor(vertexCount / 3) * 3
  const index = new Uint32Array(triCount)
  for (let i = 0; i < triCount; i += 1) index[i] = i
  return index
}

/**
 * 从已加载的可蒙皮网格（g_bake_object 合并 GLB 的 THREE 场景）构建 SkinnedMesh 列表：
 * 每个 Mesh 的几何体烘进模型根帧（applyMatrix4(mesh.matrixWorld)，loadedRoot 视为单位帧）。
 *
 * **权重求解在所有 part 网格合并后一次性完成**（而不是逐 mesh 独立求解）：各 part 分别
 * bake、默认互不共享顶点，测地距离的顶点焊接必须跨 part 一起做才能把物理接触的部件"缝"
 * 进同一张连通图（见 auto-skin.ts 头注释）——所以这里先把所有 mesh 的顶点/三角面拼成一份
 * 合并数据，整体求解一次，再按各自的顶点区间切回每个 mesh 自己的 skinIndex/skinWeight。
 * bind 到共享 skeleton（bindMatrix=identity）。`cacheKeyBase` 应含 rig 指纹 + skin 参数，
 * 使权重按（网格 + 骨架 + 参数）缓存。
 */
export function buildCharacterSkinnedMeshes(
  loadedRoot: THREE.Object3D,
  characterSkeleton: CharacterSkeleton,
  params: AutoSkinParams,
  cacheKeyBase: string,
): THREE.SkinnedMesh[] {
  const { skeleton, segments } = characterSkeleton
  loadedRoot.updateMatrixWorld(true)

  const identity = new THREE.Matrix4()

  interface Collected {
    object: THREE.Mesh
    geometry: THREE.BufferGeometry
    material: THREE.Material | THREE.Material[]
    positions: Float32Array
    index: Uint32Array
  }
  const collected: Collected[] = []

  loadedRoot.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.SkinnedMesh) return
    const geometry = object.geometry
    if (!geometry || !geometry.attributes.position) return

    const bakedGeometry = geometry.clone()
    bakedGeometry.applyMatrix4(object.matrixWorld)

    collected.push({
      object,
      geometry: bakedGeometry,
      // Clone (not reuse) the material: the caller disposes `loadedRoot` right
      // after this returns (see useViewer3DScene.ts), and disposeObject3D()
      // disposes every material/texture it finds — reusing the reference would
      // hand the persisted SkinnedMesh an already-disposed material.
      material: Array.isArray(object.material) ? object.material.map((m) => m.clone()) : object.material.clone(),
      positions: bakedGeometry.attributes.position.array as Float32Array,
      index: triangleIndexOf(bakedGeometry),
    })
  })

  if (collected.length === 0) return []

  // 拼一份合并数据：顶点按 mesh 顺序拼接，三角面下标按各 mesh 的顶点偏移平移。
  const vertexOffsets: number[] = []
  let totalVertices = 0
  let totalTriIndices = 0
  for (const c of collected) {
    vertexOffsets.push(totalVertices)
    totalVertices += c.positions.length / 3
    totalTriIndices += c.index.length
  }

  const combinedPositions = new Float32Array(totalVertices * 3)
  const combinedIndex = new Uint32Array(totalTriIndices)
  let idxCursor = 0
  for (let i = 0; i < collected.length; i += 1) {
    const c = collected[i]
    const offset = vertexOffsets[i]
    combinedPositions.set(c.positions, offset * 3)
    for (let k = 0; k < c.index.length; k += 1) {
      combinedIndex[idxCursor + k] = c.index[k] + offset
    }
    idxCursor += c.index.length
  }

  const cacheKey = `${cacheKeyBase}#combined:${totalVertices}:${combinedIndex.length}`
  const binding = computeSkinWeightsCached(cacheKey, combinedPositions, segments, params, combinedIndex)

  const meshes: THREE.SkinnedMesh[] = []
  for (let i = 0; i < collected.length; i += 1) {
    const c = collected[i]
    const vertexCount = c.positions.length / 3
    const offset = vertexOffsets[i]
    const skinIndex = binding.skinIndex.subarray(offset * 4, (offset + vertexCount) * 4)
    const skinWeight = binding.skinWeight.subarray(offset * 4, (offset + vertexCount) * 4)

    c.geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4))
    c.geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4))

    const skinnedMesh = new THREE.SkinnedMesh(c.geometry, c.material)
    skinnedMesh.name = c.object.name ? `skinned_${c.object.name}` : `skinned_${i}`
    skinnedMesh.castShadow = true
    skinnedMesh.receiveShadow = true
    skinnedMesh.bind(skeleton, identity)
    meshes.push(skinnedMesh)
  }

  return meshes
}

/** 模型根帧约定：Z-up、+X 为角色前方（走路朝向）、±Y 为左右（侧向）。 */
const MODEL_UP = new THREE.Vector3(0, 0, 1)
const MODEL_FORWARD = new THREE.Vector3(1, 0, 0)
/** 兜底弯曲轴（零长/退化骨用）：模型帧 +Y（侧向轴）→ 竖直骨绕之得前后摆。 */
const FALLBACK_BEND_AXIS = new THREE.Vector3(0, 1, 0)

/**
 * 解析一根骨的弯曲(铰链)轴（模型根帧）。
 *
 * **优先**：作者在 DSL `bone(axis=[x,y,z])` / RigBone.axis 显式声明的轴（归一化后使用）。
 * 轴若几乎平行骨向（绕自身长轴转无可视弯曲），投影掉 along 分量再归一；投影后退化则忽略。
 *
 * **缺省启发式**（未声明 axis 时）：`along = normalize(tail − head)`；`axis = normalize(ref × along)`。
 * - 骨向近竖直（|along·Z|≥0.9）→ ref=+X（前方）→ axis≈±Y → 前后摆（行走）。
 * - 否则 → ref=+Z（上）→ 水平轴 → 上下摆。
 *
 * rest 姿态下骨局部帧 == 模型根帧，故模型帧轴即动画局部旋转轴。
 * 某根骨摆反了，把该通道 `q` 整体取负即可。
 */
function resolveBoneBendAxis(bone: RigBone): THREE.Vector3 {
  const along = new THREE.Vector3(
    bone.tail[0] - bone.head[0],
    bone.tail[1] - bone.head[1],
    bone.tail[2] - bone.head[2],
  )
  const alongLenSq = along.lengthSq()
  if (alongLenSq > 1e-10) along.multiplyScalar(1 / Math.sqrt(alongLenSq))

  if (bone.axis) {
    const authored = new THREE.Vector3(bone.axis[0], bone.axis[1], bone.axis[2])
    if (authored.lengthSq() > 1e-12) {
      authored.normalize()
      // 去掉沿骨分量，避免「绕骨长轴拧」导致看不见摆动。
      if (alongLenSq > 1e-10) {
        const parallel = along.clone().multiplyScalar(authored.dot(along))
        authored.sub(parallel)
      }
      if (authored.lengthSq() > 1e-10) return authored.normalize()
    }
  }

  if (alongLenSq < 1e-10) return FALLBACK_BEND_AXIS.clone()
  const ref = Math.abs(along.dot(MODEL_UP)) < 0.9 ? MODEL_UP : MODEL_FORWARD
  const axis = new THREE.Vector3().crossVectors(ref, along)
  if (axis.lengthSq() < 1e-10) return FALLBACK_BEND_AXIS.clone()
  return axis.normalize()
}

/**
 * 从 RigSpec 的 clip 构建 THREE.AnimationClip：每个通道（键=骨骼名）的标量值解释为绕
 * **该骨弯曲轴**（优先 RigBone.axis，否则 head→tail 启发式，见 resolveBoneBendAxis）的旋转角
 * （弧度），采样为 QuaternionKeyframeTrack（rest 旋转为单位）。只保留命中 boneByName 的通道。
 */
export function buildCharacterAnimationClips(
  rigSpec: RigSpec,
  boneByName: Map<string, THREE.Bone>,
): THREE.AnimationClip[] {
  // 每根骨的弯曲轴解析一次，供所有 clip 复用。
  const bendAxisByName = new Map<string, THREE.Vector3>()
  for (const b of rigSpec.bones) bendAxisByName.set(b.name, resolveBoneBendAxis(b))
  const clips: THREE.AnimationClip[] = []
  for (const clip of rigSpec.clips) {
    const tracks = buildClipTracks(clip, rigSpec.skeletonRoot, boneByName, bendAxisByName)
    if (tracks.length === 0) continue
    const fps = Number.isFinite(clip.fps) && clip.fps > 0 ? clip.fps : 30
    const duration = clip.frameCount > 1 ? (clip.frameCount - 1) / fps : 0
    const anim = new THREE.AnimationClip(clip.name || 'character_clip', duration, tracks)
    clips.push(anim)
  }
  return clips
}

function buildClipTracks(
  clip: RigClip,
  skeletonRoot: string,
  boneByName: Map<string, THREE.Bone>,
  bendAxisByName: Map<string, THREE.Vector3>,
): THREE.KeyframeTrack[] {
  const fps = Number.isFinite(clip.fps) && clip.fps > 0 ? clip.fps : 30
  const tracks: THREE.KeyframeTrack[] = []
  const quat = new THREE.Quaternion()

  for (const [boneName, series] of Object.entries(clip.channels)) {
    const bone = boneByName.get(boneName)
    if (!bone || !Array.isArray(series) || series.length === 0) continue
    const axis = bendAxisByName.get(boneName) ?? FALLBACK_BEND_AXIS
    const frameCount = series.length
    const times = new Float32Array(frameCount)
    const values = new Float32Array(frameCount * 4)
    const rest = bone.quaternion
    for (let i = 0; i < frameCount; i += 1) {
      times[i] = i / fps
      quat.setFromAxisAngle(axis, series[i])
      quat.premultiply(rest)
      values[i * 4] = quat.x
      values[i * 4 + 1] = quat.y
      values[i * 4 + 2] = quat.z
      values[i * 4 + 3] = quat.w
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, Array.from(times), Array.from(values)))
  }
  const rootBone = boneByName.get(skeletonRoot)
  if (rootBone && clip.rootTranslation && clip.rootTranslation.length > 0) {
    const frameCount = clip.rootTranslation.length
    const times = new Float32Array(frameCount)
    const values = new Float32Array(frameCount * 3)
    const bind = rootBone.position
    for (let i = 0; i < frameCount; i += 1) {
      const offset = clip.rootTranslation[i]
      times[i] = i / fps
      values[i * 3] = bind.x + offset[0]
      values[i * 3 + 1] = bind.y + offset[1]
      values[i * 3 + 2] = bind.z + offset[2]
    }
    tracks.push(
      new THREE.VectorKeyframeTrack(
        `${rootBone.name}.position`,
        Array.from(times),
        Array.from(values),
      ),
    )
  }
  return tracks
}
