// 💡 URDF 关节预览运动：与 viewer 内 autoAnimate 同源，供场景预览与 GLB 导出复用
import * as THREE from 'three'
import type { UrdfJoint, UrdfSpec } from './urdf-parser'

export const PREVIEW_MIN_CYCLE_SECONDS = 2.6
export const PREVIEW_LINEAR_SPEED_MPS = 0.08
export const PREVIEW_ANGULAR_SPEED_RAD_PER_SECOND = Math.PI / 4
export const PREVIEW_CONTINUOUS_ANGULAR_SPEED_RAD_PER_SECOND = Math.PI / 5
export const PREVIEW_FALLBACK_PRISMATIC_TRAVEL_METERS = 0.24
export const PREVIEW_FALLBACK_REVOLUTE_TRAVEL_RADIANS = (Math.PI * 2) / 3

const DEFAULT_AXIS: [number, number, number] = [0, 0, 1]
const tempQuaternion = new THREE.Quaternion()
const tempOffset = new THREE.Vector3()

export interface PreviewJointMotion {
  joint: UrdfJoint
  cycleSeconds: number
  phaseOffset: number
}

export function isPreviewJoint(joint: UrdfJoint): boolean {
  return !joint.mimic && (joint.type === 'revolute' || joint.type === 'continuous' || joint.type === 'prismatic')
}

export function previewJointTravelSpan(joint: UrdfJoint): number {
  if (joint.type === 'continuous') return Math.PI * 2
  const lower = joint.limit?.lower
  const upper = joint.limit?.upper
  const hasRange = typeof lower === 'number' && Number.isFinite(lower)
    && typeof upper === 'number' && Number.isFinite(upper) && upper > lower
  if (hasRange) return upper - lower
  if (joint.type === 'prismatic') return PREVIEW_FALLBACK_PRISMATIC_TRAVEL_METERS
  return PREVIEW_FALLBACK_REVOLUTE_TRAVEL_RADIANS
}

export function previewJointCycleSeconds(joint: UrdfJoint): number {
  const span = previewJointTravelSpan(joint)
  if (joint.type === 'continuous') return span / PREVIEW_CONTINUOUS_ANGULAR_SPEED_RAD_PER_SECOND
  const speed = joint.type === 'prismatic' ? PREVIEW_LINEAR_SPEED_MPS : PREVIEW_ANGULAR_SPEED_RAD_PER_SECOND
  return Math.max(PREVIEW_MIN_CYCLE_SECONDS, (span * 2) / speed)
}

export function previewJointPhaseOffset(jointName: string, index: number): number {
  let hash = 0
  for (const c of jointName) hash = (hash * 33 + c.charCodeAt(0)) % 4096
  return THREE.MathUtils.euclideanModulo((hash / 4096) + (index * 0.61803398875), 1)
}

export function previewJointValue(joint: UrdfJoint, phase: number): number {
  if (joint.type === 'continuous') {
    return THREE.MathUtils.euclideanModulo((phase * Math.PI * 2) + Math.PI, Math.PI * 2) - Math.PI
  }
  const lower = joint.limit?.lower
  const upper = joint.limit?.upper
  const hasRange = typeof lower === 'number' && Number.isFinite(lower)
    && typeof upper === 'number' && Number.isFinite(upper) && upper > lower
  if (hasRange) {
    const normalized = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2)
    return THREE.MathUtils.lerp(lower, upper, normalized)
  }
  const wave = Math.sin(phase * Math.PI * 2)
  if (joint.type === 'prismatic') return wave * 0.12
  return wave * (Math.PI / 3)
}

export function buildPreviewMotions(urdfSpec: UrdfSpec): PreviewJointMotion[] {
  const previewJoints = urdfSpec.joints.filter(isPreviewJoint)
  return previewJoints.map((joint, index) => ({
    joint,
    cycleSeconds: previewJointCycleSeconds(joint),
    phaseOffset: previewJointPhaseOffset(joint.name, index),
  }))
}

