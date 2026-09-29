import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import {
  consumeDeferredBakedLayersRefresh,
  markBakedLayerPersisting,
  markBakedLayerPersistSettled,
  useRenderStore,
} from '../store'
import { isOrbit3dView } from '../types'
import { getRenderPlugin, hasRenderPlugin, type PluginHandle } from '../framework/plugin'
import { zoomViewportAtPoint } from '../framework/viewport2d'
import { mergeRenderableVoxelLayerKeys, orderBakedKeysForRender } from '../framework/layerKeys'
import { layersDrawnAtCell, type CellQuerySources } from '../framework/cellAttribution'
import { stepSelectCycle } from '../framework/selectionCycle'
import type { BillboardVoxelHit } from '../framework/geometry/topBillboard'
import { bakedApi } from '../bridge/bakedApi'
import { refreshBakedLayers } from '../bridge/useBakedLayers'
import { readPaintAsset, writePaintAsset, type PaintAsset } from '../../surfaces/library/paintAssetBus'
import { resolvePaintTargetSync } from '../framework/paintTarget'
import { markPaintStart, beginStageTimeline, markStage, timeHandler } from '../framework/bakePerf'
import type { AliasMeta } from '../framework/asset/matchAssetEntry'
import { resolveObjectPlacement } from '../framework/geometry/objectPlacement'
import '../modes' // side-effect: registers all mode plugins

// `handleRef` (optional, additive): lets a parent reach the active plugin's
// imperative PluginHandle (e.g. for screenshot capture) without touching modes.
//
// Beyond mounting the active plugin, the host owns the viewport INTERACTION layer
// (faithful to the legacy RenderCanvas): mouse-drag pan + wheel zoom-around-cursor
// writing the shared `viewport2d` store, so every 2D mode (top / topBillboard /
// iso) benefits without re-implementing it. free3d self-manages its camera via
// OrbitControls, so the host stays out of its way.
//
// In edit mode (billboard + asset) the host also drives painting: it resolves
// which baked LEAF the stroke writes into (routing a non-matching asset into an
// auto-created `layer-n` sub-layer), then paints either free-hand (per cell) or
// as a box fill. The active layer the user picks is the CONTAINER; the resolved
// target may be itself or a child sub-layer (see bakedApi.ensureTarget).
export interface PaintTargetRequest {
  activeKey: string
  activeLayer: { nodePath: string; nodeName: string; assetName: string; assetAlias?: string; assetType?: string }
  asset: PaintAsset & { type?: string }
}

/** One selectable layer resolved from a clicked voxel stack, top→bottom. */
export interface SelectionCandidate {
  layerKey: string
  /** Scene voxel(s) in the clicked stack attributed to this layer (to highlight). */
  voxels: { x: number; y: number; z: number }[]
}

/**
 * Resolve a clicked voxel stack (top→bottom) into the ordered, DISTINCT layers
 * the click can select — top-most first. Each voxel in the stack is attributed
 * to the visually-topmost VISIBLE layer drawing on it (so the selection matches
 * what the user sees on top of that voxel); duplicate layers are merged in
 * first-seen (top→bottom) order, accumulating every clicked voxel they own. This
 * is the deterministic cycle order: index 0 = top-most, last = deepest.
 */
export function resolveSelectionCandidates(
  stack: ReadonlyArray<BillboardVoxelHit>,
  sources: CellQuerySources,
): SelectionCandidate[] {
  const byKey = new Map<string, SelectionCandidate>()
  const order: string[] = []
  for (const hit of stack) {
    const v = hit.voxel
    const top = layersDrawnAtCell(sources, v.x, v.y, v.z)[0]
    if (!top) continue
    let entry = byKey.get(top.layerKey)
    if (!entry) {
      entry = { layerKey: top.layerKey, voxels: [] }
      byKey.set(top.layerKey, entry)
      order.push(top.layerKey)
    }
    if (!entry.voxels.some((p) => p.x === v.x && p.y === v.y && p.z === v.z)) {
      entry.voxels.push({ x: v.x, y: v.y, z: v.z })
    }
  }
  return order.map((k) => byKey.get(k)!)
}

