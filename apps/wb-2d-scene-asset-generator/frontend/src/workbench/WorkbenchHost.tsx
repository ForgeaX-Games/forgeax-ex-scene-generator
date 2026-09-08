import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Editor, useProjectStore, usePipelineStore } from '@forgeax/node-runtime-react/editor'
import type { ExternalDropHandler } from '@forgeax/node-runtime-react/editor'
import { HttpApiClient } from '../api/HttpApiClient.js'
import { scenePanelTypes } from '../panels/scenePanels.js'
import { paneUrl } from './paneUrls.js'
import { isWorkbenchMessage, type WorkbenchFocus } from './protocol.js'
import { sceneValueFormatter } from './sceneValueFormatter.js'
import { readDraggedAsset, encodeDraggedAssetRef } from '../surfaces/library/draggedAssetBus.js'
import './WorkbenchHost.css'

const sceneValueFormatters = [sceneValueFormatter]

// This app has no domain port types: image data flows through the core `image`
// type, and `asset2d` is the project id / backend service, not a port type — so
// no `domainPortTypes` prop is passed to <Editor> below.

// The kernel editor's gear button is hidden (showSettingsButton={false}); its
// controls — history, data types, help — are re-surfaced in the LEFT pane
// (<SceneGeneratorControlsPanel>).
// embed-toggle STATE still lives here because it drives the embedded iframes;
// the left pane flips it by writing these localStorage keys, and we mirror those
// writes via a `storage` listener (same-origin sibling iframe → cross-document).
const LS_RENDERER = 'wb-2d-scene-asset-generator.rendererInline'
const LS_ASSETSTORE = 'wb-2d-scene-asset-generator.assetStoreInline'
const LS_EDITOR = 'wb-2d-scene-asset-generator.editorInline'
// Must match the center <Editor editorSyncKey> ↔ left <SceneGeneratorControlsPanel syncKey>.
const EDITOR_SYNC_KEY = 'wb-2d-scene-asset-generator-editor'

function readBool(key: string, fallback: boolean): boolean {
  if (typeof localStorage === 'undefined') return fallback
  const raw = localStorage.getItem(key)
  return raw === null ? fallback : raw === 'true'
}