export function previewAnimationDuration(spec: UrdfSpec): number {
  const motions = buildPreviewMotions(spec)
  if (motions.length === 0) return 0
  return Math.max(...motions.map((m) => m.cycleSeconds))
}

function resolveJointValues(
  explicitValues: Map<string, number>,
  spec: UrdfSpec,
): Map<string, number> {
  const resolved = new Map<string, number>()
  const resolving = new Set<string>()

  const resolveJoint = (name: string): number => {
    const cached = resolved.get(name)
    if (cached !== undefined) return cached

    const joint = spec.joints.find((j) => j.name === name)
    if (!joint) return explicitValues.get(name) ?? 0
    if (resolving.has(name)) return 0

    resolving.add(name)
    const mimic = joint.mimic
    let value = explicitValues.get(name) ?? 0
    if (mimic) value = resolveJoint(mimic.joint) * mimic.multiplier + mimic.offset
    resolving.delete(name)
    resolved.set(name, value)
    return value
  }

  for (const joint of spec.joints) resolveJoint(joint.name)
  return resolved
}

/** 在全局时间 t（秒）下计算所有关节值（含 mimic）。 */
export function computePreviewJointValuesAtTime(spec: UrdfSpec, timeSec: number): Map<string, number> {
  const motions = buildPreviewMotions(spec)
  const explicit = new Map<string, number>()
  for (const m of motions) {
    const phase = THREE.MathUtils.euclideanModulo((timeSec / m.cycleSeconds) + m.phaseOffset, 1)
    explicit.set(m.joint.name, previewJointValue(m.joint, phase))
  }
  return resolveJointValues(explicit, spec)
}

/**
 * 在全局时间 t（秒）下，从作者 clip q(t) 计算所有关节值（含 mimic）。
 * 相邻帧线性插值；loop 时以 frameCount/fps 为周期无缝循环（frame 末尾回绕到 0），
 * 非 loop 时把时间夹到 [0, (frameCount-1)/fps] 并停在末帧。无值 / mimic 关节由
 * resolveJointValues 按 URDF 关系补齐。clip 非法（frameCount<2）时全部回落到 0。
 * 与 buildAuthoredAnimationClip 同源，供实时预览（autoAnimate）复用。
 */
export function computeAuthoredJointValuesAtTime(
  spec: UrdfSpec,
  clip: AuthoredJointAnimationClip,
  timeSec: number,
): Map<string, number> {
  const explicit = new Map<string, number>()
  const frameCount = clip.frameCount
  const fps = Number.isFinite(clip.fps) && clip.fps > 0 ? clip.fps : 30
  if (!Number.isFinite(frameCount) || frameCount < 2) {
    return resolveJointValues(explicit, spec)
  }
  const loop = clip.loop ?? false

  let framePos: number
  if (loop) {
    // 周期 = frameCount 帧：末帧后回绕到 frame 0（作者 q(t) 通常是周期的）。
    framePos = THREE.MathUtils.euclideanModulo(timeSec * fps, frameCount)
  } else {
    framePos = Math.max(0, Math.min(frameCount - 1, timeSec * fps))
  }
  const i0 = Math.floor(framePos)
  const frac = framePos - i0
  const i1 = loop ? (i0 + 1) % frameCount : Math.min(frameCount - 1, i0 + 1)

  for (const [jointName, series] of Object.entries(clip.channels)) {
    if (series.length === 0) continue
    const a = series[Math.min(series.length - 1, i0)]
    if (!Number.isFinite(a)) continue
    const b = series[Math.min(series.length - 1, i1)]
    const value = Number.isFinite(b) ? a + (b - a) * frac : a
    explicit.set(jointName, value)
  }
  return resolveJointValues(explicit, spec)
}

/** 作者 clip 的预览循环时长（秒）：loop 用 frameCount/fps，非 loop 用 (frameCount-1)/fps。 */
export function authoredAnimationDuration(clip: AuthoredJointAnimationClip): number {
  const frameCount = clip.frameCount
  const fps = Number.isFinite(clip.fps) && clip.fps > 0 ? clip.fps : 30
  if (!Number.isFinite(frameCount) || frameCount < 2) return 0
  return (clip.loop ? frameCount : frameCount - 1) / fps
}

