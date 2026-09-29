import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  Editor,
  subscribeLocalParamEdit,
  useProjectStore,
  usePipelineStore,
  stripTooLargeSummaries,
} from '@forgeax/node-runtime-react/editor'
import { HttpApiClient } from '../api/HttpApiClient.js'
import { scenePanelTypes } from '../panels/scenePanels.js'
import { paneUrl } from './paneUrls.js'
import {
  isAuthoringMessage,
  authoringParentOrigin,
  authoringTargetOrigin,
  type EditorAssetImportResultMessage,
  type AuthoringFocus,
} from './protocol.js'
import { sceneValueFormatter } from './sceneValueFormatter.js'
import { scenePortTypes } from './scenePortTypes.js'
import { syncTrace, syncTraceHintOnce, summarizeNodeOutputs } from '../debug/syncTrace.js'
import { LoadingStatusPanel, type LoadingStep } from './LoadingStatusPanel.js'
import {
  EDITOR_OPACITY_DEFAULT,
  EDITOR_OPACITY_MAX,
  EDITOR_OPACITY_MIN,
  LS_EDITOR,
  LS_RENDERER,
  clampEditorSurfaceOpacity,
  isDefaultWorkspaceLayout,
  restoreDefaultWorkspace,
} from './authoringLayout.js'
import { sceneT, useSceneLocale } from '../sceneI18n.js'
import { isFailedParamEdit, paramEditErrorMessage } from './paramEditRollback.js'
import { applyControlParamBatch } from './controlParamBatch.js'
import { SceneScriptDiagnosticDock } from './SceneScriptDiagnosticDock.js'
import { SceneScriptStudio } from './SceneScriptStudio.js'
import { bindSceneScriptDiagnosticRevision } from './sceneScriptDiagnosticBridge.js'
import { usePublishSceneRunDiagnostics } from './usePublishSceneRunDiagnostics.js'
import type { PreviewCapture } from './sceneScriptDiff.js'
import { Pin } from '../surfaces/icons.js'
import './AuthoringHost.css'

const sceneValueFormatters = [sceneValueFormatter]

// Domain port types (geometry + Geometry2D subtype markers, scene, mesh) come from scenePortTypes
// and are passed to <Editor> explicitly via the `domainPortTypes` prop below —
// no module-global registration side effect.

// The kernel editor's gear button is hidden (showSettingsButton={false}); its
// controls — history, data types, help — are re-surfaced in the LEFT pane
// (<SceneGeneratorControlsPanel>).
// Preview and floating-editor visibility live here because the left pane flips
// them through localStorage, mirrored via a same-origin `storage` listener.
// Must match the center <Editor editorSyncKey> ↔ left <SceneGeneratorControlsPanel syncKey>.
const EDITOR_SYNC_KEY = 'scene-generator-editor'
const MemoizedEditor = memo(Editor)

type PreviewStatus = {
  viewingProjectId?: string | null
  executionId?: string | null
  executionStatus?: 'idle' | 'running' | 'completed' | 'error'
  voxelLayers?: number
  gridLayers?: number
  meshLayers?: number
  guideLayers?: number
  frameDigest?: string | null
  staleReasons: string[]
}

function previewStatusLabel(status: PreviewStatus, viewingProjectId: string | null): string {
  if (status.executionStatus === 'running') return 'Executing — keeping last frame'
  if (status.staleReasons.includes('project-mismatch')) {
    return `project-mismatch: renderer is viewing ${status.viewingProjectId ?? 'none'}, authoring is ${viewingProjectId ?? 'none'}`
  }
  if (status.staleReasons.includes('no-visible-output')) return 'No visible output'
  if (status.staleReasons.includes('no-visible-delta')) return 'No visible change'
  if (status.staleReasons.includes('preview-stale')) return 'Preview out of date'
  const layers = (status.voxelLayers ?? 0) + (status.gridLayers ?? 0) + (status.meshLayers ?? 0)
  if (layers === 0) return 'No visible output'
  return `preview ${status.executionStatus ?? 'idle'} · voxel ${status.voxelLayers ?? 0} · mesh ${status.meshLayers ?? 0} · grid ${status.gridLayers ?? 0}`
}

function readBool(key: string, fallback: boolean): boolean {
  if (typeof localStorage === 'undefined') return fallback
  const raw = localStorage.getItem(key)
  return raw === null ? fallback : raw === 'true'
}

// Project-switch progress panel step labels for the host-side (editor) phases
// — the renderer-iframe's own phases (previews/baked/aliases) arrive
// pre-labeled over `authoring:loading-status` (see loadingSignals.ts).
function switchPhaseLabel(phase: string | null): string {
  switch (phase) {
    case 'persisting':
      return sceneT('loading.switch.persisting')
    case 'viewing':
      return sceneT('loading.switch.viewing')
    case 'hydrating':
      return sceneT('loading.switch.hydrating')
    default:
      return sceneT('loading.switch.default')
  }
}

