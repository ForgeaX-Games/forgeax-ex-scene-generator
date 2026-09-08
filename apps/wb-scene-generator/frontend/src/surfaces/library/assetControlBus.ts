// Cross-pane control channel between the AssetStore left-pane menus (?pane=left)
// and the AssetStore grid surface (?pane=assetstore). They are sibling same-origin
// iframes with no parent/child link, so state rides the localStorage + `storage`
// event bus — the same pattern as rulesApi/paintAssetBus.
//
// Direction of each key:
//   control   left → surface   (search / 13-field filters / batch mode)
//   selection surface → left   (selected asset for preview + batch selection set)
//   refresh   left → surface   (bump to force a refetch after a write; optional
//                               clearSelection to drop the grid's batch selection)
import type { AssetRecord, FieldFilter } from './libraryApi.js'

const LS_CONTROL = 'wb-scene-generator.assetstore.control'
const LS_SELECTION = 'wb-scene-generator.assetstore.selection'
const LS_REFRESH = 'wb-scene-generator.assetstore.refresh'
const LS_REVEAL = 'wb-scene-generator.assetstore.reveal'

export interface AssetControl {
  /** Free-text alias search. */
  search: string
  /** 13-field name filters (CategoryNav). */
  fieldFilters: FieldFilter[]
  /** Whether the grid is in multi-select batch mode. */
  batchMode: boolean
}

export interface AssetSelection {
  /** The single selected asset (drives the left-pane preview/info). */
  asset: AssetRecord | null
  /** Ids selected in batch mode (drives the left-pane batch action bar). */
  selectedIds: string[]
  batchMode: boolean
  /** Active zone the grid is showing (so the left pane can label trash actions). */
  zone: string
}

export interface AssetRefresh {
  seq: number
  clearSelection?: boolean
}

/**
 * left → surface command: select an asset by alias in the grid and scroll the
 * continuous list to the page that holds it (without touching the search/filter
 * `control`, so the rest of the grid stays put). Driven by the left-pane search
 * candidate dropdown.
 */
export interface AssetReveal {
  seq: number
  alias: string
}

export const DEFAULT_CONTROL: AssetControl = { search: '', fieldFilters: [], batchMode: false }
export const DEFAULT_SELECTION: AssetSelection = { asset: null, selectedIds: [], batchMode: false, zone: 'raw' }

function read<T>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback
  const raw = localStorage.getItem(key)
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(key, JSON.stringify(value))
}

function subscribe(key: string, cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (e: StorageEvent): void => {
    if (e.key !== null && e.key !== key) return
    cb()
  }
  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}

// ── control (left → surface) ────────────────────────────────────────────────
export const readControl = (): AssetControl => read(LS_CONTROL, DEFAULT_CONTROL)
export const writeControl = (c: AssetControl): void => write(LS_CONTROL, c)
export const subscribeControl = (cb: (c: AssetControl) => void): (() => void) =>
  subscribe(LS_CONTROL, () => cb(readControl()))

// ── selection (surface → left) ──────────────────────────────────────────────
export const readSelection = (): AssetSelection => read(LS_SELECTION, DEFAULT_SELECTION)
export const writeSelection = (s: AssetSelection): void => write(LS_SELECTION, s)
export const subscribeSelection = (cb: (s: AssetSelection) => void): (() => void) =>
  subscribe(LS_SELECTION, () => cb(readSelection()))

// ── refresh (left → surface) ────────────────────────────────────────────────
export const readRefresh = (): AssetRefresh => read(LS_REFRESH, { seq: 0 })
export const requestRefresh = (clearSelection = false): void =>
  write(LS_REFRESH, { seq: Date.now(), clearSelection })
export const subscribeRefresh = (cb: (r: AssetRefresh) => void): (() => void) =>
  subscribe(LS_REFRESH, () => cb(readRefresh()))

// ── reveal (left → surface) ─────────────────────────────────────────────────
export const readReveal = (): AssetReveal | null => read<AssetReveal | null>(LS_REVEAL, null)
export const requestReveal = (alias: string): void => write(LS_REVEAL, { seq: Date.now(), alias })
export const subscribeReveal = (cb: (r: AssetReveal) => void): (() => void) =>
  subscribe(LS_REVEAL, () => {
    const r = readReveal()
    if (r) cb(r)
  })
