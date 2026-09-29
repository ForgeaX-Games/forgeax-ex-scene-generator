/**
 * 13-bracket alias contract — frontend mirror of backend/src/library/aliasName.ts.
 * Keep in sync with asset_manager `@forgeax/asset-2d` aliasName.ts.
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

export const MATERIAL_DEFAULT_OPTIONS = [
  '木', '石', '金属', '玻璃', '液体', '生物', '粒子', '异星', '纸', '布', '竹',
] as const

export const DIRECTION_OPTIONS = ['上', '下', '左', '右', '横', '竖', '无'] as const

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

export function aliasItemName(alias: string): string {
  const name = fieldAt(alias, SLOT.name)
  return name || alias
}

export function aliasPpu(alias: string): number | null {
  const raw = fieldAt(alias, SLOT.size)
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function isCutoutTypeField(v: string): boolean {
  return v === 'asset' || v === '抠图'
}