export function RenderCanvas({
  handleRef,
  onPaintTargetMismatch,
  onBakedEditCommitted,
  paintPersistsRef,
}: {
  handleRef?: MutableRefObject<PluginHandle | null>
  onPaintTargetMismatch?: (request: PaintTargetRequest) => Promise<string | null>
  onBakedEditCommitted?: () => void | Promise<void>
  // Lets the owning surface drain in-flight paint persists before a STRUCTURAL
  // baked mutation (add/move/remove/bake), so its forced refresh can't be
  // swallowed by the paint-protection defer. Mirrors `awaitPaintPersists`.
  paintPersistsRef?: MutableRefObject<(() => Promise<void>) | null>
}): JSX.Element {
  const viewMode = useRenderStore((s) => s.viewMode)
  const drawMode = useRenderStore((s) => s.drawMode)
  const scale = useRenderStore((s) => s.viewport2d.scale)
  const setViewport2d = useRenderStore((s) => s.setViewport2d)
  const panViewport2d = useRenderStore((s) => s.panViewport2d)
  // Edit mode: paint into the active baked layer (billboard + asset only).
  const editMode = useRenderStore((s) => s.editMode)
  const brushMode = useRenderStore((s) => s.brushMode)
  const editTool = useRenderStore((s) => s.editTool)
  const editZ = useRenderStore((s) => s.editZ)
  const activeBakedLayerKey = useRenderStore((s) => s.activeBakedLayerKey)
  const paintBakedCells = useRenderStore((s) => s.paintBakedCells)
  const bindBakedLayerAsset = useRenderStore((s) => s.bindBakedLayerAsset)
  const setEditHoverCell = useRenderStore((s) => s.setEditHoverCell)
  const setEditBox = useRenderStore((s) => s.setEditBox)
  const setActivePaintTarget = useRenderStore((s) => s.setActivePaintTarget)
  // SELECT tool: resolve the clicked voxel stack → top-most layer (cycling
  // deeper on repeat clicks at the same screen cell) and publish it. The layer
  // highlight flows out through `selectedLayerKey` (which RendererSurface already
  // mirrors to `selectedLayerBus` → left panel) and the scene-voxel highlight
  // through `voxelSelection` (read by the billboard overlay).
  const setSelectedLayer = useRenderStore((s) => s.setSelectedLayer)
  const setVoxelSelection = useRenderStore((s) => s.setVoxelSelection)

  const internalRef = useRef<PluginHandle | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const isPanningRef = useRef(false)
  const [isPanning, setIsPanning] = useState(false)
  // Last mouse client position; pan deltas are computed incrementally so the
  // offset stays integer (matches compose's integer translate basis).
  const panLastRef = useRef({ x: 0, y: 0 })
  // Cursor-cell readout. Kept OUT of React state so per-mousemove cursor tracking
  // never re-renders RenderCanvas (and thus the heavy billboard plugin subtree).
  // We write the readout text imperatively into a DOM node instead.
  const mouseCellRef = useRef<{ col: number; row: number } | null>(null)
  const coordsElRef = useRef<HTMLElement | null>(null)

  // Paint state (edit mode).
  const paintingRef = useRef(false) // free-brush drag active
  const boxingRef = useRef(false) // box-select drag active
  const boxAnchorRef = useRef<{ x: number; y: number; z: number } | null>(null)
  const lastPaintCellRef = useRef<string | null>(null)
  // The resolved baked LEAF the current stroke writes into (may differ from the
  // active layer when the asset routes into a sub-layer). Set once per stroke.
  const targetKeyRef = useRef<string | null>(null)
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pendingPersistsRef = useRef<Set<Promise<void>>>(new Set())
  const pendingPaintCellsRef = useRef<Map<string, { x: number; y: number; z: number }>>(new Map())
  const pendingPaintTargetKeyRef = useRef<string | null>(null)
  const paintFrameRef = useRef<number | null>(null)
  const paintGestureCellKeysRef = useRef<Set<string>>(new Set())
  const paintGestureCellKeysTargetRef = useRef<string | null>(null)
  // The store layer object the gesture dedupe set was last seeded/reconciled from.
  // If the store replaces this layer (async refetch, undo, external edit) the set
  // could over-claim cells the store no longer holds → re-seed before trusting it,
  // so a stale "already painted" entry can never permanently drop a fresh paint.
  const paintGestureSeedLayerRef = useRef<unknown>(null)
  const paintStrokeChangedRef = useRef(false)

  // SELECT-tool cycle state: which screen cell the cycle is anchored to and how
  // deep into that cell's layer stack the last click landed. Clicking a NEW cell
  // resets to the top-most layer; re-clicking the SAME cell steps one layer down.
  const selectCellRef = useRef<string | null>(null)
  const selectCycleIndexRef = useRef(0)

  // 2D pan/zoom only for orthographic modes. Self-managed 3D plugins
  // (default, free3d, 3DMesh) own OrbitControls on their canvas — keep this list in sync.
  const is2D = !isOrbit3dView(viewMode)
  // Painting is enabled only in billboard + asset mode with a chosen baked layer.
  const editPaintable = is2D && editMode && viewMode === 'topBillboard' && drawMode === 'asset' && !!activeBakedLayerKey
  // SELECT is a read-only query (attribute a click → layer); it needs neither a
  // chosen baked layer nor asset drawMode, only the billboard view in edit mode.
  const editSelectable = is2D && editMode && viewMode === 'topBillboard' && editTool === 'select'

  function cellKey(c: { x: number; y: number; z: number }): string {
    return `${c.x},${c.y},${c.z}`
  }

  function instanceIdOf(cell: { state?: Record<string, unknown> }): string | null {
    const id = cell.state?.instanceId
    return typeof id === 'string' && id.length > 0 ? id : null
  }

  // tile vs object: a paint asset is a "tile" (autotile rule applies) iff its
  // alias carries a tileType in the loaded aliasMetas; otherwise it's an object.
  const resolveAssetType = useCallback((asset: PaintAsset): string => {
    const meta = useRenderStore.getState().aliasMetas.find((m) => m.alias === asset.alias)
    return meta?.tileType ? 'tile' : 'object'
  }, [])

  function isTileAsset(meta: AliasMeta | undefined): boolean {
    return !!meta?.tileType
  }

  function makeInstanceId(assetName: string, origin: { x: number; y: number; z: number }): string {
    return `obj_${assetName}_${origin.x}_${origin.y}_${origin.z}_${Date.now().toString(36)}`
  }

  // CSS px + active z layer → world voxel, using the active plugin's edit mapping.
  // Billboard mode maps the cursor to the target voxel's front/bottom face.
  const cellAt = useCallback((clientX: number, clientY: number): { x: number; y: number; z: number } | null => {
    const el = containerRef.current
    const handle = internalRef.current
    if (!el || !handle?.screenToEditCell) return null
    const rect = el.getBoundingClientRect()
    return handle.screenToEditCell(clientX - rect.left, clientY - rect.top, editZ)
  }, [editZ])

  const cellAtPaintAsset = useCallback((clientX: number, clientY: number, asset: PaintAsset | null): { x: number; y: number; z: number } | null => {
    const cell = cellAt(clientX, clientY)
    if (!cell || !asset || resolveAssetType(asset) !== 'tile') return cell
    return { ...cell, y: cell.y + 1 }
  }, [cellAt, resolveAssetType])

  const cellAtCurrentPaintAsset = useCallback((clientX: number, clientY: number): { x: number; y: number; z: number } | null => {
    return cellAtPaintAsset(clientX, clientY, readPaintAsset())
  }, [cellAtPaintAsset])

  const hoverCellAt = useCallback((clientX: number, clientY: number): { x: number; y: number; z: number } | null => {
    return editTool === 'paint' ? cellAtCurrentPaintAsset(clientX, clientY) : cellAt(clientX, clientY)
  }, [cellAt, cellAtCurrentPaintAsset, editTool])

  // Resolve the layer this asset writes into. A layer may be empty/unbound or
  // already bound to the same asset; a mismatch must be confirmed by the user.
  const resolveTargetSync = useCallback((asset: { name: string; alias?: string }): string | null => {
    const activeKey = useRenderStore.getState().activeBakedLayerKey
    if (!activeKey) return null
    const baked = useRenderStore.getState().bakedLayers
    const active = baked[activeKey]
    if (!active) return null
    const decision = resolvePaintTargetSync({
      activeKey,
      activeAssetName: active.assetName,
      activeAssetAlias: active.assetAlias,
      paintAssetName: asset.name,
      paintAssetAlias: asset.alias,
    })
    return decision.kind === 'use-active' ? decision.key : null
  }, [])

  const requestTargetKey = useCallback(
    async (asset: { name: string; type?: string; alias?: string }): Promise<string | null> => {
      const sync = resolveTargetSync(asset)
      if (sync) return sync
      const activeKey = useRenderStore.getState().activeBakedLayerKey
      if (!activeKey) return null
      const active = useRenderStore.getState().bakedLayers[activeKey]
      if (!active || !onPaintTargetMismatch) return null
      return onPaintTargetMismatch({
        activeKey,
        activeLayer: {
          nodePath: active.nodePath,
          nodeName: active.nodeName,
          assetName: active.assetName,
          assetAlias: active.assetAlias,
          assetType: active.assetType,
        },
        asset: asset as PaintAsset & { type?: string },
      })
    },
    [resolveTargetSync, onPaintTargetMismatch],
  )

  const trackPersist = useCallback((persist: Promise<void>): Promise<void> => {
    const tracked = persist.finally(() => {
      pendingPersistsRef.current.delete(tracked)
    })
    pendingPersistsRef.current.add(tracked)
    return tracked
  }, [])

  const seedPaintGestureCellKeys = useCallback((key: string) => {
    const layer = useRenderStore.getState().bakedLayers[key]
    paintGestureCellKeysRef.current = new Set(layer ? layer.cells.map(cellKey) : [])
    paintGestureCellKeysTargetRef.current = key
    paintGestureSeedLayerRef.current = layer ?? null
  }, [])

  const flushPendingPaintCells = useCallback(() => {
    const key = pendingPaintTargetKeyRef.current
    const pending = Array.from(pendingPaintCellsRef.current.values())
    pendingPaintCellsRef.current.clear()
    pendingPaintTargetKeyRef.current = null
    paintFrameRef.current = null
    if (!key || pending.length === 0) return
    let changed = false
    // What the store actually accepted, so we can reconcile the optimistic gesture
    // dedupe set with the store truth afterwards. A pending cell that does NOT end
    // up in layer.cells (true duplicate, no-op/rejected write) must NOT stay marked
    // "painted" in the gesture set — otherwise enqueuePaintCell drops it forever and
    // the stroke goes dead. The set is therefore a pure optimistic HINT here.
    let appendedCount = 0
    try {
      paintBakedCells(key, (prevCells) => {
        // O(k) fast path: enqueuePaintCell already de-duped each pending cell against
        // the gesture set (seeded once per stroke), so the pending batch is normally
        // all-novel — append it without rebuilding an O(N) Set from prevCells. We
        // STILL verify nothing duplicates the store tail cheaply: pending cells are
        // few; check each only against the (small) set of keys we're appending plus
        // a tail guard. The authoritative reconciliation happens after the write via
        // appendedCount, so a drifted set can never cause a permanent drop.
        if (paintGestureCellKeysTargetRef.current === key) {
          const cells = [...prevCells, ...pending]
          changed = cells.length !== prevCells.length
          appendedCount = cells.length - prevCells.length
          return changed ? cells : prevCells
        }
        // Fallback (target mismatch, e.g. an immediate paint before seeding): dedupe
        // against a fresh Set so we never double-insert.
        const have = new Set(prevCells.map(cellKey))
        const cells = [...prevCells]
        for (const cell of pending) {
          const ck = cellKey(cell)
          if (have.has(ck)) continue
          have.add(ck)
          cells.push(cell)
        }
        changed = cells.length !== prevCells.length
        appendedCount = cells.length - prevCells.length
        return changed ? cells : prevCells
      })
    } catch (err) {
      // A failed commit must not wedge the stroke: the refs above are already
      // cleared (so the next enqueue can schedule a fresh flush). Forget the pending
      // cells in the gesture set so they can be re-painted on the next move.
      for (const cell of pending) paintGestureCellKeysRef.current.delete(cellKey(cell))
      // eslint-disable-next-line no-console
      console.error('flushPendingPaintCells: paintBakedCells threw', err)
      return
    }
    // Reconcile: if the store accepted FEWER cells than we optimistically staged
    // (a no-op/rejected/duplicate write), the gesture set now over-claims. Rather
    // than guess which specific pending cells were dropped, re-seed the set from the
    // store's actual layer.cells truth (O(N) only on this RARE mismatch path — the
    // happy path appends all pending and skips this entirely, staying O(k)). This
    // guarantees the dedupe set can never permanently diverge from the store.
    if (appendedCount < pending.length && paintGestureCellKeysTargetRef.current === key) {
      const layer = useRenderStore.getState().bakedLayers[key]
      paintGestureCellKeysRef.current = new Set(layer ? layer.cells.map(cellKey) : [])
      paintGestureSeedLayerRef.current = layer ?? null
    } else if (paintGestureCellKeysTargetRef.current === key) {
      // Happy path: the store committed a NEW layer object holding exactly
      // prevCells + pending (which the gesture set already mirrors). Point the seed
      // ref at that new object so the next enqueue's O(1) ref check passes and we
      // DON'T needlessly re-seed (which would be O(N) per paint). Cheap pointer set.
      paintGestureSeedLayerRef.current = useRenderStore.getState().bakedLayers[key] ?? null
    }
    if (changed) {
      paintStrokeChangedRef.current = true
      markStage('store commit (paintBakedCells)')
      markPaintStart()
    }
  }, [paintBakedCells])

  const enqueuePaintCell = useCallback((key: string, cell: { x: number; y: number; z: number }, options: { immediate?: boolean } = {}) => {
    if (pendingPaintTargetKeyRef.current && pendingPaintTargetKeyRef.current !== key) flushPendingPaintCells()
    const layer = useRenderStore.getState().bakedLayers[key]
    if (!layer) return
    // Re-seed the dedupe set if it targets another layer OR the store replaced this
    // layer object since we seeded (async refetch / undo / external edit). Trusting
    // a set seeded from a now-stale layer can permanently drop a paint whose cell
    // the store no longer holds (the mid-stroke dead-stop). The layer-ref check is
    // O(1); a re-seed is O(cells) only on the rare turnover, never per cell.
    if (paintGestureCellKeysTargetRef.current !== key || paintGestureSeedLayerRef.current !== layer) {
      seedPaintGestureCellKeys(key)
    }
    const ck = cellKey(cell)
    if (paintGestureCellKeysRef.current.has(ck)) return
    paintGestureCellKeysRef.current.add(ck)
    pendingPaintTargetKeyRef.current = key
    pendingPaintCellsRef.current.set(ck, cell)
    if (options.immediate) {
      flushPendingPaintCells()
      return
    }
    if (paintFrameRef.current !== null) return
    if (typeof requestAnimationFrame === 'function') {
      markStage('enqueue: awaiting rAF flush')
      const frame = requestAnimationFrame(() => {
        if (paintFrameRef.current !== frame) return
        markStage('rAF fired → flush')
        flushPendingPaintCells()
      })
      paintFrameRef.current = frame
    } else {
      flushPendingPaintCells()
    }
  }, [flushPendingPaintCells, seedPaintGestureCellKeys])

  const persistLayerCells = useCallback((key: string, asset?: { name: string; type?: string; alias?: string }): Promise<void> | null => {
    if (!key) return null
    const layer = useRenderStore.getState().bakedLayers[key]
    if (!layer) return null
    const cells = layer.cells.map((c) => ({
      x: c.x,
      y: c.y,
      z: c.z,
      ...(c.token ? { token: c.token } : asset ? { token: asset.name } : {}),
      ...(c.state ? { state: c.state } : {}),
    }))
    markBakedLayerPersisting(key)
    const persist = bakedApi
      .setCells(key.slice('baked:'.length), cells, asset)
      .then(async () => {
        // Notify the host (plugin contract) that a baked edit landed. We do NOT
        // eagerly refresh here: any host-driven refreshBakedLayers() now defers
        // while this key is still marked dirty/persisting, so it can't clobber
        // optimistic local cells mid-stroke.
        try {
          await onBakedEditCommitted?.()
        } finally {
          markBakedLayerPersistSettled(key, true)
        }
        // Reconcile only AFTER the dirty flag clears: if an external baked:changed
        // (or a deferred host refresh) arrived during the persist, replay it now
        // against fresh server state. Forced because local edits are drained.
        if (consumeDeferredBakedLayersRefresh()) await refreshBakedLayers({ deferIfLocalPending: false, mode: 'full' })
      })
      .catch((e) => {
        markBakedLayerPersistSettled(key, false)
        console.warn('[baked] edit persist failed', e)
      })
    return trackPersist(persist)
  }, [onBakedEditCommitted, trackPersist])

  // Persist the active target's full cell set once per completed paint stroke.
  const flushPersist = useCallback((): Promise<void> | null => {
    flushPendingPaintCells()
    if (persistTimerRef.current !== undefined) {
      clearTimeout(persistTimerRef.current)
      persistTimerRef.current = undefined
    }
    const key = targetKeyRef.current
    if (!key) return null
    if (!paintStrokeChangedRef.current) return null
    const pa = readPaintAsset()
    return persistLayerCells(key, pa ? { name: pa.name, type: resolveAssetType(pa), alias: pa.alias } : undefined)
  }, [flushPendingPaintCells, persistLayerCells, resolveAssetType])

  const awaitPaintPersists = useCallback(async () => {
    const flushed = flushPersist()
    if (flushed) await flushed
    const pending = Array.from(pendingPersistsRef.current)
    if (pending.length > 0) await Promise.allSettled(pending)
  }, [flushPersist])

  // Publish the drain primitive to the owning surface so STRUCTURAL baked
  // mutations (add/move/remove/bake) can flush + await in-flight paint persists
  // BEFORE forcing a refresh — otherwise the paint-protection defer
  // (deferIfLocalPending) swallows their refresh and the new layer / new order
  // only appears after a manual reload.
  useEffect(() => {
    if (!paintPersistsRef) return
    paintPersistsRef.current = awaitPaintPersists
    return () => { paintPersistsRef.current = null }
  }, [paintPersistsRef, awaitPaintPersists])

  const eraseFreeAt = useCallback((clientX: number, clientY: number) => {
    const key = useRenderStore.getState().activeBakedLayerKey
    if (!key) return false
    const cell = cellAt(clientX, clientY)
    if (!cell) return false
    const layer = useRenderStore.getState().bakedLayers[key]
    if (!layer) return false
    const matched = layer.cells.filter((c) => c.x === cell.x && c.y === cell.y && c.z === cell.z)
    if (matched.length === 0) return false
    const touchedInstances = new Set(matched.map(instanceIdOf).filter((id): id is string => !!id))
    const touchedCells = new Set(matched.filter((c) => !instanceIdOf(c)).map(cellKey))
    const cells = layer.cells.filter((c) => {
      const instanceId = instanceIdOf(c)
      if (instanceId && touchedInstances.has(instanceId)) return false
      if (!instanceId && touchedCells.has(cellKey(c))) return false
      return true
    })
    if (cells.length === layer.cells.length) return false
    paintBakedCells(key, cells)
    persistLayerCells(key, layer.assetName ? { name: layer.assetName, type: layer.assetType, alias: layer.assetAlias } : undefined)
    return true
  }, [cellAt, paintBakedCells, persistLayerCells])

  const eraseBox = useCallback((box: { x0: number; y0: number; x1: number; y1: number; z: number }) => {
    const key = useRenderStore.getState().activeBakedLayerKey
    if (!key) return
    const layer = useRenderStore.getState().bakedLayers[key]
    if (!layer) return
    const [xlo, xhi] = [Math.min(box.x0, box.x1), Math.max(box.x0, box.x1)]
    const [ylo, yhi] = [Math.min(box.y0, box.y1), Math.max(box.y0, box.y1)]
    const touched = layer.cells.filter((c) => c.z === box.z && c.x >= xlo && c.x <= xhi && c.y >= ylo && c.y <= yhi)
    if (touched.length === 0) return
    const touchedInstances = new Set(touched.map(instanceIdOf).filter((id): id is string => !!id))
    const touchedCells = new Set(touched.filter((c) => !instanceIdOf(c)).map(cellKey))
    const cells = layer.cells.filter((c) => {
      const instanceId = instanceIdOf(c)
      if (instanceId && touchedInstances.has(instanceId)) return false
      if (!instanceId && touchedCells.has(cellKey(c))) return false
      return true
    })
    if (cells.length === layer.cells.length) return
    paintBakedCells(key, cells)
    persistLayerCells(key, layer.assetName ? { name: layer.assetName, type: layer.assetType, alias: layer.assetAlias } : undefined)
  }, [paintBakedCells, persistLayerCells])

  const eyedropAt = useCallback((clientX: number, clientY: number) => {
    const cell = cellAt(clientX, clientY)
    if (!cell) return
    const state = useRenderStore.getState()
    const activeKey = state.activeBakedLayerKey
    const candidates = [
      ...(activeKey && state.bakedLayers[activeKey] ? [state.bakedLayers[activeKey]] : []),
      ...Object.values(state.bakedLayers)
        .filter((layer) => layer.visible && layer.key !== activeKey)
        .sort((a, b) => b.value - a.value),
    ]
    for (const layer of candidates) {
      const hit = layer.cells.find((c) => c.x === cell.x && c.y === cell.y && c.z === cell.z)
      if (!hit) continue
      const attrAlias = typeof layer.attributes?.asset_alias === 'string' ? layer.attributes.asset_alias : undefined
      const alias = layer.assetAlias ?? attrAlias ?? hit.token ?? layer.assetName
      const name = layer.assetName || hit.token || alias
      if (!alias || !name) return
      writePaintAsset({
        alias,
        name,
        type: layer.assetType === 'tile' ? 'tile' : 'asset',
      })
      return
    }
  }, [cellAt])

  // SELECT tool: attribute the clicked screen pixel to the layer drawn there.
  // First click on a (new) cell selects the top-most layer; clicking the SAME
  // cell again cycles to progressively lower layers/objects beneath, wrapping at
  // the bottom back to the top. Publishes the resolved layer (→ left panel via
  // selectedLayerBus) + the scene voxel(s) to highlight (→ overlay).
  const selectAt = useCallback((clientX: number, clientY: number) => {
    const el = containerRef.current
    const handle = internalRef.current
    if (!el || !handle?.voxelStackAtScreen) return
    const rect = el.getBoundingClientRect()
    const stack = handle.voxelStackAtScreen(clientX - rect.left, clientY - rect.top)
    if (stack.length === 0) {
      // Empty space → clear selection (both layer + scene highlight).
      selectCellRef.current = null
      selectCycleIndexRef.current = 0
      setSelectedLayer(null)
      setVoxelSelection(null)
      return
    }
    const state = useRenderStore.getState()
    const sources: CellQuerySources = {
      layers: state.layers,
      bakedLayers: state.bakedLayers,
      orderedKeys: mergeRenderableVoxelLayerKeys(
        Object.keys(state.layers),
        orderBakedKeysForRender(Object.keys(state.bakedLayers)),
      ),
    }
    const candidates = resolveSelectionCandidates(stack, sources)
    if (candidates.length === 0) {
      setSelectedLayer(null)
      setVoxelSelection(null)
      return
    }
    // Anchor the cycle to the top-most hit voxel's screen cell so re-clicking the
    // same spot (even sub-pixel jitter resolving to the same cell) steps deeper.
    const topVoxel = stack[0].voxel
    const cellKeyStr = `${topVoxel.x},${topVoxel.y - topVoxel.z - 1}`
    const step = stepSelectCycle(
      { cell: selectCellRef.current, index: selectCycleIndexRef.current },
      cellKeyStr,
      candidates.length,
    )
    selectCellRef.current = step.next.cell
    selectCycleIndexRef.current = step.next.index
    const chosen = candidates[step.index]
    setSelectedLayer(chosen.layerKey)
    setVoxelSelection({ layerKey: chosen.layerKey, voxels: chosen.voxels })
  }, [setSelectedLayer, setVoxelSelection])

  // Add the voxel under the cursor to the resolved target layer (optimistic).
  const paintAt = useCallback(
    (clientX: number, clientY: number) => {
      const key = targetKeyRef.current
      if (!key) return
      const pa = readPaintAsset()
      const cell = cellAtPaintAsset(clientX, clientY, pa)
      if (!cell) return
      const layer = useRenderStore.getState().bakedLayers[key]
      if (!layer) return
      const meta = pa ? useRenderStore.getState().aliasMetas.find((m) => m.alias === pa.alias) : undefined
      if (pa && meta && !isTileAsset(meta)) {
        const placement = resolveObjectPlacement(cell, meta, pa.name, (o) => makeInstanceId(pa.name, o))
        const { origin, footprint, columnHeight, cells: nextCells } = placement
        const dragKey = `${pa.name}:${origin.x},${origin.y},${origin.z}:${footprint.width}x${footprint.height}:${columnHeight}`
        if (dragKey === lastPaintCellRef.current) return
        lastPaintCellRef.current = dragKey
        const occupied = new Set(layer.cells.map((c) => `${c.x},${c.y},${c.z}`))
        if (nextCells.some((next) => occupied.has(`${next.x},${next.y},${next.z}`))) return
        paintStrokeChangedRef.current = true
        paintBakedCells(key, [...layer.cells, ...nextCells])
        return
      }
      const ck = `${cell.x},${cell.y},${cell.z}`
      if (ck === lastPaintCellRef.current) return // skip repeats within a drag
      lastPaintCellRef.current = ck
      markStage('paintAt: cell resolved, enqueue')
      const immediate = !paintStrokeChangedRef.current && pendingPaintCellsRef.current.size === 0
      enqueuePaintCell(key, cell, { immediate })
    },
    [cellAtPaintAsset, enqueuePaintCell, paintBakedCells],
  )

  // Commit a filled rectangle (box-select) into the resolved target in one write.
  const commitBoxToKey = useCallback(
    (key: string, asset: { name: string; type?: string; alias?: string }, box: { x0: number; y0: number; x1: number; y1: number; z: number }) => {
      setActivePaintTarget(key)
      bindBakedLayerAsset(key, asset.name, asset.type, asset.alias)
      if (asset.type === 'object') {
        // Box select for an object asset = batch-place instances tiled across the
        // dragged rectangle, stepping by the object's footprint so neighbours sit
        // edge-to-edge. Skips any tile already occupied (no overlap / clobber).
        const meta = asset.alias ? useRenderStore.getState().aliasMetas.find((m) => m.alias === asset.alias) : undefined
        if (!meta) return
        const layer0 = useRenderStore.getState().bakedLayers[key]
        if (!layer0) return
        const z = box.z
        const [xlo, xhi] = [Math.min(box.x0, box.x1), Math.max(box.x0, box.x1)]
        const [ylo, yhi] = [Math.min(box.y0, box.y1), Math.max(box.y0, box.y1)]
        const occupied = new Set(layer0.cells.map((c) => `${c.x},${c.y},${c.z}`))
        const added: typeof layer0.cells = []
        // Probe one placement to learn the footprint stride.
        const probe = resolveObjectPlacement({ x: xlo, y: yhi, z }, meta, asset.name, (o) => makeInstanceId(asset.name, o))
        const stepX = Math.max(1, probe.footprint.width)
        const stepY = Math.max(1, probe.footprint.height)
        for (let y = yhi; y >= ylo; y -= stepY) {
          for (let x = xlo; x <= xhi; x += stepX) {
            const placement = resolveObjectPlacement({ x, y, z }, meta, asset.name, (o) => makeInstanceId(asset.name, o))
            if (placement.cells.some((c) => occupied.has(`${c.x},${c.y},${c.z}`))) continue
            for (const c of placement.cells) occupied.add(`${c.x},${c.y},${c.z}`)
            added.push(...placement.cells)
          }
        }
        if (added.length === 0) return
        paintBakedCells(key, [...layer0.cells, ...added])
        const pa = readPaintAsset()
        void persistLayerCells(key, pa ? { name: pa.name, type: asset.type, alias: pa.alias } : undefined)
        return
      }
      const layer = useRenderStore.getState().bakedLayers[key]
      if (!layer) return
      const z = box.z
      const have = new Set(layer.cells.filter((c) => c.z === z).map((c) => `${c.x},${c.y}`))
      const cells = [...layer.cells]
      const [xlo, xhi] = [Math.min(box.x0, box.x1), Math.max(box.x0, box.x1)]
      const [ylo, yhi] = [Math.min(box.y0, box.y1), Math.max(box.y0, box.y1)]
      for (let x = xlo; x <= xhi; x++) {
        for (let y = ylo; y <= yhi; y++) {
          const k = `${x},${y}`
          if (!have.has(k)) {
            have.add(k)
            cells.push({ x, y, z })
          }
        }
      }
      paintBakedCells(key, cells)
      const pa = readPaintAsset()
      void persistLayerCells(key, pa ? { name: pa.name, type: asset.type, alias: pa.alias } : undefined)
    },
    [paintBakedCells, setActivePaintTarget, bindBakedLayerAsset, persistLayerCells],
  )

  const commitBox = useCallback(
    (asset: { name: string; type?: string; alias?: string }, box: { x0: number; y0: number; x1: number; y1: number; z: number }) => {
      const sync = resolveTargetSync(asset)
      if (sync) {
        commitBoxToKey(sync, asset, box)
        return
      }
      void requestTargetKey(asset).then((key) => {
        if (!key) return
        commitBoxToKey(key, asset, box)
      })
    },
    [commitBoxToKey, requestTargetKey, resolveTargetSync],
  )

  const endPaint = useCallback(() => {
    if (!paintingRef.current) return
    paintingRef.current = false
    lastPaintCellRef.current = null
    flushPersist()
    paintGestureCellKeysRef.current.clear()
    paintGestureCellKeysTargetRef.current = null
    paintStrokeChangedRef.current = false
  }, [flushPersist])

  const endBox = useCallback(() => {
    if (!boxingRef.current) return
    boxingRef.current = false
    const anchor = boxAnchorRef.current
    boxAnchorRef.current = null
    const box = useRenderStore.getState().editBox
    setEditBox(null)
    if (!anchor || !box) return
    if (editTool === 'erase') {
      eraseBox(box)
      return
    }
    const pa = readPaintAsset()
    if (!pa) return
    void commitBox({ name: pa.name, type: resolveAssetType(pa), alias: pa.alias }, box)
  }, [commitBox, editTool, eraseBox, resolveAssetType, setEditBox])

  const flushPersistRef = useRef(flushPersist)
  useEffect(() => {
    flushPersistRef.current = flushPersist
  }, [flushPersist])

  useEffect(() => () => {
    if (persistTimerRef.current !== undefined) clearTimeout(persistTimerRef.current)
    flushPersistRef.current()
    paintFrameRef.current = null
  }, [])

  useEffect(() => {
    if (!editPaintable && !editSelectable) return
    const onKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      if (typeof target?.closest === 'function' && target.closest('input, textarea, select, [contenteditable="true"]')) return
      const key = e.key.toLowerCase()
      const mod = e.ctrlKey || e.metaKey
      if (!mod) {
        if (key === 'b') useRenderStore.getState().setEditTool('paint')
        else if (key === 'e') useRenderStore.getState().setEditTool('erase')
        else if (key === 'i') useRenderStore.getState().setEditTool('eyedropper')
        else if (key === 's') useRenderStore.getState().setEditTool('select')
        return
      }
      const redo = key === 'y' || (e.metaKey && e.shiftKey && key === 'z')
      const undo = key === 'z' && !redo
      if (!undo && !redo) return
      e.preventDefault()
      void (async () => {
        try {
          await awaitPaintPersists()
          if (redo) await bakedApi.redo()
          else await bakedApi.undo()
          // Local edits are fully drained here; force a refresh so the undone/
          // redone server state replaces the optimistic cells (this is what makes
          // "undo removes painted content" actually take effect on the canvas).
          await refreshBakedLayers({ deferIfLocalPending: false, mode: 'full' })
          await onBakedEditCommitted?.()
        } catch (err) {
          console.warn(`[baked] ${redo ? 'redo' : 'undo'} failed`, err)
        }
      })()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [editPaintable, editSelectable, onBakedEditCommitted, awaitPaintPersists])

  // Leaving edit mode (or losing paintability) clears transient edit overlays.
  useEffect(() => {
    if (!editPaintable) {
      flushPersist()
      setEditHoverCell(null)
      setEditBox(null)
      paintingRef.current = false
      boxingRef.current = false
      paintGestureCellKeysRef.current.clear()
      paintGestureCellKeysTargetRef.current = null
      paintStrokeChangedRef.current = false
    }
  }, [editPaintable, setEditHoverCell, setEditBox])

  // Callback ref: keep the internal ref authoritative and mirror into the
  // parent-provided ref when present.
  const setHandle = useCallback(
    (h: PluginHandle | null) => {
      internalRef.current = h
      if (handleRef) handleRef.current = h
    },
    [handleRef],
  )

  // Wheel zoom centered on the cursor. Native non-passive listener so we can
  // preventDefault (React's onWheel is passive and cannot block page scroll).
  useEffect(() => {
    const el = containerRef.current
    if (!el || !is2D) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const next = zoomViewportAtPoint(useRenderStore.getState().viewport2d, {
        mouseX: e.clientX - rect.left,
        mouseY: e.clientY - rect.top,
        cx: rect.width / 2,
        cy: rect.height / 2,
        deltaY: e.deltaY,
      })
      if (next) setViewport2d(next)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [is2D, setViewport2d])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => timeHandler('mousedown', () => {
      if (!is2D) return
      // SELECT tool: left-click attributes the click to a layer (no painting).
      if (editSelectable && e.button === 0) {
        selectAt(e.clientX, e.clientY)
        return
      }
      // Edit mode: left button paints/boxes; middle button still pans.
      if (editPaintable && e.button === 0) {
        if (editTool === 'eyedropper') {
          eyedropAt(e.clientX, e.clientY)
          return
        }
        if (editTool === 'erase') {
          if (brushMode === 'box') {
            const cell = cellAt(e.clientX, e.clientY)
            if (!cell) return
            boxingRef.current = true
            boxAnchorRef.current = cell
            setEditBox({ x0: cell.x, y0: cell.y, x1: cell.x, y1: cell.y, z: cell.z })
            return
          }
          void eraseFreeAt(e.clientX, e.clientY)
          return
        }
        const pa = readPaintAsset()
        if (!pa) return
        const asset = { name: pa.name, type: resolveAssetType(pa), alias: pa.alias }
        if (brushMode === 'box') {
          const cell = cellAtPaintAsset(e.clientX, e.clientY, pa)
          if (!cell) return
          boxingRef.current = true
          boxAnchorRef.current = cell
          setEditBox({ x0: cell.x, y0: cell.y, x1: cell.x, y1: cell.y, z: cell.z })
          return
        }
        // Free brush: resolve target (sync fast-path, else create), then paint.
        beginStageTimeline('mousedown(free-brush)')
        paintingRef.current = true
        lastPaintCellRef.current = null
        targetKeyRef.current = null
        paintGestureCellKeysRef.current.clear()
        paintGestureCellKeysTargetRef.current = null
        paintStrokeChangedRef.current = false
        const sync = resolveTargetSync(asset)
        markStage('resolveTargetSync')
        if (sync) {
          targetKeyRef.current = sync
          seedPaintGestureCellKeys(sync)
          setActivePaintTarget(sync)
          bindBakedLayerAsset(sync, asset.name, asset.type, asset.alias) // so the sprite resolves now
          markStage('bindBakedLayerAsset(sync)')
          paintAt(e.clientX, e.clientY)
        } else {
          const { clientX, clientY } = e
          markStage('requestTargetKey(async)…')
          void requestTargetKey(asset).then((key) => {
            markStage('requestTargetKey resolved')
            if (!key || !paintingRef.current) return
            targetKeyRef.current = key
            seedPaintGestureCellKeys(key)
            setActivePaintTarget(key)
            bindBakedLayerAsset(key, asset.name, asset.type, asset.alias)
            markStage('bindBakedLayerAsset(async)')
            paintAt(clientX, clientY)
          })
        }
        return
      }
      // Pan: left button normally, or middle button when left is busy painting.
      if (e.button !== 0 && e.button !== 1) return
      if (e.button === 1) e.preventDefault()
      isPanningRef.current = true
      setIsPanning(true)
      panLastRef.current = { x: Math.round(e.clientX), y: Math.round(e.clientY) }
    }),
    [is2D, editSelectable, selectAt, editPaintable, editTool, eyedropAt, brushMode, cellAt, cellAtPaintAsset, setEditBox, eraseFreeAt, resolveAssetType, resolveTargetSync, seedPaintGestureCellKeys, setActivePaintTarget, bindBakedLayerAsset, paintAt, requestTargetKey],
  )

  // Imperative cursor-cell readout: writes the DOM text directly, no React state,
  // so per-pixel mousemove tracking never re-renders this component or the plugin.
  const writeCoords = useCallback((cell: { col: number; row: number } | null) => {
    const prev = mouseCellRef.current
    if (prev === cell || (prev && cell && prev.col === cell.col && prev.row === cell.row)) return
    mouseCellRef.current = cell
    const el = coordsElRef.current
    if (el) el.textContent = cell ? `${cell.col}, ${cell.row}` : '—'
  }, [])

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => timeHandler('mousemove', () => {
      // Box-select drag: stretch the rubber-band to the current cell.
      if (boxingRef.current) {
        const cell = editTool === 'erase' ? cellAt(e.clientX, e.clientY) : cellAtCurrentPaintAsset(e.clientX, e.clientY)
        const anchor = boxAnchorRef.current
        setEditHoverCell(cell)
        if (cell && anchor) setEditBox({ x0: anchor.x, y0: anchor.y, x1: cell.x, y1: cell.y, z: anchor.z })
        return
      }
      if (paintingRef.current) {
        setEditHoverCell(cellAtCurrentPaintAsset(e.clientX, e.clientY))
        paintAt(e.clientX, e.clientY)
        return
      }
      // Edit-mode hover: track the voxel under the cursor for ghost/projection feedback.
      if (editPaintable) {
        setEditHoverCell(hoverCellAt(e.clientX, e.clientY))
      }
      // Cursor-cell readout (only modes that implement screenToCell report a cell).
      const el = containerRef.current
      const handle = internalRef.current
      if (el && is2D && handle?.screenToCell) {
        const rect = el.getBoundingClientRect()
        writeCoords(handle.screenToCell(e.clientX - rect.left, e.clientY - rect.top))
      } else {
        writeCoords(null)
      }

      if (!isPanningRef.current) return
      const x = Math.round(e.clientX)
      const y = Math.round(e.clientY)
      const dx = x - panLastRef.current.x
      const dy = y - panLastRef.current.y
      if (dx === 0 && dy === 0) return
      panLastRef.current = { x, y }
      panViewport2d(dx, dy)
    }),
    [is2D, editPaintable, editTool, cellAt, cellAtCurrentPaintAsset, hoverCellAt, setEditBox, paintAt, setEditHoverCell, panViewport2d, writeCoords],
  )

  const endPan = useCallback(() => {
    isPanningRef.current = false
    setIsPanning(false)
  }, [])

  const handleMouseUp = useCallback(() => {
    endPan()
    endPaint()
    endBox()
  }, [endPan, endPaint, endBox])

  const handleMouseLeave = useCallback(() => {
    endPan()
    endPaint()
    endBox()
    writeCoords(null)
    setEditHoverCell(null)
  }, [endPan, endPaint, endBox, setEditHoverCell, writeCoords])

  if (!hasRenderPlugin(viewMode)) {
    return <div data-status="no-plugin">No renderer registered for mode: {viewMode}</div>
  }
  const plugin = getRenderPlugin(viewMode)!
  const Comp = plugin.Component
  const pct = Math.round(scale * 100)

  return (
    <div
      ref={containerRef}
      className="render-canvas-container"
      data-testid="render-canvas"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        cursor: editPaintable ? 'crosshair' : is2D ? (isPanning ? 'grabbing' : 'grab') : 'default',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Comp ref={setHandle} />
      {is2D && (
        <div className="render-canvas-coords" aria-hidden>
          <span
            ref={(el) => {
              coordsElRef.current = el
              if (el) {
                const c = mouseCellRef.current
                el.textContent = c ? `${c.col}, ${c.row}` : '—'
              }
            }}
          />
          {' | '}
          {pct}%
        </div>
      )}
    </div>
  )
}
