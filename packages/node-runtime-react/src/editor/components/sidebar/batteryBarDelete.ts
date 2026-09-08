import type { Battery } from '../../types.js'
import { isTemplateBattery } from './batteryGrouping.js'

// 合成大标签 + 小标签：固定钉在大标签栏顶端，专门收录用户收藏的电池。
export const FAVORITES_BIG = '__favorites__'
export const FAVORITES_SMALL = 'favorites'

// 合成大标签：文本预设栏。钉在收藏之后，展示已保存的 Panel 文本预设；
// 条目可拖入画布生成预填文字的 text_panel 节点（行为与电池一致）。
export const PRESETS_BIG = '__presets__'

// 右键「删除」/ 行内删除按钮开放范围：
//   ─ 用户保存的提示词（prompt:* 且 builtin !== true）
//   ─ 用户模板（成组模板电池且 builtin === false）
//   ─ Develop「GROUPS」标签下的成组电池（groups/<cat>，本地电池目录可增删）
// 预设提示词 / 预设模板 builtin=true 一律不可删；普通 op 不可删。
// 注意：'group' 删除会物理删除本地电池目录里的文件，且仅在 transport 暴露
// deleteGroupTemplate 路由时由调用方启用（见 canDeleteGroups 闸门）。
export type DeletableKind =
  | { kind: 'prompt'; promptId: string }
  | { kind: 'template'; groupId: string }
  | { kind: 'group'; groupId: string }
  | null

export function getDeletableKind(battery: Battery): DeletableKind {
  if (battery.nodeType === 'prompt' && battery.id.startsWith('prompt:')) {
    return battery.builtin === true ? null : { kind: 'prompt', promptId: battery.id.slice('prompt:'.length) }
  }
  if (isTemplateBattery(battery)) {
    return battery.builtin === false ? { kind: 'template', groupId: battery.id } : null
  }
  // 非模板的成组电池 → Develop「GROUPS」标签项，可删本地电池目录文件。
  if (battery.type === 'group') {
    return { kind: 'group', groupId: battery.id }
  }
  return null
}

export function parseFavoriteBatteryJson(batteryJson: string): Battery | null {
  try {
    const parsed = JSON.parse(batteryJson) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const battery = parsed as Battery
    if (typeof battery.id !== 'string' || typeof battery.name !== 'string') return null
    return battery
  } catch {
    return null
  }
}