// Turns a raw boolean signal into 'active' while true, 'done' for a brief
// linger window after it flips false (so a fast phase still visibly appears
// as a completed checklist row instead of vanishing instantly), then 'idle'
// (excluded from the panel) once the linger elapses.
function useLingeringStep(active: boolean, lingerMs = 1100): 'idle' | 'active' | 'done' {
  const [state, setState] = useState<'idle' | 'active' | 'done'>(active ? 'active' : 'idle')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (active) {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      setState('active')
    } else {
      setState((prev) => (prev === 'active' ? 'done' : prev))
      timerRef.current = setTimeout(() => setState('idle'), lingerMs)
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [active, lingerMs])
  return state
}

type RendererLoadingTask = { id: string; label: string; active: boolean; done?: number; total?: number }

// The Page owns the project sidebar. Inside its workspace panel, Renderer fills
// the background while the kernel Editor is an optional floating card; this
// avoids duplicating Page-owned project controls in a second iframe.
export function AuthoringHost(): JSX.Element {
  useSceneLocale()
  const clientRef = useRef<HttpApiClient | null>(null)
  if (!clientRef.current) {
    clientRef.current = new HttpApiClient({ baseUrl: '', pipelineId: 'main' })
  }
  const client = clientRef.current
  usePublishSceneRunDiagnostics(client)
  useEffect(() => () => {
    clientRef.current?.dispose()
    clientRef.current = null
  }, [])

  // Page no longer exposes the old Preview toggle. A persisted `false` from
  // that removed control otherwise prevents the renderer iframe from mounting
  // and leaves the new workspace blank.
  const [rendererInline, setRendererInline] = useState(true)
  // Bundle semantics: availability stays mounted; the Renderer capsule only
  // opens/closes the floating card. This avoids recreating the editor bridge
  // and makes `editor-visibility-changed` describe the visible card.
  const [editorInline, setEditorInline] = useState(true)
  const [editorCardOpen, setEditorCardOpen] = useState(false)
  // Scene Script is an on-demand authoring surface. Keep the node canvas as
  // the default workspace and let the toolbar open the dock only when needed.
  const [sceneScriptOpen, setSceneScriptOpen] = useState(false)
  const [sceneScriptExpanded, setSceneScriptExpanded] = useState(false)
  const [editorPinned, setEditorPinned] = useState(false)
  const [editorSurfaceOpacity, setEditorSurfaceOpacity] = useState(EDITOR_OPACITY_DEFAULT)
  const [focus, setFocus] = useState<AuthoringFocus>(null)
  const [showRestore, setShowRestore] = useState(() => !isDefaultWorkspaceLayout())

  // Multi-project management (kernel-backed). Project switching / create / delete
  // lives in the left pane's <ProjectPanel>; the center pane only observes the
  // active project id so it can signal the renderer when the project changes (via
  // the kernel's project:activated cross-client sync, wired in <Editor>).
  const viewingProjectId = useProjectStore((s) => s.viewingProjectId)
  useEffect(() => {
    if (!viewingProjectId) return
    let cancelled = false
    void client.getSceneScriptProjectInfo(viewingProjectId).then((info) => {
      if (cancelled) return
      bindSceneScriptDiagnosticRevision(viewingProjectId, info.projectRevision ?? info.revision)
    }).catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [client, viewingProjectId])
  const isSwitchingProject = useProjectStore((s) => s.isSwitching)
  const switchPhase = useProjectStore((s) => s.switchPhase)
  const outputsRefreshBusy = usePipelineStore((s) => s.outputsRefreshBusy)
  const pipelineStatus = usePipelineStore((s) => s.pipelineStatus)
  // Bump to force the preview iframe to clear + reload on a project switch.
  const [rendererReloadKey, setRendererReloadKey] = useState(0)
  // Project-switch loading-progress panel: host-observed phases (below) plus
  // whatever the renderer iframe reports over `authoring:loading-status`.
  const [rendererBooting, setRendererBooting] = useState(false)
  const [rendererTasks, setRendererTasks] = useState<RendererLoadingTask[]>([])
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>({ staleReasons: [] })

  const rendererIframeRef = useRef<HTMLIFrameElement>(null)
  const resetInFlightRef = useRef(false)
  const editorContainerRef = useRef<HTMLDivElement>(null)
  const previewCaptureSequenceRef = useRef(0)
  const previewCapturePendingRef = useRef(new Map<string, {
    resolve: (capture: PreviewCapture) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>())
  const editorImportPendingRef = useRef(new Map<string, {
    resolve: (result: unknown) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>())
  const authoringOrigin = authoringTargetOrigin()
  const parentOrigin = authoringParentOrigin()

  const postToRenderer = useCallback((msg: unknown) => {
    rendererIframeRef.current?.contentWindow?.postMessage(msg, authoringOrigin)
  }, [authoringOrigin])

  const capturePreview = useCallback((): Promise<PreviewCapture> => {
    const requestId = `scene-diff-${Date.now()}-${previewCaptureSequenceRef.current += 1}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        previewCapturePendingRef.current.delete(requestId)
        reject(new Error('Renderer preview capture timed out.'))
      }, 8000)
      previewCapturePendingRef.current.set(requestId, { resolve, reject, timer })
      postToRenderer({ type: 'authoring:capture-preview', requestId })
    })
  }, [postToRenderer])

  useEffect(() => () => {
    for (const pending of previewCapturePendingRef.current.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Authoring closed during preview capture.'))
    }
    previewCapturePendingRef.current.clear()
    for (const pending of editorImportPendingRef.current.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Authoring closed before Studio asset import completed.'))
    }
    editorImportPendingRef.current.clear()
  }, [])

  const requestEditorAssetImport = useCallback((input: {
    requestId: string
    destPath: string
    sourceName: string
    base64: string
  }): Promise<unknown> => {
    const parent = window.parent
    if (!parent || parent === window) {
      return Promise.reject(new Error('Open Scene Generator in Studio before importing a GLB.'))
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        editorImportPendingRef.current.delete(input.requestId)
        reject(new Error('Studio did not respond to the GLB import request.'))
      }, 120_000)
      editorImportPendingRef.current.set(input.requestId, { resolve, reject, timer })
      try {
        parent.postMessage({ type: 'authoring:editor-asset-import', ...input }, parentOrigin)
      } catch (error) {
        clearTimeout(timer)
        editorImportPendingRef.current.delete(input.requestId)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }, [parentOrigin])

  useEffect(() => {
    const handleEditorImportResult = (event: MessageEvent): void => {
      if (event.origin !== parentOrigin || event.source !== window.parent) return
      const data = event.data as Partial<EditorAssetImportResultMessage> | null
      if (!data || data.type !== 'authoring:editor-asset-import-result' || typeof data.requestId !== 'string') return
      const pending = editorImportPendingRef.current.get(data.requestId)
      if (!pending) return
      clearTimeout(pending.timer)
      editorImportPendingRef.current.delete(data.requestId)
      if (data.ok === true) pending.resolve(data.result)
      else pending.reject(new Error(typeof data.error === 'string' ? data.error : 'Studio asset import failed.'))
    }
    window.addEventListener('message', handleEditorImportResult)
    return () => window.removeEventListener('message', handleEditorImportResult)
  }, [parentOrigin])

  const broadcastEditorVisibility = useCallback((visible: boolean) => {
    postToRenderer({ type: 'authoring:editor-visibility-changed', visible })
  }, [postToRenderer])

  const toggleEditorVisibility = useCallback(() => {
    setEditorPinned(false)
    setEditorCardOpen((open) => {
      const next = !open
      broadcastEditorVisibility(editorInline && next)
      return next
    })
  }, [broadcastEditorVisibility, editorInline])

  const closeEditorFromOutside = useCallback((force = false) => {
    if (editorPinned && !force) return
    setEditorPinned(false)
    setEditorCardOpen((open) => {
      if (!open) return open
      broadcastEditorVisibility(false)
      return false
    })
  }, [broadcastEditorVisibility, editorPinned])

  const restoreWorkspaceLayout = useCallback(() => {
    restoreDefaultWorkspace()
    setRendererInline(true)
    setEditorInline(true)
    setEditorCardOpen(false)
    setEditorPinned(false)
    setEditorSurfaceOpacity(EDITOR_OPACITY_DEFAULT)
    setFocus(null)
    setShowRestore(false)
    broadcastEditorVisibility(false)
    postToRenderer({ type: 'authoring:restore-layout' })
  }, [broadcastEditorVisibility, postToRenderer])

  const onEditorOpacityChange = useCallback((value: number) => {
    setEditorSurfaceOpacity(clampEditorSurfaceOpacity(value))
  }, [])

  const hasRenderer = rendererInline
  const showFloatingEditor = hasRenderer && editorInline
  const showEmpty = !hasRenderer && !editorInline

  // Mirror embed-toggle flips made in the left pane (which writes these keys).
  // `storage` fires only in OTHER same-origin documents, so this is exactly the
  // left-pane → center-pane channel for the relocated window toggles.
  useEffect(() => {
    try { localStorage.setItem(LS_RENDERER, 'true') } catch { /* ignore */ }
    const onStorage = (e: StorageEvent) => {
      if (e.key === LS_RENDERER) {
        // The removed Preview toggle cannot hide the always-present Page
        // workspace; normalize stale writes from pre-migration documents.
        if (readBool(LS_RENDERER, true) === false) {
          try { localStorage.setItem(LS_RENDERER, 'true') } catch { /* ignore */ }
        }
        setRendererInline(true)
      }
      else if (e.key === LS_EDITOR) {
        const visible = readBool(LS_EDITOR, true)
        setEditorInline(visible)
        if (!visible) {
          setEditorCardOpen(false)
          setEditorPinned(false)
        }
        broadcastEditorVisibility(visible && editorCardOpen)
      } else if (e.key === 'scene-generator.preview-drawer-width') {
        setShowRestore(!isDefaultWorkspaceLayout() || focus !== null)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [broadcastEditorVisibility, editorCardOpen, focus])

  useEffect(() => {
    setShowRestore(!isDefaultWorkspaceLayout() || focus !== null)
  }, [focus, editorCardOpen, editorInline, editorSurfaceOpacity, rendererInline])

  useEffect(() => {
    if (!editorCardOpen) return
    const frame = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
    return () => cancelAnimationFrame(frame)
  }, [editorCardOpen])

  // React 18 does not serialize the inert boolean attribute. Set it directly so
  // the mounted hidden editor cannot receive pointer, keyboard, or focus events.
  useEffect(() => {
    const container = editorContainerRef.current
    if (!container) return
    if (editorCardOpen) container.removeAttribute('inert')
    else container.setAttribute('inert', '')
  }, [editorCardOpen])

  const isEditorFullscreen = focus === 'editor'
  const toggleEditorFullscreen = useCallback(() => {
    setFocus((f) => (f === 'editor' ? null : 'editor'))
  }, [])

  // Parent half of the `authoring:*` protocol: children request/query focus; we
  // reply / broadcast focus-changed back.
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== authoringOrigin) return
      const rendererWindow = rendererIframeRef.current?.contentWindow
      if (!rendererWindow || event.source !== rendererWindow) return
      if (!isAuthoringMessage(event.data)) return
      const data = event.data
      if (data.type === 'authoring:preview-captured') {
        const pending = previewCapturePendingRef.current.get(data.requestId)
        if (!pending) return
        clearTimeout(pending.timer)
        previewCapturePendingRef.current.delete(data.requestId)
        if (data.error || !data.dataUrl || !data.width || !data.height) {
          pending.reject(new Error(data.error ?? 'Renderer returned an empty preview frame.'))
        } else {
          pending.resolve({
            dataUrl: data.dataUrl,
            width: data.width,
            height: data.height,
            capturedAt: data.capturedAt,
          })
        }
      } else if (data.type === 'authoring:preview-status') {
        const currentViewing = useProjectStore.getState().viewingProjectId
        const reportedViewing = typeof data.viewingProjectId === 'string'
          ? data.viewingProjectId
          : currentViewing
        const next: PreviewStatus = {
          viewingProjectId: reportedViewing,
          executionId: data.executionId ?? null,
          executionStatus: data.executionStatus,
          voxelLayers: data.voxelLayers ?? 0,
          gridLayers: data.gridLayers ?? 0,
          meshLayers: data.meshLayers ?? 0,
          guideLayers: data.guideLayers ?? 0,
          frameDigest: data.frameDigest ?? null,
          staleReasons: [],
        }
        const layers = (next.voxelLayers ?? 0) + (next.gridLayers ?? 0) + (next.meshLayers ?? 0)
        if (next.executionStatus === 'completed' && layers === 0) next.staleReasons.push('no-visible-output')
        setPreviewStatus(next)
        void client.reportRendererStatus({
          viewingProjectId: reportedViewing,
          openProjectId: reportedViewing,
          executionId: next.executionId,
          executionStatus: next.executionStatus,
          voxelLayers: next.voxelLayers,
          gridLayers: next.gridLayers,
          meshLayers: next.meshLayers,
          guideLayers: next.guideLayers,
          frameTimestamp: data.frameTimestamp,
          frameDigest: next.frameDigest,
        }).catch(() => undefined)
      } else if (data.type === 'authoring:request-focus') {
        setFocus((f) => (f === data.target ? null : data.target))
      } else if (data.type === 'authoring:query-focus') {
        rendererWindow.postMessage({ type: 'authoring:focus-changed', focus }, authoringOrigin)
      } else if (data.type === 'authoring:toggle-editor') {
        toggleEditorVisibility()
      } else if (data.type === 'authoring:request-close-editor') {
        closeEditorFromOutside(data.force)
      } else if (data.type === 'authoring:query-editor-visibility') {
        rendererWindow.postMessage(
          { type: 'authoring:editor-visibility-changed', visible: editorInline && editorCardOpen },
          authoringOrigin,
        )
      } else if (data.type === 'authoring:loading-status') {
        setRendererTasks(data.tasks)
      } else if (data.type === 'authoring:renderer-direct-import') {
        const reply = (ok: boolean, result?: unknown, error?: string): void => {
          rendererWindow.postMessage({
            type: 'authoring:renderer-direct-import-result',
            requestId: data.requestId,
            ok,
            ...(result === undefined ? {} : { result }),
            ...(error === undefined ? {} : { error }),
          }, authoringOrigin)
        }
        if (
          typeof data.requestId !== 'string'
          || typeof data.directory !== 'string'
          || typeof data.name !== 'string'
          || typeof data.base64 !== 'string'
        ) {
          reply(false, undefined, 'GLB import request is missing a directory, filename, or binary payload.')
          return
        }
        const directory = data.directory.replace(/[\\/]+$/u, '')
        const sourceName = data.name.replace(/^[\\/]+/u, '')
        void requestEditorAssetImport({
          requestId: data.requestId,
          destPath: `${directory}/${sourceName}`,
          sourceName,
          base64: data.base64,
        }).then(
          (result) => reply(true, result),
          (error: unknown) => reply(false, undefined, error instanceof Error ? error.message : String(error)),
        )
      } else if (data.type === 'authoring:set-param') {
        if (typeof data.nodeId !== 'string' || typeof data.key !== 'string') return
        const store = usePipelineStore.getState()
        const node = store.currentPipeline?.nodes.find((n) => n.id === data.nodeId)
        if (!node) return
        if (data.silent === true) {
          store.updateNodeParam(data.nodeId, data.key, data.value, true)
          return
        }
        const previous = node.params[data.key]
        store.updateNodeParam(data.nodeId, data.key, data.value, true)
        void store.incrementalExecute(data.nodeId, false, { localParamEdit: true }).then(async (result) => {
          if (!isFailedParamEdit(result)) {
            postToRenderer({ type: 'authoring:param-edit-result', ok: true, nodeId: data.nodeId, key: data.key })
            return
          }
          const latest = usePipelineStore.getState()
          latest.updateNodeParam(data.nodeId, data.key, previous, true)
          await latest.incrementalExecute(data.nodeId, false, { localParamEdit: true })
          postToRenderer({
            type: 'authoring:param-edit-result',
            ok: false,
            nodeId: data.nodeId,
            key: data.key,
            error: paramEditErrorMessage(result),
          })
        })
      } else if (data.type === 'authoring:reset-document') {
        if (resetInFlightRef.current) return
        resetInFlightRef.current = true
        void usePipelineStore.getState().clearCacheAndExecutePipeline().then(() => {
          postToRenderer({
            type: 'authoring:param-edit-result',
            ok: true,
            nodeId: '',
            key: 'reset',
          })
        }).finally(() => {
          resetInFlightRef.current = false
        })
      } else if (data.type === 'authoring:set-params') {
        const edits = Array.isArray(data.edits) ? data.edits : []
        void applyControlParamBatch(usePipelineStore.getState(), edits, {
          persistNodes: async (nodes) => {
            if (nodes.length === 0) return
            await client.applyBatch(
              nodes.map((node) => ({ type: 'updateNode', nodeId: node.id, params: node.params })),
              { actor: 'editor' },
            )
          },
        }).then((result) => {
          postToRenderer({
            type: 'authoring:param-edit-result',
            ok: result.ok,
            nodeId: result.nodeId ?? '',
            key: result.key ?? 'params',
            ...(result.error ? { error: result.error } : {}),
          })
        })
      } else if (data.type === 'authoring:select-nodes') {
        const nodeIds = Array.isArray(data.nodeIds) ? data.nodeIds.filter((id): id is string => typeof id === 'string') : []
        usePipelineStore.getState().requestSelectNodes(nodeIds)
      } else if (data.type === 'authoring:preview-lineage-selection') {
        const projectId = useProjectStore.getState().viewingProjectId
        if (!projectId) return
        void client.getSceneLineage({
          ...(data.sceneNodeId ? { sceneNodeId: data.sceneNodeId } : {}),
          ...(data.path ? { path: data.path } : {}),
          ...(data.bakedLayerId ? { bakedLayerId: data.bakedLayerId } : {}),
        }, projectId).then((response) => {
          const authoringNodeIds = [...new Set(response.lineage.map((entry) => entry.authoring.entityId))]
          if (authoringNodeIds.length) usePipelineStore.getState().requestSelectNodes(authoringNodeIds)
        }).catch(() => {
          // Unknown/stale preview ids are an expected read-only miss after refresh.
        })
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [client, closeEditorFromOutside, focus, editorCardOpen, editorInline, postToRenderer, requestEditorAssetImport, toggleEditorVisibility, authoringOrigin])

  // Broadcast focus changes so child buttons reflect fullscreen state.
  useEffect(() => {
    postToRenderer({ type: 'authoring:focus-changed', focus })
  }, [focus, postToRenderer])

  // Keep the renderer capsule's Scene Script window button in sync with host state.
  useEffect(() => {
    broadcastEditorVisibility(editorInline && editorCardOpen)
  }, [editorInline, editorCardOpen, broadcastEditorVisibility])

  // Forward the kernel editor's node selection to the renderer pane so it can
  // apply the legacy editor-selection highlight. The kernel selection lives in
  // the host's in-process pipeline store (no backend/WS round-trip), so we read
  // it here and push it down the `authoring:editor-selection` postMessage
  // channel. View-only — never mutates the graph. `selectionRef` lets the
  // iframe `onLoad` re-seed selection after the renderer (re)mounts.
  const selectionRef = useRef<string[]>([])
  const postSelectionToRenderer = useCallback((ids: string[]) => {
    postToRenderer({ type: 'authoring:editor-selection', selectedNodeIds: ids })
  }, [postToRenderer])
  useEffect(() => {
    let lineageSequence = 0
    const sync = (ids: string[]) => {
      selectionRef.current = ids
      postSelectionToRenderer(ids)
      const projectId = useProjectStore.getState().viewingProjectId
      const sequence = ++lineageSequence
      if (!projectId || ids.length === 0) {
        postToRenderer({ type: 'authoring:lineage-highlight', paths: [], bakedPaths: [] })
        return
      }
      void Promise.all(ids.map((runtimeNodeId) =>
        client.getSceneLineage({ runtimeNodeId }, projectId).catch(() => null),
      )).then((responses) => {
        if (sequence !== lineageSequence) return
        const entries = responses.flatMap((response) => response?.lineage ?? [])
        postToRenderer({
          type: 'authoring:lineage-highlight',
          paths: [...new Set(entries.flatMap((entry) => entry.sceneNodes.map((node) => node.path)))],
          bakedPaths: [...new Set(entries.flatMap((entry) => entry.bakedLayers.map((layer) => layer.path)))],
        })
      })
    }
    sync(usePipelineStore.getState().selectedNodeIds)
    return usePipelineStore.subscribe((state, prev) => {
      if (state.selectedNodeIds !== prev.selectedNodeIds) sync(state.selectedNodeIds)
    })
  }, [client, postSelectionToRenderer, postToRenderer])

  // Forward the kernel editor's per-node preview toggle (`previewEnabled`) to the
  // renderer pane. The host does persist the flag (500ms debounce), but Default
  // must not wait for that write + listNodes. The disabled-id list is the live
  // gate: listed ids hide in place; leaving the list is an explicit re-enable.
  const previewDisabledRef = useRef<string[]>([])
  const postPreviewToRenderer = useCallback((ids: string[]) => {
    postToRenderer({ type: 'authoring:preview-change', previewDisabledNodeIds: ids })
  }, [postToRenderer])
  useEffect(() => {
    const disabledIds = (state: ReturnType<typeof usePipelineStore.getState>): string[] =>
      (state.currentPipeline?.nodes ?? []).filter((n) => n.previewEnabled === false).map((n) => n.id)
    const sync = (ids: string[]) => {
      previewDisabledRef.current = ids
      postPreviewToRenderer(ids)
    }
    sync(disabledIds(usePipelineStore.getState()))
    return usePipelineStore.subscribe((state, prev) => {
      if (state.currentPipeline === prev.currentPipeline) return
      const next = disabledIds(state)
      const cur = previewDisabledRef.current
      // Only post when the disabled SET actually changed (graph edits churn
      // currentPipeline identity on unrelated changes).
      if (next.length === cur.length && next.every((v, i) => v === cur[i])) return
      sync(next)
    })
  }, [postPreviewToRenderer])

  // Push live node output VALUES straight to the renderer when the editor
  // hydrates an execute response. This is a latency shortcut for both lanes:
  // slider ticks and structural execute (drop). It does NOT mark param-drag —
  // that pulse is `authoring:param-edit-active` / `editor-param-*` batches.
  const pendingPreviewOutputsRef = useRef<Record<string, Record<string, unknown>>>({})
  const previewFrameRef = useRef<number | null>(null)
  const postPreviewDataToRenderer = useCallback((outputs: Record<string, Record<string, unknown>>) => {
    const stripped: Record<string, Record<string, unknown>> = {}
    for (const [nodeId, bag] of Object.entries(outputs)) {
      const clean = stripTooLargeSummaries(bag)
      if (Object.keys(clean).length > 0) stripped[nodeId] = clean
    }
    if (Object.keys(stripped).length === 0) return
    // setNodeOutput writes ports individually. Merge every write in the same
    // animation frame so voxel `layers` + `names` arrive as one coherent
    // snapshot and the iframe never builds an intermediate half-updated mesh.
    for (const [nodeId, bag] of Object.entries(stripped)) {
      pendingPreviewOutputsRef.current[nodeId] = {
        ...(pendingPreviewOutputsRef.current[nodeId] ?? {}),
        ...bag,
      }
    }
    if (previewFrameRef.current !== null) return
    previewFrameRef.current = requestAnimationFrame(() => {
      previewFrameRef.current = null
      const merged = pendingPreviewOutputsRef.current
      pendingPreviewOutputsRef.current = {}
      if (Object.keys(merged).length === 0) return
      syncTrace('preview:postMessage', { nodes: summarizeNodeOutputs(merged) })
      postToRenderer({ type: 'authoring:preview-data', outputs: merged })
    })
  }, [postToRenderer])
  useEffect(() => () => {
    if (previewFrameRef.current !== null) cancelAnimationFrame(previewFrameRef.current)
    previewFrameRef.current = null
    pendingPreviewOutputsRef.current = {}
  }, [])
  useEffect(() => {
    let prevOutputs = usePipelineStore.getState().nodeOutputs
    return usePipelineStore.subscribe((state) => {
      const next = state.nodeOutputs
      if (next === prevOutputs) return
      // Forward only the nodes whose per-node bag reference changed (new value).
      const changed: Record<string, Record<string, unknown>> = {}
      for (const nodeId of Object.keys(next)) {
        if (next[nodeId] !== prevOutputs[nodeId]) changed[nodeId] = next[nodeId]
      }
      prevOutputs = next
      postPreviewDataToRenderer(changed)
    })
  }, [postPreviewDataToRenderer])

  // Signal at the START of a local scrub, before graph invalidation and execute
  // events can reach the renderer. This makes drag refresh suppression explicit
  // instead of inferring it from cross-socket graph event ordering.
  useEffect(() => subscribeLocalParamEdit(() => {
    postToRenderer({ type: 'authoring:param-edit-active' })
  }), [postToRenderer])

  // Bootstrap the project list + viewing project on mount. switchProject sets
  // the HttpApiClient viewingProjectId and loads the graph via the view cascade.
  useEffect(() => {
    syncTraceHintOnce()
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    const bootstrap = async (): Promise<void> => {
      await useProjectStore.getState().bootstrap()
      if (!cancelled && !useProjectStore.getState().viewingProjectId) {
        retryTimer = setTimeout(() => void bootstrap(), 1000)
      }
    }
    void bootstrap()
    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [])

  // Notify the preview iframe when the viewing project changes so it can
  // SOFT-reset (clear its store + re-run its data hooks for the new project)
  // via `authoring:project-changed` — see `RendererSurface`'s handler, which
  // calls `useRenderStore.getState().reset()`. This used to also force a hard
  // iframe remount (`key` bump) on every switch, destroying the whole document
  // (3 WebSockets + op-catalog/node-meta caches) just to clear a few React/
  // zustand fields that `reset()` already covers faithfully (same fields a
  // remount would implicitly zero via a fresh module load) — removed, since
  // the perceived "stuck/blank" project-switch delay was largely this teardown
  // + reconnect, not actual data work. `rendererReloadKey` is left wired (iframe
  // `key` below) as a manual escape hatch — nothing currently bumps it
  // automatically.
  const prevProjectRef = useRef<string | null>(null)
  useEffect(() => {
    if (viewingProjectId === null) return
    const prev = prevProjectRef.current
    if (prev === viewingProjectId) return
    prevProjectRef.current = viewingProjectId
    postToRenderer({ type: 'authoring:project-changed', projectId: viewingProjectId })
  }, [viewingProjectId, postToRenderer])

  // Project-switch loading-progress panel: merge the host-observed phases
  // (editor-side persist/view/hydrate + output fan-out) with whatever the
  // renderer iframe reports (previews/baked/aliases + its own boot window).
  // Each `useLingeringStep` keeps a fast/instant phase visible as a briefly
  // "done" checklist row instead of vanishing the moment it completes.
  const switchState = useLingeringStep(isSwitchingProject)
  const outputsState = useLingeringStep(outputsRefreshBusy)
  const bootState = useLingeringStep(rendererBooting)
  // Covers `autoExecuteOnOpen()` (cold-cache auto-run after a project switch,
  // see projectStore.ts's refreshOutputsAfterProjectSwitch) as well as manual
  // Run/"clear cache + re-run" — this can legitimately be the longest step
  // (actual node computation, not a fetch), so it needs its own visible row
  // rather than silently running after the "拉取节点输出" step already reads "done".
  const executingState = useLingeringStep(pipelineStatus === 'running')
  const loadingSteps = useMemo<LoadingStep[]>(() => {
    const steps: LoadingStep[] = []
    if (switchState !== 'idle') {
      steps.push({ id: 'switch', label: switchPhaseLabel(switchPhase), state: switchState })
    }
    if (bootState !== 'idle') {
      steps.push({ id: 'boot', label: sceneT('loading.boot'), state: bootState })
    }
    if (outputsState !== 'idle') {
      steps.push({ id: 'outputs', label: sceneT('loading.outputs'), state: outputsState })
    }
    if (executingState !== 'idle') {
      steps.push({ id: 'execute', label: sceneT('loading.execute'), state: executingState })
    }
    const rendererOrder = ['previews', 'baked', 'aliases']
    for (const id of rendererOrder) {
      const task = rendererTasks.find((t) => t.id === id)
      if (!task) continue
      steps.push({
        id: task.id,
        label: task.label,
        state: task.active ? 'active' : 'done',
        detail: task.total ? `${task.done ?? task.total}/${task.total}` : undefined,
      })
    }
    return steps
  }, [switchState, switchPhase, bootState, outputsState, executingState, rendererTasks])

  const editorSurfaceStyle = useMemo(
    () => ({ '--editor-surface-opacity': editorSurfaceOpacity / 100 } as CSSProperties),
    [editorSurfaceOpacity],
  )

  const editorToolbarActions = useMemo(() => (
    <div className="scene-editor-toolbar-actions">
      <button
        type="button"
        className={`scene-script-toggle${sceneScriptOpen ? ' is-active' : ''}`}
        aria-pressed={sceneScriptOpen}
        onClick={() => setSceneScriptOpen((open) => !open)}
      >
        Code
      </button>
      <label className="scene-editor-opacity" title={sceneT('editor.opacity')}>
        <span className="scene-editor-opacity__label">{sceneT('editor.opacity')}</span>
        <input
          type="range"
          min={EDITOR_OPACITY_MIN}
          max={EDITOR_OPACITY_MAX}
          value={editorSurfaceOpacity}
          aria-label={sceneT('editor.opacity')}
          aria-valuemin={EDITOR_OPACITY_MIN}
          aria-valuemax={EDITOR_OPACITY_MAX}
          aria-valuenow={editorSurfaceOpacity}
          onChange={(event) => onEditorOpacityChange(Number(event.currentTarget.value))}
        />
        <output className="scene-editor-opacity__value">{editorSurfaceOpacity}%</output>
      </label>
      <button
        type="button"
        className={`scene-editor-pin${editorPinned ? ' is-active' : ''}`}
        title={sceneT(editorPinned ? 'editor.unpin' : 'editor.pin')}
        aria-label={sceneT(editorPinned ? 'editor.unpin' : 'editor.pin')}
        aria-pressed={editorPinned}
        onClick={() => setEditorPinned((pinned) => !pinned)}
      >
        <Pin size={13} />
      </button>
    </div>
  ), [editorPinned, editorSurfaceOpacity, onEditorOpacityChange, sceneScriptOpen])

  return (
    <div
      className={[
        'scene-authoring',
        showFloatingEditor ? 'scene-authoring--floating' : '',
        focus ? `scene-authoring--focus-${focus}` : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {showRestore && (
        <button
          type="button"
          className="scene-authoring__restore-layout"
          title={sceneT('authoring.restoreLayoutTitle')}
          onClick={restoreWorkspaceLayout}
        >
          {sceneT('authoring.restoreLayout')}
        </button>
      )}

      {hasRenderer && (
        <div className="scene-authoring__panes">
          <section className="scene-pane scene-pane--renderer" aria-label={sceneT('preview.title')}>
            <iframe
              key={`renderer-${rendererReloadKey}`}
              ref={rendererIframeRef}
              src={paneUrl('renderer')}
              title={sceneT('authoring.rendererIframe')}
              className="scene-pane__iframe"
              allow="clipboard-write"
              onLoad={() => {
                postSelectionToRenderer(selectionRef.current)
                postPreviewToRenderer(previewDisabledRef.current)
                setRendererBooting(false)
              }}
            />
            <LoadingStatusPanel steps={loadingSteps} />
            <div
              className={`scene-authoring__preview-status${previewStatus.staleReasons.length ? ' is-stale' : ''}${previewStatus.executionStatus === 'running' ? ' is-running' : ''}`}
              role="status"
            >
              {previewStatusLabel(previewStatus, viewingProjectId)}
            </div>
          </section>
        </div>
      )}

      {editorInline && (
        <div
          ref={editorContainerRef}
          className={`scene-authoring__editor${editorCardOpen ? '' : ' is-collapsed'}`}
          style={editorSurfaceStyle}
          aria-hidden={!editorCardOpen}
        >
          <div
            className={[
              'scene-authoring__authoring-layout',
              sceneScriptOpen ? 'has-script' : '',
              sceneScriptOpen && sceneScriptExpanded ? 'is-script-expanded' : '',
            ].filter(Boolean).join(' ')}
          >
            <div className="scene-authoring__node-editor">
              {viewingProjectId && editorCardOpen && (
                <SceneScriptDiagnosticDock projectId={viewingProjectId} />
              )}
              <MemoizedEditor
                apiClient={client}
                title={sceneT('editor.title')}
                showRunControl={false}
                showSettingsButton={false}
                toolbarActions={editorToolbarActions}
                editorSyncKey={EDITOR_SYNC_KEY}
                domainNodeTypes={scenePanelTypes}
                domainPortTypes={scenePortTypes}
                domainValueFormatters={sceneValueFormatters}
                isFullscreen={isEditorFullscreen}
                onToggleFullscreen={toggleEditorFullscreen}
              />
            </div>
            {sceneScriptOpen && viewingProjectId && (
              <SceneScriptStudio
                client={client}
                projectId={viewingProjectId}
                capturePreview={capturePreview}
                expanded={sceneScriptExpanded}
                onToggleExpanded={() => setSceneScriptExpanded((expanded) => !expanded)}
                onClose={() => setSceneScriptOpen(false)}
              />
            )}
          </div>
        </div>
      )}

      {showEmpty && (
        <div className="scene-authoring__empty" role="status">
          <div className="scene-authoring__empty-inner">
            <h2>{sceneT('authoring.emptyTitle')}</h2>
            <p>{sceneT('authoring.emptyBody')}</p>
          </div>
        </div>
      )}
    </div>
  )
}
