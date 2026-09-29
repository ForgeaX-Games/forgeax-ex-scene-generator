import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { HttpApiClient } from '../api/HttpApiClient.js'
import { pluginFetch } from '../api/pluginHttp.js'
import { RenderCanvas, type PaintTargetRequest } from '../renderer/host/RenderCanvas.js'
import { useRenderStore } from '../renderer/store.js'
import {
  useBakedLayer, useBakedLayerKeys, useVoxelLayer, useVoxelLayerKeys, useGridLayer, useGridLayerKeys, useGuideLayer, useGuideLayerKeys, useMeshLayer, useMeshLayerKeysByRole,
} from '../renderer/framework/useLayer.js'
import { notifyLocalParamEdit, useNodePreviews, projectLiveOutputs } from '../renderer/bridge/useNodePreviews.js'
import { registerDocumentReset, registerGuideParamCommit } from '../renderer/bridge/guideParamBridge.js'
import { hostGraphNodeIds, mergeIncomingEditorSelection, registerStageSelect } from '../renderer/bridge/stageSelectBridge.js'
import { ValleyControls, useCollectedControls } from './ValleyControls.js'
import { StageOutliner } from './StageOutliner.js'
import { useAliasMetas } from '../renderer/bridge/useAliasMetas.js'
import { useScreenshotCapture } from '../renderer/bridge/useScreenshotCapture.js'
import { captureFrame } from '../renderer/bridge/captureFrame.js'
import { useRendererCommands } from '../renderer/bridge/useRendererCommands.js'
import { useBakedLayers, refreshBakedLayers } from '../renderer/bridge/useBakedLayers.js'
import { bakedApi } from '../renderer/bridge/bakedApi.js'
import { syncTrace } from '../debug/syncTrace.js'
import { sceneExportApi, type SceneExportCookResult } from '../renderer/bridge/sceneExportApi.js'
import { mesh3dExportApi, type Mesh3dExportCookResult } from '../renderer/bridge/mesh3dExportApi.js'
import { PackExportButton, PackExportPopover, selectAllText, usePackExport } from './PackExportControl.js'
import { buildBakedVoxelGlbBlob } from '../renderer/export/bakedVoxelGlb.js'
import {
  blobToBase64,
  createStudioImportRequestId,
  DEFAULT_STUDIO_ASSET_DIRECTORY,
  normalizeStudioAssetDirectory,
  normalizeStudioGlbFilename,
  requestDirectStudioImport,
} from '../renderer/export/directStudioImport.js'
import { defaultPaintTargetName } from '../renderer/framework/paintTarget.js'
import { buildPathTree, collectDescendantLayerKeys, pathParent, type PathTreeNode } from '../renderer/framework/pathTree.js'
import { colorForValueCss } from '../renderer/framework/palette.js'
import type { PluginHandle } from '../renderer/framework/plugin.js'
import { zoomViewportCentered } from '../renderer/framework/viewport2d.js'
import type { WorldPlaneFrame } from '../renderer/framework/worldFrame.js'
import { getPlaneColor } from '../renderer/framework/worldFrame.js'
import type { ViewMode, DrawMode, DisplaySchema } from '../renderer/types.js'
import { VIEW_MODE_ORDER, isOrbit3dView } from '../renderer/types.js'
import { useAuthoringChild } from '../authoring/useAuthoringChild.js'
import { isAuthoringMessage, authoringTargetOrigin, type AuthoringMessage } from '../authoring/protocol.js'
import { sceneT, useSceneLocale, type SceneKey } from '../sceneI18n.js'
import { writeSelectedLayers } from './library/selectedLayerBus.js'
import { bakedLayerToSnapshot, outputLayerToSnapshot } from './library/layerSnapshots.js'
import { reconcilePanelSelection } from './library/selectionReconcile.js'
import { dedupeBakePaths } from './library/bakePaths.js'
import { reorderSibling, stackOrderHints } from '../renderer/framework/outputOrder.js'
import {
  writeEditMode,
  writePreviewEditContext,
  readBrushMode,
  subscribeBrushMode,
  readEditTool,
  subscribeEditTool,
  readEditZ,
  subscribeEditZ,
} from './library/editToolbarBus.js'
import { subscribeScreenshotRequest, writeScreenshotResult } from './library/screenshotBus.js'
import { libraryApi } from './library/libraryApi.js'
import {
  Axis3d, Box, Camera, ChevronDown, ChevronRight, Eye, EyeOff, Layers, ListTree, Mountain, NodeEditor, Pencil, Pin, Plus,
  Sliders, SlidersHorizontal, Trash, TriangleAlert, ViewBillboard, ViewIso, ViewMesh,
  ViewOrbit, ViewPerspective, ViewTop,
} from './icons.js'
import {
  clampDrawerWidth,
  effectiveDrawerWidth,
  loadPreviewDrawerWidth,
  savePreviewDrawerWidth,
} from './previewDrawerLayout.js'
import './RendererSurface.css'

const VIEW_MODES = VIEW_MODE_ORDER
const DRAW_MODES: DrawMode[] = ['wire', 'color', 'asset']
const VIEW_LABEL_KEYS = {
  default: 'preview.view.default',
  top: 'preview.view.top',
  topBillboard: 'preview.view.billboard',
  iso: 'preview.view.iso',
  free3d: 'preview.view.free3d',
  '3DMesh': 'preview.view.mesh3d',
} as const satisfies Record<ViewMode, SceneKey>
const DRAW_LABEL_KEYS = {
  wire: 'preview.draw.wire',
  color: 'preview.draw.color',
  asset: 'preview.draw.asset',
} as const satisfies Record<DrawMode, SceneKey>

function viewLabel(mode: ViewMode): string {
  return sceneT(VIEW_LABEL_KEYS[mode])
}

function drawLabel(mode: DrawMode): string {
  return sceneT(DRAW_LABEL_KEYS[mode])
}

function viewIcon(mode: ViewMode): ReactNode {
  switch (mode) {
    case 'default': return <ViewPerspective size={17} />
    case 'top': return <ViewTop size={17} />
    case 'topBillboard': return <ViewBillboard size={17} />
    case 'iso': return <ViewIso size={17} />
    case 'free3d': return <ViewOrbit size={17} />
    case '3DMesh': return <ViewMesh size={17} />
  }
}

const LAYER_INDENT_STEP = 10
const LAYER_INDENT_MAX = 52

type PreviewDrawer = 'effects' | 'editable' | 'output' | 'control' | 'valley' | 'outliner'

function layerRowPadding(depth: number): number {
  return 8 + Math.min(depth * LAYER_INDENT_STEP, LAYER_INDENT_MAX)
}

type SceneExportState =
  | { status: 'idle' }
  | { status: 'pending'; kind: 'sceneZip' | 'mesh3d' }
  | { status: 'success'; kind: 'sceneZip'; result: SceneExportCookResult }
  | { status: 'success'; kind: 'mesh3d'; result: Mesh3dExportCookResult }
  | { status: 'error'; kind: 'sceneZip' | 'mesh3d'; message: string }

type StudioGlbExportState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'success'; target: string }
  | { status: 'error'; message: string }

// Screenshot result presented in a popover for manual copy. The sandboxed studio
// iframe blocks both the image-blob clipboard write AND the `<a download>` click,
// so we surface the rendered frame as a copyable PNG data URL (base64) plus an
// inline thumbnail the user can right-click → Copy/Save (a browser-native action
// the permissions policy can't gate) — same fallback the FRAME PNG export uses.
type ScreenshotState =
  | { status: 'idle' }
  | { status: 'success'; dataUrl: string; width: number; height: number }
  | { status: 'error'; message: string }

