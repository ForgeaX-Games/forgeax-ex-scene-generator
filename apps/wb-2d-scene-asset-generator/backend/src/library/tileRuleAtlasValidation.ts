/**
 * Tile atlas dimension validation for publish-to-game (mirrors wb-scene-generator
 * `library/tileRuleAtlasValidation.ts`). Rules live in this app's `assets/rules/`.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface AtlasSize {
  widthPx: number
  heightPx: number
}

export type TileAtlasValidationResult =
  | { ok: true; matched: AtlasSize }
  | { ok: false; error: string; allowedSizes: AtlasSize[] }

interface RuleSprite {
  x: number
  y: number
  w: number
  h: number
}

interface MinimalRule {
  ppu: number
  sprites: RuleSprite[]
  faces?: {
    top?: {
      basePieces?: number
      variantIdxs?: number[]
    }
  }
}

const RULES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'assets', 'rules')
const ruleCache = new Map<string, MinimalRule | null>()
const FLEXIBLE_VARIANT_ROW_RULES = new Set(['common_16'])

function loadMinimalRule(name: string): MinimalRule | null {
  if (ruleCache.has(name)) return ruleCache.get(name) ?? null
  let parsed: MinimalRule | null = null
  try {
    const raw = JSON.parse(readFileSync(join(RULES_DIR, `${name}.json`), 'utf8')) as unknown
    if (!raw || typeof raw !== 'object') throw new Error('invalid')
    const o = raw as Record<string, unknown>
    if (typeof o.ppu !== 'number' || !Array.isArray(o.sprites) || o.sprites.length === 0) {
      throw new Error('invalid rule schema')
    }
    const sprites: RuleSprite[] = []
    for (const s of o.sprites) {
      if (!s || typeof s !== 'object') throw new Error('invalid sprite')
      const sp = s as Record<string, unknown>
      if (typeof sp.x !== 'number' || typeof sp.y !== 'number'
        || typeof sp.w !== 'number' || typeof sp.h !== 'number') {
        throw new Error('invalid sprite rect')
      }
      sprites.push({ x: sp.x, y: sp.y, w: sp.w, h: sp.h })
    }
    const facesRaw = o.faces as Record<string, unknown> | undefined
    const topRaw = facesRaw?.top as Record<string, unknown> | undefined
    parsed = {
      ppu: o.ppu,
      sprites,
      ...(topRaw ? {
        faces: {
          top: {
            ...(typeof topRaw.basePieces === 'number' ? { basePieces: topRaw.basePieces } : {}),
            ...(Array.isArray(topRaw.variantIdxs) ? { variantIdxs: topRaw.variantIdxs as number[] } : {}),
          },
        },
      } : {}),
    }
  } catch {
    parsed = null
  }
  ruleCache.set(name, parsed)
  return parsed
}

function spriteBounds(sprites: ReadonlyArray<RuleSprite>): AtlasSize {
  let widthPx = 0
  let heightPx = 0
  for (const s of sprites) {
    widthPx = Math.max(widthPx, s.x + s.w)
    heightPx = Math.max(heightPx, s.y + s.h)
  }
  return { widthPx, heightPx }
}

function dedupeSizes(sizes: AtlasSize[]): AtlasSize[] {
  const seen = new Set<string>()
  const out: AtlasSize[] = []
  for (const s of sizes) {
    const key = `${s.widthPx}x${s.heightPx}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out
}

function baseAtlasBounds(rule: MinimalRule): AtlasSize | null {
  const top = rule.faces?.top
  if (!top?.variantIdxs?.length || top.basePieces == null) return null
  if (top.basePieces <= 0 || top.basePieces >= rule.sprites.length) return null
  return spriteBounds(rule.sprites.slice(0, top.basePieces))
}

function allowedSizesForRule(rule: MinimalRule, ruleName: string): AtlasSize[] {
  const full = spriteBounds(rule.sprites)
  if (!FLEXIBLE_VARIANT_ROW_RULES.has(ruleName)) return [full]
  const base = baseAtlasBounds(rule)
  if (!base) return [full]
  if (base.widthPx === full.widthPx && base.heightPx === full.heightPx) return [full]
  return dedupeSizes([base, full])
}

function formatSizes(sizes: AtlasSize[]): string {
  return sizes.map((s) => `${s.widthPx}×${s.heightPx}px`).join(' or ')
}

export function validateTileAtlasDimensions(
  autotileKind: string,
  widthPx: number | undefined,
  heightPx: number | undefined,
): TileAtlasValidationResult {
  const kind = autotileKind.trim()
  if (!kind) {
    return { ok: false, error: 'autotileKind is required for tile assets', allowedSizes: [] }
  }
  if (widthPx == null || heightPx == null || widthPx <= 0 || heightPx <= 0) {
    return { ok: false, error: 'could not read PNG width/height for tile atlas validation', allowedSizes: [] }
  }

  const rule = loadMinimalRule(kind)
  if (!rule) {
    return { ok: false, error: `unknown autotile rule: ${kind}`, allowedSizes: [] }
  }

  const allowedSizes = allowedSizesForRule(rule, kind)
  const matched = allowedSizes.find((s) => s.widthPx === widthPx && s.heightPx === heightPx)
  if (matched) return { ok: true, matched }

  return {
    ok: false,
    error: `atlas ${widthPx}×${heightPx}px does not match rule "${kind}" (allowed: ${formatSizes(allowedSizes)})`,
    allowedSizes,
  }
}
