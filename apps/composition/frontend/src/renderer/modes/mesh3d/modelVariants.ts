// 💡 Stable family → variant pick for object models.
//
// Resolution order for a scene assetName:
// 1. Exact pack name (firtree3, realistic_hd_northern_red_oak_1)
// 2. Classic numbered / segmented variants (firtree → firtree1…6; shrub → shrub_01_*)
// 3. FAMILY_EXTRA hard aliases (rock → rock* + moss_rock*)
// 4. Derived pack family stem: strip decorative prefixes + trailing numbers so
//    northern_red_oak → realistic_hd_northern_red_oak_1 (no per-pack hand aliases)

/** FNV-1a 32-bit — stable across sessions for the same instanceKey. */
export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Longest-first decorative prefixes on seed / marketplace pack names.
 * Stripped when deriving the short family stem scenes use as asset_name.
 *
 * Note: do NOT list `realistic_high_poly_` here — stripping it would collapse
 * `realistic_high_poly_tree_1` to bare `tree`. Instead `realistic_` leaves
 * the meaningful `high_poly_tree` stem.
 */
export const DECORATIVE_PACK_PREFIXES = [
  'realistic_hd_',
  'realistic_',
] as const

/**
 * Family stem implied by an installed pack name.
 * `realistic_hd_northern_red_oak_1` → `northern_red_oak`
 * `shrub_01_3` → `shrub`
 * `firtree4` → `firtree`
 * `real_tree1` → `real_tree`
 */
export function packFamilyStem(packName: string): string {
  let s = packName.trim()
  if (!s) return s
  // Drop trailing variant segments: _01_3, _1, or glued digits (firtree4).
  s = s.replace(/(_\d+)+$/, '').replace(/\d+$/, '')
  for (const prefix of DECORATIVE_PACK_PREFIXES) {
    if (s.startsWith(prefix)) {
      s = s.slice(prefix.length)
      break
    }
  }
  return s
}

/**
 * Extra packs folded into a family beyond stem / derived-stem matching.
 * Use sparingly — prefer packFamilyStem for prefix+number packs.
 */
const FAMILY_EXTRA: Record<string, RegExp> = {
  // Unified "rock" family: rock1/2 + moss_rock1 (moss_rock stem ≠ rock).
  rock: /^(rock\d+|moss_rock\d+)$/,
}

export function listNumberedVariants(stem: string, catalog: readonly string[]): string[] {
  const reAdj = new RegExp(`^${escapeRegExp(stem)}\\d+$`)
  const reSeg = new RegExp(`^${escapeRegExp(stem)}(_\\d+)+$`)
  const reExtra = FAMILY_EXTRA[stem]
  return catalog
    .filter((n) => {
      if (n === stem) return false
      if (reAdj.test(n) || reSeg.test(n)) return true
      if (reExtra && reExtra.test(n)) return true
      // Unified short-name ↔ long pack name (northern_red_oak ↔ realistic_hd_…_1).
      return packFamilyStem(n) === stem
    })
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

/**
 * Resolve a requested assetName against the installed model catalog.
 *
 * - Exact pack (`firtree3`, `shrub_01_2`) → itself
 * - Family stem (`firtree`, `northern_red_oak`, `shrub`) → stable pick among variants
 */
export function pickModelVariant(
  requested: string,
  instanceKey: string,
  catalog: readonly string[],
): string {
  const name = requested.trim()
  if (!name || catalog.length === 0) return name

  // Exact pack always wins.
  if (catalog.includes(name)) return name

  const numbered = listNumberedVariants(name, catalog)
  if (numbered.length === 0) return name
  if (numbered.length === 1) return numbered[0]!
  return numbered[hashString(instanceKey) % numbered.length]!
}
