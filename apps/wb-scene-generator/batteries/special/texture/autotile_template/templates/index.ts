import singleTemplate from './single.json' with { type: 'json' }
import cardinal16Template from './4bit-cardinal-16.json' with { type: 'json' }

export interface RandomRule {
  tileId: number
  keepProbability: number
  offset?: number
  tileIdMax?: number
}

export interface SpriteDefinition {
  name?: string
  x: number
  y: number
  width: number
  height: number
}

export interface AutotileTemplateDefinition {
  type: string
  name: string
  remarks?: string
  sprites: SpriteDefinition[]
  // 向后兼容旧模板 dict：旧版本仍可能只有规则网格拆分参数
  tileSize?: number
  columns?: number
  base_pieces: number
  total_pieces: number
  map: Record<string, number>
  randomRules?: RandomRule[]
}

const BUILTIN_TEMPLATES: Record<string, AutotileTemplateDefinition> = {
  single: singleTemplate as AutotileTemplateDefinition,
  '4bit-cardinal-16': cardinal16Template as AutotileTemplateDefinition,
}

export function getBuiltinAutotileTemplate(preset: string): AutotileTemplateDefinition {
  const selected = BUILTIN_TEMPLATES[preset] ?? BUILTIN_TEMPLATES.single
  return {
    ...selected,
    sprites: selected.sprites.map(sprite => ({ ...sprite })),
    map: { ...selected.map },
    randomRules: selected.randomRules ? selected.randomRules.map(rule => ({ ...rule })) : [],
  }
}

export function getBuiltinAutotilePresets(): string[] {
  return Object.keys(BUILTIN_TEMPLATES)
}
