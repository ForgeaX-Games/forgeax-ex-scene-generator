// 💡 SceneSpec —— 静态 IR（g_to_scene 产物）在前端的类型 + type guard。
//    三路并列：URDF ↔ RigSpec ↔ SceneSpec；urdf_preview ↔ rig_preview ↔ scene_preview。
//    纯静态：一组已置位、已上色的网格引用，前端加载并组合成一个静态场景，导出合并为单个 .glb。

export interface SceneItem {
  /** 网格文件名 <sha>.obj / <sha>.glb（内容寻址；配 baseUrl 加载）。 */
  meshFilename: string
  /** 位置（模型根帧，米）；缺省 = 原点。 */
  origin?: [number, number, number]
  /** 朝向 [r, p, y]（弧度，ZYX）；缺省 = 无旋转。 */
  rpy?: [number, number, number]
  /** 缩放；缺省 = [1,1,1]。 */
  scale?: [number, number, number]
  /** 覆盖颜色 rgba（OBJ 无内嵌色时用）；缺省 = 保留内嵌色 / 默认灰。 */
  rgba?: [number, number, number, number]
  metalness?: number
  roughness?: number
}

export interface SceneSpec {
  version: 1
  items: SceneItem[]
  itemCount: number
}

const isVec = (v: unknown, n: number): boolean =>
  Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x))

/** Duck-type guard for a wire value shaped like a SceneSpec. */
export function isSceneSpec(value: unknown): value is SceneSpec {
  if (!value || typeof value !== 'object') return false
  const s = value as Partial<SceneSpec>
  if (!Array.isArray(s.items) || s.items.length === 0) return false
  for (const it of s.items) {
    if (!it || typeof it !== 'object') return false
    const item = it as Partial<SceneItem>
    if (typeof item.meshFilename !== 'string' || item.meshFilename === '') return false
    if (item.origin !== undefined && !isVec(item.origin, 3)) return false
    if (item.rpy !== undefined && !isVec(item.rpy, 3)) return false
    if (item.scale !== undefined && !isVec(item.scale, 3)) return false
    if (item.rgba !== undefined && !isVec(item.rgba, 4)) return false
  }
  return true
}
