// Cross-pane channel for the asset the user paints with in the preview's edit
// mode. The AssetStore pane (?pane=assetstore) publishes the selected tile; the
// renderer pane (?pane=renderer) reads it as the paint asset. Sibling same-origin
// iframes, so this rides the localStorage + `storage` event bus (same pattern as
// rulesApi.ts).

import { aliasItemName, aliasPpu } from './aliasName.js'

export interface PaintAsset {
  /** Library alias of the selected tile — also what the baked layer binds to. */
  alias: string
  /** asset_name written onto the painted layer (matchAssetEntry resolves it). */
  name: string
  /** asset_type, e.g. 'tile'. */
  type?: string
}

const LS_PAINT_ASSET = 'wb-scene-generator.assetstore.paintAsset'

export { aliasItemName, aliasPpu }

export function writePaintAsset(asset: PaintAsset | null): void {
  if (typeof localStorage === 'undefined') return
  if (asset) localStorage.setItem(LS_PAINT_ASSET, JSON.stringify(asset))
  else localStorage.removeItem(LS_PAINT_ASSET)
}

export function readPaintAsset(): PaintAsset | null {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(LS_PAINT_ASSET)
  if (!raw) return null
  try {
    return JSON.parse(raw) as PaintAsset
  } catch {
    return null
  }
}

export function subscribePaintAsset(cb: (asset: PaintAsset | null) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (e: StorageEvent): void => {
    if (e.key !== null && e.key !== LS_PAINT_ASSET) return
    cb(readPaintAsset())
  }
  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}
