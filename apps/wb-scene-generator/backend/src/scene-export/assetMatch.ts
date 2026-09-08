// Uses the vendored renderer matcher so the export makes the exact same
// alias/pool/variant-primary decision as Billboard Asset preview.

import type { AliasMeta } from '../library/service.js'
import { matchAssetEntry } from '../../../vendor/dist/renderer-resolve/renderer/server/spriteResolver.js'

function bracketField(alias: string, index: number): string {
  const matches = alias.match(/\[([^\]]*)\]/g)
  if (!matches || matches.length <= index) return ''
  return matches[index]!.slice(1, -1).trim()
}

/**
 * The human-readable display name embedded in a resolved alias (bracket
 * field 2) — the SAME field `findByName()` matches a layer's `assetName`
 * against. Exposed so the cooker can derive a stable object/terrain
 * type-identity key straight from the RESOLVED library entry instead of the
 * layer's own (possibly missing or inconsistent across sibling layers)
 * `assetName`/`nodeName`: two layers that resolve to the same alias always
 * get the same display name, so keying by it guarantees "same underlying
 * asset -> same type/template" regardless of how each layer was authored.
 * Returns `''` for aliases that aren't in the bracketed format (e.g. a raw
 * filename fallback), so callers should treat an empty result as "no name
 * available" and fall back further.
 */
export function aliasDisplayName(alias: string): string {
  return bracketField(alias, 2)
}

/**
 * Resolve the primary AliasMeta for a baked layer. Prefers an exact alias, then
 * name-based matching through the renderer's shared matcher. Returns `undefined`
 * when no library asset matches (layer stays a placeholder).
 */
export function resolveLayerAlias(
  entry: { assetName?: string; assetAlias?: string; assetType?: string },
  aliases: ReadonlyArray<AliasMeta>,
): AliasMeta | undefined {
  if (!entry.assetName && !entry.assetAlias) return undefined
  // No library snapshot to match against: still honour an explicit alias binding
  // so the atlas builder fetches it (and missing content surfaces as an error).
  if (aliases.length === 0) return rawAliasFallback(entry.assetAlias)
  const match = matchAssetEntry(
    { assetName: entry.assetName ?? '', assetAlias: entry.assetAlias, assetType: entry.assetType },
    aliases,
    false,
  )
  return (match ? aliases.find((meta) => meta.alias === match.primary) : undefined)
    ?? rawAliasFallback(entry.assetAlias)
}

/**
 * When a layer carries an explicit `asset_alias` that is not present in the
 * library snapshot, still surface it as a (tileType-less) meta so the atlas
 * builder attempts to fetch it — preserving the explicit-binding contract and
 * letting genuinely-missing content surface as an error (or be tolerated under
 * allowMissingAssets) rather than silently producing a blank tile.
 */
function rawAliasFallback(alias: string | undefined): AliasMeta | undefined {
  return alias ? { alias } : undefined
}
