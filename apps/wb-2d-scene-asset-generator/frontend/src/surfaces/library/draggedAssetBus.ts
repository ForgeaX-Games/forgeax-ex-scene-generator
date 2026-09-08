// Cross-iframe channel for an image being dragged from the All Images panel
// (?pane=assetstore → GeneratedAssetStoreSurface) onto the kernel canvas in the
// host document (?pane=center → WorkbenchHost). Native HTML5 drag-and-drop does
// NOT carry dataTransfer across the iframe boundary, so we hand the payload off
// through localStorage (same channel-C pattern as selectedLayerBus.ts): the
// assetstore writes the dragged asset on dragstart and clears it on dragend; the
// host reads it synchronously inside the canvas drop handler. Same-origin
// localStorage is shared synchronously, so no `storage` event is needed for the
// drop read — the value is already visible by the time the drop lands.

export interface DraggedAsset {
  /** The generated-asset alias (filename-like id within the store). */
  alias: string
  /** Content-addressed blob id; lets the node resolve /api/v1/library/blob/:id. */
  blobId: string
  /** Mime type, for display / metadata. */
  mimeType?: string
}

const LS_DRAGGED_ASSET = 'wb-2d-scene-asset-generator.draggedAsset'

// Pending deferred-clear timer (see clearDraggedAssetDeferred). Writing a new
// drag payload cancels it so a stale clear from the previous drag can't wipe the
// freshly-started one.
let clearTimer: ReturnType<typeof setTimeout> | null = null

export function writeDraggedAsset(asset: DraggedAsset | null): void {
  if (typeof localStorage === 'undefined') return
  if (asset && asset.alias && asset.blobId) {
    if (clearTimer) {
      clearTimeout(clearTimer)
      clearTimer = null
    }
    localStorage.setItem(LS_DRAGGED_ASSET, JSON.stringify(asset))
  } else {
    localStorage.removeItem(LS_DRAGGED_ASSET)
  }
}

// Clear the handoff, but DEFERRED. The drag-and-drop model fires `drop` on the
// target then `dragend` on the source; across the assetstore↔canvas iframe
// boundary that ordering is NOT reliable in every engine (notably WKWebView in
// the Studio .app), so clearing synchronously in `dragend` can wipe the payload
// a hair BEFORE the host's drop handler reads it — the drop then silently
// no-ops ("the image source keeps its old image"). Deferring the clear lets the
// synchronous drop read always win, while still not lingering long enough for a
// genuinely separate later drag to misread it (a fresh dragstart cancels it).
export function clearDraggedAssetDeferred(): void {
  if (typeof localStorage === 'undefined') return
  if (clearTimer) clearTimeout(clearTimer)
  clearTimer = setTimeout(() => {
    clearTimer = null
    localStorage.removeItem(LS_DRAGGED_ASSET)
  }, 400)
}

export function readDraggedAsset(): DraggedAsset | null {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(LS_DRAGGED_ASSET)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<DraggedAsset>
    if (typeof parsed.alias === 'string' && parsed.alias && typeof parsed.blobId === 'string' && parsed.blobId) {
      return { alias: parsed.alias, blobId: parsed.blobId, ...(parsed.mimeType ? { mimeType: parsed.mimeType } : {}) }
    }
  } catch {
    return null
  }
  return null
}

/** Encode a dragged asset into the standard `{alias,blobId}` ImageRef string. */
export function encodeDraggedAssetRef(asset: DraggedAsset): string {
  return JSON.stringify({ alias: asset.alias, blobId: asset.blobId })
}
