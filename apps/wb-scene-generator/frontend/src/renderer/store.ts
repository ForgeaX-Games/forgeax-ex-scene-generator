import { create } from 'zustand'
import { DEFAULT_SCHEMA_VISIBLE } from './types'
import type { WorldPlaneFrame } from './framework/worldFrame'
import type {
  DisplaySchema,
  GuideLayer,
  GuidePoint,
  GuideStyle,
  DrawMode,
  GridLayer,
  MeshInstanceXform,
  MeshLayer,
  MeshPayload,
  NameListEntry,
  Point3D,
  RendererVoxelLayer,
  ViewMode,
  VoxelLayer,
} from './types'
import type { AliasMeta } from './framework/asset/matchAssetEntry'
import type { BakedLayerDTO } from './bridge/bakedApi'
import type { PreviewEditTool } from '../surfaces/library/editToolbarBus'
import { DEFAULT_VIEWPORT_2D, panViewport } from './framework/viewport2d'
import type { ScenePortValue } from '../../../../vendor/shared/types/scene/port.js'

// Synthetic nodeId for baked (graph-independent) layers. No real graph node uses
// this, so it never collides with `${nodeId}:${nodePath}` keys and the
// graph-refresh GC (retainVoxelNodes) — which only touches `layers` — ignores it.
export const BAKED_NODE_ID = '__baked__'

/** Sample enough vertices that interior-only edits (river carve, valley depth) still invalidate. */
export function meshPositionsFingerprint(positions: readonly number[]): string {
  const n = positions.length
  if (n === 0) return '0'
  const step = Math.max(1, Math.floor(n / 48))
  let hash = n
  for (let i = 0; i < n; i += step) {
    hash = (Math.imul(hash, 31) + Math.round((positions[i] ?? 0) * 1000)) | 0
  }
  hash = (Math.imul(hash, 31) + Math.round((positions[n - 1] ?? 0) * 1000)) | 0
  return `${hash}:${n}`
}

export function meshColorsFingerprint(colors: readonly number[] | undefined): string {
  if (!colors || colors.length === 0) return '0'
  return meshPositionsFingerprint(colors)
}

export function meshInstancesFingerprint(instances: readonly MeshInstanceXform[] | undefined): string {
  if (!instances || instances.length === 0) return '0'
  const first = instances[0]!
  const last = instances[instances.length - 1]!
  return `${instances.length}:${first.tx.toFixed(2)},${first.ty.toFixed(2)},${last.tx.toFixed(2)},${last.ty.toFixed(2)}`
}

export type ViewGuideVisibility = Record<ViewMode, boolean>

const VIEW_GUIDES_STORAGE_KEY = 'wb-scene-generator.preview.viewGuides'
const LEGACY_SHOW_GRID_KEY = 'wb-scene-generator.preview.showGrid'
const DEFAULT_VIEW_GUIDES: ViewGuideVisibility = {
  default: true,
  top: false,
  topBillboard: false,
  iso: false,
  free3d: false,
  '3DMesh': false,
}

function loadViewGuides(): ViewGuideVisibility {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_VIEW_GUIDES }
  try {
    const raw = localStorage.getItem(VIEW_GUIDES_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Record<ViewMode, unknown>>
      return {
        default: typeof parsed.default === 'boolean' ? parsed.default : DEFAULT_VIEW_GUIDES.default,
        top: parsed.top === true,
        topBillboard: parsed.topBillboard === true,
        iso: parsed.iso === true,
        free3d: parsed.free3d === true,
        '3DMesh': parsed['3DMesh'] === true,
      }
    }
    // One-time compatibility with the old edit-toolbar preference.
    if (localStorage.getItem(LEGACY_SHOW_GRID_KEY) === '1') {
      return { ...DEFAULT_VIEW_GUIDES, topBillboard: true }
    }
  } catch {
    // Storage can be unavailable in sandboxed embeds.
  }
  return { ...DEFAULT_VIEW_GUIDES }
}

function saveViewGuides(value: ViewGuideVisibility): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(VIEW_GUIDES_STORAGE_KEY, JSON.stringify(value))
  } catch {
    // View preferences are best-effort only.
  }
}

/**
 * SELECT-tool resolved selection: the layer it maps to (drives the layer-list +
 * left-panel highlight via `selectedLayerKey` → `selectedLayerBus`) plus the
 * concrete scene voxel(s) to outline. Generic on purpose — no node-editor
 * specifics — so the billboard preview plugin stays decoupled (it only reads
 * `voxels` to draw the highlight, same pattern as `editHoverCell`).
 */
export interface VoxelSelection {
  /** Resolved layer key (`baked:${nodePath}` or `${nodeId}:${nodePath}`). */
  layerKey: string
  /** The exact scene voxel(s) to highlight in the overlay. */
  voxels: Point3D[]
}

