import { memo, useCallback, useRef, useState } from 'react'
import { BatteryNode, usePipelineStore, type Battery, type NodeProps } from '@forgeax/node-runtime-react/editor'
import { readDraggedAsset, encodeDraggedAssetRef, type DraggedAsset } from '../surfaces/library/draggedAssetBus.js'
import { pluginUrl } from '../api/pluginHttp'
import './ImageSourceNode.css'

interface ImageSourceNodeData {
  battery: Battery
  params: Record<string, unknown>
}

// Resolve an encoded image ref (data URL / { alias, blobId } JSON) to a browser
// src. Matches ImagePreviewNode / ImageBatteryNode: a blobId maps to the app's
// content-addressed blob route; a bare alias maps to the generated-asset route.
function imageRefToSrc(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('data:')) return trimmed
  if (!trimmed.startsWith('{')) {
    // Treat a non-JSON, non-data string as a bare generated-asset alias.
    return pluginUrl(`/api/v1/generated-assets/blob/${encodeURIComponent(trimmed)}`)
  }
  try {
    const parsed = JSON.parse(trimmed) as { blobId?: unknown; alias?: unknown }
    if (typeof parsed.blobId === 'string' && parsed.blobId) {
      return pluginUrl(`/api/v1/library/blob/${encodeURIComponent(parsed.blobId)}`)
    }
    if (typeof parsed.alias === 'string' && parsed.alias) {
      return pluginUrl(`/api/v1/generated-assets/blob/${encodeURIComponent(parsed.alias)}`)
    }
  } catch {
    return ''
  }
  return ''
}

// Output-only image node: it holds its own image reference in params (set when an
// image is dragged from the All Images panel onto the canvas) and previews it on
// the canvas. Styled like ImagePreviewNode, but the image comes from this node's
// OWN params instead of an upstream edge — so it has no input handle.
function ImageSourceNode(props: NodeProps<ImageSourceNodeData>): JSX.Element {
  const { id, data } = props
  // Read the image from the LIVE pipeline store, not the ReactFlow `data.params`
  // snapshot: an in-place replace goes through `updateNodeParam`, which writes
  // `currentPipeline` synchronously but does NOT push into the ReactFlow node's
  // `data` (only a later canvas rebuild does — and the param-edit hot path
  // suppresses/coalesces that rebuild). Reading the store makes the preview
  // reflect the new image the instant it is dropped, instead of lagging behind a
  // debounced persist round-trip (or never updating when the rebuild is dropped).
  const liveImage = usePipelineStore(
    (s) => s.currentPipeline?.nodes.find((n) => n.id === id)?.params?.image,
  )
  const src = imageRefToSrc(liveImage ?? data.params?.image)
  const hasImage = src.length > 0
  const [isDragOver, setIsDragOver] = useState(false)

  // The dragged asset, captured the moment it is reliably visible (during
  // dragover, before the source iframe's dragend can clear the handoff). Used as
  // the drop fallback so the in-place replace never silently no-ops on a
  // cross-iframe read race.
  const draggedRef = useRef<DraggedAsset | null>(null)

  // Drop an Asset Store image directly ONTO this node → replace its image
  // in-place instead of letting the canvas create a new image_source node.
  // The dragged asset's payload rides the localStorage `draggedAssetBus` (the
  // native dataTransfer does not cross the assetstore↔canvas iframe boundary),
  // so we read it synchronously here. We only intercept when there IS a dragged
  // asset; otherwise the event bubbles to the canvas untouched.
  const onDragOver = useCallback((event: React.DragEvent) => {
    const asset = readDraggedAsset()
    if (!asset) return
    draggedRef.current = asset
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
    setIsDragOver(true)
  }, [])

  const onDragLeave = useCallback(() => {
    setIsDragOver(false)
  }, [])

  const onDrop = useCallback((event: React.DragEvent) => {
    const asset = readDraggedAsset() ?? draggedRef.current
    if (!asset) return
    event.preventDefault()
    event.stopPropagation()
    setIsDragOver(false)
    draggedRef.current = null
    const store = usePipelineStore.getState()
    // Set `alias` silently (display-only param, no execution), then `image`
    // non-silently so the node + downstream recompute exactly once with both
    // params already applied — instead of two back-to-back execute round-trips.
    store.updateNodeParam(id, 'alias', asset.alias, true)
    store.updateNodeParam(id, 'image', encodeDraggedAssetRef(asset))
  }, [id])

  return (
    <div
      className={`asset2d-image-source-node${isDragOver ? ' is-drag-over' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <BatteryNode {...props} />
      <div className={`is-preview nodrag${hasImage ? ' has-image' : ''}`}>
        {hasImage ? (
          <img className="is-preview__img" src={src} alt="image source" draggable={false} />
        ) : (
          <div className="is-preview__placeholder">
            <svg className="is-preview__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 15l5-5 4 4 3-3 6 6" />
              <circle cx="9" cy="9" r="1.5" />
            </svg>
            <span className="is-preview__hint">拖入图片</span>
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(ImageSourceNode)
