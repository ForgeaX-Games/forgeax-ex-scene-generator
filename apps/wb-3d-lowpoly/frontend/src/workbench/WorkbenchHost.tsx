import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Editor, usePipelineStore, useProjectStore } from '@forgeax/node-runtime-react/editor'
import { HttpApiClient } from '../api/HttpApiClient.js'
import { geometryValueFormatter } from './geometryValueFormatter.js'
import { paneUrl } from './paneUrls.js'
import type {
  EditorAssetImportResultMessage,
  ViewerDirectImportMessage,
} from './protocol.js'
import './WorkbenchHost.css'

const geometryPortTypes = [
  { type: 'geometry', desc: '几何', descEn: 'Geometry', color: '#f87171', compatibleWith: ['string'] },
]
const geometryValueFormatters = [geometryValueFormatter]

// Domain port types (geometry) are passed to <Editor> explicitly via the
// `domainPortTypes` prop below — no module-global registration side effect.

// The kernel editor's gear button is hidden (showSettingsButton={false}); its
// controls — language, open/save, the 3D viewer embed toggle, status, history,
// data types — are re-surfaced in the LEFT pane (<EditorControlsPanel>). The
// embed STATE still lives here because it drives the embedded iframe; the left
// pane flips it by writing LS_VIEWER3D, which we mirror via a `storage` listener
// (same-origin sibling iframe → cross-document).
const LS_VIEWER3D = 'wb3d:viewer3dInline'
// Must match the center <Editor editorSyncKey> ↔ left <EditorControlsPanel syncKey>.
const EDITOR_SYNC_KEY = 'wb-3d-lowpoly-editor'

function readBool(key: string, fallback: boolean): boolean {
  if (typeof localStorage === 'undefined') return fallback
  const raw = localStorage.getItem(key)
  return raw === null ? fallback : raw === 'true'
}