interface RenderState {
  /** SceneOutput sink voxel layers, key = `${nodeId}:${nodePath}`. */
  layers: Record<string, RendererVoxelLayer>
  /** Dense 2D grid previews from any node's grid port, key = `${nodeId}:${portName}`. */
  previewLayers: Record<string, GridLayer>
  /** Continuous mesh previews from any node's mesh port, key = `${nodeId}:${portName}`. */
  meshLayers: Record<string, MeshLayer>
  /** Control-point polylines from points_to_node / point2d lists. */
  guideLayers: Record<string, GuideLayer>
  /** Scene graph ports carrying graph + focus, key = nodeId. */
  scenePorts: Record<string, ScenePortValue>
  setScenePort: (nodeId: string, port: ScenePortValue) => void
  removeScenePort: (nodeId: string) => void
  retainScenePorts: (desiredNodeIds: ReadonlySet<string>) => void
  clearScenePorts: () => void
  viewMode: ViewMode
  drawMode: DrawMode
  /** Asset zone's alias metadata pool; the asset drawMode matcher resolves names against this. */
  aliasMetas: AliasMeta[]
  viewport2d: { offsetX: number; offsetY: number; scale: number }
  /**
   * Editor-selected node ids (view-only highlight). Mirrors the legacy
   * `renderStore.selectedEditorNodeIds`, populated from the host's kernel editor
   * selection forwarded over the `workbench:editor-selection` postMessage. Any
   * layer/preview whose `nodeId` is listed gets the green editor-selection
   * highlight on the canvas + its Layers-panel row.
   */
  selectedEditorNodeIds: string[]
  /** Pin that currently shows the local move gizmo (axis + plane handles). */
  selectedGuidePoint: { key: string; index: number } | null
  /** True while a gizmo gesture owns pin/gizmo world XY (React must not snap them back). */
  guideDragging: boolean
  /** Ignore stale preview hydrates until the committed cell comes back. */
  guideCommitLock: { key: string; index: number; x: number; y: number } | null
  /** Points as they were before the in-flight SetParam, used to undo a failed edit. */
  guideEditSnapshot: { key: string; points: GuidePoint[] } | null
  /** Last failed viewport edit; shown until the next successful edit or dismiss. */
  guideEditError: string | null
  /**
   * Per-node preview override forwarded from the editor's `previewEnabled`
   * toggle over `workbench:preview-change`. A node mapped to `false` is treated
   * as preview-off regardless of the backend's `previewEnabled`; nodes absent
   * here fall back to the backend default. Drives `useNodePreviews` gating so a
   * node toggled off in the editor drops its grid/voxel layers, and toggling it
   * back on restores them — the legacy `preview:change` contract.
   */
  previewOverrides: Record<string, boolean>
  /**
   * Manual stacking order for OUTPUT layers (`${nodeId}:${nodePath}` → rank),
   * only for sibling groups the user has actually dragged. The renderer paints
   * in array order, and the store's natural key order shifts every time a sink
   * is re-pulled (`setLayers` deletes then re-inserts that node's keys), so this
   * is the only stable handle on "which of two overlapping layers is on top".
   * Persisted per project — it is a view preference, not graph state.
   */
  outputLayerOrder: Record<string, number>
  /** Merge ranks for one sibling group (see `reorderSibling`). */
  setOutputLayerOrder: (ranks: Record<string, number>) => void
  /** Load the persisted order for a project (or clear it on project switch). */
  loadOutputLayerOrder: (projectId: string | null) => void
  /** Replace the whole preview-override map (host posts the full disabled set). */
  setPreviewOverrides: (overrides: Record<string, boolean>) => void
  /**
   * Apply a `workbench:preview-change` disabled set. Every node the host has
   * ever named keeps an entry: absent from `ids` now means an explicit `true`,
   * NOT "no opinion". The host persists `previewEnabled` to the backend on a
   * 500ms debounce while the refresh this triggers runs in ~30ms, so a node
   * that was just re-enabled would otherwise fall back to the still-stale
   * `previewEnabled:false` from `listNodes` and stay hidden forever — a
   * presentation-only batch broadcasts no `graph:applied`, so nothing ever
   * re-runs the projection once the persist lands.
   */
  setPreviewDisabledNodeIds: (ids: string[]) => void
  /**
   * Currently selected Layers-panel row, driven either by a user click or by the
   * AI/Agent `select-layer` control command. `key` is a voxel layerKey
   * (`${nodeId}:${nodePath}`); `subValue` optionally targets a multi-value
   * sub-layer (G2). null = nothing selected.
   */
  selectedLayerKey: string | null
  selectedSubValue: number | null
  setSelectedLayer: (key: string | null, subValue?: number | null) => void
  /**
   * SELECT-tool scene highlight: the voxel(s) the user resolved by clicking in
   * select mode, to outline/tint in the scene overlay. Decoupled from layer
   * selection (`selectedLayerKey`) so the highlight can render the exact clicked
   * voxels while the layer-list/left-panel highlight keys off the layer. null =
   * nothing highlighted. Read imperatively by the billboard overlay (never
   * render-subscribed there, same as editHoverCell) to keep paint perf.
   */
  voxelSelection: VoxelSelection | null
  /** Replace the current SELECT-tool voxel highlight (+ resolved layer). */
  setVoxelSelection: (selection: VoxelSelection | null) => void
  /**
   * Open (make visible) every sub-layer of a node — or of ALL nodes when
   * `nodeId` is omitted. Mirrors the legacy renderer `open-all-sublayers`
   * command / `showAllSubPreviewLayers`. Sets the parent voxel layers visible
   * and, for multi-value layers, flips all of their sub-layer visibility on.
   */
  openAllSubLayers: (nodeId?: string | null) => void
  /**
   * Toggle one multi-value sub-layer (token) of a voxel layer. Recomputes the
   * layer's effective `cells` (union of the still-visible tokens) and bumps
   * `updatedAt` so the per-layer surface rebuilds with the reduced cell set —
   * the legacy `toggleSubLayerVisible` contract.
   */
  toggleSubLayerVisible: (layerKey: string, token: string) => void
  setLayers: (nodeId: string, batteryName: string, layers: VoxelLayer[], names: NameListEntry[]) => void
  clearLayers: (nodeId: string) => void
  /**
   * Show/hide every voxel layer belonging to a node WITHOUT dropping its cached
   * cells — used for the `previewEnabled` toggle (as opposed to `clearLayers`,
   * which is for node deletion). The backend's output cache is short-lived, so
   * deleting-then-refetching on re-enable can race an evicted cache and come
   * back empty forever (see `useNodePreviews` "enable preview" bug); hiding in
   * place makes re-enable instant and immune to that race.
   */
  setLayersVisibleForNode: (nodeId: string, visible: boolean) => void
  setLayerVisible: (key: string, visible: boolean) => void
  /** Write/replace one node-port grid preview (from a node:output-equivalent fetch). */
  setPreviewLayer: (
    nodeId: string,
    portName: string,
    nodeName: string,
    data: number[][],
    outputType?: 'grid',
  ) => void
  /** Drop every grid preview belonging to a node (node deleted, preview off, or no output). */
  clearPreviewLayers: (nodeId: string) => void
  /** Grid-preview counterpart of `setLayersVisibleForNode` — see its doc. */
  setPreviewLayersVisibleForNode: (nodeId: string, visible: boolean) => void
  /** Evict any grid preview whose key is not in `keys` (post-refresh staleness GC). */
  retainPreviewLayers: (keys: ReadonlySet<string>) => void
  setMeshLayer: (
    nodeId: string,
    portName: string,
    nodeName: string,
    mesh: MeshPayload,
    instances?: readonly MeshInstanceXform[],
  ) => void
  setMeshLayerVisible: (key: string, visible: boolean) => void
  setMeshLayersVisibleForNode: (nodeId: string, visible: boolean) => void
  retainMeshLayers: (keys: ReadonlySet<string>) => void
  setGuideLayer: (nodeId: string, portName: string, nodeName: string, points: GuidePoint[], style?: GuideStyle) => void
  setGuideLayerVisible: (key: string, visible: boolean) => void
  setGuideLayersVisibleForNode: (nodeId: string, visible: boolean) => void
  retainGuideLayers: (keys: ReadonlySet<string>) => void
  moveGuidePoint: (key: string, index: number, x: number, y: number, z?: number) => void
  /** Evict any voxel layer whose nodeId is not in `nodeIds` (deleted scene_output sinks). */
  retainVoxelNodes: (nodeIds: ReadonlySet<string>) => void
  setPreviewLayerVisible: (key: string, visible: boolean) => void
  setViewMode: (m: ViewMode) => void
  setDrawMode: (d: DrawMode) => void
  /** Per-render-plugin visibility. Default mode is the world metre frame, not a work-grid field. */
  viewGuides: ViewGuideVisibility
  setViewGuideVisible: (mode: ViewMode, visible: boolean) => void
  /** Composed work-plane rectangles for the Default world-frame overlay. */
  worldPlanes: WorldPlaneFrame[]
  setWorldPlanes: (planes: WorldPlaneFrame[]) => void
  /**
   * Default-mode schema master toggles (Voxel / Grid / Mesh / Road / Boxes / Guide). Independent of
   * per-layer eyes. Session-only — do not clobber a saved viewMode.
   */
  schemaVisible: Record<DisplaySchema, boolean>
  setSchemaVisible: (schema: DisplaySchema, visible: boolean) => void
  setAliasMetas: (metas: AliasMeta[]) => void
  /** Overwrite viewport fields (zoom-at-cursor writes scale+offset atomically). */
  setViewport2d: (v: Partial<RenderState['viewport2d']>) => void
  /** Incrementally pan the viewport by a CSS-pixel delta (mouse drag). */
  panViewport2d: (dx: number, dy: number) => void
  /** Reset the 2D viewport to the default (offset 0,0 / scale 1). */
  resetViewport2d: () => void
  /** Replace the editor-selected node id list (view-only highlight). */
  setSelectedEditorNodeIds: (ids: string[]) => void
  setSelectedGuidePoint: (sel: { key: string; index: number } | null) => void
  setGuideDragging: (dragging: boolean) => void
  setGuideCommitLock: (lock: { key: string; index: number; x: number; y: number } | null) => void
  setGuideEditSnapshot: (snap: { key: string; points: GuidePoint[] } | null) => void
  setGuideEditError: (error: string | null) => void
  revertGuideEdit: (error: string) => void