export function applyJointValue(
  node: THREE.Object3D,
  spec: UrdfJoint,
  value: number,
): void {
  const axis = new THREE.Vector3(...(spec.axis ?? DEFAULT_AXIS)).normalize()
  switch (spec.type) {
    case 'revolute':
    case 'continuous': {
      tempQuaternion.setFromAxisAngle(axis, value)
      node.quaternion.copy(tempQuaternion)
      break
    }
    case 'prismatic': {
      tempOffset.copy(axis).multiplyScalar(value)
      node.position.copy(tempOffset)
      break
    }
    default:
      break
  }
}

export function applyJointValuesToNodes(
  jointNodes: Map<string, THREE.Object3D>,
  spec: UrdfSpec,
  values: Map<string, number>,
): void {
  for (const joint of spec.joints) {
    const node = jointNodes.get(joint.name)
    if (!node) continue
    if (joint.type !== 'revolute' && joint.type !== 'continuous' && joint.type !== 'prismatic') continue
    applyJointValue(node, joint, values.get(joint.name) ?? 0)
  }
}

export function findJointMotionNodes(root: THREE.Object3D): Map<string, THREE.Object3D> {
  const map = new Map<string, THREE.Object3D>()
  root.traverse((child) => {
    if (!child.name.startsWith('joint-motion:')) return
    map.set(child.name.slice('joint-motion:'.length), child)
  })
  return map
}

function isAnimatableJoint(joint: UrdfJoint): boolean {
  return joint.type === 'revolute' || joint.type === 'continuous' || joint.type === 'prismatic'
}

/** 按 viewer 预览动画规则烘焙一条 AnimationClip（无关节时返回 null）。 */
export function buildUrdfPreviewAnimationClip(
  spec: UrdfSpec,
  jointNodes: Map<string, THREE.Object3D>,
  exportRoot: THREE.Object3D,
): THREE.AnimationClip | null {
  const motions = buildPreviewMotions(spec)
  if (motions.length === 0) return null

  const duration = previewAnimationDuration(spec)
  const fps = 30
  const frameCount = Math.max(2, Math.ceil(duration * fps))
  const times = Array.from({ length: frameCount }, (_, i) => (
    frameCount <= 1 ? 0 : (i / (frameCount - 1)) * duration
  ))

  const animatable = spec.joints.filter((joint) => {
    if (!isAnimatableJoint(joint)) return false
    return jointNodes.has(joint.name)
  })
  if (animatable.length === 0) return null

  const positionSamples = new Map<string, number[]>()
  const rotationSamples = new Map<string, number[]>()
  for (const joint of animatable) {
    if (joint.type === 'prismatic') positionSamples.set(joint.name, [])
    else rotationSamples.set(joint.name, [])
  }

  for (const t of times) {
    const resolved = computePreviewJointValuesAtTime(spec, t)
    applyJointValuesToNodes(jointNodes, spec, resolved)
    exportRoot.updateMatrixWorld(true)

    for (const joint of animatable) {
      const node = jointNodes.get(joint.name)
      if (!node) continue
      if (joint.type === 'prismatic') {
        positionSamples.get(joint.name)?.push(node.position.x, node.position.y, node.position.z)
      } else {
        rotationSamples.get(joint.name)?.push(
          node.quaternion.x,
          node.quaternion.y,
          node.quaternion.z,
          node.quaternion.w,
        )
      }
    }
  }

  const tracks: THREE.KeyframeTrack[] = []
  for (const joint of animatable) {
    const node = jointNodes.get(joint.name)
    if (!node) continue
    if (joint.type === 'prismatic') {
      const values = positionSamples.get(joint.name)
      if (!values || values.length === 0) continue
      tracks.push(new THREE.VectorKeyframeTrack(`${node.name}.position`, times, values))
      continue
    }
    const values = rotationSamples.get(joint.name)
    if (!values || values.length === 0) continue
    tracks.push(new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, times, values))
  }

  if (tracks.length === 0) return null
  return new THREE.AnimationClip(`${spec.name}_joint_preview`, duration, tracks)
}

