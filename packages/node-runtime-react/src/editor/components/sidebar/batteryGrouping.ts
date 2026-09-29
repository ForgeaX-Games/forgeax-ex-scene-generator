// 大/小标签派生与排序（自 BatteryBar.tsx 抽出的纯函数层，便于单测与复用）。
//   ─ 大标签（左侧 rail 一级分组）
//   ─ 小标签（手风琴二级分组）
//   ─ 组内电池排序（部分大/小标签有人工 curated 顺序，其余 A→Z）
// 这些函数全部是无副作用的派生逻辑，不依赖 React / DOM / store。
import type { Battery } from '../../types.js'

// 模板/多项目相关字段不在通用 Battery 类型中（属 app 级），用局部扩展类型读取，保持移植忠实度
export type CatalogBattery = Battery & { sourcePath?: string; projectTypes?: string[] }

// 模板判定：group 电池且大标签不是 'groups'。
//   groups/<cat>   → 大标签 'groups' → Develop 模式 GROUPS 大标签（普通成组电池）
//   templates/<cat> → 大标签 'templates' → Templates 模式（特殊子集）
//   无 displayGroup 的图内 group → 大标签 'groups' → Develop（保持原行为）
export function catalogBatteryKey(battery: Battery): string {
  return battery.sourcePath ?? battery.id
}

export function isTemplateBattery(battery: Battery): boolean {
  return battery.type === 'group' && getBigLabel(battery) !== 'groups'
}

export function getBigLabel(battery: Battery): string {
  if (battery.displayGroup) return battery.displayGroup.split('/')[0] || battery.type
  if (battery.type === 'ts') return battery.category.split('/')[0] || battery.type
  if (battery.type === 'group') return 'groups'
  return battery.type
}

/** 模板电池所在子目录名（templates/{category}/{subfolder}/…） */
export function getTemplateSubfolder(battery: Battery): string {
  const sourcePath = (battery as CatalogBattery).sourcePath
  if (!sourcePath) return battery.id
  const parts = sourcePath.replace(/\\/g, '/').split('/')
  const idx = parts.indexOf('templates')
  if (idx >= 0 && parts.length > idx + 2) return parts[idx + 2]
  return battery.id
}

/**
 * 模板电池的「真实小标签」——仅当目录结构为 `templates/{大标签}/{小标签}/{模板}/file.json`
 * （大标签与模板文件夹之间还夹了一层小标签目录）时返回该小标签；扁平的
 * `templates/{大标签}/{模板}/file.json`（子目录名即模板名，无独立小标签）返回 null。
 * 用于让 Templates 模式与 Develop 模式一致地以小标签手风琴分组，同时不把扁平模板
 * 拆成「每个模板一个同名小标签」的冗余分组。
 */
export function getTemplateSmallLabel(battery: Battery): string | null {
  const sourcePath = (battery as CatalogBattery).sourcePath
  if (!sourcePath) return null
  const parts = sourcePath.replace(/\\/g, '/').split('/')
  const idx = parts.indexOf('templates')
  if (idx < 0) return null
  // 模板 json 的所在目录 = parts[length-2]；小标签候选 = parts[idx+2]。
  // 仅当二者不是同一层（即大标签与模板文件夹之间确有一层小标签）才算有真实小标签。
  if (parts.length - 2 > idx + 2) return parts[idx + 2]
  return null
}

export function getSmallLabel(battery: Battery): string {
  // Batteries group by their on-disk layout "bigTag/smallTag" (category), or by
  // an explicit displayGroup override (templates). The accordion sub-group is the
  // SECOND path segment; fall back to the first segment / type when a battery
  // sits directly under its big tag with no sub-folder.
  //
  // This is derived uniformly for every type. The previous per-type branches
  // returned the WHOLE "bigTag/smallTag" string for un-cased types (scene /
  // scene30 / components / basic / groups / json / common …) — so e.g. every
  // scene30 battery landed in a distinct "scene30/indoor"-style label instead of
  // collapsing into an "indoor" sub-group — and returned the BIG tag for
  // type==='special', collapsing all special batteries into one "special" group.
  const path = battery.displayGroup ?? battery.category ?? ''
  const parts = path.split('/')
  return parts.length >= 2 ? parts[1] : (parts[0] || battery.type)
}

export function formatBigLabel(label: string): string {
  if (label === '__favorites__') return 'Favorites'
  if (label === '__presets__') return 'Presets'
  if (label === 'prompt') return 'PROMPTS'
  if (label === 'json') return 'JSON'
  if (label === 'special') return 'SPECIAL'
  if (label === 'ai') return 'AI'
  if (label === 'groups') return 'GROUPS'
  return label.charAt(0).toUpperCase() + label.slice(1)
}

// First-batch rail: Basic literals, then Modeling, then Grid, then Scene.
const BIG_LABEL_ORDER = ['Basic', 'Modeling', 'Grid', 'Scene']