// Renderer pane. Canvas actions live in the left tool capsule (Effects, Editable,
// Output drawers, Scene Script window toggle, screenshot, reset, fullscreen).
// Zoom is available in the canvas preview label; wheel-zoom remains on canvas.
export function RendererSurface({
  client,
  gameSlug,
}: {
  client: HttpApiClient
  /** Active ForgeaX game from host iframe `?slug=` — mesh3d export lands here. */
  gameSlug?: string | null
}): JSX.Element {
  useSceneLocale()
  useNodePreviews(client)
  useAliasMetas(client)
  useRendererCommands()
  useBakedLayers(client)
  const collectedControls = useCollectedControls(client)
  const hasControls = collectedControls.hasControls
  const pluginRef = useRef<PluginHandle | null>(null)
  useScreenshotCapture(client, pluginRef)
  // Drain in-flight paint persists before a structural baked mutation (see
  // structuralBakedRefresh). Published by RenderCanvas via paintPersistsRef.
  const paintPersistsRef = useRef<(() => Promise<void>) | null>(null)

  // Each field selected individually (not `useRenderStore()` with no selector!) —
  // an unselected call subscribes to the WHOLE store, so it re-renders on every
  // single store update including every wheel-zoom tick's setViewport2d/
  // panViewport2d. That re-render cascades into every unmemoized child below
  // (LayerTreeRows/BakedLayerTreeRows/LayerRow/BakedLayerRow etc.), which is
  // where the real cost was hiding — the layer list panel has nothing to do
  // with viewport, but was re-rendering top-to-bottom on every zoom tick.
  const viewMode = useRenderStore((s) => s.viewMode)
  const drawMode = useRenderStore((s) => s.drawMode)
  const setViewMode = useRenderStore((s) => s.setViewMode)
  const setDrawMode = useRenderStore((s) => s.setDrawMode)
  const viewGuideVisible = useRenderStore((s) => s.viewGuides[viewMode])
  const setViewGuideVisible = useRenderStore((s) => s.setViewGuideVisible)
  const schemaVisible = useRenderStore((s) => s.schemaVisible)
  const setSchemaVisible = useRenderStore((s) => s.setSchemaVisible)
  const setSelectedEditorNodeIds = useRenderStore((s) => s.setSelectedEditorNodeIds)
  // Voxel (scene_output) layers — the read-only "Output" section of the panel.
  const layerKeys = useVoxelLayerKeys()
  const layers = useRenderStore((s) => s.layers)
  const aliasMetas = useRenderStore((s) => s.aliasMetas)
  const layerTree = useMemo(() => buildPathTree(layerKeys, (key) => layers[key]), [layerKeys, layers])
  const outputLayerOrder = useRenderStore((s) => s.outputLayerOrder)
  const stackHints = useMemo(
    () => stackOrderHints(layerKeys, outputLayerOrder, (key) => layers[key]),
    [layerKeys, outputLayerOrder, layers],
  )
  // Baked (graph-independent, editable) layers — the "Editable" section.
  const bakedKeys = useBakedLayerKeys()
  const bakedLayersMap = useRenderStore((s) => s.bakedLayers)
  const bakedTree = useMemo(() => buildPathTree(bakedKeys, (key) => bakedLayersMap[key]), [bakedKeys, bakedLayersMap])
  const bakedCellCount = useMemo(
    () => bakedKeys.reduce((total, key) => total + (bakedLayersMap[key]?.cellCount ?? bakedLayersMap[key]?.cells.length ?? 0), 0),
    [bakedKeys, bakedLayersMap],
  )
  const editMode = useRenderStore((s) => s.editMode)
  const setEditMode = useRenderStore((s) => s.setEditMode)
  const setBrushMode = useRenderStore((s) => s.setBrushMode)
  const setEditTool = useRenderStore((s) => s.setEditTool)
  const setEditZ = useRenderStore((s) => s.setEditZ)
  const activeBakedLayerKey = useRenderStore((s) => s.activeBakedLayerKey)
  const setActiveBakedLayer = useRenderStore((s) => s.setActiveBakedLayer)
  // Multi-selection of baked layers for batch ops (delete / drag). The store's
  // `activeBakedLayerKey` is the primary (= paint target), kept = last-clicked.
  const [selectedBakedKeys, setSelectedBakedKeys] = useState<ReadonlySet<string>>(() => new Set())
  const bakedAnchorRef = useRef<string | null>(null)
  const dragKeysRef = useRef<string[]>([])
  const [dropHover, setDropHover] = useState<{ key: string; zone: 'before' | 'after' | 'inside' } | null>(null)
  // OUTPUT restacking. Separate from the baked drag state above: output layers
  // can only be REORDERED among siblings (their paths come from the scene graph,
  // so there is no reparenting to offer), and the drop zones are before/after.
  const outputDragKeyRef = useRef<string | null>(null)
  const [outputDropHover, setOutputDropHover] = useState<{ key: string; zone: 'before' | 'after' } | null>(null)
  const [renamingBakedKey, setRenamingBakedKey] = useState<string | null>(null)
  // Edit mode only makes sense in billboard + asset (single-plane z=0 painting).
  const editAvailable = viewMode === 'topBillboard' && drawMode === 'asset'
  // Grid previews still render on the canvas; counted only for the canvas/global
  // empty-state + status (legacy counts both buckets), never listed in the panel.
  const gridKeys = useGridLayerKeys()
  const meshKeys = useMeshLayerKeysByRole('terrain')
  const roadKeys = useMeshLayerKeysByRole('road')
  const houseKeys = useMeshLayerKeysByRole('houses')
  const guideKeys = useGuideLayerKeys()
  const totalLayers = layerKeys.length + gridKeys.length + (viewMode === 'default' ? meshKeys.length + roadKeys.length + houseKeys.length + guideKeys.length : 0)
  const { reportStatus } = useAuthoringChild('renderer')
  const authoringOrigin = authoringTargetOrigin()
  const postToHost = useCallback((msg: AuthoringMessage) => {
    if (typeof window === 'undefined' || window.parent === window) return
    window.parent.postMessage(msg, authoringOrigin)
  }, [authoringOrigin])
  useEffect(() => {
    registerGuideParamCommit(
      (nodeId, key, value, silent) => {
        postToHost({ type: 'authoring:set-param', nodeId, key, value, silent })
      },
      (edits) => {
        postToHost({ type: 'authoring:set-params', edits })
      },
    )
    registerDocumentReset(() => {
      postToHost({ type: 'authoring:reset-document' })
    })
    registerStageSelect((nodeIds) => {
      postToHost({ type: 'authoring:select-nodes', nodeIds: hostGraphNodeIds(nodeIds) })
    })
    return () => {
      registerGuideParamCommit(null)
      registerDocumentReset(null)
      registerStageSelect(null)
    }
  }, [postToHost])
  const capturePreviewFrame = useCallback(():
    | { dataUrl: string; width: number; height: number; capturedAt: string }
    | { error: string; capturedAt: string } => {
    const capturedAt = new Date().toISOString()
    const handle = pluginRef.current
    handle?.renderFrame?.()
    const canvas = handle?.getFrameCanvas?.()
    if (!canvas) return { error: sceneT('preview.screenshotNoFrame'), capturedAt }
    try {
      return {
        dataUrl: canvas.toDataURL('image/png'),
        width: canvas.width,
        height: canvas.height,
        capturedAt,
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error), capturedAt }
    }
  }, [])

  // Pure VIEW state (no graph/runtime mutation) — kept local to the renderer.
  const [activeDrawer, setActiveDrawer] = useState<PreviewDrawer | null>(null)
  const [pinnedDrawer, setPinnedDrawer] = useState<PreviewDrawer | null>(null)
  // Card visibility belongs to the host's `editorCardOpen` state. Availability
  // persistence is deliberately not consulted here; the initial query below
  // establishes the authoritative state over the authoring protocol.
  const [editorVisible, setEditorVisible] = useState(false)
  const editorVisibleRef = useRef(false)
  const [drawerMaxHeight, setDrawerMaxHeight] = useState(430)
  const [drawerUserWidth, setDrawerUserWidth] = useState(loadPreviewDrawerWidth)
  const [drawerContainerWidth, setDrawerContainerWidth] = useState(0)
  const drawerDockRef = useRef<HTMLDivElement>(null)
  const canvasWrapRef = useRef<HTMLDivElement>(null)
  const drawerWidth = effectiveDrawerWidth(drawerUserWidth, drawerContainerWidth)
  const [sceneExport, setSceneExport] = useState<SceneExportState>({ status: 'idle' })
  const [studioGlbExport, setStudioGlbExport] = useState<StudioGlbExportState>({ status: 'idle' })
  const packExport = usePackExport()
  const [studioGlbDialogOpen, setStudioGlbDialogOpen] = useState(false)
  const [studioGlbDirectory, setStudioGlbDirectory] = useState(DEFAULT_STUDIO_ASSET_DIRECTORY)
  const [studioGlbName, setStudioGlbName] = useState('baked-voxel-scene.glb')
  const [screenshot, setScreenshot] = useState<ScreenshotState>({ status: 'idle' })
  const screenshotButtonRef = useRef<HTMLButtonElement>(null)
  const [screenshotEnabled, setScreenshotEnabled] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('scene-generator.screenshot-enabled')
      return stored === null ? false : stored === 'true'
    } catch {
      return false
    }
  })
  const screenshotEnabledRef = useRef(screenshotEnabled)
  screenshotEnabledRef.current = screenshotEnabled

  // Sync screenshot capability preference to backend
  const syncScreenshotConfig = useCallback((enabled: boolean) => {
    void pluginFetch('/api/v1/agent/screenshot/config', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
      headers: { 'content-type': 'application/json' },
    }).catch(() => {})
  }, [])

  const applyScreenshotEnabled = useCallback((enabled: boolean) => {
    screenshotEnabledRef.current = enabled
    setScreenshotEnabled(enabled)
    try {
      localStorage.setItem('scene-generator.screenshot-enabled', String(enabled))
    } catch {}
    syncScreenshotConfig(enabled)
  }, [syncScreenshotConfig])

  useEffect(() => {
    syncScreenshotConfig(screenshotEnabled)
  }, [screenshotEnabled, syncScreenshotConfig])

  // Capture-phase native listener: Studio/browser menus often win over React's
  // bubbling `onContextMenu`, which made the toggle look like a no-op.
  useEffect(() => {
    const onContextMenu = (event: MouseEvent): void => {
      const button = screenshotButtonRef.current
      if (!button || !(event.target instanceof Node) || !button.contains(event.target)) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      applyScreenshotEnabled(!screenshotEnabledRef.current)
    }
    document.addEventListener('contextmenu', onContextMenu, true)
    return () => document.removeEventListener('contextmenu', onContextMenu, true)
  }, [applyScreenshotEnabled])

  const openDrawer = useCallback((drawer: PreviewDrawer): void => {
    setScreenshot({ status: 'idle' })
    if (editorVisibleRef.current) {
      postToHost({ type: 'authoring:request-close-editor', force: true })
    }
    setPinnedDrawer(null)
    setActiveDrawer(drawer)
  }, [postToHost])
  // Selected Layers-panel row lives in the store so the AI/Agent `select-layer`
  // control command (useRendererCommands) drives the same highlight a user click
  // does. Toggle off on re-click of the already-selected row.
  const selectedKey = useRenderStore((s) => s.selectedLayerKey)
  const setSelectedLayer = useRenderStore((s) => s.setSelectedLayer)
  // Multi-selection of OUTPUT layers (for batch "Bake selected"). ctrl/⌘ toggles,
  // shift selects a range from the anchor, plain click selects just one. The
  // store's single `selectedLayerKey` still drives the left-pane detail + the
  // AI select-layer command — kept in sync with the last-clicked row.
  const [selectedOutputKeys, setSelectedOutputKeys] = useState<ReadonlySet<string>>(() => new Set())
  const selectAnchorRef = useRef<string | null>(null)
  // The last selectedLayerKey the PANEL itself wrote (via a row click). Used to
  // distinguish panel-originated store writes from EXTERNAL ones (SELECT-mode
  // scene clicks, AI select-layer). Only external changes reconcile the local
  // selection sets below — panel writes already set the sets, and reconciling
  // them would clobber legitimate multi-selection.
  const panelSelectionEchoRef = useRef<string | null>(null)
  // DFS leaf order of the output tree — the index space shift-range select uses.
  const orderedOutputKeys = useMemo(() => flattenLayerKeys(layerTree), [layerTree])
  const onSelectLayer = (key: string, e?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => {
    const range = !!e?.shiftKey && selectAnchorRef.current !== null
    const additive = !!(e?.ctrlKey || e?.metaKey)
    setSelectedOutputKeys((prev) => {
      if (range) {
        const a = orderedOutputKeys.indexOf(selectAnchorRef.current!)
        const b = orderedOutputKeys.indexOf(key)
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a]
          return new Set(orderedOutputKeys.slice(lo, hi + 1))
        }
        return new Set([key])
      }
      if (additive) {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      }
      return new Set([key])
    })
    if (!range) selectAnchorRef.current = key
    panelSelectionEchoRef.current = key
    setSelectedLayer(key)
    const layer = layers[key]
    if (layer) {
      postToHost({ type: 'authoring:preview-lineage-selection', path: layer.nodePath })
    }
  }
  // Collapsed sink/path container rows (collapsible tree). Keyed by pathKey;
  // default expanded.
  const [collapsedOutput, setCollapsedOutput] = useState<ReadonlySet<string>>(() => new Set())
  const [collapsedBaked, setCollapsedBaked] = useState<ReadonlySet<string>>(() => new Set())
  const toggleCollapsedOutput = (pathKey: string) =>
    setCollapsedOutput((prev) => {
      const next = new Set(prev)
      if (next.has(pathKey)) next.delete(pathKey)
      else next.add(pathKey)
      return next
    })
  const toggleCollapsedBaked = (pathKey: string) =>
    setCollapsedBaked((prev) => {
      const next = new Set(prev)
      if (next.has(pathKey)) next.delete(pathKey)
      else next.add(pathKey)
      return next
    })

  const revealBakedLayerForRename = useCallback((path: string) => {
    const key = `baked:${path}`
    openDrawer('editable')
    setActiveBakedLayer(key)
    setSelectedBakedKeys(new Set([key]))
    bakedAnchorRef.current = key
    setCollapsedBaked((prev) => {
      const next = new Set(prev)
      let changed = false
      for (const ancestor of ancestorPathKeys(path)) {
        if (next.delete(ancestor)) changed = true
      }
      return changed ? next : prev
    })
    setRenamingBakedKey(key)
  }, [openDrawer, setActiveBakedLayer])

  const [pendingPaintTarget, setPendingPaintTarget] = useState<(PaintTargetRequest & { resolve: (key: string | null) => void }) | null>(null)
  const [paintTargetName, setPaintTargetName] = useState('')

  const requestPaintTarget = useCallback((request: PaintTargetRequest): Promise<string | null> => {
    return new Promise((resolve) => {
      setPendingPaintTarget((prev) => {
        prev?.resolve(null)
        return { ...request, resolve }
      })
      setPaintTargetName(defaultPaintTargetName(request.asset.name))
    })
  }, [])

  const handleBakedEditCommitted = useCallback(async () => {
    await refreshBakedLayers()
  }, [])

  useEffect(() => {
    reportStatus({ layers: totalLayers, viewMode })
  }, [totalLayers, viewMode, reportStatus])

  // Publish edit mode to the left pane so its (collapsed) edit toolbar expands
  // only while editing. We own the Pencil toggle, so this is the source of truth.
  useEffect(() => {
    writeEditMode(editMode)
  }, [editMode])

  useEffect(() => {
    writePreviewEditContext({ editMode, viewMode, drawMode, editAvailable })
  }, [editMode, viewMode, drawMode, editAvailable])

  // Brush mode (Free/Box) also lives in the left pane's edit toolbar; mirror it
  // into the render store so the canvas interaction switches accordingly.
  useEffect(() => {
    setBrushMode(readBrushMode())
    return subscribeBrushMode(setBrushMode)
  }, [setBrushMode])

  // Edit tool (Paint/Eraser/Eyedropper) is orthogonal to Free/Box brush shape.
  useEffect(() => {
    setEditTool(readEditTool())
    return subscribeEditTool(setEditTool)
  }, [setEditTool])

  // Z layer lives in the left pane's edit toolbar; mirror it into the render
  // store so the active plugin can map mouse position to a voxel.
  useEffect(() => {
    setEditZ(readEditZ())
    return subscribeEditZ(setEditZ)
  }, [setEditZ])

  // The left pane's Edit tools has its own screenshot button, but only this pane
  // owns the frame canvas — answer its capture requests over the bus.
  useEffect(() => {
    return subscribeScreenshotRequest((request) => {
      const result = captureFrame(pluginRef.current, { crop: request.crop })
      writeScreenshotResult(result.ok
        ? { id: request.id, status: 'success', ...result.capture }
        : { id: request.id, status: 'error', message: result.message })
    })
  }, [])

  const beginDrawerWidthResize = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = drawerUserWidth
    const onMove = (mv: MouseEvent): void => {
      const next = clampDrawerWidth(startWidth + mv.clientX - startX)
      setDrawerUserWidth(next)
      savePreviewDrawerWidth(next)
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [drawerUserWidth, drawerContainerWidth])

  useEffect(() => {
    const el = canvasWrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = (): void => {
      setDrawerContainerWidth(el.getBoundingClientRect().width)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    postToHost({ type: 'authoring:query-editor-visibility' })
  }, [postToHost])

  useEffect(() => {
    const measure = (): void => {
      let visiblePreviewHeight = window.innerHeight
      try {
        const frameRect = (window.frameElement as HTMLElement | null)?.getBoundingClientRect()
        const editorRect = window.parent.document.querySelector('.scene-authoring__editor')?.getBoundingClientRect()
        if (editorVisible && frameRect && editorRect && editorRect.width > 0 && editorRect.height > 0) {
          visiblePreviewHeight = editorRect.top - frameRect.top
        }
      } catch {
        // Direct renderer preview or cross-origin host: use the iframe viewport.
      }
      const dockTop = drawerDockRef.current?.getBoundingClientRect().top ?? 52
      const availableHeight = visiblePreviewHeight - dockTop - 12
      setDrawerMaxHeight(Math.max(120, Math.min(430, availableHeight)))
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    try {
      const editor = window.parent.document.querySelector('.scene-authoring__editor')
      if (editor) observer?.observe(editor)
    } catch {
      // Direct renderer preview or cross-origin host.
    }
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [editorVisible])

  useEffect(() => {
    if (!activeDrawer || pinnedDrawer === activeDrawer) return
    const closeOnOutsideClick = (event: PointerEvent): void => {
      if (!drawerDockRef.current?.contains(event.target as Node)) setActiveDrawer(null)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [activeDrawer, pinnedDrawer])

  useEffect(() => {
    if (pinnedDrawer && pinnedDrawer !== activeDrawer) setPinnedDrawer(null)
  }, [activeDrawer, pinnedDrawer])

  useEffect(() => {
    if (screenshot.status === 'idle') return
    const closeScreenshotOnOutsideClick = (event: PointerEvent): void => {
      if (!drawerDockRef.current?.contains(event.target as Node)) {
        setScreenshot({ status: 'idle' })
      }
    }
    document.addEventListener('pointerdown', closeScreenshotOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeScreenshotOnOutsideClick)
  }, [screenshot.status])

  useEffect(() => {
    if (!editorVisible) return
    const requestEditorClose = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (!canvasWrapRef.current?.contains(target)) return
      if (drawerDockRef.current?.contains(target)) return
      if (target.closest('.renderer-preview-label, button, input, select, textarea, a')) return
      postToHost({ type: 'authoring:request-close-editor' })
    }
    document.addEventListener('pointerdown', requestEditorClose)
    return () => document.removeEventListener('pointerdown', requestEditorClose)
  }, [editorVisible, postToHost])

  // Editor-selection bridge: the authoring host forwards the kernel editor's
  // current node selection over `authoring:editor-selection`. We mirror it into
  // the render store so the canvas + Layers panel highlight the selected node's
  // layers/previews (view-only; no graph mutation). Replaces the legacy
  // `editor:selection` WS event, which this backend doesn't emit.
  useEffect(() => {
    const inIframe = window.parent !== window
    const handler = (event: MessageEvent) => {
      if (inIframe) {
        if (event.origin !== authoringOrigin) return
        if (event.source !== window.parent) return
      }
      if (!isAuthoringMessage(event.data)) return
      const data = event.data
      if (data.type === 'authoring:project-changed') {
        // SOFT project-switch reset: the host no longer hard-remounts this
        // iframe (see AuthoringHost's project-changed effect), so this is now
        // the ONLY place stale cross-project state gets cleared. `reset()`
        // zeroes exactly the fields a remount used to wipe for free (layers /
        // previewLayers / bakedLayers / selection / viewMode / drawMode /
        // editMode …) — useNodePreviews / useBakedLayers / useAliasMetas
        // independently repopulate their own buckets right after, on the same
        // `authoring:project-changed` message.
        useRenderStore.getState().reset()
        setSelectedOutputKeys(new Set())
        setSelectedBakedKeys(new Set())
        setPendingPaintTarget((prev) => {
          prev?.resolve(null)
          return null
        })
        setSceneExport({ status: 'idle' })
        setScreenshot({ status: 'idle' })
        setActiveDrawer(null)
        return
      }
      if (data.type === 'authoring:capture-preview') {
        postToHost({
          type: 'authoring:preview-captured',
          requestId: data.requestId,
          ...capturePreviewFrame(),
        })
      } else if (data.type === 'authoring:editor-selection') {
        const next = mergeIncomingEditorSelection(
          useRenderStore.getState().selectedEditorNodeIds,
          data.selectedNodeIds ?? [],
        )
        if (next) setSelectedEditorNodeIds(next)
      } else if (data.type === 'authoring:lineage-highlight') {
        const scenePaths = new Set(data.paths)
        const bakedPaths = new Set(data.bakedPaths)
        const state = useRenderStore.getState()
        const matchingKeys = [
          ...Object.values(state.layers)
            .filter((layer) => scenePaths.has(layer.nodePath))
            .map((layer) => layer.key),
          ...Object.values(state.bakedLayers)
            .filter((layer) => bakedPaths.has(layer.nodePath))
            .map((layer) => layer.key),
        ]
        setSelectedEditorNodeIds([...new Set([...state.selectedEditorNodeIds, ...matchingKeys])])
      } else if (data.type === 'authoring:preview-change') {
        // Host posts the current preview-off set. Previously-disabled nodes that
        // are now absent must become explicit true — persist of previewEnabled
        // is debounced, so falling back to listNodes would keep them hidden.
        useRenderStore.getState().setPreviewDisabledNodeIds(data.previewDisabledNodeIds)
      } else if (data.type === 'authoring:editor-visibility-changed') {
        editorVisibleRef.current = data.visible
        setEditorVisible(data.visible)
        if (data.visible) {
          setActiveDrawer(null)
          setPinnedDrawer(null)
          setScreenshot({ status: 'idle' })
        }
      } else if (data.type === 'authoring:restore-layout') {
        setActiveDrawer(null)
        setDrawerUserWidth(loadPreviewDrawerWidth())
        setSceneExport({ status: 'idle' })
        setScreenshot({ status: 'idle' })
        setEditorVisible(false)
      } else if (data.type === 'authoring:preview-data') {
        syncTrace('preview:iframe-received', {
          nodes: Object.keys(data.outputs).join(',') || '(none)',
        })
        // Live direct-push from the editor: freshly executed outputs, painted into
        // the render store with zero network. This is the slider-drag fast path —
        // it bypasses the WS exec:completed → getNodeOutput re-pull so the preview
        // repaints in the same frame the execute response landed. The trailing WS
        // refresh still owns GC + the durable post-drag settle.
        projectLiveOutputs(data.outputs)
      } else if (data.type === 'authoring:param-edit-active') {
        notifyLocalParamEdit()
      } else if (data.type === 'authoring:param-edit-result') {
        if (data.ok) useRenderStore.getState().setGuideEditError(null)
        else useRenderStore.getState().revertGuideEdit(data.error ?? 'This edit failed. The previous value was restored.')
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [capturePreviewFrame, postToHost, setSelectedEditorNodeIds, authoringOrigin])

  const exportIsMesh3d = viewMode === '3DMesh'
  const exportSceneZip = async () => {
    setSceneExport({ status: 'pending', kind: 'sceneZip' })
    try {
      const result = await sceneExportApi.cook()
      setSceneExport({ status: 'success', kind: 'sceneZip', result })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setSceneExport({ status: 'error', kind: 'sceneZip', message })
    }
  }
  const exportMesh3dScene = async () => {
    setSceneExport({ status: 'pending', kind: 'mesh3d' })
    try {
      const activeSlug = gameSlug?.trim()
      if (!activeSlug) {
        throw new Error('no active game; open a game in Studio then export again')
      }
      const result = await mesh3dExportApi.cook({ gameSlug: activeSlug })
      setSceneExport({ status: 'success', kind: 'mesh3d', result })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setSceneExport({ status: 'error', kind: 'mesh3d', message })
    }
  }
  const runExport = () => {
    if (exportIsMesh3d) void exportMesh3dScene()
    else void exportSceneZip()
  }
  const dismissSceneExport = () => setSceneExport({ status: 'idle' })
  const openStudioGlbDialog = () => {
    setStudioGlbDirectory(DEFAULT_STUDIO_ASSET_DIRECTORY)
    setStudioGlbName('baked-voxel-scene.glb')
    setStudioGlbExport({ status: 'idle' })
    setStudioGlbDialogOpen(true)
  }
  const closeStudioGlbDialog = () => {
    if (studioGlbExport.status !== 'pending') setStudioGlbDialogOpen(false)
  }
  const exportBakedVoxelGlbToStudio = async () => {
    let directory: string
    let name: string
    try {
      directory = normalizeStudioAssetDirectory(studioGlbDirectory)
      name = normalizeStudioGlbFilename(studioGlbName)
    } catch (error) {
      setStudioGlbExport({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      return
    }
    setStudioGlbDirectory(directory)
    setStudioGlbName(name)
    setStudioGlbExport({ status: 'pending' })
    try {
      await refreshBakedLayers({ deferIfLocalPending: false, mode: 'full' })
      const blob = await buildBakedVoxelGlbBlob(useRenderStore.getState().bakedLayers)
      await requestDirectStudioImport({
        requestId: createStudioImportRequestId(),
        directory,
        name,
        base64: await blobToBase64(blob),
      })
      setStudioGlbExport({ status: 'success', target: `${directory}/${name}` })
    } catch (error) {
      setStudioGlbExport({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }
  const selectExportUrl = (e: React.FocusEvent<HTMLInputElement> | React.MouseEvent<HTMLInputElement>) => {
    e.currentTarget.select()
  }

  // ── Baked layer ops (graph-independent service; never touches the node graph) ──
  //
  // STRUCTURAL mutations (add / sub / move / remove / bake / rename) change the
  // tree shape & sibling order, which only the backend authoritatively re-derives.
  // After such a mutation the frontend MUST pull the new structure back in.
  //
  // But the default refreshBakedLayers() defers while ANY local paint edit is
  // still dirty/persisting (paint-protection, so a refresh can't clobber an
  // in-flight stroke). A paint immediately preceding the structural op (e.g.
  // place object → auto-create sub-layer) leaves that dirty flag set, so the
  // structural refresh would be silently DEFERRED and the new layer / new order
  // would only show up after a manual reload — the reported "must refresh" /
  // "reorder didn't take" bugs.
  //
  // Fix: drain the in-flight paint persists FIRST (flush + await → dirty clears),
  // THEN force the refresh in. Structural ops thus never collide with paint
  // protection, and there's no second source of truth: the backend stays
  // authoritative and the panel reflects it synchronously.
  const structuralBakedRefresh = useCallback(async () => {
    await paintPersistsRef.current?.()
    await refreshBakedLayers({ deferIfLocalPending: false, mode: 'full' })
  }, [])
  const addBakedLayer = async () => {
    try {
      const path = await bakedApi.addLayer(sceneT('layers.defaultName'))
      await structuralBakedRefresh()
      revealBakedLayerForRename(path)
    } catch (e) { console.warn('[baked] add layer failed', e) }
  }
  const addBakedSubLayer = async (nodePath: string) => {
    try {
      const path = await bakedApi.addSubLayer(nodePath, sceneT('layers.defaultSubName'))
      await structuralBakedRefresh()
      revealBakedLayerForRename(path)
    } catch (e) { console.warn('[baked] action failed', e) }
  }
  const cancelPaintTarget = () => {
    pendingPaintTarget?.resolve(null)
    setPendingPaintTarget(null)
  }
  const confirmPaintTarget = async () => {
    if (!pendingPaintTarget) return
    try {
      const path = await bakedApi.addSubLayer(pendingPaintTarget.activeLayer.nodePath, paintTargetName.trim() || defaultPaintTargetName(pendingPaintTarget.asset.name))
      const key = `baked:${path}`
      await structuralBakedRefresh()
      setActiveBakedLayer(key)
      setSelectedBakedKeys(new Set([key]))
      pendingPaintTarget.resolve(key)
      setPendingPaintTarget(null)
    } catch (e) {
      console.warn('[baked] create paint target failed', e)
    }
  }
  const removeBakedLayer = async (nodePath: string) => {
    try {
      await bakedApi.remove(nodePath)
      if (activeBakedLayerKey === `baked:${nodePath}`) setActiveBakedLayer(null)
      await structuralBakedRefresh()
    } catch (e) { console.warn('[baked] action failed', e) }
  }
  // Snapshot the SELECTED transient output layers into new editable baked layers.
  // Sent in DFS order with their nodePath so the backend preserves the layers'
  // parent/child hierarchy + order (e.g. /House before /House/Roof).
  const bakeSelectedLayers = async () => {
    syncTrace('baked:ui-bake-selected', { count: selectedOutputKeys.size })
    const all = useRenderStore.getState().layers
    const selected = orderedOutputKeys
      .filter((k) => selectedOutputKeys.has(k))
      .map((k) => all[k])
      .filter((l): l is NonNullable<typeof l> => !!l)
    const payload = dedupeBakePaths(selected).map(({ layer, nodePath }) => ({
      nodePath,
      nodeName: layer.nodeName,
      cells: layer.cells.map((c) => ({ x: c.x, y: c.y, z: c.z })),
      assetName: layer.assetName,
      assetType: layer.assetType,
      schema: layer.schema,
    }))
    if (payload.length === 0) return
    try {
      await bakedApi.bake(payload)
      await structuralBakedRefresh()
      setSelectedOutputKeys(new Set())
    } catch (e) { console.warn('[baked] action failed', e) }
  }

  // Select a baked layer: plain = single, ⌘/ctrl = toggle, shift = range. The
  // last-clicked becomes the paint target (activeBakedLayerKey).
  const onSelectBaked = (key: string, e?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => {
    const range = !!e?.shiftKey && bakedAnchorRef.current !== null
    const additive = !!(e?.ctrlKey || e?.metaKey)
    setSelectedBakedKeys((prev) => {
      if (range) {
        const a = bakedKeys.indexOf(bakedAnchorRef.current!)
        const b = bakedKeys.indexOf(key)
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a]
          return new Set(bakedKeys.slice(lo, hi + 1))
        }
        return new Set([key])
      }
      if (additive) {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      }
      return new Set([key])
    })
    if (!range) bakedAnchorRef.current = key
    setActiveBakedLayer(key)
    const layer = bakedLayersMap[key]
    if (layer) {
      postToHost({
        type: 'authoring:preview-lineage-selection',
        bakedLayerId: layer.nodePath,
      })
    }
    // Mirror the last-clicked baked row into the store's single selection so the
    // panel and SELECT-mode share one source of truth (bidirectional). Output
    // rows already do this via onSelectLayer; baked rows must too, otherwise a
    // baked panel-selection can't be overridden by a scene SELECT click.
    panelSelectionEchoRef.current = key
    setSelectedLayer(key)
  }

  const deleteSelectedBaked = async () => {
    const paths = [...selectedBakedKeys].map((k) => k.replace(/^baked:/, ''))
    if (paths.length === 0) return
    try {
      // Delete deepest-first so removing a parent doesn't invalidate a child path.
      for (const p of paths.sort((a, b) => b.length - a.length)) await bakedApi.remove(p)
      setSelectedBakedKeys(new Set())
      if (activeBakedLayerKey && paths.includes(activeBakedLayerKey.replace(/^baked:/, ''))) setActiveBakedLayer(null)
      await structuralBakedRefresh()
    } catch (e) { console.warn('[baked] action failed', e) }
  }

  // OUTPUT restack: drop on a row's top/bottom edge to place the dragged layer
  // before/after it. Restricted to layers that share a scene-path parent — that
  // is exactly the "two rival Beach layers overlap, which one wins" case, and it
  // includes rows from DIFFERENT sinks (grouping is by scene path, not nodeId).
  const onOutputDragStart = (key: string) => { outputDragKeyRef.current = key }
  const onOutputDragOver = (key: string, zone: 'before' | 'after') => {
    setOutputDropHover((prev) => (prev && prev.key === key && prev.zone === zone ? prev : { key, zone }))
  }
  const onOutputDrop = (targetKey: string, zone: 'before' | 'after') => {
    setOutputDropHover(null)
    const moved = outputDragKeyRef.current
    outputDragKeyRef.current = null
    if (!moved || moved === targetKey) return
    const movedLayer = layers[moved]
    const targetLayer = layers[targetKey]
    if (!movedLayer || !targetLayer) return
    const parent = pathParent(movedLayer.nodePath)
    if (parent !== pathParent(targetLayer.nodePath)) return
    const siblings = layerKeys.filter((k) => layers[k] && pathParent(layers[k].nodePath) === parent)
    useRenderStore.getState().setOutputLayerOrder(reorderSibling(siblings, moved, targetKey, zone))
  }

  // Drag-and-drop reorder/reparent. Dropping on a row's top/bottom edge reorders
  // (before/after that sibling); dropping on its middle reparents (becomes child).
  const onBakedDragStart = (key: string) => {
    dragKeysRef.current = selectedBakedKeys.has(key) && selectedBakedKeys.size > 1
      ? bakedKeys.filter((k) => selectedBakedKeys.has(k))
      : [key]
  }
  const onBakedDragOver = (key: string, zone: 'before' | 'after' | 'inside') => {
    setDropHover((prev) => (prev && prev.key === key && prev.zone === zone ? prev : { key, zone }))
  }
  const onBakedDrop = async (targetKey: string, zone: 'before' | 'after' | 'inside') => {
    setDropHover(null)
    const dragged = dragKeysRef.current
    dragKeysRef.current = []
    const target = bakedLayersMap[targetKey]
    if (!target || dragged.length === 0) return
    const pathOf = (k: string) => k.replace(/^baked:/, '')
    const targetPath = target.nodePath
    let destParent: string
    let beforeName: string | undefined
    if (zone === 'inside') {
      destParent = targetPath
      beforeName = undefined
    } else {
      destParent = pathParent(targetPath)
      const baseName = targetPath.split('/').filter(Boolean).pop()!
      if (zone === 'before') {
        beforeName = baseName
      } else {
        // after target → before the next sibling in the same parent (else append).
        const siblings = bakedKeys.map((k) => bakedLayersMap[k]).filter((l) => l && pathParent(l.nodePath) === destParent)
        const idx = siblings.findIndex((l) => l!.nodePath === targetPath)
        beforeName = idx >= 0 && idx + 1 < siblings.length ? siblings[idx + 1]!.nodePath.split('/').filter(Boolean).pop() : undefined
      }
    }
    try {
      for (const k of dragged) {
        if (k === targetKey) continue
        await bakedApi.move(pathOf(k), destParent, beforeName)
      }
      await structuralBakedRefresh()
    } catch (e) { console.warn('[baked] action failed', e) }
  }

  const renameBakedLayer = async (nodePath: string, name: string): Promise<void> => {
    try {
      const path = await bakedApi.rename(nodePath, name)
      const key = `baked:${path}`
      await structuralBakedRefresh()
      setActiveBakedLayer(key)
      setSelectedBakedKeys(new Set([key]))
      bakedAnchorRef.current = key
      setRenamingBakedKey(null)
    } catch (e) {
      console.warn('[baked] rename failed', e)
    }
  }

  // Store → panel reconcile: when `selectedLayerKey` changes from OUTSIDE the
  // panel (SELECT-mode scene click, AI select-layer command), collapse the local
  // selection sets to that single key so the panel row highlight follows and the
  // bus publish (below) reflects it — overriding any prior panel selection. This
  // is the other half of the bidirectional contract.
  //
  // Guards against loops/clobbering:
  // - Skips when the change was panel-originated (panelSelectionEchoRef matches),
  //   so multi-selection (Bake selected / batch baked ops) is preserved.
  // - Set updates early-return the SAME reference when already correct, so React
  //   bails and no extra render/publish fires (idempotent).
  useEffect(() => {
    if (panelSelectionEchoRef.current === selectedKey) return
    panelSelectionEchoRef.current = selectedKey
    if (selectedKey === null) {
      setSelectedOutputKeys((prev) => (prev.size === 0 ? prev : new Set()))
      setSelectedBakedKeys((prev) => (prev.size === 0 ? prev : new Set()))
      return
    }
    const { outputKey, bakedKey } = reconcilePanelSelection(selectedKey, { baked: bakedLayersMap, output: layers })
    if (bakedKey) {
      setSelectedBakedKeys((prev) => (prev.size === 1 && prev.has(bakedKey) ? prev : new Set([bakedKey])))
      setSelectedOutputKeys((prev) => (prev.size === 0 ? prev : new Set()))
      bakedAnchorRef.current = bakedKey
      openDrawer('editable')
      postToHost({
        type: 'authoring:preview-lineage-selection',
        bakedLayerId: bakedLayersMap[bakedKey]!.nodePath,
      })
    } else if (outputKey) {
      setSelectedOutputKeys((prev) => (prev.size === 1 && prev.has(outputKey) ? prev : new Set([outputKey])))
      setSelectedBakedKeys((prev) => (prev.size === 0 ? prev : new Set()))
      selectAnchorRef.current = outputKey
      openDrawer('output')
      postToHost({
        type: 'authoring:preview-lineage-selection',
        path: layers[outputKey]!.nodePath,
      })
    }
    // If the key matches neither bucket yet (layers still loading), leave the
    // sets alone; the publish effect's selectedKey fallback still emits it.
  }, [selectedKey, bakedLayersMap, layers, openDrawer, postToHost])

  // Publish all selected baked + output layers to the left-pane inspector bus.
  useEffect(() => {
    const snapshots = []
    for (const key of selectedBakedKeys) {
      const l = bakedLayersMap[key]
      if (l) snapshots.push(bakedLayerToSnapshot(l, aliasMetas))
    }
    for (const key of selectedOutputKeys) {
      const l = layers[key]
      if (l) snapshots.push(outputLayerToSnapshot(l, aliasMetas))
    }
    if (snapshots.length === 0 && activeBakedLayerKey) {
      const l = bakedLayersMap[activeBakedLayerKey]
      if (l) snapshots.push(bakedLayerToSnapshot(l, aliasMetas))
    }
    if (snapshots.length === 0 && selectedKey) {
      const l = layers[selectedKey]
      if (l) snapshots.push(outputLayerToSnapshot(l, aliasMetas))
      // SELECT tool can resolve to a baked layer that isn't in selectedBakedKeys
      // (it writes the store's selectedLayerKey directly); publish it too so the
      // left-pane inspector reflects the picked baked layer with no panel edits.
      else {
        const bl = bakedLayersMap[selectedKey]
        if (bl) snapshots.push(bakedLayerToSnapshot(bl, aliasMetas))
      }
    }
    writeSelectedLayers(snapshots.length > 0 ? {
      layers: snapshots,
      editContext: { editMode, viewMode, drawMode, editAvailable },
    } : null)
  }, [
    selectedBakedKeys,
    selectedOutputKeys,
    activeBakedLayerKey,
    selectedKey,
    bakedLayersMap,
    layers,
    aliasMetas,
    editMode,
    viewMode,
    drawMode,
    editAvailable,
  ])

  const captureScreenshot = () => {
    if (!screenshotEnabledRef.current) return
    setActiveDrawer(null)
    setPinnedDrawer(null)
    if (editorVisibleRef.current) {
      postToHost({ type: 'authoring:request-close-editor', force: true })
    }
    // Reuse the existing low-level render API (the plugin's §7.3 screenshot
    // protocol): force one synchronous compose, then read the live frame canvas.
    // This is the SAME render path the headless `useScreenshotCapture` WS loop
    // uses — we do not re-implement rendering.
    const captured = capturePreviewFrame()
    if ('dataUrl' in captured) {
      // Present the frame as a copyable PNG data URL. The studio embeds this
      // plugin in a sandboxed cross-origin iframe whose permissions policy
      // blocks BOTH the image-blob clipboard write and the `<a download>` click
      // (the previous implementation), so neither surfaces anything usable.
      // A base64 data URL is plain text the user can select + copy, and renders
      // as a right-click-able thumbnail — no clipboard / download dependency.
      setScreenshot({
        status: 'success',
        dataUrl: captured.dataUrl,
        width: captured.width,
        height: captured.height,
      })
    } else {
      setScreenshot({ status: 'error', message: captured.error })
    }
  }
  const dismissScreenshot = () => setScreenshot({ status: 'idle' })
  const toggleDrawer = (drawer: PreviewDrawer): void => {
    if (activeDrawer === drawer) {
      dismissScreenshot()
      setPinnedDrawer(null)
      setActiveDrawer(null)
      return
    }
    openDrawer(drawer)
  }
  const toggleEffectsDrawer = (): void => toggleDrawer('effects')
  const toggleEditor = (): void => {
    dismissScreenshot()
    setActiveDrawer(null)
    setPinnedDrawer(null)
    postToHost({ type: 'authoring:toggle-editor' })
  }
  const activeDrawerTitle = activeDrawer === 'effects'
    ? sceneT('drawer.effects')
    : activeDrawer === 'editable'
      ? sceneT('layers.editable')
      : activeDrawer === 'output'
        ? sceneT('layers.output')
        : activeDrawer === 'control' || activeDrawer === 'valley'
          ? sceneT('control.title')
          : activeDrawer === 'outliner'
            ? sceneT('outliner.title')
            : ''
  const drawerPinned = activeDrawer !== null && pinnedDrawer === activeDrawer

  return (
    <div
      className="renderer-surface"
      data-forgeax-headless-renderer="scene-generator"
      data-pane="renderer"
    >
      <div className="renderer-body">
        <div ref={canvasWrapRef} className="renderer-canvas-wrap">
          <PreviewHeader title={sceneT('preview.title')} viewMode={viewMode} />
          <div ref={drawerDockRef} className="renderer-drawer-dock">
            <nav className="renderer-drawer-pill" aria-label={sceneT('drawer.tools')}>
              <button
                type="button"
                className={`renderer-drawer-pill__button${activeDrawer === 'effects' ? ' is-active' : ''}`}
                title={sceneT('drawer.effects')}
                aria-label={sceneT('drawer.effects')}
                aria-pressed={activeDrawer === 'effects'}
                onClick={toggleEffectsDrawer}
              >
                <SlidersHorizontal size={17} />
              </button>
              <button
                type="button"
                className={`renderer-drawer-pill__button${editorVisible ? ' is-active' : ''}`}
                title={sceneT('editor.title')}
                aria-label={sceneT('editor.title')}
                aria-pressed={editorVisible}
                onClick={toggleEditor}
              >
                <NodeEditor size={17} />
              </button>
              {hasControls && (
                <button
                  type="button"
                  className={`renderer-drawer-pill__button${activeDrawer === 'control' || activeDrawer === 'valley' ? ' is-active' : ''}`}
                  title={sceneT('control.title')}
                  aria-label={sceneT('control.title')}
                  aria-pressed={activeDrawer === 'control' || activeDrawer === 'valley'}
                  onClick={() => toggleDrawer('control')}
                >
                  <Sliders size={17} />
                </button>
              )}
              <button
                type="button"
                className={`renderer-drawer-pill__button${activeDrawer === 'outliner' ? ' is-active' : ''}`}
                title={sceneT('outliner.title')}
                aria-label={sceneT('outliner.title')}
                aria-pressed={activeDrawer === 'outliner'}
                onClick={() => toggleDrawer('outliner')}
              >
                <ListTree size={17} />
              </button>
              <button
                type="button"
                className={`renderer-drawer-pill__button${activeDrawer === 'output' ? ' is-active' : ''}`}
                title={sceneT('layers.output')}
                aria-label={sceneT('layers.output')}
                aria-pressed={activeDrawer === 'output'}
                onClick={() => toggleDrawer('output')}
              >
                <Box size={17} />
              </button>
              <button
                type="button"
                className={`renderer-drawer-pill__button${activeDrawer === 'editable' ? ' is-active' : ''}`}
                title={sceneT('layers.editable')}
                aria-label={sceneT('layers.editable')}
                aria-pressed={activeDrawer === 'editable'}
                onClick={() => toggleDrawer('editable')}
              >
                <Layers size={17} />
              </button>
              <span className="renderer-drawer-pill__divider" aria-hidden />
              <button
                ref={screenshotButtonRef}
                type="button"
                data-testid="renderer-screenshot-button"
                className={`renderer-drawer-pill__button${!screenshotEnabled ? ' is-disabled' : ''}`}
                title={screenshotEnabled ? sceneT('preview.screenshotEnabled') : sceneT('preview.screenshotDisabled')}
                aria-label={screenshotEnabled ? sceneT('preview.screenshotEnabled') : sceneT('preview.screenshotDisabled')}
                aria-disabled={!screenshotEnabled}
                onClick={captureScreenshot}
              >
                <Camera size={17} />
              </button>
              <PackExportButton control={packExport} gameSlug={gameSlug} />
            </nav>

            <div className="renderer-shot-container renderer-shot-container--dock">
              {screenshot.status === 'success' && (
                <div className="renderer-export-popover renderer-shot-popover" role="status" aria-live="polite">
                  <button
                    type="button"
                    className="renderer-export-popover__close"
                    aria-label={sceneT('preview.closeScreenshot')}
                    onClick={dismissScreenshot}
                  >
                    ×
                  </button>
                  <div className="renderer-export-popover__title">{sceneT('preview.screenshotReady')}</div>
                  <img
                    className="renderer-shot-popover__preview"
                    src={screenshot.dataUrl}
                    alt={sceneT('preview.screenshotAlt', { width: screenshot.width, height: screenshot.height })}
                  />
                  <label className="renderer-export-popover__field">
                    <span>{sceneT('preview.screenshotCopy')}</span>
                    <textarea
                      className="renderer-shot-popover__data"
                      aria-label={sceneT('preview.screenshotDataAria')}
                      readOnly
                      rows={3}
                      value={screenshot.dataUrl}
                      onFocus={selectAllText}
                      onClick={selectAllText}
                    />
                  </label>
                </div>
              )}
              <PackExportPopover control={packExport} />
              {screenshot.status === 'error' && (
                <div
                  className="renderer-export-popover renderer-export-popover--error renderer-shot-popover"
                  role="status"
                  aria-live="polite"
                >
                  <button
                    type="button"
                    className="renderer-export-popover__close"
                    aria-label={sceneT('preview.closeScreenshot')}
                    onClick={dismissScreenshot}
                  >
                    ×
                  </button>
                  <div className="renderer-export-popover__title">{sceneT('preview.screenshotFailed')}</div>
                  <div className="renderer-export-popover__message" title={screenshot.message}>
                    {screenshot.message}
                  </div>
                </div>
              )}
            </div>

            <aside
              className={`renderer-drawer-panel${activeDrawer ? ' is-open' : ''}${drawerMaxHeight < 300 ? ' is-compact' : ''}`}
              aria-hidden={!activeDrawer}
              style={{
                '--renderer-drawer-max-height': `${drawerMaxHeight}px`,
                '--renderer-drawer-user-width': `${drawerWidth}px`,
              } as React.CSSProperties}
            >
              {activeDrawer && (
                <div
                  className="renderer-drawer-panel__resize"
                  role="separator"
                  aria-label={sceneT('layers.resize')}
                  aria-orientation="vertical"
                  onMouseDown={beginDrawerWidthResize}
                />
              )}
              <div className="renderer-drawer-panel__inner">
                {activeDrawer && (
                  <div className="renderer-drawer-panel__title">
                    <span>{activeDrawerTitle}</span>
                    <button
                      type="button"
                      className={`renderer-drawer-panel__pin${drawerPinned ? ' is-active' : ''}`}
                      title={sceneT(drawerPinned ? 'drawer.unpin' : 'drawer.pin')}
                      aria-label={sceneT(drawerPinned ? 'drawer.unpin' : 'drawer.pin')}
                      aria-pressed={drawerPinned}
                      onClick={() => setPinnedDrawer(drawerPinned ? null : activeDrawer)}
                    >
                      <Pin size={13} />
                    </button>
                  </div>
                )}
                {activeDrawer === 'effects' && (
                  <div className="renderer-effects-panel">
                    <section className="renderer-effects-section">
                      <div className="renderer-effects-section__head">
                        <h3>{sceneT('preview.view')}</h3>
                        <span className="renderer-effects-section__meta">{sceneT('preview.viewModeCount')}</span>
                      </div>
                      <div className="renderer-effects-grid renderer-effects-grid--views" role="radiogroup" aria-label={sceneT('preview.view')}>
                        {VIEW_MODES.map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            className={`renderer-effects-option${viewMode === mode ? ' is-active' : ''}`}
                            aria-pressed={viewMode === mode}
                            title={viewLabel(mode)}
                            onClick={() => setViewMode(mode)}
                          >
                            <span className="renderer-effects-option__icon" aria-hidden>{viewIcon(mode)}</span>
                            <span className="renderer-effects-option__label">{viewLabel(mode)}</span>
                          </button>
                        ))}
                      </div>
                    </section>
                    <section className="renderer-effects-section renderer-effects-section--controls">
                      <div className="renderer-effects-compact-controls">
                        <button
                          type="button"
                          className={`renderer-effects-coordinate-toggle${viewGuideVisible ? ' is-active' : ''}`}
                          title={`${sceneT('preview.coordinateSystem')} · ${sceneT(viewMode === 'default'
                            ? (viewGuideVisible ? 'layers.hideWorldFrame' : 'layers.showWorldFrame')
                            : 'preview.viewGuides')}`}
                          aria-label={sceneT(viewMode === 'default'
                            ? (viewGuideVisible ? 'layers.hideWorldFrame' : 'layers.showWorldFrame')
                            : 'preview.viewGuides')}
                          aria-pressed={viewGuideVisible}
                          onClick={() => setViewGuideVisible(viewMode, !viewGuideVisible)}
                        >
                          <Axis3d size={17} aria-hidden />
                          <span className="renderer-effects-coordinate-toggle__state" aria-hidden />
                        </button>
                        <div className="renderer-effects-draw-capsule renderer-effects-grid--draw" role="radiogroup" aria-label={sceneT('preview.drawMode')}>
                          {DRAW_MODES.map((mode) => (
                            <button
                              key={mode}
                              type="button"
                              className={`renderer-effects-draw-option${drawMode === mode ? ' is-active' : ''}`}
                              aria-pressed={drawMode === mode}
                              onClick={() => setDrawMode(mode)}
                            >
                              {drawLabel(mode)}
                            </button>
                          ))}
                        </div>
                      </div>
                    </section>
                  </div>
                )}

                {activeDrawer === 'editable' && (
                  <div className="renderer-layers-drawer renderer-layers__section renderer-layers__section--editable">
                    <div className="renderer-layers__section-head">
                      <span className="renderer-layers__head-actions">
                        <button
                          type="button"
                          className={`renderer-layers__add${editMode && editAvailable ? ' is-active' : ''}`}
                          title={editAvailable ? (editMode ? sceneT('preview.editExit') : sceneT('preview.editEnter')) : sceneT('preview.editUnavailable')}
                          aria-pressed={editMode && editAvailable}
                          disabled={!editAvailable}
                          onClick={() => setEditMode(!editMode)}
                        >
                          <Pencil size={12} /> {sceneT('preview.editMode')}
                        </button>
                        {selectedBakedKeys.size > 0 && (
                          <button type="button" className="renderer-layers__add" title={sceneT('layers.deleteSelectedHint')} onClick={deleteSelectedBaked}>
                            {sceneT('layers.deleteSelected', { count: selectedBakedKeys.size })}
                          </button>
                        )}
                        <button type="button" className="renderer-layers__add" title={sceneT('layers.addHint')} onClick={addBakedLayer}>
                          <Plus size={12} /> {sceneT('layers.add')}
                        </button>
                      </span>
                    </div>
                    {bakedKeys.length === 0 ? (
                      <div className="renderer-layers__hint">{sceneT('layers.emptyEditable')}</div>
                    ) : (
                      <ul
                        className="renderer-layers__list"
                        role="listbox"
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => { dragKeysRef.current = []; setDropHover(null) }}
                      >
                        {bakedTree.map((node) => (
                          <BakedLayerTreeRows
                            key={node.pathKey}
                            node={node}
                            depth={0}
                            selectedKeys={selectedBakedKeys}
                            activeKey={activeBakedLayerKey}
                            dropHover={dropHover}
                            collapsed={collapsedBaked}
                            onToggleCollapsed={toggleCollapsedBaked}
                            onSelect={onSelectBaked}
                            onAddSub={addBakedSubLayer}
                            onRemove={removeBakedLayer}
                            renamingKey={renamingBakedKey}
                            onStartRename={setRenamingBakedKey}
                            onCancelRename={() => setRenamingBakedKey(null)}
                            onRename={renameBakedLayer}
                            onDragStartKey={onBakedDragStart}
                            onDragOverKey={onBakedDragOver}
                            onDropKey={onBakedDrop}
                          />
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {(activeDrawer === 'control' || activeDrawer === 'valley') && (
                  <ValleyControls client={client} controls={collectedControls.controls} />
                )}

                {activeDrawer === 'outliner' && (
                  <StageOutliner />
                )}

                {activeDrawer === 'output' && (
                  <div className="renderer-layers-drawer renderer-layers__section renderer-layers__section--output">
                    <div className="renderer-layers__section-head">
                      <span className="renderer-layers__head-actions">
                        <button
                          type="button"
                          className="renderer-layers__add"
                          title={sceneT('layers.bakeSelectedHint')}
                          disabled={selectedOutputKeys.size === 0}
                          onClick={bakeSelectedLayers}
                        >
                          {selectedOutputKeys.size > 0
                            ? sceneT('layers.bakeSelectedCount', { count: selectedOutputKeys.size })
                            : sceneT('layers.bakeSelected')}
                        </button>
                        <button
                          type="button"
                          className="renderer-layers__add"
                          aria-label={exportIsMesh3d ? sceneT('preview.export3d') : sceneT('preview.exportScene')}
                          title={exportIsMesh3d ? sceneT('preview.export3dTitle') : sceneT('preview.exportSceneTitle')}
                          disabled={sceneExport.status === 'pending'}
                          onClick={runExport}
                        >
                          {sceneExport.status === 'pending'
                            ? sceneT('preview.exporting')
                            : exportIsMesh3d
                              ? sceneT('preview.export3d')
                              : sceneT('preview.exportScene')}
                        </button>
                        <button
                          type="button"
                          className="renderer-layers__add"
                          title={sceneT('preview.exportVoxelGlbTitle')}
                          disabled={bakedCellCount === 0 || studioGlbExport.status === 'pending'}
                          onClick={openStudioGlbDialog}
                        >
                          {sceneT('preview.exportVoxelGlb')}
                        </button>
                      </span>
                    </div>
                    {studioGlbDialogOpen && (
                      <div className="renderer-studio-glb-dialog" role="dialog" aria-modal="true" aria-label={sceneT('preview.exportVoxelGlb')}>
                        <button
                          type="button"
                          className="renderer-export-popover__close"
                          aria-label={sceneT('preview.closeVoxelGlbExport')}
                          disabled={studioGlbExport.status === 'pending'}
                          onClick={closeStudioGlbDialog}
                        >
                          ×
                        </button>
                        <strong>{sceneT('preview.exportVoxelGlb')}</strong>
                        <p>{sceneT('preview.exportVoxelGlbDescription', { count: bakedCellCount })}</p>
                        <label className="renderer-export-popover__field">
                          <span>{sceneT('preview.studioDirectory')}</span>
                          <input
                            aria-label={sceneT('preview.studioDirectory')}
                            disabled={studioGlbExport.status === 'pending'}
                            value={studioGlbDirectory}
                            onChange={(event) => setStudioGlbDirectory(event.target.value)}
                          />
                        </label>
                        <label className="renderer-export-popover__field">
                          <span>{sceneT('preview.studioFilename')}</span>
                          <input
                            aria-label={sceneT('preview.studioFilename')}
                            disabled={studioGlbExport.status === 'pending'}
                            value={studioGlbName}
                            onChange={(event) => setStudioGlbName(event.target.value)}
                          />
                        </label>
                        <div className="renderer-studio-glb-dialog__presets">
                          {['assets/3d', 'assets', 'assets/models'].map((directory) => (
                            <button
                              key={directory}
                              type="button"
                              disabled={studioGlbExport.status === 'pending'}
                              onClick={() => setStudioGlbDirectory(directory)}
                            >
                              {directory}
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          className="renderer-layers__add"
                          disabled={studioGlbExport.status === 'pending'}
                          onClick={() => void exportBakedVoxelGlbToStudio()}
                        >
                          {studioGlbExport.status === 'pending' ? sceneT('preview.exporting') : sceneT('preview.exportVoxelGlbAction')}
                        </button>
                        {studioGlbExport.status === 'success' && (
                          <div className="renderer-studio-glb-dialog__status is-success" role="status">
                            {sceneT('preview.exportVoxelGlbReady', { target: studioGlbExport.target })}
                          </div>
                        )}
                        {studioGlbExport.status === 'error' && (
                          <div className="renderer-studio-glb-dialog__status is-error" role="status">
                            {studioGlbExport.message}
                          </div>
                        )}
                      </div>
                    )}
                    {sceneExport.status === 'success' && sceneExport.kind === 'sceneZip' && (
                      <div className="renderer-drawer-export-result" role="status">
                        <button type="button" aria-label={sceneT('preview.closeExport')} onClick={dismissSceneExport}>×</button>
                        <strong>{sceneT('preview.exportSceneReady')}</strong>
                        <input
                          aria-label={sceneT('preview.sceneZipAria')}
                          readOnly
                          value={sceneExport.result.downloadUrl}
                          onFocus={selectExportUrl}
                          onClick={selectExportUrl}
                        />
                      </div>
                    )}
                    {sceneExport.status === 'success' && sceneExport.kind === 'mesh3d' && (
                      <div className="renderer-drawer-export-result" role="status">
                        <button type="button" aria-label={sceneT('preview.closeExport')} onClick={dismissSceneExport}>×</button>
                        <strong>{sceneT('preview.export3dReady')}</strong>
                        <input
                          aria-label={sceneT('preview.export3dRelAria')}
                          readOnly
                          value={sceneExport.result.projectRelativeDir}
                          onFocus={selectExportUrl}
                          onClick={selectExportUrl}
                        />
                        <input
                          aria-label={sceneT('preview.export3dAbsAria')}
                          readOnly
                          value={sceneExport.result.sceneDir}
                          onFocus={selectExportUrl}
                          onClick={selectExportUrl}
                        />
                      </div>
                    )}
                    {sceneExport.status === 'error' && (
                      <div className="renderer-drawer-export-result is-error" role="status">
                        <button type="button" aria-label={sceneT('preview.closeExport')} onClick={dismissSceneExport}>×</button>
                        <strong>{sceneT('preview.exportFailed')}</strong>
                        <span>{sceneExport.message}</span>
                      </div>
                    )}
                    {viewMode === 'default' ? (
                      <div className="renderer-schema-groups">
                        <WorldFrameGroup
                          visible={viewGuideVisible}
                          onToggle={() => setViewGuideVisible('default', !viewGuideVisible)}
                        />
                        <SchemaGroup
                          schema="voxel"
                          visible={schemaVisible.voxel}
                          count={layerKeys.length}
                          onToggle={() => setSchemaVisible('voxel', !schemaVisible.voxel)}
                        >
                          {layerKeys.length === 0 ? (
                            <div className="renderer-layers__empty renderer-layers__empty--schema">
                              <span>{sceneT('layers.emptyOutput')}</span>
                              <small>{sceneT('layers.emptyOutputHint')}</small>
                            </div>
                          ) : (
                            <ul
                              className="renderer-layers__list"
                              role="listbox"
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={() => { outputDragKeyRef.current = null; setOutputDropHover(null) }}
                            >
                              {layerTree.map((node) => (
                                <LayerTreeRows
                                  key={node.pathKey}
                                  node={node}
                                  depth={0}
                                  selectedKeys={selectedOutputKeys}
                                  onSelectLayer={onSelectLayer}
                                  collapsed={collapsedOutput}
                                  onToggleCollapsed={toggleCollapsedOutput}
                                  dropHover={outputDropHover}
                                  stackHints={stackHints}
                                  onDragStartKey={onOutputDragStart}
                                  onDragOverKey={onOutputDragOver}
                                  onDropKey={onOutputDrop}
                                />
                              ))}
                            </ul>
                          )}
                        </SchemaGroup>
                        <SchemaGroup
                          schema="grid"
                          visible={schemaVisible.grid}
                          count={gridKeys.length}
                          onToggle={() => setSchemaVisible('grid', !schemaVisible.grid)}
                        >
                          {gridKeys.length === 0 ? (
                            <div className="renderer-layers__empty renderer-layers__empty--schema">
                              <span>{sceneT('layers.emptyGrid')}</span>
                              <small>{sceneT('layers.emptyGridHint')}</small>
                            </div>
                          ) : (
                            <ul className="renderer-layers__list" role="listbox">
                              {gridKeys.map((key) => (
                                <GridLayerRow key={key} layerKey={key} />
                              ))}
                            </ul>
                          )}
                        </SchemaGroup>
                        {meshKeys.length > 0 && (
                          <SchemaGroup
                            schema="mesh"
                            visible={schemaVisible.mesh}
                            count={meshKeys.length}
                            onToggle={() => setSchemaVisible('mesh', !schemaVisible.mesh)}
                          >
                            <ul className="renderer-layers__list" role="listbox">
                              {meshKeys.map((key) => (
                                <MeshLayerRow key={key} layerKey={key} />
                              ))}
                            </ul>
                          </SchemaGroup>
                        )}
                        {roadKeys.length > 0 && (
                          <SchemaGroup
                            schema="road"
                            visible={schemaVisible.road}
                            count={roadKeys.length}
                            onToggle={() => setSchemaVisible('road', !schemaVisible.road)}
                          >
                            <ul className="renderer-layers__list" role="listbox">
                              {roadKeys.map((key) => (
                                <MeshLayerRow key={key} layerKey={key} badge="road" />
                              ))}
                            </ul>
                          </SchemaGroup>
                        )}
                        {houseKeys.length > 0 && (
                          <SchemaGroup
                            schema="houses"
                            visible={schemaVisible.houses}
                            count={houseKeys.length}
                            onToggle={() => setSchemaVisible('houses', !schemaVisible.houses)}
                          >
                            <ul className="renderer-layers__list" role="listbox">
                              {houseKeys.map((key) => (
                                <MeshLayerRow key={key} layerKey={key} badge="houses" />
                              ))}
                            </ul>
                          </SchemaGroup>
                        )}
                        {guideKeys.length > 0 && (
                          <SchemaGroup
                            schema="guide"
                            visible={schemaVisible.guide}
                            count={guideKeys.length}
                            onToggle={() => setSchemaVisible('guide', !schemaVisible.guide)}
                          >
                            <ul className="renderer-layers__list" role="listbox">
                              {guideKeys.map((key) => (
                                <GuideLayerRow key={key} layerKey={key} />
                              ))}
                            </ul>
                          </SchemaGroup>
                        )}
                      </div>
                    ) : layerKeys.length === 0 ? (
                      <div className="renderer-layers__empty">
                        <Box size={20} />
                        <span>{sceneT('layers.emptyOutput')}</span>
                        <small>{sceneT('layers.emptyOutputHint')}</small>
                      </div>
                    ) : (
                      <ul
                        className="renderer-layers__list"
                        role="listbox"
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => { outputDragKeyRef.current = null; setOutputDropHover(null) }}
                      >
                        {layerTree.map((node) => (
                          <LayerTreeRows
                            key={node.pathKey}
                            node={node}
                            depth={0}
                            selectedKeys={selectedOutputKeys}
                            onSelectLayer={onSelectLayer}
                            collapsed={collapsedOutput}
                            onToggleCollapsed={toggleCollapsedOutput}
                            dropHover={outputDropHover}
                            stackHints={stackHints}
                            onDragStartKey={onOutputDragStart}
                            onDragOverKey={onOutputDragOver}
                            onDropKey={onOutputDrop}
                          />
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </aside>
          </div>
          <RenderCanvas
            handleRef={pluginRef}
            onPaintTargetMismatch={requestPaintTarget}
            onBakedEditCommitted={handleBakedEditCommitted}
            paintPersistsRef={paintPersistsRef}
          />
        </div>
      </div>
      {pendingPaintTarget && (
        <div className="renderer-modal-backdrop" role="presentation">
          <div className="renderer-modal" role="dialog" aria-modal="true" aria-label={sceneT('paint.createDialog')}>
            <div className="renderer-modal__title">{sceneT('paint.createTitle')}</div>
            <p className="renderer-modal__copy">
              {sceneT('paint.currentLayer')} <strong>{pendingPaintTarget.activeLayer.nodeName}</strong> {sceneT('paint.boundTo')}{' '}
              <strong>{pendingPaintTarget.activeLayer.assetName || sceneT('paint.noAsset')}</strong>. {sceneT('paint.painting')}{' '}
              <strong>{pendingPaintTarget.asset.name}</strong>{sceneT('paint.requiresChild')}
            </p>
            {pendingPaintTarget.asset.alias && (
              <div className="renderer-modal__asset">
                <img src={libraryApi.serveUrl(pendingPaintTarget.asset.alias)} alt={pendingPaintTarget.asset.alias} />
                <span>{pendingPaintTarget.asset.alias}</span>
              </div>
            )}
            <label className="renderer-modal__field">
              {sceneT('paint.newLayerName')}
              <input
                value={paintTargetName}
                onChange={(e) => setPaintTargetName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') cancelPaintTarget()
                  if (e.key === 'Enter') void confirmPaintTarget()
                }}
                autoFocus
              />
            </label>
            <div className="renderer-modal__actions">
              <button type="button" className="renderer-modal__btn" onClick={cancelPaintTarget}>{sceneT('common.cancel')}</button>
              <button type="button" className="renderer-modal__btn renderer-modal__btn--primary" onClick={() => void confirmPaintTarget()}>
                {sceneT('paint.createAndPaint')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PreviewHeader({ title, viewMode }: { title: string; viewMode: ViewMode }): JSX.Element | null {
  const scale = useRenderStore((state) => state.viewport2d.scale)
  const zoomAvailable = !isOrbit3dView(viewMode)
  if (!zoomAvailable) return null
  const zoom = (direction: 'in' | 'out'): void => {
    const store = useRenderStore.getState()
    const next = zoomViewportCentered(store.viewport2d, direction)
    if (next) store.setViewport2d(next)
  }

  return (
    <div className="renderer-preview-label" aria-label={title}>
      <span className="renderer-preview-label__status" aria-hidden />
      <span className="renderer-preview-label__zoom">
        <button type="button" aria-label={sceneT('preview.zoomOut')} onClick={() => zoom('out')}>−</button>
        <output>{Math.round(scale * 100)}%</output>
        <button type="button" aria-label={sceneT('preview.zoomIn')} onClick={() => zoom('in')}>+</button>
      </span>
    </div>
  )
}

const SCHEMA_LABEL_KEYS = {
  voxel: 'layers.schema.voxel',
  grid: 'layers.schema.grid',
  mesh: 'layers.schema.mesh',
  road: 'layers.schema.road',
  houses: 'layers.schema.houses',
  guide: 'layers.schema.guide',
  ref: 'layers.schema.ref',
} as const satisfies Record<DisplaySchema, SceneKey>

function ControlPlaneRow({ plane, index }: { plane: WorldPlaneFrame; index: number }): JSX.Element {
  const selectedLayerKey = useRenderStore((s) => s.selectedLayerKey)
  const selectedEditorNodeIds = useRenderStore((s) => s.selectedEditorNodeIds)
  const setSelectedLayer = useRenderStore((s) => s.setSelectedLayer)
  const setSelectedEditorNodeIds = useRenderStore((s) => s.setSelectedEditorNodeIds)

  const isSelected = selectedLayerKey === `plane:${plane.id}` ||
    (!!plane.nodeId && selectedEditorNodeIds.includes(plane.nodeId))

  const colorHex = `#${getPlaneColor(plane, index, false).toString(16).padStart(6, '0')}`
  const dimStr = `${Math.round(plane.extent[0])}×${Math.round(plane.extent[1])}m`
  const cellStr = plane.cellSize ? `${plane.cellSize}m` : undefined
  const gridStr = plane.cols && plane.rows ? `${plane.cols}×${plane.rows}` : undefined

  return (
    <li
      className={`renderer-layer-row${isSelected ? ' is-selected is-editor-selected' : ''}`}
      role="option"
      aria-selected={isSelected}
      onClick={() => {
        setSelectedLayer(`plane:${plane.id}`)
        if (plane.nodeId) setSelectedEditorNodeIds([plane.nodeId])
      }}
      title={`${plane.name} (${dimStr}${cellStr ? `, cell: ${cellStr}` : ''}${gridStr ? `, ${gridStr}` : ''})`}
      data-testid={`control-plane-row-${plane.id}`}
    >
      <span className="renderer-layer-caret renderer-layer-caret--spacer" aria-hidden />
      <span className="renderer-layer-color" style={{ backgroundColor: colorHex }} aria-hidden />
      <span className="renderer-layer-name">{plane.name}</span>
      <span className="renderer-schema-badge" data-schema-badge="geometry">
        geometry
      </span>
      <span className="renderer-layer-count" title={`Size: ${dimStr}${cellStr ? ` | Cell: ${cellStr}` : ''}${gridStr ? ` (${gridStr})` : ''}`}>
        {cellStr ? `${cellStr} (${dimStr})` : dimStr}
      </span>
    </li>
  )
}

function WorldFrameGroup({
  visible,
  onToggle,
}: {
  visible: boolean
  onToggle: () => void
}): JSX.Element {
  const worldPlanes = useRenderStore((s) => s.worldPlanes)
  return (
    <section
      className={`renderer-schema-group${visible ? '' : ' is-hidden'}`}
      data-schema="world-frame"
      data-testid="world-frame-layer"
    >
      <div className="renderer-schema-group__head">
        <span className="renderer-schema-group__label">{sceneT('layers.worldFrame')}</span>
        <span className="renderer-layer-count">{Math.max(1, worldPlanes.length)}</span>
        <button
          type="button"
          className="renderer-layer-eye"
          title={visible ? sceneT('layers.hideWorldFrame') : sceneT('layers.showWorldFrame')}
          aria-label={visible ? sceneT('layers.hideWorldFrame') : sceneT('layers.showWorldFrame')}
          aria-pressed={visible}
          onClick={onToggle}
        >
          {visible ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
      </div>
      {worldPlanes.length === 0 ? (
        <div className="renderer-layers__empty renderer-layers__empty--schema">
          <small>{sceneT('layers.worldFrameHint')}</small>
        </div>
      ) : (
        <ul className="renderer-layers__list" role="listbox">
          {worldPlanes.map((plane, idx) => (
            <ControlPlaneRow key={plane.id} plane={plane} index={idx} />
          ))}
        </ul>
      )}
    </section>
  )
}

function SchemaGroup({
  schema,
  visible,
  count,
  onToggle,
  children,
}: {
  schema: DisplaySchema
  visible: boolean
  count: number
  onToggle: () => void
  children: ReactNode
}): JSX.Element {
  const label = sceneT(SCHEMA_LABEL_KEYS[schema])
  return (
    <section className={`renderer-schema-group${visible ? '' : ' is-hidden'}`} data-schema={schema}>
      <div className="renderer-schema-group__head">
        <span className="renderer-schema-group__label">{label}</span>
        <span className="renderer-layer-count">{count}</span>
        <button
          type="button"
          className="renderer-layer-eye"
          title={visible ? sceneT('layers.hideSchema', { schema: label }) : sceneT('layers.showSchema', { schema: label })}
          aria-label={visible ? sceneT('layers.hideSchema', { schema: label }) : sceneT('layers.showSchema', { schema: label })}
          aria-pressed={visible}
          onClick={onToggle}
        >
          {visible ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
      </div>
      {children}
    </section>
  )
}

function GridLayerRow({ layerKey }: { layerKey: string }): JSX.Element | null {
  const layer = useGridLayer(layerKey)
  const setPreviewLayerVisible = useRenderStore((s) => s.setPreviewLayerVisible)
  const selectedEditorNodeIds = useRenderStore((s) => s.selectedEditorNodeIds)
  if (!layer) return null
  const label = `${layer.nodeName}.${layer.portName}`
  const editorSelected = selectedEditorNodeIds.includes(layer.nodeId)
  return (
    <li
      className={`renderer-layer-row${layer.visible ? '' : ' is-hidden'}${editorSelected ? ' is-editor-selected' : ''}`}
      role="option"
      aria-selected={false}
    >
      <span className="renderer-layer-caret renderer-layer-caret--spacer" aria-hidden />
      <span className="renderer-layer-color" style={{ backgroundColor: colorForValueCss(1) }} aria-hidden />
        <span className="renderer-layer-name" title={label}>{label}</span>
      <span className="renderer-schema-badge" data-schema-badge="grid">grid</span>
      <span className="renderer-layer-count">{layer.rows}×{layer.cols}</span>
      <button
        type="button"
        className="renderer-layer-eye"
        title={layer.visible ? sceneT('layers.hide') : sceneT('layers.show')}
        aria-pressed={layer.visible}
        onClick={(e) => {
          e.stopPropagation()
          setPreviewLayerVisible(layerKey, !layer.visible)
        }}
      >
        {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
      </button>
    </li>
  )
}

function GuideLayerRow({ layerKey }: { layerKey: string }): JSX.Element | null {
  const layer = useGuideLayer(layerKey)
  const setGuideLayerVisible = useRenderStore((s) => s.setGuideLayerVisible)
  const selectedEditorNodeIds = useRenderStore((s) => s.selectedEditorNodeIds)
  if (!layer) return null
  const label = `${layer.nodeName}.${layer.portName}`
  const editorSelected = selectedEditorNodeIds.includes(layer.nodeId)
  return (
    <li
      className={`renderer-layer-row${layer.visible ? '' : ' is-hidden'}${editorSelected ? ' is-editor-selected' : ''}`}
      role="option"
      aria-selected={false}
    >
      <span className="renderer-layer-caret renderer-layer-caret--spacer" aria-hidden />
      <span className="renderer-layer-color" style={{ backgroundColor: '#f2c14e' }} aria-hidden />
      <span className="renderer-layer-name" title={label}>{label}</span>
      <span className="renderer-schema-badge" data-schema-badge="guide">guide</span>
      <span className="renderer-layer-count">{layer.points.length}</span>
      <button
        type="button"
        className="renderer-layer-eye"
        title={layer.visible ? sceneT('layers.hide') : sceneT('layers.show')}
        aria-pressed={layer.visible}
        onClick={(e) => {
          e.stopPropagation()
          setGuideLayerVisible(layerKey, !layer.visible)
        }}
      >
        {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
      </button>
    </li>
  )
}

function MeshLayerRow({ layerKey, badge = 'mesh' }: { layerKey: string; badge?: 'mesh' | 'road' | 'houses' }): JSX.Element | null {
  const layer = useMeshLayer(layerKey)
  const setMeshLayerVisible = useRenderStore((s) => s.setMeshLayerVisible)
  const selectedEditorNodeIds = useRenderStore((s) => s.selectedEditorNodeIds)
  if (!layer) return null
  const label = `${layer.nodeName}.${layer.portName}`
  const editorSelected = selectedEditorNodeIds.includes(layer.nodeId)
  return (
    <li
      className={`renderer-layer-row${layer.visible ? '' : ' is-hidden'}${editorSelected ? ' is-editor-selected' : ''}`}
      role="option"
      aria-selected={false}
    >
      <span className="renderer-layer-caret renderer-layer-caret--spacer" aria-hidden />
      <span className="renderer-layer-color" style={{ backgroundColor: badge === 'road' ? '#eee3c0' : badge === 'houses' ? '#f4f4f0' : '#d4d4d0' }} aria-hidden />
      <span className="renderer-layer-name" title={label}>{label}</span>
      <span className="renderer-schema-badge" data-schema-badge={badge}>{badge}</span>
      <span className="renderer-layer-count">{layer.triangleCount}</span>
      <button
        type="button"
        className="renderer-layer-eye"
        title={layer.visible ? sceneT('layers.hide') : sceneT('layers.show')}
        aria-pressed={layer.visible}
        onClick={(e) => {
          e.stopPropagation()
          setMeshLayerVisible(layerKey, !layer.visible)
        }}
      >
        {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
      </button>
    </li>
  )
}

// Collect the layerKeys of every leaf in DFS order — the index space the panel's
// shift-range multi-select operates over. A path carrying several layers (rival
// scene_output sinks projecting the same path with different content) yields one
// entry per layer, matching the rows actually rendered.
function flattenLayerKeys(nodes: PathTreeNode[]): string[] {
  const out: string[] = []
  const walk = (n: PathTreeNode) => {
    out.push(...n.layerKeys)
    n.children.forEach(walk)
  }
  nodes.forEach(walk)
  return out
}

function ancestorPathKeys(path: string): string[] {
  const segs = path.split('/').filter(Boolean)
  const out: string[] = []
  for (let i = 1; i < segs.length; i++) out.push(`/${segs.slice(0, i).join('/')}`)
  return out
}

/** Restack has no "inside" (output paths come from the scene graph, so there is
 *  nothing to reparent into): the row splits cleanly at its midpoint. */
function restackZoneFromEvent(e: React.DragEvent): 'before' | 'after' {
  const r = e.currentTarget.getBoundingClientRect()
  return e.clientY - r.top < r.height / 2 ? 'before' : 'after'
}

function LayerTreeRows({
  node,
  depth,
  selectedKeys,
  onSelectLayer,
  collapsed,
  onToggleCollapsed,
  dropHover,
  stackHints,
  onDragStartKey,
  onDragOverKey,
  onDropKey,
}: {
  node: PathTreeNode
  depth: number
  selectedKeys: ReadonlySet<string>
  onSelectLayer: (key: string, e?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => void
  collapsed: ReadonlySet<string>
  onToggleCollapsed: (pathKey: string) => void
  dropHover: { key: string; zone: 'before' | 'after' } | null
  /** Per-layer "this restack can't show" warnings (see `stackOrderHints`). */
  stackHints: ReadonlyMap<string, string>
  onDragStartKey: (key: string) => void
  onDragOverKey: (key: string, zone: 'before' | 'after') => void
  onDropKey: (key: string, zone: 'before' | 'after') => void
}): JSX.Element {
  const isCollapsed = collapsed.has(node.pathKey)
  const hasChildren = node.children.length > 0
  // Alt-click sweep target, hung off the row that owns the chevron.
  const descendantKeys = useMemo(
    () => (hasChildren ? collectDescendantLayerKeys(node) : undefined),
    [node, hasChildren],
  )
  return (
    <>
      {node.layerKeys.length > 0 ? (
        // One row per layer at this path. Normally exactly one; several when
        // rival scene_output sinks project the same scene path with DIFFERENT
        // content (byte-identical inherited ancestors already collapsed in
        // buildPathTree). Each row keeps its own eye/selection/bake, so no sink
        // is silently swallowed. Only the first row carries the subtree chevron
        // — the children belong to the PATH, not to one sink's layer.
        node.layerKeys.map((key, i) => (
          <LayerRow
            key={key}
            layerKey={key}
            depth={depth}
            selected={selectedKeys.has(key)}
            hasChildren={hasChildren && i === 0}
            collapsed={isCollapsed}
            showSource={node.layerKeys.length > 1}
            aliasKeys={node.layerAliases?.[key]}
            descendantKeys={i === 0 ? descendantKeys : undefined}
            dropZone={dropHover && dropHover.key === key ? dropHover.zone : null}
            stackHint={stackHints.get(key)}
            onToggleCollapsed={() => onToggleCollapsed(node.pathKey)}
            onSelect={(e) => onSelectLayer(key, e)}
            onDragStartKey={onDragStartKey}
            onDragOverKey={onDragOverKey}
            onDropKey={onDropKey}
          />
        ))
      ) : (
        // Collapsible sink/path container row: chevron toggles its subtree.
        <li
          className={`renderer-layer-row renderer-layer-row--container${depth > 0 ? ' renderer-layer-row--child' : ''}`}
          style={{ paddingLeft: layerRowPadding(depth) }}
          role="presentation"
        >
          <button
            type="button"
            className="renderer-layer-caret"
            title={isCollapsed ? sceneT('layers.expand') : sceneT('layers.collapse')}
            aria-expanded={!isCollapsed}
            onClick={() => onToggleCollapsed(node.pathKey)}
          >
            {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </button>
          <span className="renderer-layer-color renderer-layer-color--container" aria-hidden />
          <span className="renderer-layer-name" title={node.pathKey}>{node.segment}</span>
        </li>
      )}
      {hasChildren &&
        !isCollapsed &&
        node.children.map((child) => (
          <LayerTreeRows
            key={child.pathKey}
            node={child}
            depth={depth + 1}
            selectedKeys={selectedKeys}
            onSelectLayer={onSelectLayer}
            collapsed={collapsed}
            onToggleCollapsed={onToggleCollapsed}
            dropHover={dropHover}
            stackHints={stackHints}
            onDragStartKey={onDragStartKey}
            onDragOverKey={onDragOverKey}
            onDropKey={onDropKey}
          />
        ))}
    </>
  )
}

function LayerRow({
  layerKey,
  depth,
  selected,
  hasChildren,
  collapsed,
  showSource = false,
  aliasKeys,
  descendantKeys,
  dropZone,
  stackHint,
  onToggleCollapsed,
  onSelect,
  onDragStartKey,
  onDragOverKey,
  onDropKey,
}: {
  layerKey: string
  depth: number
  selected: boolean
  hasChildren: boolean
  collapsed: boolean
  /** Label the row with its originating scene_output sink (rival same-path rows). */
  showSource?: boolean
  /**
   * Byte-identical copies of this layer from other sinks, folded into this row.
   * The canvas paints them too, so the eye must toggle them in lockstep.
   */
  aliasKeys?: string[]
  /**
   * Every layer below this row. A scene path is BOTH a layer with its own cells
   * and a parent, so the plain eye stays single-layer (hide just this node's
   * voxels) and Alt-click opts into sweeping the whole subtree.
   */
  descendantKeys?: string[]
  /** Restack drop indicator for this row, when it is the current hover target. */
  dropZone?: 'before' | 'after' | null
  /** Set when this row was restacked but sits in a z band no sibling shares. */
  stackHint?: string
  onToggleCollapsed: () => void
  onSelect: (e: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => void
  onDragStartKey: (key: string) => void
  onDragOverKey: (key: string, zone: 'before' | 'after') => void
  onDropKey: (key: string, zone: 'before' | 'after') => void
}): JSX.Element | null {
  const layer = useVoxelLayer(layerKey)
  const setLayerVisible = useRenderStore((s) => s.setLayerVisible)
  const toggleSubLayerVisible = useRenderStore((s) => s.toggleSubLayerVisible)
  const selectedEditorNodeIds = useRenderStore((s) => s.selectedEditorNodeIds)
  // Multi-value layers (G2) expand to one sub-layer row per voxel token.
  const [subOpen, setSubOpen] = useState(true)
  if (!layer) return null
  // Legacy LayersSidePanel labels rows by the scene node/path name; the
  // asset_name is surfaced separately (badge), not as the row label.
  const label = layer.nodeName || layer.assetName || `#${layer.value}`
  // Green editor-selection highlight when this layer's node is selected in the
  // editor — mirrors the legacy PathTreeRow `is-editor-selected` treatment.
  const editorSelected = selectedEditorNodeIds.includes(layer.nodeId) || selectedEditorNodeIds.includes(layer.key)
  const subTokens = layer.subTokens
  const isMulti = !!subTokens && subTokens.length > 1
  return (
    <>
      <li
        className={`renderer-layer-row${depth > 0 ? ' renderer-layer-row--child' : ''}${layer.visible ? '' : ' is-hidden'}${layer.nodeDisabled ? ' is-node-disabled' : ''}${selected ? ' is-selected' : ''}${editorSelected ? ' is-editor-selected' : ''}${dropZone ? ` drop-${dropZone}` : ''}`}
        style={{ paddingLeft: layerRowPadding(depth) }}
        role="option"
        aria-selected={selected}
        // Restack among siblings. This list IS the painter's order, so a row
        // dragged BELOW another ends up drawn ON TOP of it — the inverse of the
        // Editable section, whose panel order is flipped for the painter in
        // `orderBakedKeysForRender`. Output order is left uninverted on purpose:
        // flipping it would restack every existing scene under the user.
        draggable
        onDragStart={() => onDragStartKey(layerKey)}
        onDragOver={(e) => { e.preventDefault(); onDragOverKey(layerKey, restackZoneFromEvent(e)) }}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDropKey(layerKey, restackZoneFromEvent(e)) }}
        onClick={onSelect}
      >
        {hasChildren ? (
          <button
            type="button"
            className="renderer-layer-caret"
            title={collapsed ? sceneT('layers.expand') : sceneT('layers.collapse')}
            aria-expanded={!collapsed}
            onClick={(e) => {
              e.stopPropagation()
              onToggleCollapsed()
            }}
          >
            {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </button>
        ) : isMulti ? (
          <button
            type="button"
            className="renderer-layer-caret"
            title={subOpen ? sceneT('layers.collapseSub') : sceneT('layers.expandSub')}
            aria-expanded={subOpen}
            onClick={(e) => {
              e.stopPropagation()
              setSubOpen((v) => !v)
            }}
          >
            {subOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="renderer-layer-caret renderer-layer-caret--spacer" aria-hidden />
        )}
        <span className="renderer-layer-color" style={{ backgroundColor: colorForValueCss(layer.value) }} aria-hidden />
        <span className="renderer-layer-name" title={layer.nodePath || label}>
          {label}
        </span>
        <span className="renderer-schema-badge" data-schema-badge="voxel">voxel</span>
        {stackHint && (
          <span className="renderer-layer-stack-hint" title={stackHint} role="img" aria-label={stackHint}>
            <TriangleAlert size={12} />
          </span>
        )}
        {showSource && (
          <span className="renderer-layer-source" title={`Scene Output node ${layer.nodeId}`}>
            {layer.nodeId.slice(-5)}
          </span>
        )}
        <span className="renderer-layer-count">{layer.cells.length || layer.cellCount || 0}</span>
        <button
          type="button"
          className="renderer-layer-eye"
          // A gated layer's eye is inert: the source node's preview is off, so
          // any local toggle would be undone by the next refresh. Say so instead
          // of letting the click look broken.
          disabled={!!layer.nodeDisabled}
          title={
            layer.nodeDisabled
              ? `Preview is disabled on the source Scene Output node (${layer.nodeId}) — re-enable it there`
              : `${layer.visible ? 'Hide layer' : 'Show layer'}${descendantKeys?.length ? ' (Alt: include sub-layers)' : ''}`
          }
          aria-pressed={layer.visible}
          onClick={(e) => {
            e.stopPropagation()
            const next = !layer.visible
            setLayerVisible(layerKey, next)
            for (const alias of aliasKeys ?? []) setLayerVisible(alias, next)
            if (e.altKey) for (const key of descendantKeys ?? []) setLayerVisible(key, next)
          }}
        >
          {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
      </li>
      {isMulti &&
        subOpen &&
        subTokens!.map((token, i) => {
          const subVisible = layer.subVisible?.[token] !== false
          const count = layer.cellsByToken?.[token]?.length ?? 0
          return (
            <li
              key={token || `#${i}`}
              className={`renderer-layer-row renderer-layer-row--child renderer-layer-row--sub${subVisible ? '' : ' is-hidden'}`}
              style={{ paddingLeft: layerRowPadding(depth + 1) }}
              role="presentation"
            >
              <span className="renderer-layer-caret renderer-layer-caret--spacer" aria-hidden />
              <span
                className="renderer-layer-color renderer-layer-color--sub"
                style={{ backgroundColor: colorForValueCss(i + 1, { subDimmed: true }) }}
                aria-hidden
              />
              <span className="renderer-layer-name" title={token}>
                {token || '(untokened)'}
              </span>
              <span className="renderer-layer-count">{count}</span>
              <button
                type="button"
                className="renderer-layer-eye"
                title={subVisible ? sceneT('layers.hideSub') : sceneT('layers.showSub')}
                aria-pressed={subVisible}
                onClick={(e) => {
                  e.stopPropagation()
                  toggleSubLayerVisible(layerKey, token)
                }}
              >
                {subVisible ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>
            </li>
          )
        })}
    </>
  )
}

// One editable (baked) layer row. Selecting it makes it the paint target
// (`activeBakedLayerKey`); painting in the canvas flows into this layer. Indents
// by scene-path depth so sub-layers nest visually.
function BakedLayerTreeRows({
  node,
  depth,
  selectedKeys,
  activeKey,
  dropHover,
  collapsed,
  onToggleCollapsed,
  onSelect,
  onAddSub,
  onRemove,
  renamingKey,
  onStartRename,
  onCancelRename,
  onRename,
  onDragStartKey,
  onDragOverKey,
  onDropKey,
}: {
  node: PathTreeNode
  depth: number
  selectedKeys: ReadonlySet<string>
  activeKey: string | null
  dropHover: { key: string; zone: 'before' | 'after' | 'inside' } | null
  collapsed: ReadonlySet<string>
  onToggleCollapsed: (pathKey: string) => void
  onSelect: (key: string, e?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => void
  onAddSub: (nodePath: string) => void
  onRemove: (nodePath: string) => void
  renamingKey: string | null
  onStartRename: (key: string) => void
  onCancelRename: () => void
  onRename: (nodePath: string, name: string) => Promise<void>
  onDragStartKey: (key: string) => void
  onDragOverKey: (key: string, zone: 'before' | 'after' | 'inside') => void
  onDropKey: (key: string, zone: 'before' | 'after' | 'inside') => void
}): JSX.Element {
  const isCollapsed = collapsed.has(node.pathKey)
  const hasChildren = node.children.length > 0
  return (
    <>
      {node.layerKey ? (
        <BakedLayerRow
          layerKey={node.layerKey}
          depth={depth}
          selected={selectedKeys.has(node.layerKey)}
          active={activeKey === node.layerKey}
          dropZone={dropHover && dropHover.key === node.layerKey ? dropHover.zone : null}
          hasChildren={hasChildren}
          collapsed={isCollapsed}
          onToggleCollapsed={() => onToggleCollapsed(node.pathKey)}
          onSelect={onSelect}
          onAddSub={onAddSub}
          onRemove={onRemove}
          isRenaming={renamingKey === node.layerKey}
          onStartRename={() => onStartRename(node.layerKey!)}
          onCancelRename={onCancelRename}
          onRename={onRename}
          onDragStartKey={onDragStartKey}
          onDragOverKey={onDragOverKey}
          onDropKey={onDropKey}
        />
      ) : (
        <li
          className={`renderer-layer-row renderer-layer-row--container${depth > 0 ? ' renderer-layer-row--child' : ''}`}
          style={{ paddingLeft: layerRowPadding(depth) }}
          role="presentation"
        >
          <button
            type="button"
            className="renderer-layer-caret"
            title={isCollapsed ? sceneT('layers.expand') : sceneT('layers.collapse')}
            aria-expanded={!isCollapsed}
            onClick={() => onToggleCollapsed(node.pathKey)}
          >
            {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </button>
          <span className="renderer-layer-color renderer-layer-color--container" aria-hidden />
          <span className="renderer-layer-name" title={node.pathKey}>{node.segment}</span>
        </li>
      )}
      {hasChildren &&
        !isCollapsed &&
        node.children.map((child) => (
          <BakedLayerTreeRows
            key={child.pathKey}
            node={child}
            depth={depth + 1}
            selectedKeys={selectedKeys}
            activeKey={activeKey}
            dropHover={dropHover}
            collapsed={collapsed}
            onToggleCollapsed={onToggleCollapsed}
            onSelect={onSelect}
            onAddSub={onAddSub}
            onRemove={onRemove}
            renamingKey={renamingKey}
            onStartRename={onStartRename}
            onCancelRename={onCancelRename}
            onRename={onRename}
            onDragStartKey={onDragStartKey}
            onDragOverKey={onDragOverKey}
            onDropKey={onDropKey}
          />
        ))}
    </>
  )
}

function BakedLayerRow({
  layerKey,
  depth,
  selected,
  active,
  dropZone,
  hasChildren,
  collapsed,
  onToggleCollapsed,
  onSelect,
  onAddSub,
  onRemove,
  isRenaming,
  onStartRename,
  onCancelRename,
  onRename,
  onDragStartKey,
  onDragOverKey,
  onDropKey,
}: {
  layerKey: string
  depth: number
  selected: boolean
  active: boolean
  dropZone: 'before' | 'after' | 'inside' | null
  hasChildren: boolean
  collapsed: boolean
  onToggleCollapsed: () => void
  onSelect: (key: string, e?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => void
  onAddSub: (nodePath: string) => void
  onRemove: (nodePath: string) => void
  isRenaming: boolean
  onStartRename: () => void
  onCancelRename: () => void
  onRename: (nodePath: string, name: string) => Promise<void>
  onDragStartKey: (key: string) => void
  onDragOverKey: (key: string, zone: 'before' | 'after' | 'inside') => void
  onDropKey: (key: string, zone: 'before' | 'after' | 'inside') => void
}): JSX.Element | null {
  const layer = useBakedLayer(layerKey)
  const setBakedLayerVisible = useRenderStore((s) => s.setBakedLayerVisible)
  const rowRef = useRef<HTMLLIElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [draftName, setDraftName] = useState('')
  const label = layer ? (layer.nodeName || layer.assetName || layer.nodePath) : ''
  useEffect(() => {
    if (!isRenaming) {
      setDraftName(label)
      return
    }
    setDraftName(label)
    window.requestAnimationFrame(() => {
      rowRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [isRenaming, label])
  if (!layer) return null
  const commitRename = async (): Promise<void> => {
    const next = draftName.trim()
    if (!next || next === label) {
      setDraftName(label)
      onCancelRename()
      return
    }
    await onRename(layer.nodePath, next)
  }
  // Cursor position within the row → drop intent (top 30% before, bottom 30%
  // after, middle reparents as a child).
  const zoneFromEvent = (e: React.DragEvent): 'before' | 'after' | 'inside' => {
    const r = e.currentTarget.getBoundingClientRect()
    const rel = (e.clientY - r.top) / Math.max(1, r.height)
    return rel < 0.3 ? 'before' : rel > 0.7 ? 'after' : 'inside'
  }
  return (
    <li
      ref={rowRef}
      className={`renderer-layer-row renderer-layer-row--baked${depth > 0 ? ' renderer-layer-row--child' : ''}${layer.visible ? '' : ' is-hidden'}${active ? ' is-active' : ''}${selected ? ' is-selected' : ''}${dropZone ? ` drop-${dropZone}` : ''}`}
      style={{ paddingLeft: layerRowPadding(depth) }}
      role="option"
      aria-selected={selected}
      title={layer.assetName ? `${layer.nodePath} · ${layer.assetName}` : layer.nodePath}
      draggable={!isRenaming}
      onDragStart={() => onDragStartKey(layerKey)}
      onDragOver={(e) => { e.preventDefault(); onDragOverKey(layerKey, zoneFromEvent(e)) }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDropKey(layerKey, zoneFromEvent(e)) }}
      onClick={(e) => onSelect(layerKey, e)}
    >
      {hasChildren ? (
        <button
          type="button"
          className="renderer-layer-caret"
          title={sceneT(collapsed ? 'layers.expand' : 'layers.collapse')}
          aria-label={sceneT(collapsed ? 'layers.expand' : 'layers.collapse')}
          aria-expanded={!collapsed}
          onClick={(e) => { e.stopPropagation(); onToggleCollapsed() }}
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        </button>
      ) : (
        <span className="renderer-layer-caret renderer-layer-caret--spacer" aria-hidden />
      )}
      <span className="renderer-layer-color" style={{ backgroundColor: colorForValueCss(layer.value) }} aria-hidden />
      {isRenaming ? (
        <input
          ref={inputRef}
          className="renderer-layer-name-input"
          aria-label={sceneT('layers.rename')}
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onBlur={() => { void commitRename() }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              setDraftName(label)
              onCancelRename()
            } else if (e.key === 'Enter') {
              e.stopPropagation()
              e.currentTarget.blur()
            }
          }}
        />
      ) : (
        <span className="renderer-layer-name" onDoubleClick={(e) => { e.stopPropagation(); onStartRename() }}>{label}</span>
      )}
      <span className="renderer-layer-count">{layer.cells.length || layer.cellCount || 0}</span>
      <button
        type="button"
        className="renderer-layer-eye"
        title={sceneT('layers.addSub')}
        onClick={(e) => { e.stopPropagation(); onAddSub(layer.nodePath) }}
      >
        <Plus size={12} />
      </button>
      <button
        type="button"
        className="renderer-layer-eye"
        title={sceneT('layers.delete')}
        onClick={(e) => { e.stopPropagation(); onRemove(layer.nodePath) }}
      >
        <Trash size={12} />
      </button>
      <button
        type="button"
        className="renderer-layer-eye"
        title={layer.visible ? sceneT('layers.hide') : sceneT('layers.show')}
        aria-pressed={layer.visible}
        onClick={(e) => { e.stopPropagation(); setBakedLayerVisible(layerKey, !layer.visible) }}
      >
        {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
      </button>
    </li>
  )
}