  // ── Baked (graph-independent) editable layers ──────────────────────────────
  /**
   * Hand-edited "baked" voxel layers, key = `baked:${nodePath}`. Populated from
   * the baked scene-layer service (`/api/v1/baked/layers`), NOT the node graph —
   * so the graph-refresh GC never evicts them. Rendered through the same
   * billboard pipeline as `layers`.
   */
  bakedLayers: Record<string, RendererVoxelLayer>
  /** Whether the canvas is in paint/edit mode (billboard + asset only). */
  editMode: boolean
  /** The baked layer the user selected as the paint container (`baked:${nodePath}`), or null. */
  activeBakedLayerKey: string | null
  /** Brush mode in edit mode: free paint per cell, or box (rectangle) fill. */
  brushMode: 'free' | 'box'
  /** Active edit tool: operation mode independent from brush shape. */
  editTool: PreviewEditTool
  /** Active integer z layer for editing; default 0. */
  editZ: number
  /** Voxel under the cursor in edit mode, for the ghost preview. */
  editHoverCell: Point3D | null
  /** Live box-select rectangle (world cells, inclusive) at a single z, or null when not dragging. */
  editBox: { x0: number; y0: number; x1: number; y1: number; z: number } | null
  /** The resolved leaf the current stroke writes into (may be a routed sub-layer). */
  activePaintTargetKey: string | null
  /** Replace the whole baked bucket from the service's projected layers. */
  setBakedLayers: (layers: BakedLayerDTO[], opts?: { summary?: boolean }) => void
  /** Clear project-scoped baked layer state before loading a different project. */
  clearBakedLayers: () => void
  setEditMode: (on: boolean) => void
  setBrushMode: (mode: 'free' | 'box') => void
  setEditTool: (tool: PreviewEditTool) => void
  setEditZ: (z: number) => void
  setEditHoverCell: (cell: Point3D | null) => void
  setEditBox: (box: { x0: number; y0: number; x1: number; y1: number; z: number } | null) => void
  setActivePaintTarget: (key: string | null) => void
  setActiveBakedLayer: (key: string | null) => void
  /**
   * Optimistic local cell overwrite for instant paint feedback (persist debounced).
   * Updater form lets rAF paint batches merge into the latest cells instead of
   * replacing the layer from a captured array.
   */
  paintBakedCells: (key: string, cells: Point3D[] | ((cells: Point3D[]) => Point3D[])) => void
  /** Optimistically bind a layer's asset so asset-mode rendering resolves a sprite
   *  immediately (before the backend persist + refetch confirms it). */
  bindBakedLayerAsset: (key: string, assetName: string, assetType?: string, assetAlias?: string) => void
  setBakedLayerVisible: (key: string, visible: boolean) => void

  reset: () => void
}

export const SCENE_DEFAULT_VIEWPORT_2D = { ...DEFAULT_VIEWPORT_2D, scale: 0.7 }
const initialViewport = { ...SCENE_DEFAULT_VIEWPORT_2D }

const userLayerVisibility = new Map<string, boolean>()
const LS_OUTPUT_ORDER_PREFIX = 'wb-scene-generator.output-layer-order:'
let outputOrderProjectId: string | null = null

function readOutputLayerOrder(projectId: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(LS_OUTPUT_ORDER_PREFIX + projectId)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

function writeOutputLayerOrder(order: Record<string, number>): void {
  if (!outputOrderProjectId) return
  try {
    localStorage.setItem(LS_OUTPUT_ORDER_PREFIX + outputOrderProjectId, JSON.stringify(order))
  } catch {
    // Storage unavailable/full — the order still applies for this session.
  }
}

const dirtyBakedLayerKeys = new Set<string>()
const persistingBakedLayerKeys = new Set<string>()
let bakedRefreshDeferred = false

export function markBakedLayerPersisting(key: string): void {
  dirtyBakedLayerKeys.add(key)
  persistingBakedLayerKeys.add(key)
}

export function markBakedLayerPersistSettled(key: string, succeeded: boolean): void {
  persistingBakedLayerKeys.delete(key)
  if (succeeded) dirtyBakedLayerKeys.delete(key)
}

export function hasLocalBakedLayerEdits(): boolean {
  return dirtyBakedLayerKeys.size > 0 || persistingBakedLayerKeys.size > 0
}

export function deferBakedLayersRefresh(): void {
  bakedRefreshDeferred = true
}

// ── Transient per-paint additive delta ──────────────────────────────────────
// paintBakedCells already knows exactly which cells a paint appended (the new
// cells array is the previous one plus a suffix). Recording that suffix here lets
// the billboard's incremental-bake effect consume the delta DIRECTLY in O(k),
// instead of re-deriving it by snapshotting + diffing the whole (e.g. 25k-cell)
// layer on every paint — the dominant cost in the paint→visible window.
// A non-suffix change (removal / reorder / replace) records `null`, signalling the
// effect to fall back to a correct full snapshot/diff (and full rebuild if needed).
interface PaintDelta {
  key: string
  /** Appended cells (a suffix of the new cells array); empty if no-op. */
  added: ReadonlyArray<Point3D>
  /** Layer version after the paint, to match the effect's snapshot bookkeeping. */
  version: number
  /** false ⇒ not a pure append; the effect must do a full diff/rebuild. */
  pureAppend: boolean
}
let lastPaintDelta: PaintDelta | null = null

// Strictly-monotonic layer version stamp. Date.now() has only millisecond
// resolution, so a fast stroke can produce TWO distinct paints with the SAME
// version. That collides the incremental-bake effect's content signature
// (`${layerIdx}@${version}`) → the effect's dependency array doesn't change → the
// 2nd paint's cells are committed to the store but NEVER baked onto the master
// (visually a dead-stop). Anchoring to Date.now() keeps versions human-meaningful
// and roughly wall-clock, while +1 guarantees every mutation gets a unique,
// increasing version so no two paints ever share a signature.
let lastVersionStamp = 0
function nextVersionStamp(): number {
  const t = Date.now()
  lastVersionStamp = t > lastVersionStamp ? t : lastVersionStamp + 1
  return lastVersionStamp
}

export function consumeLastPaintDelta(): PaintDelta | null {
  const d = lastPaintDelta
  lastPaintDelta = null
  return d
}

export function consumeDeferredBakedLayersRefresh(): boolean {
  const deferred = bakedRefreshDeferred
  bakedRefreshDeferred = false
  return deferred
}

/** Dense-grid content equality (number[][]); used to skip no-op preview writes. */
function gridEqual(a: number[][], b: number[][]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let r = 0; r < a.length; r++) {
    const ra = a[r]
    const rb = b[r]
    if (ra === rb) continue
    if (!ra || !rb || ra.length !== rb.length) return false
    for (let c = 0; c < ra.length; c++) if (ra[c] !== rb[c]) return false
  }
  return true
}

