// 💡 骨骼蒙皮导出：从 UrdfSpec 构建绑定姿态骨骼树（每个 joint 一根 Bone + 一根根骨骼）
//    纯函数，不依赖任何已渲染场景——本地变换直接取自 originToMatrix4(joint.origin)，
//    与 scene-graph-builder.ts 建 jointFrame 的逻辑并列，但产出 THREE.Bone 而不是 THREE.Group。
import * as THREE from 'three'
import type { UrdfSpec } from './urdf-parser'
import { findRootLink, originToMatrix4 } from './urdf-parser'

export const ROOT_BONE_NAME = 'bone:__root__'

export interface BindSkeleton {
  rootBone: THREE.Bone
  /** 所有骨骼，index 与 skeleton.bones 一致（rootBone 排第一）。 */
  bones: THREE.Bone[]
  /** joint 名 → 该 joint 对应的骨骼（骨骼的本地变换 = joint.origin）。 */
  boneByJointName: Map<string, THREE.Bone>
  /** 骨骼 → 其在 bones/skeleton.bones 中的下标，供蒙皮 skinIndex 使用。 */
  boneIndex: Map<THREE.Bone, number>
  /** 绑定姿态（q=0）下已算好 boneInverses 的 Skeleton。 */
  skeleton: THREE.Skeleton
}

/**
 * 从 UrdfSpec 构建绑定姿态骨骼树。根 link 对应 `bone:__root__`，每个 joint 对应
 * 一根同名骨骼（`bone:<jointName>`），本地变换取自该 joint 的 `origin`。
 * 关节按 parent/child 挂好父子链——不假设 `spec.joints` 已按拓扑顺序排列，用
 * 一个简单的定点循环反复消费"父骨骼已存在"的 joint，直到全部处理完或无法再推进。
 */
export function buildBindSkeleton(spec: UrdfSpec): BindSkeleton {
  const rootLinkName = findRootLink(spec)

  const rootBone = new THREE.Bone()
  rootBone.name = ROOT_BONE_NAME

  const boneByJointName = new Map<string, THREE.Bone>()
  const boneByLink = new Map<string, THREE.Bone>()
  if (rootLinkName) boneByLink.set(rootLinkName, rootBone)

  const bones: THREE.Bone[] = [rootBone]
  const pendingJoints = [...spec.joints]
  let guard = 0
  while (pendingJoints.length > 0 && guard <= spec.joints.length) {
    guard += 1
    let progressed = false
    for (let i = pendingJoints.length - 1; i >= 0; i -= 1) {
      const joint = pendingJoints[i]
      const parentBone = boneByLink.get(joint.parent)
      if (!parentBone) continue

      const bone = new THREE.Bone()
      bone.name = `bone:${joint.name}`
      bone.applyMatrix4(originToMatrix4(joint.origin))
      parentBone.add(bone)

      boneByJointName.set(joint.name, bone)
      boneByLink.set(joint.child, bone)
      bones.push(bone)
      pendingJoints.splice(i, 1)
      progressed = true
    }
    if (!progressed) break
  }

  if (pendingJoints.length > 0) {
    console.warn('[viewer/skeleton-builder] could not resolve parent chain for some joints (missing/cyclic link references)', {
      unresolved: pendingJoints.map((j) => j.name),
    })
  }

  // 绑定姿态（q=0）：此刻骨骼树未挂到任何父节点，rootBone.matrixWorld 即代表
  // "纯 origin 链"的世界矩阵——不含后续导出时套的外层 Y-up 旋转（那层旋转只在
  // export-glb.ts 组装容器时套一次，不烘进骨骼本身）。
  rootBone.updateMatrixWorld(true)

  const boneIndex = new Map<THREE.Bone, number>()
  bones.forEach((bone, index) => boneIndex.set(bone, index))

  const skeleton = new THREE.Skeleton(bones)

  return { rootBone, bones, boneByJointName, boneIndex, skeleton }
}
