// Cross-iframe channel for the asset the user clicked in the Asset Store
// (?pane=assetstore → GeneratedAssetStoreSurface) so the Preview surface
// (?pane=preview → ImagePreviewSurface) can show it. The two surfaces live in
// separate iframes, so — like draggedAssetBus.ts — we hand the selection off
// through same-origin localStorage. The store WRITES the clicked alias; the
// preview SUBSCRIBES via the `storage` event (which fires across iframes of the
// same origin) and switches its stage to the matching asset.

const LS_SELECTED_PREVIEW = 'wb-2d-scene-asset-generator.selectedPreview'

export function writeSelectedPreview(alias: string | null): void {
  if (typeof localStorage === 'undefined') return
  // Always include a nonce so re-clicking the same alias still fires a `storage`
  // event (the event only fires when the stored string actually changes).
  if (alias) localStorage.setItem(LS_SELECTED_PREVIEW, JSON.stringify({ alias, at: Date.now() }))
  else localStorage.removeItem(LS_SELECTED_PREVIEW)
}

function parseAlias(raw: string | null): string | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { alias?: unknown }
    return typeof parsed.alias === 'string' && parsed.alias ? parsed.alias : null
  } catch {
    return null
  }
}

export function readSelectedPreview(): string | null {
  if (typeof localStorage === 'undefined') return null
  return parseAlias(localStorage.getItem(LS_SELECTED_PREVIEW))
}

/** Subscribe to cross-iframe preview selections. Returns an unsubscribe fn. */
export function subscribeSelectedPreview(onSelect: (alias: string) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (event: StorageEvent): void => {
    if (event.key !== LS_SELECTED_PREVIEW) return
    const alias = parseAlias(event.newValue)
    if (alias) onSelect(alias)
  }
  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}