/** Per-token visibility equality (skips no-op layer writes on idle re-pull). */
function subVisibleEqual(a?: Record<string, boolean>, b?: Record<string, boolean>): boolean {
  if (a === b) return true
  if (!a || !b) return !a === !b
  const ak = Object.keys(a)
  const bk = Object.keys(b)
  if (ak.length !== bk.length) return false
  return ak.every((k) => a[k] === b[k])
}

/** Voxel-layer content equality (ignores `updatedAt`); skips no-op layer writes. */
function voxelLayerEqual(a: RendererVoxelLayer, b: RendererVoxelLayer): boolean {
  if (
    a.nodePath !== b.nodePath ||
    a.nodeName !== b.nodeName ||
    a.value !== b.value ||
    a.visible !== b.visible ||
    a.assetName !== b.assetName ||
    a.assetAlias !== b.assetAlias ||
    a.assetType !== b.assetType ||
    a.cells.length !== b.cells.length ||
    !subVisibleEqual(a.subVisible, b.subVisible)
  ) {
    return false
  }
  if (a.cells === b.cells && a.schema === b.schema) return true
  try {
    return JSON.stringify(a.schema) === JSON.stringify(b.schema) && JSON.stringify(a.cells) === JSON.stringify(b.cells)
  } catch {
    return false
  }
}

function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

/** Baked-layer equality for identity-stable service refetches. */
function bakedLayerEqual(a: RendererVoxelLayer, b: RendererVoxelLayer): boolean {
  return (
    voxelLayerEqual(a, b) &&
    a.version === b.version &&
    jsonEqual(a.attributes, b.attributes) &&
    jsonEqual(a.bounds, b.bounds)
  )
}

function editBoxEqual(
  a: RenderState['editBox'],
  b: RenderState['editBox'],
): boolean {
  return a === b || (!!a && !!b && a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1 && a.z === b.z)
}

/** Union the cells of every token whose sub-layer is currently visible. */
function unionVisibleCells(
  cellsByToken: Record<string, import('./types').Point3D[]>,
  tokens: string[],
  subVisible: Record<string, boolean>,
): import('./types').Point3D[] {
  const out: import('./types').Point3D[] = []
  for (const tok of tokens) {
    if (subVisible[tok] === false) continue
    const bucket = cellsByToken[tok]
    if (bucket) out.push(...bucket)
  }
  return out
}