/**
 * 作者关节轨迹 q(t)：以 URDF 关节名为键的每关节标量数组（弧度 revolute/continuous |
 * 米 prismatic）。结构与后端 g_bake_animation 的 `animation` 端口输出一致（跨包无法
 * 直接共享类型，此处保持结构兼容的本地定义）。
 */
export interface AuthoredJointAnimationClip {
  name: string
  fps: number
  frameCount: number
  loop?: boolean
  channels: Record<string, number[]>
}

/**
 * 按作者 clip 烘焙一条 AnimationClip：采样循环与 buildUrdfPreviewAnimationClip 一致，
 * 只是每帧的显式关节值来自 clip.channels（其余关节走 resolveJointValues 补 mimic / 静止 0）。
 * clip 非法（frameCount < 2 / 无可烘关节 / 无 track）时返回 null，交由调用方回退。
 */
export function buildAuthoredAnimationClip(
  spec: UrdfSpec,
  clip: AuthoredJointAnimationClip,
  jointNodes: Map<string, THREE.Object3D>,
  exportRoot: THREE.Object3D,
): THREE.AnimationClip | null {
  const frameCount = clip.frameCount
  if (!Number.isFinite(frameCount) || frameCount < 2) return null
  const fps = Number.isFinite(clip.fps) && clip.fps > 0 ? clip.fps : 30
  const duration = (frameCount - 1) / fps
  const times = Array.from({ length: frameCount }, (_, i) => (i / (frameCount - 1)) * duration)

  const animatable = spec.joints.filter((joint) => {
    if (!isAnimatableJoint(joint)) return false
    return jointNodes.has(joint.name)
  })
  if (animatable.length === 0) return null

  const positionSamples = new Map<string, number[]>()
  const rotationSamples = new Map<string, number[]>()
  for (const joint of animatable) {
    if (joint.type === 'prismatic') positionSamples.set(joint.name, [])
    else rotationSamples.set(joint.name, [])
  }

  for (let frame = 0; frame < frameCount; frame++) {
    const explicit = new Map<string, number>()
    for (const [jointName, series] of Object.entries(clip.channels)) {
      if (series.length === 0) continue
      const idx = Math.max(0, Math.min(series.length - 1, frame))
      const value = series[idx]
      if (Number.isFinite(value)) explicit.set(jointName, value)
    }
    // resolveJointValues 会填 mimic（按 URDF 关系）并把无值关节兜底为 0。
    const resolved = resolveJointValues(explicit, spec)
    applyJointValuesToNodes(jointNodes, spec, resolved)
    exportRoot.updateMatrixWorld(true)

    for (const joint of animatable) {
      const node = jointNodes.get(joint.name)
      if (!node) continue
      if (joint.type === 'prismatic') {
        positionSamples.get(joint.name)?.push(node.position.x, node.position.y, node.position.z)
      } else {
        rotationSamples.get(joint.name)?.push(
          node.quaternion.x,
          node.quaternion.y,
          node.quaternion.z,
          node.quaternion.w,
        )
      }
    }
  }

  const tracks: THREE.KeyframeTrack[] = []
  for (const joint of animatable) {
    const node = jointNodes.get(joint.name)
    if (!node) continue
    if (joint.type === 'prismatic') {
      const values = positionSamples.get(joint.name)
      if (!values || values.length === 0) continue
      tracks.push(new THREE.VectorKeyframeTrack(`${node.name}.position`, times, values))
      continue
    }
    const values = rotationSamples.get(joint.name)
    if (!values || values.length === 0) continue
    tracks.push(new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, times, values))
  }

  if (tracks.length === 0) return null
  const clipName = clip.name?.trim() ? clip.name.trim() : `${spec.name}_authored`
  return new THREE.AnimationClip(clipName, duration, tracks)
}
