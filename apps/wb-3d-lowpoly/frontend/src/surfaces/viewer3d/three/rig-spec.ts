// 💡 RigSpec —— 角色 IR（g_to_rig 产物）在前端的类型 + type guard。
//    与 UrdfSpec 并列：URDF ↔ RigSpec；urdf_preview ↔ rig_preview。
//    权重不在 RigSpec 里——由 auto-skin.ts 在前端按需求解。

export interface RigBone {
  /** 骨骼名（= DSL bone 语句 id）。 */
  name: string
  /** 父骨名；根骨为 null。 */
  parent: string | null
  /** head 世界位置（模型根帧，米）。 */
  head: [number, number, number]
  /** tail 世界位置（模型根帧，米）。 */
  tail: [number, number, number]
  /**
   * 可选弯曲铰链轴（模型根帧单位向量方向即可）。作者在 DSL `bone(axis=[…])` 显式声明时带上；
   * 有则动画严格绕此轴转，缺省才走 head→tail 启发式。行走腿骨推荐 `[0,1,0]`（前后摆）。
   */
  axis?: [number, number, number]
}

export interface RigClip {
  name: string
  fps: number
  frameCount: number
  loop: boolean
  /**
   * 每骨标量通道：值 = 绕**该骨弯曲轴**的弯曲角（弧度）。键 = 骨骼名。
   * 弯曲轴优先用 `RigBone.axis`（DSL `bone(axis=…)`）；缺省才按 head→tail 启发式推
   * （见 character-builder.resolveBoneBendAxis）。
   */
  channels: Record<string, number[]>
  /**
   * 模型根帧（Z-up、+X 向前）中的根骨 bind-relative 位移（米）。
   * 目标固定为 `RigSpec.skeletonRoot`，长度必须等于 frameCount。
   */
  rootTranslation?: [number, number, number][]
}

export interface RigSpec {
  version: 1
  /** 可蒙皮网格文件名 <sha>.glb（内容寻址；配 baseUrl 加载）。 */
  meshFilename: string
  /** 根骨名。 */
  skeletonRoot: string
  bones: RigBone[]
  boneCount: number
  skin: {
    method: 'auto' | 'rigid'
    resolution: number
    maxInfluences: number
    falloff: number
  }
  clips: RigClip[]
}

function isVec3(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n))
}

/** Duck-type guard for a wire value shaped like a RigSpec. */
export function isRigSpec(value: unknown): value is RigSpec {
  if (!value || typeof value !== 'object') return false
  const r = value as Partial<RigSpec>
  if (typeof r.meshFilename !== 'string' || r.meshFilename === '') return false
  if (!Array.isArray(r.bones) || r.bones.length === 0) return false
  for (const b of r.bones) {
    if (!b || typeof b !== 'object') return false
    const bone = b as Partial<RigBone>
    if (typeof bone.name !== 'string') return false
    if (bone.parent !== null && typeof bone.parent !== 'string') return false
    if (!isVec3(bone.head) || !isVec3(bone.tail)) return false
    if (bone.axis !== undefined && !isVec3(bone.axis)) return false
  }
  if (typeof r.skeletonRoot !== 'string') return false
  if (!Array.isArray(r.clips)) return false
  for (const clip of r.clips) {
    if (!clip || typeof clip !== 'object') return false
    const c = clip as Partial<RigClip>
    if (
      typeof c.name !== 'string'
      || typeof c.fps !== 'number'
      || !Number.isFinite(c.fps)
      || c.fps <= 0
      || typeof c.frameCount !== 'number'
      || !Number.isInteger(c.frameCount)
      || c.frameCount < 2
      || typeof c.loop !== 'boolean'
      || !c.channels
      || typeof c.channels !== 'object'
    ) return false
    for (const series of Object.values(c.channels)) {
      if (
        !Array.isArray(series)
        || series.length !== c.frameCount
        || !series.every((n) => typeof n === 'number' && Number.isFinite(n))
      ) return false
    }
    if (
      c.rootTranslation !== undefined
      && (
        !Array.isArray(c.rootTranslation)
        || c.rootTranslation.length !== c.frameCount
        || !c.rootTranslation.every(isVec3)
      )
    ) return false
  }
  return true
}