export const useRenderStore = create<RenderState>((set) => ({
  layers: {},
  previewLayers: {},
  meshLayers: {},
  guideLayers: {},
  scenePorts: {},
  viewMode: 'default',
  drawMode: 'color',
  viewGuides: loadViewGuides(),
  worldPlanes: [],
  schemaVisible: { ...DEFAULT_SCHEMA_VISIBLE },
  aliasMetas: [],
  viewport2d: { ...initialViewport },
  selectedEditorNodeIds: [],
  selectedGuidePoint: null,
  guideDragging: false,
  guideCommitLock: null,
  guideEditSnapshot: null,
  guideEditError: null,
  previewOverrides: {},
  outputLayerOrder: {},
  selectedLayerKey: null,
  selectedSubValue: null,
  voxelSelection: null,
  bakedLayers: {},
  editMode: false,
  brushMode: 'free',
  editTool: 'paint',
  editZ: 0,
  editHoverCell: null,
  editBox: null,
  activePaintTargetKey: null,
  activeBakedLayerKey: null,
  setSelectedLayer: (key, subValue = null) =>
    set((s) => {
      if (s.selectedLayerKey === key && s.selectedSubValue === subValue) return s
      return { selectedLayerKey: key, selectedSubValue: subValue }
    }),
  setVoxelSelection: (selection) =>
    set((s) => (s.voxelSelection === selection ? s : { voxelSelection: selection })),
  openAllSubLayers: (nodeId = null) =>
    set((state) => {
      const next = { ...state.layers }
      let changed = false
      const now = Date.now()
      for (const k of Object.keys(next)) {
        const l = next[k]
        if (nodeId && l.nodeId !== nodeId) continue
        // Flip the parent layer visible and (when present) every sub-layer on,
        // restoring the full cell set when any sub-layer had been hidden.
        const subVisible = l.subVisible
        const subChanged = subVisible ? Object.keys(subVisible).some((sk) => !subVisible[sk]) : false
        if (!l.visible || subChanged) {
          // An explicit "open everything" is a user intent too — pin it, or the
          // next node-level show would restore the stale hidden choice.
          userLayerVisibility.set(k, true)
          if (subVisible && l.cellsByToken && l.subTokens && subChanged) {
            const nextSub: Record<string, boolean> = {}
            for (const sk of Object.keys(subVisible)) nextSub[sk] = true
            const cells = unionVisibleCells(l.cellsByToken, l.subTokens, nextSub)
            next[k] = { ...l, visible: true, subVisible: nextSub, cells, updatedAt: now }
          } else {
            next[k] = { ...l, visible: true }
          }
          changed = true
        }
      }
      return changed ? { layers: next } : state
    }),
  toggleSubLayerVisible: (layerKey, token) =>
    set((state) => {
      const l = state.layers[layerKey]
      if (!l || !l.subVisible || !l.cellsByToken || !l.subTokens) return state
      if (!(token in l.subVisible)) return state
      const nextSub = { ...l.subVisible, [token]: !l.subVisible[token] }
      const cells = unionVisibleCells(l.cellsByToken, l.subTokens, nextSub)
      return {
        layers: { ...state.layers, [layerKey]: { ...l, subVisible: nextSub, cells, updatedAt: Date.now() } },
      }
    }),
  setOutputLayerOrder: (ranks) =>
    set((s) => {
      const keys = Object.keys(ranks)
      if (keys.length === 0) return s
      if (keys.every((k) => s.outputLayerOrder[k] === ranks[k])) return s
      const next = { ...s.outputLayerOrder, ...ranks }
      writeOutputLayerOrder(next)
      return { outputLayerOrder: next }
    }),
  loadOutputLayerOrder: (projectId) =>
    set((s) => {
      if (outputOrderProjectId === projectId) return s
      outputOrderProjectId = projectId
      const next = projectId ? readOutputLayerOrder(projectId) : {}
      const prevKeys = Object.keys(s.outputLayerOrder)
      const nextKeys = Object.keys(next)
      if (prevKeys.length === nextKeys.length && nextKeys.every((k) => s.outputLayerOrder[k] === next[k])) return s
      return { outputLayerOrder: next }
    }),
  setPreviewOverrides: (overrides) =>
    set((s) => {
      // Identity-stable no-op when unchanged, so the useNodePreviews subscriber
      // doesn't re-run a full refresh on idle re-broadcasts of the same set.
      const prev = s.previewOverrides
      const prevKeys = Object.keys(prev)
      const nextKeys = Object.keys(overrides)
      if (prevKeys.length === nextKeys.length && nextKeys.every((k) => prev[k] === overrides[k])) return s
      return { previewOverrides: overrides }
    }),
  setPreviewDisabledNodeIds: (ids) =>
    set((s) => {
      const prev = s.previewOverrides
      const next: Record<string, boolean> = {}
      for (const id of Object.keys(prev)) next[id] = true
      for (const id of ids) next[id] = false
      const nextKeys = Object.keys(next)
      if (Object.keys(prev).length === nextKeys.length && nextKeys.every((k) => prev[k] === next[k])) return s
      return { previewOverrides: next }
    }),
  setLayers: (nodeId, _battery, layers, names) =>
    set((state) => {
      const nameById = new Map(names.map((n) => [n.id, n]))
      const now = Date.now()
      // Build this node's candidate entries, preserving each layer's prior
      // `updatedAt` when its content is unchanged so the per-layer subscribers
      // (useVoxelLayer / useVoxelLayerVersion) stay referentially stable.
      const candidates: Record<string, RendererVoxelLayer> = {}
      for (const l of layers) {
        const nm = nameById.get(l.value)
        const key = `${nodeId}:${l.nodePath}`
        const prev = state.layers[key]
        // Multi-value (G2): a node whose cells carry >1 token projects sub-layers.
        // Carry forward the user's prior sub-layer visibility across re-pulls
        // (legacy `subLayerVisibleCache` behavior), defaulting new tokens to on.
        const isMulti = Array.isArray(l.tokens) && l.tokens.length > 1 && !!l.cellsByToken
        let subTokens: string[] | undefined
        let subVisible: Record<string, boolean> | undefined
        let cellsByToken: Record<string, import('./types').Point3D[]> | undefined
        let cells = l.cells
        if (isMulti) {
          subTokens = l.tokens
          cellsByToken = l.cellsByToken
          const prevSub = prev?.subVisible ?? {}
          subVisible = {}
          for (const tok of subTokens!) subVisible[tok] = prevSub[tok] ?? true
          cells = unionVisibleCells(cellsByToken!, subTokens!, subVisible)
        }
        const entry: RendererVoxelLayer = {
          key, nodeId, nodePath: l.nodePath, nodeName: l.nodeName, value: l.value,
          // Carry forward the user's prior visibility choice across re-pulls
          // (a re-exec / refresh must not silently re-show a layer the user hid);
          // brand-new layers default to visible.
          schema: l.schema, cells, visible: prev ? prev.visible : true,
          nodeDisabled: prev?.nodeDisabled,
          updatedAt: prev ? prev.updatedAt : now,
          assetName: nm?.name ?? '', assetType: nm?.type,
          ...(isMulti ? { subTokens, subVisible, cellsByToken } : {}),
        }
        // Re-pulling the same output (e.g. an unrelated graph mutation triggers a
        // full refresh) must NOT churn this node's layers: when the content is
        // identical, keep the existing object reference verbatim.
        candidates[key] = prev && voxelLayerEqual(prev, entry) ? prev : { ...entry, updatedAt: now }
      }
      // No change at all for this node (same keys, same content) → keep `state`
      // so only the genuinely-affected region of the preview re-renders.
      const prevKeys = Object.keys(state.layers).filter((k) => state.layers[k].nodeId === nodeId)
      const candKeys = Object.keys(candidates)
      const unchanged =
        prevKeys.length === candKeys.length &&
        candKeys.every((k) => state.layers[k] === candidates[k])
      if (unchanged) return state
      const next = { ...state.layers }
      for (const k of prevKeys) delete next[k]
      for (const k of candKeys) next[k] = candidates[k]
      return { layers: next }
    }),
  clearLayers: (nodeId) =>
    set((state) => {
      const next = { ...state.layers }
      for (const k of Object.keys(next)) {
        if (next[k].nodeId === nodeId) {
          delete next[k]
          userLayerVisibility.delete(k)
        }
      }
      return { layers: next }
    }),
  setLayersVisibleForNode: (nodeId, visible) =>
    set((state) => {
      let changed = false
      const next = { ...state.layers }
      for (const k of Object.keys(next)) {
        const layer = next[k]
        if (layer.nodeId !== nodeId) continue
        // A node-level SHOW must not clobber the user's per-layer choices: this
        // runs on EVERY full refresh (wiring up a new scene_output, any graph
        // mutation), so forcing `true` would make every hand-hidden layer pop
        // back. Restore the user's own last choice where there is one; layers
        // the user never touched follow the node-level flag.
        const target = visible ? userLayerVisibility.get(k) ?? true : false
        const disabled = !visible
        if (layer.visible !== target || !!layer.nodeDisabled !== disabled) {
          next[k] = { ...layer, visible: target, nodeDisabled: disabled }
          changed = true
        }
      }
      return changed ? { layers: next } : state
    }),
  setLayerVisible: (key, visible) =>
    set((state) => {
      const layer = state.layers[key]
      if (!layer) return state
      // Remember it even when the value is unchanged: this is the user pinning
      // an explicit choice that node-level shows must honor from now on.
      userLayerVisibility.set(key, visible)
      if (layer.visible === visible) return state
      return { layers: { ...state.layers, [key]: { ...layer, visible } } }
    }),
  setPreviewLayer: (nodeId, portName, nodeName, data, outputType = 'grid') =>
    set((state) => {
      const key = `${nodeId}:${portName}`
      const rows = data.length
      const cols = data.reduce((m, r) => (r && r.length > m ? r.length : m), 0)
      // Preserve a prior visibility choice across re-executions of the same port.
      const prev = state.previewLayers[key]
      // Partial-redraw guard: a full refresh re-pulls EVERY node's output and
      // calls this setter for each, even when nothing changed. Skip the write
      // when the content is identical so this layer keeps its object reference
      // and its per-layer subscriber (useGridLayer) does not re-render. Only the
      // region whose output actually changed redraws — the legacy contract.
      if (
        prev &&
        prev.nodeName === nodeName &&
        prev.outputType === outputType &&
        prev.rows === rows &&
        prev.cols === cols &&
        gridEqual(prev.data, data)
      ) {
        return state
      }
      return {
        previewLayers: {
          ...state.previewLayers,
          [key]: {
            key, nodeId, portName, nodeName, data, rows, cols, outputType,
            visible: prev?.visible ?? true, updatedAt: Date.now(),
          },
        },
      }
    }),
  clearPreviewLayers: (nodeId) =>
    set((state) => {
      const next = { ...state.previewLayers }
      let changed = false
      for (const k of Object.keys(next)) {
        if (next[k].nodeId === nodeId) { delete next[k]; changed = true }
      }
      return changed ? { previewLayers: next } : state
    }),
  setPreviewLayersVisibleForNode: (nodeId, visible) =>
    set((state) => {
      let changed = false
      const next = { ...state.previewLayers }
      for (const k of Object.keys(next)) {
        const layer = next[k]
        if (layer.nodeId === nodeId && layer.visible !== visible) {
          next[k] = { ...layer, visible }
          changed = true
        }
      }
      return changed ? { previewLayers: next } : state
    }),
  retainPreviewLayers: (keys) =>
    set((state) => {
      const next = { ...state.previewLayers }
      let changed = false
      for (const k of Object.keys(next)) {
        if (!keys.has(k)) { delete next[k]; changed = true }
      }
      return changed ? { previewLayers: next } : state
    }),
  setMeshLayer: (nodeId, portName, nodeName, mesh, instances) =>
    set((state) => {
      const key = `${nodeId}:${portName}`
      const triangleCount = Math.floor(mesh.indices.length / 3)
      const prev = state.meshLayers[key]
      if (
        prev &&
        prev.nodeName === nodeName &&
        prev.triangleCount === triangleCount &&
        prev.mesh.positions.length === mesh.positions.length &&
        prev.mesh.indices.length === mesh.indices.length &&
        meshPositionsFingerprint(prev.mesh.positions) === meshPositionsFingerprint(mesh.positions) &&
        meshColorsFingerprint(prev.mesh.colors) === meshColorsFingerprint(mesh.colors) &&
        meshInstancesFingerprint(prev.instances) === meshInstancesFingerprint(instances)
      ) {
        return state
      }
      return {
        meshLayers: {
          ...state.meshLayers,
          [key]: {
            key, nodeId, portName, nodeName, mesh, triangleCount,
            visible: prev?.visible ?? true, updatedAt: Date.now(),
            ...(instances && instances.length > 0 ? { instances } : {}),
          },
        },
      }
    }),
  setMeshLayerVisible: (key, visible) =>
    set((state) => {
      const layer = state.meshLayers[key]
      if (!layer || layer.visible === visible) return state
      return { meshLayers: { ...state.meshLayers, [key]: { ...layer, visible } } }
    }),
  setMeshLayersVisibleForNode: (nodeId, visible) =>
    set((state) => {
      let changed = false
      const next = { ...state.meshLayers }
      for (const k of Object.keys(next)) {
        const layer = next[k]
        if (layer.nodeId === nodeId && layer.visible !== visible) {
          next[k] = { ...layer, visible }
          changed = true
        }
      }
      return changed ? { meshLayers: next } : state
    }),
  retainMeshLayers: (keys) =>
    set((state) => {
      const next = { ...state.meshLayers }
      let changed = false
      for (const k of Object.keys(next)) {
        if (!keys.has(k)) { delete next[k]; changed = true }
      }
      return changed ? { meshLayers: next } : state
    }),
  setGuideLayer: (nodeId, portName, nodeName, points, style) =>
    set((state) => {
      const key = `${nodeId}:${portName}`
      const lock = state.guideCommitLock
      if (state.guideDragging && lock && lock.key === key) return state
      if (lock && lock.key === key) {
        const incoming = points[lock.index]
        if (!incoming || Math.round(incoming.x) !== lock.x || Math.round(incoming.y) !== lock.y) {
          return state
        }
      }
      const prev = state.guideLayers[key]
      const nextStyle = style ?? prev?.style ?? 'polyline'
      const same = !!(
        prev &&
        prev.nodeName === nodeName &&
        prev.style === nextStyle &&
        prev.points.length === points.length &&
        prev.points.every((pt, i) => pt.x === points[i]?.x && pt.y === points[i]?.y && pt.sourceNodeId === points[i]?.sourceNodeId)
      )
      if (same && !(lock && lock.key === key)) return state
      return {
        guideLayers: same ? state.guideLayers : {
          ...state.guideLayers,
          [key]: {
            key, nodeId, portName, nodeName, points, style: nextStyle,
            visible: prev?.visible ?? true, updatedAt: Date.now(),
          },
        },
        guideCommitLock: lock && lock.key === key ? null : lock,
      }
    }),
  setGuideLayerVisible: (key, visible) =>
    set((state) => {
      const layer = state.guideLayers[key]
      if (!layer || layer.visible === visible) return state
      return { guideLayers: { ...state.guideLayers, [key]: { ...layer, visible } } }
    }),
  setGuideLayersVisibleForNode: (nodeId, visible) =>
    set((state) => {
      let changed = false
      const next = { ...state.guideLayers }
      for (const k of Object.keys(next)) {
        const layer = next[k]
        if (layer.nodeId === nodeId && layer.visible !== visible) {
          next[k] = { ...layer, visible }
          changed = true
        }
      }
      return changed ? { guideLayers: next } : state
    }),
  retainGuideLayers: (keys) =>
    set((state) => {
      const next = { ...state.guideLayers }
      let changed = false
      for (const k of Object.keys(next)) {
        if (!keys.has(k)) { delete next[k]; changed = true }
      }
      return changed ? { guideLayers: next } : state
    }),
  moveGuidePoint: (key, index, x, y, z) =>
    set((state) => {
      const layer = state.guideLayers[key]
      if (!layer || !layer.points[index]) return state
      const points = layer.points.map((pt, i) => {
        if (i !== index) return pt
        const next = { ...pt, x, y }
        if (z === undefined) delete next.z
        else next.z = z
        return next
      })
      const lock = state.guideCommitLock
      return {
        guideLayers: { ...state.guideLayers, [key]: { ...layer, points, updatedAt: Date.now() } },
        guideCommitLock: lock && lock.key === key ? { ...lock, index, x, y } : lock,
      }
    }),
  setGuideDragging: (dragging) =>
    set((state) => (state.guideDragging === dragging ? state : { guideDragging: dragging })),
  setGuideCommitLock: (lock) => set({ guideCommitLock: lock }),
  setGuideEditSnapshot: (snap) => set({ guideEditSnapshot: snap }),
  setGuideEditError: (error) => set({ guideEditError: error }),
  revertGuideEdit: (error) =>
    set((state) => {
      const snap = state.guideEditSnapshot
      const layer = snap ? state.guideLayers[snap.key] : undefined
      return {
        guideLayers: layer
          ? { ...state.guideLayers, [snap!.key]: { ...layer, points: snap!.points, updatedAt: Date.now() } }
          : state.guideLayers,
        guideEditError: error,
        guideCommitLock: null,
        guideDragging: false,
      }
    }),
  retainVoxelNodes: (nodeIds) =>
    set((state) => {
      const next = { ...state.layers }
      let changed = false
      for (const k of Object.keys(next)) {
        if (!nodeIds.has(next[k].nodeId)) {
          delete next[k]
          userLayerVisibility.delete(k)
          changed = true
        }
      }
      return changed ? { layers: next } : state
    }),
  setScenePort: (nodeId, port) =>
    set((s) => ({ scenePorts: { ...s.scenePorts, [nodeId]: port } })),
  removeScenePort: (nodeId) =>
    set((s) => {
      if (!s.scenePorts[nodeId]) return s
      const next = { ...s.scenePorts }
      delete next[nodeId]
      return { scenePorts: next }
    }),
  retainScenePorts: (desiredNodeIds) =>
    set((s) => {
      let changed = false
      const next = { ...s.scenePorts }
      for (const k of Object.keys(next)) {
        if (!desiredNodeIds.has(k)) {
          delete next[k]
          changed = true
        }
      }
      return changed ? { scenePorts: next } : s
    }),
  clearScenePorts: () => set({ scenePorts: {} }),
  setPreviewLayerVisible: (key, visible) =>
    set((state) => {
      const layer = state.previewLayers[key]
      if (!layer || layer.visible === visible) return state
      return { previewLayers: { ...state.previewLayers, [key]: { ...layer, visible } } }
    }),
  setViewMode: (m) => set({ viewMode: m }),
  setDrawMode: (d) => set({ drawMode: d }),
  setAliasMetas: (metas) => set({ aliasMetas: metas }),
  setViewport2d: (v) => set((s) => ({ viewport2d: { ...s.viewport2d, ...v } })),
  panViewport2d: (dx, dy) => set((s) => ({ viewport2d: panViewport(s.viewport2d, dx, dy) })),
  resetViewport2d: () => set({ viewport2d: { ...SCENE_DEFAULT_VIEWPORT_2D } }),
  setSelectedEditorNodeIds: (ids) =>
    set((s) => {
      // Identity-stable no-op when the selection is unchanged, so subscribers
      // (canvas compose, panel rows) don't churn on idle selection rebroadcasts.
      const prev = s.selectedEditorNodeIds
      if (prev.length === ids.length && prev.every((v, i) => v === ids[i])) return s
      return { selectedEditorNodeIds: ids }
    }),
  setSelectedGuidePoint: (sel) =>
    set((s) => {
      const prev = s.selectedGuidePoint
      if (prev === sel) return s
      if (prev && sel && prev.key === sel.key && prev.index === sel.index) return s
      if (!prev && !sel) return s
      return { selectedGuidePoint: sel }
    }),
  setBakedLayers: (layers, opts) =>
    set((state) => {
      const now = Date.now()
      const summary = opts?.summary === true
      const next: Record<string, RendererVoxelLayer> = {}
      for (const b of layers) {
        const key = `baked:${b.nodePath}`
        const prev = state.bakedLayers[key]
        const incomingCells = b.cells ?? []
        const cellsSource = summary ? [] : incomingCells
        const cellCount = summary ? (b.cellCount ?? incomingCells.length) : incomingCells.length
        const assetAlias = b.assetAlias ?? (typeof b.attributes?.asset_alias === 'string' ? b.attributes.asset_alias : undefined)
        const candidate: RendererVoxelLayer = {
          key,
          nodeId: BAKED_NODE_ID,
          nodePath: b.nodePath,
          nodeName: b.nodeName,
          value: b.value,
          schema: b.schema,
          cells: cellsSource.map((c) => ({ x: c.x, y: c.y, z: c.z, ...(c.token ? { token: c.token } : {}), ...(c.state ? { state: c.state } : {}) })),
          cellCount,
          // Carry the user's prior show/hide across refetches; new layers default on.
          visible: prev ? prev.visible : true,
          updatedAt: now,
          assetName: b.assetName,
          assetAlias,
          assetType: b.assetType,
          attributes: b.attributes ?? {
            ...(b.assetName ? { asset_name: b.assetName } : {}),
            ...(assetAlias ? { asset_alias: assetAlias } : {}),
            ...(b.assetType ? { asset_type: b.assetType } : {}),
          },
          version: b.version,
          bounds: b.bounds,
          subTokens: prev?.subTokens,
          subVisible: prev?.subVisible,
          cellsByToken: prev?.cellsByToken,
        }
        if (prev && dirtyBakedLayerKeys.has(key)) {
          const incomingVersion = b.version
          const prevVersion = prev.version
          const staleWhileDirty = incomingVersion == null || prevVersion == null || incomingVersion <= prevVersion
          if (bakedLayerEqual(prev, candidate)) {
            dirtyBakedLayerKeys.delete(key)
          } else if (staleWhileDirty) {
            next[key] = prev
            continue
          } else {
            dirtyBakedLayerKeys.delete(key)
            persistingBakedLayerKeys.delete(key)
          }
        }
        next[key] = prev && bakedLayerEqual(prev, candidate) ? prev : { ...candidate, updatedAt: now }
      }
      for (const key of dirtyBakedLayerKeys) {
        if (!(key in next) && state.bakedLayers[key]) next[key] = state.bakedLayers[key]
      }
      const prevKeys = Object.keys(state.bakedLayers)
      const nextKeys = Object.keys(next)
      const unchanged =
        prevKeys.length === nextKeys.length &&
        nextKeys.every((key) => state.bakedLayers[key] === next[key])
      return unchanged ? state : { bakedLayers: next }
    }),
  clearBakedLayers: () => {
    dirtyBakedLayerKeys.clear()
    persistingBakedLayerKeys.clear()
    bakedRefreshDeferred = false
    set((state) => {
      const unchanged =
        Object.keys(state.bakedLayers).length === 0 &&
        state.activeBakedLayerKey === null &&
        state.activePaintTargetKey === null &&
        state.editHoverCell === null &&
        state.editBox === null
      return unchanged
        ? state
        : {
            bakedLayers: {},
            activeBakedLayerKey: null,
            activePaintTargetKey: null,
            editHoverCell: null,
            editBox: null,
          }
    })
  },
  setEditMode: (on) => set((s) => (s.editMode === on ? s : { editMode: on })),
  setViewGuideVisible: (mode, visible) =>
    set((state) => {
      if (state.viewGuides[mode] === visible) return state
      const viewGuides = { ...state.viewGuides, [mode]: visible }
      saveViewGuides(viewGuides)
      return { viewGuides }
    }),
  setWorldPlanes: (planes) => set({ worldPlanes: [...planes] }),
  setSchemaVisible: (schema, visible) =>
    set((state) => {
      if (state.schemaVisible[schema] === visible) return state
      return { schemaVisible: { ...state.schemaVisible, [schema]: visible } }
    }),
  setBrushMode: (mode) => set((s) => (s.brushMode === mode ? s : { brushMode: mode })),
  setEditTool: (tool) => set((s) => (s.editTool === tool ? s : { editTool: tool })),
  setEditZ: (z) => set((s) => {
    const next = Math.trunc(Number.isFinite(z) ? z : 0)
    return s.editZ === next ? s : { editZ: next }
  }),
  setEditHoverCell: (cell) =>
    set((s) => {
      const a = s.editHoverCell
      if (a === cell || (a && cell && a.x === cell.x && a.y === cell.y && a.z === cell.z)) return s
      return { editHoverCell: cell }
    }),
  setEditBox: (box) => set((s) => (editBoxEqual(s.editBox, box) ? s : { editBox: box })),
  setActivePaintTarget: (key) => set((s) => (s.activePaintTargetKey === key ? s : { activePaintTargetKey: key })),
  setActiveBakedLayer: (key) => set((s) => (s.activeBakedLayerKey === key ? s : { activeBakedLayerKey: key })),
  paintBakedCells: (key, cellsOrUpdater) =>
    set((state) => {
      const layer = state.bakedLayers[key]
      if (!layer) return state
      const cells = typeof cellsOrUpdater === 'function' ? cellsOrUpdater(layer.cells) : cellsOrUpdater
      if (cells === layer.cells) return state
      dirtyBakedLayerKeys.add(key)
      const version = nextVersionStamp()
      // Record the additive delta for the incremental-bake effect (O(k)). A pure
      // append means the new array is the old one followed by extra cells; the
      // suffix is the delta. Anything else (shrink/reorder) → not a pure append,
      // so the effect must fall back to a full snapshot/diff.
      //
      // Multiple paintBakedCells calls can coalesce into ONE React render (React
      // batches state updates). The effect consumes the delta once, so we must
      // ACCUMULATE the suffixes across calls for the same key in that window;
      // otherwise earlier cells would be silently dropped by the fast path. A key
      // switch or a non-append change invalidates the accumulator (→ full diff).
      const prev = layer.cells
      const pureAppend = cells.length > prev.length
      const suffix = pureAppend ? cells.slice(prev.length) : []
      if (lastPaintDelta && lastPaintDelta.key === key && lastPaintDelta.pureAppend && pureAppend) {
        lastPaintDelta = {
          key,
          added: [...lastPaintDelta.added, ...suffix],
          version,
          pureAppend: true,
        }
      } else if (lastPaintDelta && lastPaintDelta.key !== key) {
        // A paint for a DIFFERENT key arrived before the bake effect consumed the
        // previous (key A) delta. Overwriting it wholesale would silently discard
        // A's already-committed cells from the incremental bake (committed-but-never-
        // baked = the cells visually go missing). We can't fast-path two layers from
        // one delta, so force the effect onto its FULL snapshot/diff fallback, which
        // reconciles ALL layers (catching both A and B). pureAppend:false guarantees
        // deltaToAppendCells bails → the full diff fires (correct, never silent).
        lastPaintDelta = { key, added: suffix, version, pureAppend: false }
      } else {
        lastPaintDelta = { key, added: suffix, version, pureAppend }
      }
      // Maintain the layer's XY bbox incrementally so voxelLayerCellSource never
      // re-scans all (e.g. 25k) cells per paint. An additive paint extends the
      // previous bbox by the suffix only (O(k)); anything else recomputes once
      // (O(N)) and re-caches, keeping the bbox correct after shrink/reorder.
      let bbox: { minX: number; minY: number; maxX: number; maxY: number } | undefined
      if (pureAppend && layer.bbox) {
        let { minX, minY, maxX, maxY } = layer.bbox
        for (const c of suffix) {
          if (c.x < minX) minX = c.x
          if (c.y < minY) minY = c.y
          if (c.x > maxX) maxX = c.x
          if (c.y > maxY) maxY = c.y
        }
        bbox = { minX, minY, maxX, maxY }
      } else if (cells.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (const c of cells) {
          if (c.x < minX) minX = c.x
          if (c.y < minY) minY = c.y
          if (c.x > maxX) maxX = c.x
          if (c.y > maxY) maxY = c.y
        }
        bbox = { minX, minY, maxX, maxY }
      }
      return { bakedLayers: { ...state.bakedLayers, [key]: { ...layer, cells, updatedAt: version, bbox } } }
    }),
  bindBakedLayerAsset: (key, assetName, assetType, assetAlias) =>
    set((state) => {
      const layer = state.bakedLayers[key]
      if (!layer || (layer.assetName === assetName && layer.assetType === assetType && layer.assetAlias === assetAlias)) return state
      dirtyBakedLayerKeys.add(key)
      const attributes = {
        ...(layer.attributes ?? {}),
        ...(assetName ? { asset_name: assetName } : {}),
        ...(assetAlias ? { asset_alias: assetAlias } : {}),
        ...(assetType ? { asset_type: assetType } : {}),
      }
      return { bakedLayers: { ...state.bakedLayers, [key]: { ...layer, assetName, assetAlias, assetType, attributes, updatedAt: nextVersionStamp() } } }
    }),
  setBakedLayerVisible: (key, visible) =>
    set((state) => {
      const layer = state.bakedLayers[key]
      if (!layer || layer.visible === visible) return state
      return { bakedLayers: { ...state.bakedLayers, [key]: { ...layer, visible } } }
    }),
  reset: () => {
    dirtyBakedLayerKeys.clear()
    persistingBakedLayerKeys.clear()
    userLayerVisibility.clear()
    bakedRefreshDeferred = false
    lastPaintDelta = null
    lastVersionStamp = 0
    outputOrderProjectId = null
    set({
      layers: {},
      previewLayers: {},
      meshLayers: {},
      guideLayers: {},
      scenePorts: {},
      viewMode: 'default',
      drawMode: 'color',
      schemaVisible: { ...DEFAULT_SCHEMA_VISIBLE },
      worldPlanes: [],
      aliasMetas: [],
      viewport2d: { ...initialViewport },
      selectedEditorNodeIds: [],
      selectedGuidePoint: null,
      guideDragging: false,
      guideCommitLock: null,
      guideEditSnapshot: null,
      guideEditError: null,
      previewOverrides: {},
      outputLayerOrder: {},
      selectedLayerKey: null,
      selectedSubValue: null,
      voxelSelection: null,
      bakedLayers: {},
      editMode: false,
      brushMode: 'free',
      editTool: 'paint',
      editZ: 0,
      editHoverCell: null,
      editBox: null,
      activePaintTargetKey: null,
      activeBakedLayerKey: null,
    })
  },
}))