// Workbench host: the kernel Editor sits at the bottom; an embedded 3D viewer
// iframe (a `?pane=viewer3d` surface of this same app) sits on top, separated
// by a draggable row splitter. The host forwards the kernel editor's node
// selection to the viewer over the `workbench:editor-selection` postMessage
// channel. Mirrors the scene generator's WorkbenchHost (renderer pane).
export function WorkbenchHost(): JSX.Element {
  const client = useMemo(() => new HttpApiClient({ baseUrl: '', pipelineId: 'main' }), [])
  // Release the client's WebSocket + listeners on unmount so a host teardown
  // (or HMR remount) doesn't leak a live socket + reconnect loop.
  useEffect(() => () => { client.dispose() }, [client])

  const [viewer3dInline, setViewer3DInline] = useState(() => readBool(LS_VIEWER3D, true))
  const [workbenchHeight, setWorkbenchHeight] = useState<number | null>(null)
  const [isResizing, setIsResizing] = useState(false)
  const [viewerReloadKey, setViewerReloadKey] = useState(0)
  const [isEditorFullscreen, setIsEditorFullscreen] = useState(false)

  const rootRef = useRef<HTMLDivElement>(null)
  const viewerIframeRef = useRef<HTMLIFrameElement>(null)
  // Project switching / create / delete now lives in the left pane's
  // <ProjectPanel>; the center pane only observes the active project id so it
  // can reload the embedded 3D viewer when the project changes (via the
  // kernel's project:activated cross-client sync, wired in <Editor>).
  const viewingProjectId = useProjectStore((s) => s.viewingProjectId)

  // Mirror viewer embed flips made in the left pane (which writes LS_VIEWER3D).
  // `storage` fires only in OTHER same-origin documents, so this is exactly the
  // left-pane → center-pane channel for the relocated window toggle.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === LS_VIEWER3D) setViewer3DInline(readBool(LS_VIEWER3D, true))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Forward the kernel editor's node selection to the 3D viewer pane. The kernel
  // selection lives in the host's in-process pipeline store (no backend/WS
  // round-trip), so we read it here and push it down the
  // `workbench:editor-selection` postMessage channel. View-only — never mutates
  // the graph. `selectionRef` lets the iframe `onLoad` re-seed selection after
  // the viewer (re)mounts.
  const selectionRef = useRef<string[]>([])
  const postSelectionToViewer = useCallback((ids: string[]) => {
    viewerIframeRef.current?.contentWindow?.postMessage(
      { type: 'workbench:editor-selection', selectedNodeIds: ids },
      '*',
    )
  }, [])

  const pendingEditorImportsRef = useRef(new Map<string, {
    resolve: (result: unknown) => void
    reject: (error: Error) => void
    timer: number
  }>())

  // The viewer is a child iframe of this workbench. The workbench forwards the
  // bytes to the Studio WorkbenchRuntimeFrame, whose injected Editor bridge
  // calls the live Gateway directly. No ToolRegistry lookup is involved.
  useEffect(() => {
    const onEditorImportResult = (event: MessageEvent): void => {
      if (event.source !== window.parent) return
      const data = event.data as Partial<EditorAssetImportResultMessage> | null
      if (!data || data.type !== 'workbench:editor-asset-import-result' || typeof data.requestId !== 'string') return
      const pending = pendingEditorImportsRef.current.get(data.requestId)
      if (!pending) return
      window.clearTimeout(pending.timer)
      pendingEditorImportsRef.current.delete(data.requestId)
      if (data.ok === true) pending.resolve(data.result)
      else pending.reject(new Error(typeof data.error === 'string' ? data.error : 'Editor asset import failed'))
    }

    window.addEventListener('message', onEditorImportResult)
    return () => {
      window.removeEventListener('message', onEditorImportResult)
      for (const pending of pendingEditorImportsRef.current.values()) {
        window.clearTimeout(pending.timer)
        pending.reject(new Error('Workbench closed before Editor asset import completed'))
      }
      pendingEditorImportsRef.current.clear()
    }
  }, [])

  const requestEditorAssetImport = useCallback((input: {
    requestId: string
    destPath: string
    sourceName: string
    base64: string
  }): Promise<unknown> => {
    const parent = window.parent
    if (!parent || parent === window) {
      return Promise.reject(new Error('请在 Studio 工作台中打开 3D Lowpoly Generator 后再导入引擎'))
    }
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pendingEditorImportsRef.current.delete(input.requestId)
        reject(new Error('Editor 没有在规定时间内响应导入请求'))
      }, 120_000)
      pendingEditorImportsRef.current.set(input.requestId, { resolve, reject, timer })
      try {
        parent.postMessage({ type: 'workbench:editor-asset-import', ...input }, '*')
      } catch (error) {
        window.clearTimeout(timer)
        pendingEditorImportsRef.current.delete(input.requestId)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }, [])

  const handleViewerDirectImport = useCallback(async (event: MessageEvent): Promise<void> => {
    if (event.source !== viewerIframeRef.current?.contentWindow) return
    const data = event.data as Partial<ViewerDirectImportMessage> | null
    if (!data || data.type !== 'workbench:viewer-direct-import') return
    const target = viewerIframeRef.current?.contentWindow
    if (!target || typeof data.requestId !== 'string') return
    const reply = (ok: boolean, result?: unknown, error?: string): void => {
      target.postMessage({
        type: 'workbench:viewer-direct-import-result',
        requestId: data.requestId,
        ok,
        ...(result === undefined ? {} : { result }),
        ...(error === undefined ? {} : { error }),
      }, '*')
    }
    if (
      typeof data.directory !== 'string'
      || typeof data.name !== 'string'
      || typeof data.base64 !== 'string'
    ) {
      reply(false, undefined, '导入请求缺少目录、文件名或 GLB 数据')
      return
    }
    try {
      const directory = data.directory.replace(/[\\/]+$/u, '')
      const sourceName = data.name.replace(/^[\\/]+/u, '')
      const result = await requestEditorAssetImport({
        requestId: data.requestId,
        destPath: `${directory}/${sourceName}`,
        sourceName,
        base64: data.base64,
      })
      reply(true, result)
    } catch (error) {
      reply(false, undefined, error instanceof Error ? error.message : String(error))
    }
  }, [requestEditorAssetImport])

  useEffect(() => {
    window.addEventListener('message', handleViewerDirectImport)
    return () => window.removeEventListener('message', handleViewerDirectImport)
  }, [handleViewerDirectImport])
  useEffect(() => {
    const sync = (ids: string[]) => {
      selectionRef.current = ids
      postSelectionToViewer(ids)
    }
    sync(usePipelineStore.getState().selectedNodeIds)
    return usePipelineStore.subscribe((state, prev) => {
      if (state.selectedNodeIds !== prev.selectedNodeIds) sync(state.selectedNodeIds)
    })
  }, [postSelectionToViewer])

  useEffect(() => {
    void useProjectStore.getState().bootstrap()
  }, [])

  const prevProjectRef = useRef<string | null>(null)
  useEffect(() => {
    if (viewingProjectId === null) return
    if (prevProjectRef.current === null) {
      prevProjectRef.current = viewingProjectId
      return
    }
    if (prevProjectRef.current === viewingProjectId) return
    prevProjectRef.current = viewingProjectId
    setViewerReloadKey((k) => k + 1)
    viewerIframeRef.current?.contentWindow?.postMessage(
      { type: 'workbench:project-changed', projectId: viewingProjectId },
      '*',
    )
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

  const rootStyle: CSSProperties = {
    ...(workbenchHeight !== null ? { '--workbench-height': `${workbenchHeight}px` } : {}),
  } as CSSProperties

  return (
    <div
      ref={rootRef}
      className={[
        'wb3d-workbench',
        viewer3dInline ? 'wb3d-workbench--embedded' : '',
        isResizing ? 'wb3d-workbench--resizing' : '',
        isEditorFullscreen ? 'wb3d-workbench--focus-editor' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={rootStyle}
    >
      {viewer3dInline && (
        <section className="wb3d-workbench__pane" aria-label="3D Viewer">
          <iframe
            key={`viewer3d-${viewerReloadKey}`}
            ref={viewerIframeRef}
            src={paneUrl('viewer3d')}
            title="viewer3d"
            className="wb3d-workbench__iframe"
            allow="clipboard-write"
            onLoad={() => postSelectionToViewer(selectionRef.current)}
          />
        </section>
      )}

      {viewer3dInline && (
        <div
          className="wb3d-workbench__resize"
          onMouseDown={beginRowResize}
          aria-label="Resize 3D viewer and editor"
        />
      )}

      <div className="wb3d-workbench__editor">
        <Editor
          apiClient={client}
          title="3D Lowpoly Generator"
          showRunControl={false}
          showSettingsButton={false}
          editorSyncKey={EDITOR_SYNC_KEY}
          domainNodeTypes={{}}
          domainPortTypes={geometryPortTypes}
          domainValueFormatters={geometryValueFormatters}
          isFullscreen={isEditorFullscreen}
          onToggleFullscreen={() => setIsEditorFullscreen((v) => !v)}
        />
      </div>
    </div>
  )
}
