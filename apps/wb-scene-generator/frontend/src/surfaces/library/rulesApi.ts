// Thin client for the read-only rule-listing route, plus the cross-pane channel
// that carries the currently-selected rule from the AssetStore pane to the left
// pane. AssetStore (?pane=assetstore) and the left pane (?pane=left) are sibling
// same-origin iframes with no parent/child link, so selection rides the shared
// localStorage + `storage` event bus (the same pattern WorkbenchHost/LeftPane use
// for the embed toggles). Backed by GET /api/v1/library/rules.
import { pluginFetch } from '../../api/pluginHttp'

export interface RuleFaceSummary {
  basePieces: number
  mapEntries: number
  variants: number
  hasRandom: boolean
}

// Mirrors the backend `RuleListItem` (service.ts). A tilemap stitching (autotile)
// rule, normalized so v1/v2 schemas both expose `faces.top` / `faces.front`.
export interface RuleListItem {
  alias: string
  name?: string
  description?: string
  schemaVersion: 1 | 2
  ppu: number
  spriteCount: number
  faces: { top?: RuleFaceSummary; front?: RuleFaceSummary }
  regions: string[]
}

// Same namespace as the other AssetStore keys (assetStoreStore.ts LS_* + the
// WorkbenchHost embed toggles), so it's clearly part of that pane's state.
const LS_SELECTED_RULE = 'wb-scene-generator.assetstore.selectedRule'

export const rulesApi = {
  list(): Promise<RuleListItem[]> {
    return pluginFetch('/api/v1/library/rules', { method: 'GET' }).then((r) => {
      if (!r.ok) throw new Error(`/api/v1/library/rules → ${r.status}`)
      return r.json() as Promise<RuleListItem[]>
    })
  },
}

/** Publish the selected rule (or clear it) to the cross-pane localStorage bus. */
export function writeSelectedRule(item: RuleListItem | null): void {
  if (typeof localStorage === 'undefined') return
  if (item) localStorage.setItem(LS_SELECTED_RULE, JSON.stringify(item))
  else localStorage.removeItem(LS_SELECTED_RULE)
}

/** Current selected rule from the bus, or null if none / unparseable. */
export function readSelectedRule(): RuleListItem | null {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(LS_SELECTED_RULE)
  if (!raw) return null
  try {
    return JSON.parse(raw) as RuleListItem
  } catch {
    return null
  }
}

/**
 * Subscribe to selected-rule changes made in ANOTHER document (e.g. the
 * AssetStore pane writing while this is the left pane). `storage` events only
 * fire cross-document, which is exactly the sibling-iframe case we want. Returns
 * an unsubscribe fn. The callback receives the freshly-parsed selection.
 */
export function subscribeSelectedRule(cb: (item: RuleListItem | null) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (e: StorageEvent): void => {
    if (e.key !== null && e.key !== LS_SELECTED_RULE) return
    cb(readSelectedRule())
  }
  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}
