// 💡 骨骼蒙皮导出：把现有 authored/preview 关节动画重采样为驱动绑定骨骼的 AnimationClip。
//    采样循环与 urdf-joint-motion.ts 的 buildAuthoredAnimationClip / buildUrdfPreviewAnimationClip
//    完全一致（同一套 q(t) 计算），区别只在于"每帧怎么把关节值写进骨骼变换"：
//    骨骼的本地变换本身已经带了 joint.origin 的静态旋转/位移（见 skeleton-builder.ts），
//    所以这里要用 restQuaternion/restPosition 与关节运动量组合，而不能像旧的
//    `joint-motion:<name>` 节点那样直接覆盖（那个节点本身没有 origin 偏移）。
import * as THREE from 'three'
import type { UrdfJoint, UrdfSpec } from './urdf-parser'
import {
  computeAuthoredJointValuesAtTime,
  computePreviewJointValuesAtTime,
  previewAnimationDuration,
  type AuthoredJointAnimationClip,
} from './urdf-joint-motion'

const DEFAULT_AXIS: [number, number, number] = [0, 0, 1]
const BONE_ANIMATION_FPS = 30

function isAnimatableJoint(joint: UrdfJoint): boolean {
  return joint.type === 'revolute' || joint.type === 'continuous' || joint.type === 'prismatic'
}

interface BoneRestPose {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
}

function captureRestPoses(boneByJointName: Map<string, THREE.Bone>): Map<string, BoneRestPose> {
  const rest = new Map<string, BoneRestPose>()
  for (const [jointName, bone] of boneByJointName) {
    rest.set(jointName, { position: bone.position.clone(), quaternion: bone.quaternion.clone() })
  }
  return rest
}

/**
 * 把关节值 q 写进骨骼的本地变换：骨骼本地变换 = origin（rest）⊕ 关节运动。
 * - revolute/continuous：restQuaternion · axisAngleQuat(axis, q)（axis 是 origin 旋转之后
 *   的局部坐标系里定义的，因此右乘）。
 * - prismatic：restPosition + restQuaternion.rotate(axis · q)（平移量先按 origin 旋转
 *   转到父骨骼坐标系，再叠加到 rest 位置上）。
 * 与 urdf-joint-motion.ts 里 applyJointValue 对 `joint-motion:<name>` 节点的写法保持
 * 同一套约定，只是这里多了一层 rest 组合。
 */
function applyJointValueToBone(bone: THREE.Bone, rest: BoneRestPose, joint: UrdfJoint, value: number): void {
  const axis = new THREE.Vector3(...(joint.axis ?? DEFAULT_AXIS)).normalize()
  switch (joint.type) {
    case 'revolute':
    case 'continuous': {
      const motion = new THREE.Quaternion().setFromAxisAngle(axis, value)
      bone.quaternion.copy(rest.quaternion).multiply(motion)
      break
    }
    case 'prismatic': {
      const offset = axis.multiplyScalar(value).applyQuaternion(rest.quaternion)
      bone.position.copy(rest.position).add(offset)
      break
    }
    default:
      break
  }
}

/**
 * 按 authored/preview 关节轨迹重采样一条驱动骨骼的 AnimationClip（与
 * buildAuthoredAnimationClip / buildUrdfPreviewAnimationClip 用同一套时间轴 + q(t)
 * 计算，只是写入目标换成骨骼）。采样过程中会临时改写骨骼的 position/quaternion，
 * 采样结束后会把骨骼恢复到 rest（q=0）姿态——蒙皮的 bindMatrix/boneInverses 都是
 * 按 rest 姿态算好的（见 skeleton-builder.ts / skinned-mesh-builder.ts），导出前骨骼
 * 必须留在 rest 姿态，否则静态帧（t=0）看到的模型会是被采样打乱的最后一帧姿态。
 * 无可动关节 / clip 非法时返回 null。
 */
export function buildBoneAnimationClip(
  spec: UrdfSpec,
  boneByJointName: Map<string, THREE.Bone>,
  authoredClip?: AuthoredJointAnimationClip | null,
): THREE.AnimationClip | null {
  const animatable = spec.joints.filter((joint) => isAnimatableJoint(joint) && boneByJointName.has(joint.name))
  if (animatable.length === 0) return null

  let times: number[]
  let duration: number
  let clipName: string
  let sampleValuesAtTime: (t: number) => Map<string, number>

  if (authoredClip) {
    const frameCount = authoredClip.frameCount
    if (!Number.isFinite(frameCount) || frameCount < 2) return null
    const fps = Number.isFinite(authoredClip.fps) && authoredClip.fps > 0 ? authoredClip.fps : 30
    duration = (frameCount - 1) / fps
    times = Array.from({ length: frameCount }, (_, i) => (i / (frameCount - 1)) * duration)
    clipName = authoredClip.name?.trim() ? authoredClip.name.trim() : `${spec.name}_authored_skinned`
    sampleValuesAtTime = (t) => computeAuthoredJointValuesAtTime(spec, authoredClip, t)
  } else {
    duration = previewAnimationDuration(spec)
    if (duration <= 0) return null
    const frameCount = Math.max(2, Math.ceil(duration * BONE_ANIMATION_FPS))
    times = Array.from({ length: frameCount }, (_, i) => (frameCount <= 1 ? 0 : (i / (frameCount - 1)) * duration))
    clipName = `${spec.name}_joint_preview_skinned`
    sampleValuesAtTime = (t) => computePreviewJointValuesAtTime(spec, t)
  }

  const restByJoint = captureRestPoses(boneByJointName)

  const positionSamples = new Map<string, number[]>()
  const rotationSamples = new Map<string, number[]>()
  for (const joint of animatable) {
    if (joint.type === 'prismatic') positionSamples.set(joint.name, [])
    else rotationSamples.set(joint.name, [])
  }

  for (const t of times) {
    const values = sampleValuesAtTime(t)
    for (const joint of animatable) {
      const bone = boneByJointName.get(joint.name)
      const rest = restByJoint.get(joint.name)
      if (!bone || !rest) continue
      applyJointValueToBone(bone, rest, joint, values.get(joint.name) ?? 0)
      if (joint.type === 'prismatic') {
        positionSamples.get(joint.name)?.push(bone.position.x, bone.position.y, bone.position.z)
      } else {
        rotationSamples.get(joint.name)?.push(bone.quaternion.x, bone.quaternion.y, bone.quaternion.z, bone.quaternion.w)
      }
    }
  }

  // 采样只是"读回骨骼当前姿态"的临时手段，导出前把骨骼复位回 rest（见函数头注释）。
  for (const [jointName, bone] of boneByJointName) {
    const rest = restByJoint.get(jointName)
    if (!rest) continue
    bone.position.copy(rest.position)
    bone.quaternion.copy(rest.quaternion)
  }

  const tracks: THREE.KeyframeTrack[] = []
  for (const joint of animatable) {
    const bone = boneByJointName.get(joint.name)
    if (!bone) continue
    if (joint.type === 'prismatic') {
      const values = positionSamples.get(joint.name)
      if (!values || values.length === 0) continue
      tracks.push(new THREE.VectorKeyframeTrack(`${bone.name}.position`, times, values))
      continue
    }
    const values = rotationSamples.get(joint.name)
    if (!values || values.length === 0) continue
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, values))
  }

  if (tracks.length === 0) return null
  return new THREE.AnimationClip(clipName, duration, tracks)
}
