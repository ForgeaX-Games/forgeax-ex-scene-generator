/**
 * 13-bracket alias contract — SSOT for wb-scene-generator, aligned with
 * asset_manager `packages/asset_2d/src/aliasName.ts` / wb-asset-manager.
 *
 *   [index]_[indoorOutdoor]_[name]_[material]_[direction]_[themeStyle]_[state]_[cropType]_[size]_[isStatic]_[filterTemplate]_[serial]_[appearancePlace]
 */

export const FIELD_NAMES = [
  'index',
  'indoorOutdoor',
  'name',
  'material',
  'direction',
  'themeStyle',
  'state',
  'cropType',
  'size',
  'isStatic',
  'filterTemplate',
  'serial',
  'appearancePlace',
] as const

export type FieldName = (typeof FIELD_NAMES)[number]

/** Bracket index (0-based) for facet/filter SQL `bracket_value(alias, n)`. */
export const SLOT = {
  index: 0,
  indoorOutdoor: 1,
  name: 2,
  material: 3,
  direction: 4,
  themeStyle: 5,
  state: 6,
  cropType: 7,
  size: 8,
  isStatic: 9,
  filterTemplate: 10,
  serial: 11,
  appearancePlace: 12,
} as const

/** Default material options; the library may contain additional values (纸/布/竹…). */
export const MATERIAL_DEFAULT_OPTIONS = [
  '木', '石', '金属', '玻璃', '液体', '生物', '粒子', '异星', '纸', '布', '竹',
] as const

export const DIRECTION_OPTIONS = ['上', '下', '左', '右', '横', '竖', '无'] as const

/** Bracket fields of an alias, trimmed. */
export function bracketFields(alias: string): string[] {
  const out: string[] = []
  const re = /\[([^\]]*)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(alias)) !== null) out.push(m[1].trim())
  return out
}

export function fieldAt(alias: string, idx: number): string {
  const f = bracketFields(alias)
  return idx < f.length ? f[idx] : ''
}

/** Item name (SLOT.name); falls back to the full alias when absent. */
export function aliasItemName(alias: string): string {
  const name = fieldAt(alias, SLOT.name)
  return name || alias
}

/** size/PPU (SLOT.size); null when absent or invalid. */
export function aliasPpu(alias: string): number | null {
  const raw = fieldAt(alias, SLOT.size)
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** cropType === 'asset' (legacy: '抠图') marks a cutout object. */
export function isCutoutTypeField(v: string): boolean {
  return v === 'asset' || v === '抠图'
}