/** 大标签比较器：Basic 第一，Modeling 第二，已知流水线阶段按顺序，其余按 localeCompare。 */
export function compareBigLabel(a: string, b: string): number {
  const ia = BIG_LABEL_ORDER.indexOf(a)
  const ib = BIG_LABEL_ORDER.indexOf(b)
  if (ia >= 0 || ib >= 0) {
    if (ia < 0) return 1
    if (ib < 0) return -1
    return ia - ib
  }
  return a.localeCompare(b)
}

export function formatBigLabelRailText(label: string): string {
  // 收藏 / 预设的 rail 图标由 BatteryBar 渲染 SVG pictogram（FavoritesRailIcon /
  // PresetsRailIcon），不再用 emoji 文本；此处返回空，文本分支不参与渲染。
  if (label === '__favorites__') return ''
  if (label === '__presets__') return ''
  const clean = formatBigLabel(label).trim()
  if (!clean) return ''
  return clean.slice(0, 2)
}

export function formatBigLabelRailRest(label: string): string {
  if (label === '__favorites__') return ''
  if (label === '__presets__') return ''
  return formatBigLabel(label).trim().slice(2)
}

export function formatSmallLabel(label: string): string {
  if (label === 'preview') return 'Annotation'
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export function applyOrder(savedOrder: string[], allLabels: string[]): string[] {
  const result = savedOrder.filter(l => allLabels.includes(l))
  for (const l of allLabels) {
    if (!result.includes(l)) result.push(l)
  }
  return result
}

// Constructors first (2d → heightfield → 3d), then the operators that consume
// them: pose puts a mesh in the world, surface relates geometry to a surface.
const MODELING_SMALL_LABEL_ORDER = [
  'geometry2d',
  'heightfield',
  'geometry3d',
  'layout',
  'pose',
  'query',
  'surface',
]

const GRID_SMALL_LABEL_ORDER = [
  'init',
  'noise',
  'arith',
  'filter',
  'morph',
  'sample',
  'derive',
  'partition',
  'zone',
  'global',
  'lattice',
  'ca',
]

export function sortSmallLabels(labels: string[], bigLabel: string | null): string[] {
  const sorted = [...labels].sort()
  const priority = bigLabel === 'common'
    ? ['input', 'list', 'datatree', 'number', 'preview']
    : bigLabel === 'Modeling'
      ? MODELING_SMALL_LABEL_ORDER
      : bigLabel === 'Grid'
        ? GRID_SMALL_LABEL_ORDER
        : null
  if (!priority) return sorted
  return sorted.sort((a, b) => {
    const ai = priority.indexOf(a)
    const bi = priority.indexOf(b)
    if (ai >= 0 || bi >= 0) {
      if (ai < 0) return 1
      if (bi < 0) return -1
      return ai - bi
    }
    return a.localeCompare(b)
  })
}

const COMMON_NUMBER_ORDER = [
  'seed_control',
  'random_number',
  'random_numbers',
  'range_list',
  'basic_math_op',
  'advanced_math_op',
  'negate',
  'relu',
  'compare_gt',
  'compare_gte',
]

const COMMON_LIST_ORDER = [
  'list_get_length',
  'list_get_single',
  'list_get_by_index',
  'list_get_index_single',
  'list_get_index_by_item',
  'list_remove_by_index',
  'list_difference',
  'list_unpack',
  'list_collect',
  'dict_get_by_key',
  'dict_get_keys_by_value',
]

const BASIC_GENERAL_ORDER = [
  'rect_grid',
  'grid_size',
  'point_to_rect',
]

export function sortBatteriesInGroup(items: Battery[], bigLabel: string | null, smallLabel: string): Battery[] {
  if (bigLabel === '__favorites__') return items
  const sorted = [...items]
  const priority = bigLabel === 'common' && smallLabel === 'list'
    ? COMMON_LIST_ORDER
    : bigLabel === 'common' && smallLabel === 'number'
      ? COMMON_NUMBER_ORDER
    : bigLabel === 'basic' && smallLabel === 'general'
      ? BASIC_GENERAL_ORDER
      : null
  if (priority) {
    return sorted.sort((a, b) => {
      const ai = priority.indexOf(a.id)
      const bi = priority.indexOf(b.id)
      if (ai >= 0 || bi >= 0) {
        if (ai < 0) return 1
        if (bi < 0) return -1
        return ai - bi
      }
      return a.id.localeCompare(b.id)
    })
  }
  return sorted.sort((a, b) => a.id.localeCompare(b.id))
}

/** True when the battery is visible for the currently viewing project type. */
export function matchesProjectType(battery: Battery, activeProjectType: string | null | undefined): boolean {
  if (!activeProjectType) return true
  const types = (battery as CatalogBattery).projectTypes
  if (!types || types.length === 0) return true
  if (types.includes('both')) return true
  return types.includes(activeProjectType)
}

/** Whitespace-token AND match across battery id / name / description / tags. */
export function fuzzyMatchBattery(battery: Battery, query: string): boolean {
  if (!query.trim()) return true
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  const fields = [
    battery.id,
    battery.name,
    battery.description ?? '',
    battery.category,
    ...(battery.tags ?? []),
    ...(battery.tagLabels ?? []),
  ].map((f) => f.toLowerCase())
  return tokens.every((token) => fields.some((field) => field.includes(token)))
}