// Legacy-style workbench host: the faithful kernel Editor sits at the bottom; an
// embedded row of Renderer / AssetStore iframes sits on top, each a `?pane=`
// surface of this same app. Mirrors the legacy editor App.tsx layout/focus model
// minus the Viewer (which moves to the 3d-lowpoly plugin).
export function WorkbenchHost(): JSX.Element {
  const client = useMemo(() => new HttpApiClient({ baseUrl: '', pipelineId: 'main' }), [])

  const [rendererInline, setRendererInline] = useState(() => readBool(LS_RENDERER, true))
  const [assetStoreInline, setAssetStoreInline] = useState(() => readBool(LS_ASSETSTORE, true))
  const [editorInline, setEditorInline] = useState(() => readBool(LS_EDITOR, true))
  const [focus, setFocus] = useState<WorkbenchFocus>(null)
  const [workbenchHeight, setWorkbenchHeight] = useState<number | null>(null)
  // Default to `null` so the two top panes split evenly (1fr / 1fr) on first
  // load; dragging the column splitter seeds an explicit pixel width afterwards.
  const [assetStoreWidth, setAssetStoreWidth] = useState<number | null>(null)
  const [isResizing, setIsResizing] = useState(false)

  // Multi-project management (kernel-backed). Project switching / create / delete
  // lives in the left pane's <ProjectPanel>; the center pane only observes the
  // active project id so it can signal the renderer when the project changes (via
  // the kernel's project:activated cross-client sync, wired in <Editor>).
  const viewingProjectId = useProjectStore((s) => s.viewingProjectId)
  // Bump to force the preview iframe to clear + reload on a project switch.
  const [rendererReloadKey, setRendererReloadKey] = useState(0)

  const rootRef = useRef<HTMLDivElement>(null)
  const rendererIframeRef = useRef<HTMLIFrameElement>(null)
  const assetStoreIframeRef = useRef<HTMLIFrameElement>(null)

  const hasEmbedded = rendererInline || assetStoreInline
  // The editor (2D Scene Asset Generator) is now toggleable too. The "split" 3-row layout
  // (panes / resize / editor) only applies when BOTH the panes row and the editor
  // are visible; otherwise whichever single section is on fills the grid. When all
  // three are off we render an empty-state placeholder so the pane isn't blank.
  const showSplit = hasEmbedded && editorInline
  const showEmpty = !hasEmbedded && !editorInline

  // Mirror embed-toggle flips made in the left pane (which writes these keys).
  // `storage` fires only in OTHER same-origin documents, so this is exactly the
  // left-pane → center-pane channel for the relocated window toggles.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === LS_RENDERER) setRendererInline(readBool(LS_RENDERER, true))
      else if (e.key === LS_ASSETSTORE) setAssetStoreInline(readBool(LS_ASSETSTORE, true))
      else if (e.key === LS_EDITOR) setEditorInline(readBool(LS_EDITOR, true))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const isEditorFullscreen = focus === 'editor'
  const toggleEditorFullscreen = useCallback(() => {
    setFocus((f) => (f === 'editor' ? null : 'editor'))
  }, [])

  // Cross-iframe image drop → create an `image_source` node. The kernel canvas
  // calls this only for drops that carry NO `application/battery` payload. The
  // dragged image's id was handed off via the localStorage `draggedAssetBus`
  // (the assetstore iframe's native dataTransfer does not survive the iframe
  // boundary), so we read it here, find the `image_source` battery in the loaded
  // catalog, and place a node whose params hold the encoded image reference.
  const handleExternalDrop = useCallback<ExternalDropHandler>((position, _event, placeBattery) => {
    const asset = readDraggedAsset()
    if (!asset) return
    const battery = usePipelineStore.getState().batteries.find((b) => b.id === 'image_source')
    if (!battery) return
    placeBattery(battery, position, {
      presetParams: { image: encodeDraggedAssetRef(asset), alias: asset.alias },
    })
  }, [])

  // Parent half of the `workbench:*` protocol: children request/query focus; we
  // reply / broadcast focus-changed back.
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (!isWorkbenchMessage(event.data)) return
      const data = event.data
      if (data.type === 'workbench:request-focus') {
        setFocus((f) => (f === data.target ? null : data.target))
      } else if (data.type === 'workbench:query-focus') {
        ;(event.source as Window | null)?.postMessage(
          { type: 'workbench:focus-changed', focus },
          '*',
        )
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [focus])

  // Broadcast focus changes so child buttons reflect fullscreen state.
  useEffect(() => {
    const msg = { type: 'workbench:focus-changed', focus }
    rendererIframeRef.current?.contentWindow?.postMessage(msg, '*')
    assetStoreIframeRef.current?.contentWindow?.postMessage(msg, '*')
  }, [focus])

  // Bootstrap the project list + active project type on mount. We do NOT
  // switchProject here — the kernel Editor already loadPipeline()s the active
  // project's graph on mount, so this only populates the modal + battery filter.
  useEffect(() => {
    void useProjectStore.getState().bootstrap()
  }, [])

  // Clear + reload the preview when the active project changes: remount the
  // iframe (key bump) so its caches/state reset. The graph itself live-syncs
  // via the activate route's graph:applied broadcast.
  const prevProjectRef = useRef<string | null>(null)
  useEffect(() => {
    if (viewingProjectId === null) return
    if (prevProjectRef.current === null) {
      prevProjectRef.current = viewingProjectId
      return
    }
    if (prevProjectRef.current === viewingProjectId) return
    prevProjectRef.current = viewingProjectId
    setRendererReloadKey((k) => k + 1)
  }, [viewingProjectId])

  const beginRowResize = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return
    setIsResizing(true)
    const onMove = (m: MouseEvent) => {
      const max = Math.max(180, rect.height - 180 - 4)
      setWorkbenchHeight(Math.max(180, Math.min(max, m.clientY - rect.top)))
    }
    const onUp = () => {
      setIsResizing(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  const beginColumnResize = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    const rect = e.currentTarget.parentElement?.getBoundingClientRect()
    if (!rect) return
    setIsResizing(true)
    const onMove = (m: MouseEvent) => {
      const max = Math.max(180, rect.width - 240 - 4)
      setAssetStoreWidth(Math.max(180, Math.min(max, m.clientX - rect.left)))
    }
    const onUp = () => {
      setIsResizing(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  // Pane column template: when both panes are open they split evenly by default
  // (1fr / 1fr); dragging the splitter pins the AssetStore to an explicit pixel
  // width via `--assetstore-width`. Either pane alone fills the row. A 4px
  // splitter sits between the two when both are open.
  const gridTemplateColumns = useMemo(() => {
    const cols: string[] = []
    if (assetStoreInline) {
      cols.push(
        rendererInline
          ? `var(--assetstore-width, ${assetStoreWidth !== null ? `${assetStoreWidth}px` : 'minmax(0, 1fr)'})`
          : 'minmax(180px, 1fr)',
      )
    }
    if (rendererInline) cols.push('minmax(240px, 1fr)')
    return cols.join(' 4px ')
  }, [assetStoreInline, rendererInline, assetStoreWidth])

  const rootStyle: CSSProperties = {
    ...(workbenchHeight !== null ? { '--workbench-height': `${workbenchHeight}px` } : {}),
    ...(assetStoreWidth !== null ? { '--assetstore-width': `${assetStoreWidth}px` } : {}),
  } as CSSProperties

  const panes: Array<'assetstore' | 'renderer'> = [
    ...(assetStoreInline ? ['assetstore' as const] : []),
    ...(rendererInline ? ['renderer' as const] : []),
  ]

  return (
    <div
      ref={rootRef}
      className={[
        'scene-workbench',
        showSplit ? 'scene-workbench--embedded' : '',
        isResizing ? 'scene-workbench--resizing' : '',
        focus ? `scene-workbench--focus-${focus}` : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={rootStyle}
    >
      {hasEmbedded && (
        <div className="scene-workbench__panes" style={{ gridTemplateColumns }}>
          {panes.map((pane, idx) => {
            const isLast = idx === panes.length - 1
            return (
              <Fragment key={pane}>
                {pane === 'assetstore' && (
                  <section className="scene-pane scene-pane--assetstore" aria-label="AssetStore">
                    <iframe
                      ref={assetStoreIframeRef}
                      src={paneUrl('assetstore')}
                      title="AssetStore"
                      className="scene-pane__iframe"
                    />
                  </section>
                )}
                {pane === 'renderer' && (
                  <section className="scene-pane scene-pane--renderer" aria-label="Renderer">
                    <iframe
                      key={`renderer-${rendererReloadKey}`}
                      ref={rendererIframeRef}
                      src={paneUrl('preview')}
                      title="Preview"
                      className="scene-pane__iframe"
                      allow="clipboard-write"
                    />
                  </section>
                )}
                {!isLast && (
                  <div
                    className="scene-pane__resize scene-pane__resize--col"
                    onMouseDown={beginColumnResize}
                    aria-label={`Resize ${pane} panel`}
                  />
                )}
              </Fragment>
            )
          })}
        </div>
      )}

      {showSplit && (
        <div
          className="scene-pane__resize scene-pane__resize--row"
          onMouseDown={beginRowResize}
          aria-label="Resize workbench and editor"
        />
      )}

      {editorInline && (
        <div className="scene-workbench__editor">
          <Editor
            apiClient={client}
            title="Asset Generator"
            showRunControl={false}
            showSettingsButton={false}
            editorSyncKey={EDITOR_SYNC_KEY}
            domainNodeTypes={scenePanelTypes}
            domainValueFormatters={sceneValueFormatters}
            isFullscreen={isEditorFullscreen}
            onToggleFullscreen={toggleEditorFullscreen}
            onExternalDrop={handleExternalDrop}
          />
        </div>
      )}

      {showEmpty && (
        <div className="scene-workbench__empty" role="status">
          <div className="scene-workbench__empty-inner">
            <h2>All panels are hidden</h2>
            <p>Use the Asset Generator, AssetStore, and Preview buttons in the left navigation to bring a panel back.</p>
          </div>
        </div>
      )}
    </div>
  )
}
