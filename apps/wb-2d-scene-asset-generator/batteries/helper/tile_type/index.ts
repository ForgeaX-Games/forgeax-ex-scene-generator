/**
 * tile_type
 *
 * 下拉框选择一种 tile 种类，原样输出该种类字符串。
 * 合法值：floor / cliff / forest / flower_bed / tilemap / slope。
 *
 * 运行约定：函数名小写字母开头，入参/出参均为 Record<string, unknown>，
 * 端口 key 与 meta.json 对齐。
 */
const TILE_TYPES = ['floor', 'cliff', 'forest', 'flower_bed', 'tilemap', 'slope'] as const

export function tileType(input: Record<string, unknown>): Record<string, unknown> {
  const raw = input.tile
  const value = raw === undefined || raw === null ? '' : String(raw)
  return { value: (TILE_TYPES as readonly string[]).includes(value) ? value : 'floor' }
}
