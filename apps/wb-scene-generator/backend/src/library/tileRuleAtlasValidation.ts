/**
 * Validate published tile atlas PNG dimensions against vendored autotile rules
 * (`assets/rules/<autotileKind>.json`). Called when binding `autotileKind` at
 * publish time so mismatched atlases fail fast instead of silently mis-slicing.
 */
import { loadTileRule, type TileRule } from '../scene-export/tileRules.js'

export interface AtlasSize {
  widthPx: number
  heightPx: number
}

export type TileAtlasValidationResult =
  | { ok: true; matched: AtlasSize }
  | { ok: false; error: string; allowedSizes: AtlasSize[] }

/** Rules that accept a shorter atlas when optional variant sprites are omitted. */
const FLEXIBLE_VARIANT_ROW_RULES = new Set(['common_16'])

/** Rules that accept multiple single-tile atlas heights (16×16 or 16×17 PNG exports). */
const FLEXIBLE_SQUARE_TILE_RULES = new Set(['square_1'])

function spriteBounds(sprites: ReadonlyArray<{ x: number; y: number; w: number; h: number }>): AtlasSize {
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

/** Atlas size without optional randomRules variant row (e.g. common_16 @ 64×64). */
function baseAtlasBounds(rule: TileRule): AtlasSize | null {
  const top = rule.faces.top
  if (!top) return null
  const variantIdxs = top.variantIdxs
  if (!variantIdxs || variantIdxs.length === 0) return null
  const basePieces = top.basePieces
  if (basePieces <= 0 || basePieces >= rule.sprites.length) return null
  return spriteBounds(rule.sprites.slice(0, basePieces))
}

function allowedSizesForRule(rule: TileRule, ruleName: string): AtlasSize[] {
  const full = spriteBounds(rule.sprites)
  if (FLEXIBLE_SQUARE_TILE_RULES.has(ruleName)) {
    const base = full.widthPx === 16 && full.heightPx === 16
      ? [{ widthPx: 16, heightPx: 16 }, { widthPx: 16, heightPx: 17 }]
      : [full]
    return dedupeSizes(base)
  }
  if (!FLEXIBLE_VARIANT_ROW_RULES.has(ruleName)) {
    return [full]
  }
  const base = baseAtlasBounds(rule)
  if (!base) return [full]
  if (base.widthPx === full.widthPx && base.heightPx === full.heightPx) {
    return [full]
  }
  return dedupeSizes([base, full])
}

function formatSizes(sizes: AtlasSize[]): string {
  return sizes.map((s) => `${s.widthPx}×${s.heightPx}px`).join(' or ')
}

/** List atlas dimensions accepted for a tile rule (for docs / error messages). */
export function getAllowedAtlasSizes(autotileKind: string): AtlasSize[] {
  const rule = loadTileRule(autotileKind.trim())
  if (!rule) return []
  return allowedSizesForRule(rule, autotileKind.trim())
}

/** Validate PNG dimensions when binding `autotileKind` on publish. */
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

  const rule = loadTileRule(kind)
  if (!rule) {
    return { ok: false, error: `unknown autotile rule: ${kind}`, allowedSizes: [] }
  }

  const allowedSizes = allowedSizesForRule(rule, kind)
  const matched = allowedSizes.find((s) => s.widthPx === widthPx && s.heightPx === heightPx)
  if (matched) {
    return { ok: true, matched }
  }

  return {
    ok: false,
    error: `atlas ${widthPx}×${heightPx}px does not match rule "${kind}" (allowed: ${formatSizes(allowedSizes)})`,
    allowedSizes,
  }
}
