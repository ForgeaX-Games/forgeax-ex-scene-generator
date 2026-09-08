// 💡 mode-topBillboard:立面俯视(Pokémon GBA / RPG Maker 风格)
//
// Voxel 层 = 跨层 dedup + 3D 遮挡 cull + (y,z) painter sort + 一次烤进 master
//           OffscreenCanvas;compose 阶段 drawImage 一次完事。
//
// 视觉:每个 voxel 渲染两个方块(顶面 + 立面);z 抬升让"高的"在屏幕上往上挪,
// 模拟立体感。详见 framework/geometry/topBillboard.ts。
//
// 本 slice 只投影 voxel 层(SceneOutput);legacy 的 GridLayer 稠密 2D 路径在
// scene-generator 里没有数据源,整段 drop。editor 选中高亮 deferred 到 overlay
// canvas(见 drawOverlay),不写入 master bake,避免点击电池触发全量 rebuild。
// alias → rule + atlas,per-face pickFaceSprite 贴图(Stage-2c.2)。

import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useBakedLayer, useBakedLayerKeys, useVoxelLayer, useVoxelLayerKeys } from '../../framework/useLayer'
import { useLayerSurface } from '../../framework/useLayerSurface'
import type { Viewport2D } from '../../framework/useViewport'
import { useRenderStore, consumeLastPaintDelta } from '../../store'
import { voxelLayerCellSource, type CellSource } from '../../framework/cellSource'
import { mergeRenderableVoxelLayerKeys, orderBakedKeysForRender } from '../../framework/layerKeys'
import { registerRenderPlugin, type PluginHandle } from '../../framework/plugin'
import { SCREEN_CELL_SIZE, TEXTURE_PPU } from '../../framework/geometry/constants'
import { topMasterOrigin } from '../../framework/geometry/top'
import {
  billboardEditVoxelFromFrontFaceCell,
  billboardFrontFaceCellForVoxel,
  billboardObjectAnchorCanvasXY,
  billboardObjectFootprintPreviewIndexed,
  billboardProjectionFaceForVoxelIndexed,
  billboardTopFaceCellForVoxel,
  billboardVoxelStackAtScreenCell,
  buildColumnOccupancy,
  addCellsToColumnOccupancy,
  type ColumnOccupancy,
  type VoxelCellLite,
} from '../../framework/geometry/topBillboard'
import { subscribeToAssetReadiness, getOrLoadImage, getRegisteredAssetUrl } from '../../framework/asset/imageCache'
import { subscribeToRuleReadiness, getOrLoadRule } from '../../framework/asset/ruleCache'
import { readPaintAsset, subscribePaintAsset, type PaintAsset } from '../../../surfaces/library/paintAssetBus'
import { devicePixelRatio } from '../../framework/canvas2d'
import { computeCollisionFootprint, snapFootprintToBottomCenter } from '../../framework/geometry/objectPlacement'
import {
  buildVoxelMaster, makeStructuralLayerKey, makeAssetTokenKey,
  appendCellsToVoxelMaster, type AppendCell,
  type VoxelLayerInput, type VoxelMaster,
} from './buildVoxelMaster'
import { composeFrame, composeDirtyRect } from './compose'
import { markPaintDrawn, endStageTimeline, logComposeMs, logOccupancyMs, logRenderPhase } from '../../framework/bakePerf'
import './ModeTopBillboard.css'

// ── 顶层 Plugin Component ─────────────────────────────────────────────────

interface VoxelLayerEntry {
  source: CellSource
  layer: { nodeId: string; updatedAt: number; visible: boolean; nodePath: string }
  layerIdx: number
  /** scene attribute,Stage-2c.2 asset autotile 用 */
  assetName: string
  assetAlias?: string
  assetType?: string
}

// Re-exported from framework/layerKeys so existing tests + the SELECT-mode host
// attribution share ONE source of truth for baked render order.
export { orderBakedKeysForRender }

// ── Incremental-bake support: per-layer cell snapshot + additive diff ─────────
//
// The dominant paint cost was that every painted cell bumped a layer's updatedAt,
// which flowed into makeVoxelMasterCacheKey (it keys on source.version=updatedAt)
// and forced useLayerSurface to fully rebuild the master each stroke point.
//
// We split that key in two:
//   * a STRUCTURAL key (drawMode + layer set/order/visibility/selection + asset
//     readiness ticks + a rebuildEpoch) — only this drives full rebuilds.
//   * the per-cell CONTENT — diffed here. A purely additive delta (cells added,
//     none removed, no object sprites) is appended onto the existing master via
//     appendCellsToVoxelMaster (O(k)) and composed imperatively, never touching
//     the surface cache. Removals / object adds / non-incremental masters bump
//     rebuildEpoch instead, falling back to a correct full rebuild.

interface LayerCellSnapshot {
  /** world cell key `x,y,z` → the append-cell payload (for additive replay). */
  byKey: Map<string, AppendCell>
}

function snapshotOneLayer(input: VoxelLayerInput): LayerCellSnapshot {
  const byKey = new Map<string, AppendCell>()
  const ox = input.source.worldOffsetX
  const oy = input.source.worldOffsetY
  input.source.iterCells((c) => {
    const x = ox + c.col
    const y = oy + c.row
    const z = c.z ?? 0
    byKey.set(`${x},${y},${z}`, {
      x, y, z,
      value: c.value,
      layerIdx: input.layerIdx,
      isSelected: input.isSelected,
      isEditorSelected: input.isEditorSelected,
      isMultiValue: input.source.isMultiValue,
      ...(c.state ? { state: c.state } : {}),
    })
  })
  return { byKey }
}

/** Incremental snapshot: re-iterate ONLY layers whose source version changed
 *  (a single paint touches one layer's updatedAt), reusing the prior snapshot for
 *  all other layers. Avoids re-scanning every layer's cells on each paint when a
 *  scene has many layers. `cache` is mutated in place to track versions. */
function snapshotVoxelInputsIncremental(
  inputs: ReadonlyArray<VoxelLayerInput>,
  cache: Map<number, { version: number; snap: LayerCellSnapshot }>,
): Map<number, LayerCellSnapshot> {
  const out = new Map<number, LayerCellSnapshot>()
  const seen = new Set<number>()
  for (const input of inputs) {
    seen.add(input.layerIdx)
    const prev = cache.get(input.layerIdx)
    if (prev && prev.version === input.source.version) {
      out.set(input.layerIdx, prev.snap)
      continue
    }
    const snap = snapshotOneLayer(input)
    cache.set(input.layerIdx, { version: input.source.version, snap })
    out.set(input.layerIdx, snap)
  }
  for (const idx of cache.keys()) if (!seen.has(idx)) cache.delete(idx)
  return out
}

interface CellDiff {
  added: AppendCell[]
  /** true when any layer lost a cell, gained an object-instance cell, or the
   *  layer set itself changed shape — none of which are append-safe. */
  needsFullRebuild: boolean
}

function diffSnapshots(
  prev: Map<number, LayerCellSnapshot>,
  next: Map<number, LayerCellSnapshot>,
): CellDiff {
  const added: AppendCell[] = []
  // A changed layer set is structural — let the structural key handle it.
  if (prev.size !== next.size) return { added, needsFullRebuild: true }
  for (const [layerIdx, nextSnap] of next) {
    const prevSnap = prev.get(layerIdx)
    if (!prevSnap) return { added, needsFullRebuild: true }
    // Any removed cell can un-occlude / leave stale pixels → full rebuild.
    if (prevSnap.byKey.size > nextSnap.byKey.size) return { added, needsFullRebuild: true }
    for (const [key, cell] of nextSnap.byKey) {
      if (prevSnap.byKey.has(key)) continue
      // Object-instance cells have irregular sprites → not append-safe.
      const instanceId = cell.state && typeof cell.state.instanceId === 'string' ? cell.state.instanceId : ''
      if (instanceId.length > 0) return { added, needsFullRebuild: true }
      added.push(cell)
    }
    // Same size but a key disappeared (replaced) → treat as removal.
    if (prevSnap.byKey.size === nextSnap.byKey.size) {
      for (const key of prevSnap.byKey.keys()) {
        if (!nextSnap.byKey.has(key)) return { added, needsFullRebuild: true }
      }
    }
  }
  return { added, needsFullRebuild: false }
}

/** O(k) additive delta from the store's recorded paint suffix, bypassing the
 *  O(N) snapshot+diff. Returns null when the delta can't be used safely (no
 *  pure-append delta, can't match the painted layer, or a delta cell is an
 *  object-instance) so the caller falls back to the full snapshot/diff path.
 *  On success it also patches the per-layer snapshot cache + prev snapshot in
 *  place (adding only the new keys) so the next paint's bookkeeping stays correct
 *  without ever re-scanning the whole layer. */
function deltaToAppendCells(
  delta: { key: string; added: ReadonlyArray<import('../../types').Point3D>; version: number; pureAppend: boolean },
  inputs: ReadonlyArray<VoxelLayerInput>,
  prevSnap: Map<number, LayerCellSnapshot>,
  snapCache: Map<number, { version: number; snap: LayerCellSnapshot }>,
): AppendCell[] | null {
  if (!delta.pureAppend) return null
  // Find the input whose source was just bumped to this paint's version. A paint
  // touches exactly one layer's updatedAt, so the version uniquely identifies it.
  const input = inputs.find((i) => i.source.version === delta.version)
  if (!input) return null
  const snap = prevSnap.get(input.layerIdx)
  if (!snap) return null
  // All cells in a single-value voxel layer share layer.value; read it off an
  // existing snapshot cell. (In asset drawMode value doesn't pick the sprite, so
  // an empty-layer fallback of 1 is harmless.)
  let layerValue = 1
  for (const c of snap.byKey.values()) { layerValue = c.value; break }
  const added: AppendCell[] = []
  for (const c of delta.added) {
    const instanceId = c.state && typeof c.state.instanceId === 'string' ? c.state.instanceId : ''
    if (instanceId.length > 0) return null // object-instance → full rebuild
    const z = c.z ?? 0
    const key = `${c.x},${c.y},${z}`
    if (snap.byKey.has(key)) continue // already present (defensive)
    const cell: AppendCell = {
      x: c.x, y: c.y, z,
      value: layerValue,
      layerIdx: input.layerIdx,
      isSelected: input.isSelected,
      isEditorSelected: input.isEditorSelected,
      isMultiValue: input.source.isMultiValue,
      ...(c.state ? { state: c.state } : {}),
    }
    added.push(cell)
    snap.byKey.set(key, cell) // patch cache in place (O(k))
  }
  // Keep the per-layer version cache in sync so a later full snapshot reuses this.
  snapCache.set(input.layerIdx, { version: delta.version, snap })
  return added
}

/** Lightweight signature of all layers' content, so the append effect only runs
 *  when cells actually change (not on viewport/hover re-renders). */
function contentSignature(inputs: ReadonlyArray<VoxelLayerInput>): string {
  const parts: string[] = []
  for (const i of inputs) parts.push(`${i.layerIdx}@${i.source.version}`)
  return parts.join('|')
}

/** Grid extent covering a master's real bbox (≥1 so an empty canvas still has a
 *  stable grid anchor). Deliberately a plain function, not a memo: it must be
 *  recomputed fresh from whatever master a caller ACTUALLY has in hand (often
 *  `masterRef.current` read well after the render that captured a stale
 *  snapshot — see the `compose`/`drawOverlay` comments below) — a couple of
 *  integer ops, cheaper than the memo bookkeeping needed to "cache" it. */
function deriveGridExtent(master: VoxelMaster | null): { maxRows: number; maxCols: number } {
  let r = 0, c = 0
  if (master) {
    const { bbox } = master
    const vXmax = bbox.worldOffsetX + bbox.cols
    const vYmax = bbox.worldOffsetY + bbox.rows
    if (vXmax > c) c = vXmax
    if (vYmax > r) r = vYmax
  }
  return { maxRows: r || 1, maxCols: c || 1 }
}

/** Structural key: everything that requires a FULL master rebuild EXCEPT raw
 *  per-cell content (which the additive diff handles). Includes a rebuildEpoch
 *  the component bumps when a content change isn't append-safe.
 *
 *  `assetTokenKey` is the (expensive, O(aliases×regex)) asset-binding portion,
 *  passed in PRE-COMPUTED + memoized by the caller so a plain cell append does
 *  not re-resolve every layer against the alias library (~156ms at large pools).
 *  The cheap structural-layer part is regex-stripped of @version here so appends
 *  don't change it either. */
function makeStructuralKey(
  inputs: ReadonlyArray<VoxelLayerInput>,
  drawMode: import('../../types').DrawMode,
  assetTokenKey: string,
  rebuildEpoch: number,
): string {
  // The structural-layer part is `${drawMode}:layerKey@version/sel|…`; strip
  // `@version` so identical structure with different cells maps to the same key.
  const structural = makeStructuralLayerKey(inputs, drawMode).replace(/@\d+(?=\/)/g, '@_')
  return `${structural}${assetTokenKey}#e${rebuildEpoch}`
}

const ModeTopBillboardPlugin = forwardRef<PluginHandle, object>(function ModeTopBillboardPlugin(_, ref) {
  // [bake-perf] WHOLE render-phase accounting: time the body top→bottom and each
  // scene-wide computation, so the gap between markPaintStart and markPaintDrawn
  // is fully attributed (not one memo at a time). The segments + a Profiler
  // (around the returned subtree) are logged from a layout effect each render.
  const bodyT0 = performance.now()
  const renderSegRef = useRef<Array<[string, number]>>([])
  renderSegRef.current = []
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
  const drawMode = useRenderStore(s => s.drawMode)
  const aliasMetas = useRenderStore(s => s.aliasMetas)
  // Editor selection is NOT React-subscribed here — subscribing would re-render
  // this heavy plugin and rebuildVoxelMaster on every click (~700ms–2s). The
  // highlight is drawn imperatively in drawOverlay (same pattern as voxelSelection).
  const activeBakedLayerKey = useRenderStore(s => s.activeBakedLayerKey)
  const showGrid = useRenderStore(s => s.viewGuides.topBillboard)
  // Edit-mode overlay inputs (brush ghost + box-select rubber-band).
  const editMode = useRenderStore(s => s.editMode)
  // NOTE: editHoverCell / editBox are intentionally NOT render-subscribed here.
  // They change on every hovered-cell move; subscribing would re-render this
  // whole (heavy) plugin + re-run the master/overlay effects per move (~700ms).
  // Instead the overlay is driven imperatively via a transient store
  // subscription + rAF (see the overlay block below), reading their latest
  // values from getState() without triggering React renders.
  const [paintAsset, setPaintAsset] = useState<PaintAsset | null>(() => readPaintAsset())
  useEffect(() => {
    setPaintAsset(readPaintAsset())
    return subscribePaintAsset(setPaintAsset)
  }, [])
  // Viewport (pan/zoom) is intentionally NOT React-subscribed (no useViewport2D()
  // here). A wheel gesture bumps viewport2d on every tick; subscribing would
  // re-render this WHOLE heavy plugin per tick — every hook/memo re-evaluated
  // (even though none actually depend on viewport, the memoized ones only skip
  // their body, they still cost a dep-array comparison) plus React reconciling
  // every VoxelLayerSubscriber/BakedLayerSubscriber child — pure overhead when
  // all that's actually needed is "re-blit the already-baked master at a new
  // transform". Instead we track it in a ref and drive compose()/the overlay
  // directly from a store subscription (same imperative pattern already used
  // below for editHoverCell/editBox/voxelSelection).
  const viewportRef = useRef<Viewport2D>(useRenderStore.getState().viewport2d)

  // voxel 层数据表(整组送进 buildVoxelMaster)
  const voxelLayersRef = useRef<Map<string, VoxelLayerEntry>>(new Map())
  const [, forceCompose] = useState(0)
  const tickRef = useRef(0)
  const bumpTick = useCallback(() => {
    tickRef.current++
    forceCompose(t => t + 1)
  }, [])
  // Asset/rule readiness pulses bump a DEDICATED tick (not the generic layer tick)
  // so the memoized asset-token key only refreshes when an image/rule actually
  // finishes loading — NOT on every paint (which also bumps the layer tick).
  const assetTickRef = useRef(0)
  const bumpAssetTick = useCallback(() => {
    assetTickRef.current++
    forceCompose(t => t + 1)
  }, [])

  const onVoxelLayer = useCallback((key: string, entry: VoxelLayerEntry | null) => {
    if (entry) voxelLayersRef.current.set(key, entry)
    else voxelLayersRef.current.delete(key)
    bumpTick()
  }, [bumpTick])

  const voxelKeys = useVoxelLayerKeys()
  // Baked (graph-independent, editable) layers share the same render pipeline;
  // they render AFTER graph layers so hand-edits paint on top.
  const bakedKeys = useBakedLayerKeys()

  // voxel master inputs。graph 层在前、baked 层在后;layerIdx 按数组位置赋值
  // (painter sort / 上色用)。Active baked layer reuses the existing selected
  // color path so editable layer selection is visible on the canvas too.
  const voxelInputs = useMemo<VoxelLayerInput[]>(() => {
    const _t = performance.now()
    const arr: VoxelLayerInput[] = []
    // graph layers stay in their natural order (bottom); baked layers paint on
    // top in tree z-order (child-over-parent, upper-sibling-over-lower).
    for (const key of mergeRenderableVoxelLayerKeys(voxelKeys, orderBakedKeysForRender(bakedKeys))) {
      const entry = voxelLayersRef.current.get(key)
      if (!entry || !entry.layer.visible) continue
      arr.push({
        source: entry.source,
        layerIdx: arr.length,
        isSelected: key === activeBakedLayerKey,
        // Editor selection highlight is deferred to drawOverlay — baking it into
        // the master would bump structuralKey and trigger a full rebuild per click.
        isEditorSelected: false,
        assetName: entry.assetName,
        assetAlias: entry.assetAlias,
        assetType: entry.assetType,
        nodePath: entry.layer.nodePath,
      })
    }
    renderSegRef.current.push(['voxelInputs', performance.now() - _t])
    return arr
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voxelKeys, bakedKeys, activeBakedLayerKey, tickRef.current])

  // asset drawMode:订阅 image / rule readiness 脉冲 —— 异步资产加载完后 bumpTick
  // 触发 re-render,cacheKey 因 url@tick / rule@tick 变化而变,useLayerSurface 只重
  // build 用到该资产的 master。非 asset 模式不订阅。
  useEffect(() => {
    if (drawMode !== 'asset') return
    const unsubImg = subscribeToAssetReadiness(bumpAssetTick)
    const unsubRule = subscribeToRuleReadiness(bumpAssetTick)
    return () => { unsubImg(); unsubRule() }
  }, [drawMode, bumpAssetTick])

  // asset 匹配上下文:drawMode='asset' 时把 alias 池 + fuzzy 传给 build / cacheKey
  const assetCtx = useMemo(
    () => drawMode === 'asset'
      ? { aliases: aliasMetas, fuzzy: false, aliasesKey: `n=${aliasMetas.length}` }
      : undefined,
    [drawMode, aliasMetas],
  )

  // voxel master — incremental bake split:
  //   * structuralKey drives FULL rebuilds (layer set/order/visibility/selection,
  //     drawMode, asset readiness ticks, rebuildEpoch). Per-cell content is NOT
  //     in this key.
  //   * additive cell deltas are appended onto the cached master in place by the
  //     effect below (no surface-cache invalidation, no memo recompute).
  const rebuildEpochRef = useRef(0)
  // Set when the append effect schedules a full rebuild; the compose effect closes
  // the perf timeline once the rebuilt master is actually composited (visible).
  const pendingRebuildTimelineRef = useRef(false)

  // Cheap (O(layers), regex-free) signature of just the asset-relevant inputs:
  // per-layer asset binding + drawMode + alias-pool id + the asset/rule load tick.
  // It is INVARIANT under a plain cell append, so it lets us memoize the heavy
  // asset-token resolution below instead of re-running matchAssetEntry over the
  // (possibly large) alias pool for every layer on every paint.
  const assetBindingSig = useMemo(() => {
    if (drawMode !== 'asset') return `nonasset:${drawMode}`
    let s = `tick=${assetTickRef.current}|aliases=${assetCtx?.aliasesKey ?? ''}|fz=${assetCtx?.fuzzy ? 1 : 0}`
    for (const i of voxelInputs) s += `|${i.layerIdx}:${i.assetName}\u0001${i.assetAlias ?? ''}\u0001${i.assetType ?? ''}`
    return s
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawMode, assetCtx, voxelInputs, assetTickRef.current])

  // Expensive asset-token portion of the structural key — memoized on the cheap
  // binding signature so an append (which leaves assetBindingSig identical) does
  // ZERO O(aliases×regex) work. Recomputes only on asset rebind / mode switch /
  // alias-pool change / a load-tick pulse (all of which change assetBindingSig).
  const assetTokenKey = useMemo(() => {
    const _t = performance.now()
    const k = makeAssetTokenKey(voxelInputs, drawMode, assetCtx)
    renderSegRef.current.push(['assetTokenKey', performance.now() - _t])
    return k
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetBindingSig])

  const structuralKey = useMemo(
    () => {
      const _t = performance.now()
      const k = makeStructuralKey(voxelInputs, drawMode, assetTokenKey, rebuildEpochRef.current)
      renderSegRef.current.push(['structuralKey', performance.now() - _t])
      return k
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [voxelInputs, drawMode, assetTokenKey, tickRef.current, rebuildEpochRef.current],
  )
  const voxelMaster = useLayerSurface(
    voxelInputs.length === 0 ? undefined : structuralKey,
    () => {
      const _t = performance.now()
      const m = buildVoxelMaster(voxelInputs, {
        drawMode,
        aliases: assetCtx?.aliases,
        fuzzy: assetCtx?.fuzzy,
      })
      renderSegRef.current.push(['buildVoxelMaster(FULL)', performance.now() - _t])
      return m
    },
  )

  // masterRef mirrors the live master (with its up-to-date incremental snapshot)
  // for the imperative append path; prevSnapshotRef/builtKeyRef remember what was
  // last fully baked so the append effect only diffs genuine additive deltas.
  // snapCacheRef memoizes per-layer snapshots by source version so each paint only
  // re-scans the ONE layer it touched (not every layer's cells).
  const masterRef = useRef<VoxelMaster | null>(null)
  const prevSnapshotRef = useRef<Map<number, LayerCellSnapshot>>(new Map())
  const builtStructuralKeyRef = useRef<string | null>(null)
  const snapCacheRef = useRef<Map<number, { version: number; snap: LayerCellSnapshot }>>(new Map())
  if (voxelMaster !== masterRef.current && builtStructuralKeyRef.current !== structuralKey) {
    const _t = performance.now()
    // A full rebuild just happened (structural key changed): adopt it and reset
    // the additive baseline to the freshly-baked content.
    masterRef.current = voxelMaster
    prevSnapshotRef.current = snapshotVoxelInputsIncremental(voxelInputs, snapCacheRef.current)
    builtStructuralKeyRef.current = structuralKey
    renderSegRef.current.push(['adoptMaster+snapshot', performance.now() - _t])
  }

  // Lightweight content signature: changes only when cells change (not on
  // viewport/hover re-renders). Drives the additive append effect + occupied-cell
  // overlay cache below.
  const contentSig = useMemo(() => {
    const _t = performance.now()
    const s = contentSignature(voxelInputs)
    renderSegRef.current.push(['contentSig', performance.now() - _t])
    return s
  }, [voxelInputs])

  // O(1)-per-move overlay support: the brush ghost's projection/footprint preview
  // needs to find the closest lower voxel in a column (occlusion/support lookup).
  // Previously rebuilt by scanning ALL layers AND projecting via an O(N) linear
  // scan on EVERY mousemove. Now we build a column-indexed occupancy ONCE per
  // STRUCTURAL change; additive paints feed only their new cells into it (below),
  // so a single paint is O(k) here too — NOT an O(N=all-cells) rebuild per paint.
  //
  // CRITICAL: this memo must key on `structuralKey` ONLY, not `contentSig`.
  // contentSig changes on every painted cell (source.version bumps), so keying on
  // it rebuilt the entire 25k-cell occupancy each paint — the ~375ms that sat in
  // the React render phase between markPaintStart and markPaintDrawn.
  const occupancyCache = useMemo<ColumnOccupancy>(() => {
    const t0 = performance.now()
    const cells: VoxelCellLite[] = []
    for (const entry of voxelLayersRef.current.values()) {
      if (!entry.layer.visible) continue
      entry.source.iterCells((c) => {
        cells.push({
          x: entry.source.worldOffsetX + c.col,
          y: entry.source.worldOffsetY + c.row,
          z: c.z ?? 0,
        })
      })
    }
    const occ = buildColumnOccupancy(cells)
    logOccupancyMs('full', cells.length, performance.now() - t0)
    return occ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structuralKey])


  // master grid bbox:涵盖 voxel 真实占据的世界坐标。Render-scope snapshot, used by
  // things that only ever run WITHIN a render pass that just computed it fresh
  // (composeDirty's non-grow branch, drawOverlay's memoized deps, the imperative
  // handle's bookkeeping struct). `compose` itself does NOT use this — see below.
  const liveMaster = masterRef.current
  const { maxRows, maxCols } = deriveGridExtent(liveMaster)

  // compose — full-frame repaint (viewport/grid/resize). Reads `masterRef.current`
  // and re-derives the grid extent FRESH on every call (not the render-scope
  // `liveMaster`/`maxRows`/`maxCols` above) — deliberately, because this can now
  // be invoked LONG after the render that closed over it: a pan/zoom no longer
  // re-renders this plugin (see "Pan/zoom: imperative compose" below), so if an
  // incremental paint grew masterRef in between (which mutates the ref WITHOUT
  // ever triggering a new render — no structuralKey bump, no setState), a stale
  // render-scope closure would repaint the just-painted stroke away (the
  // original "paint vanishes on pan" bug, now reachable via ANY viewport change,
  // not just the render that happened to follow one). Reading the ref + a couple
  // of integer ops at call time costs nothing and is correct by construction —
  // no dependency on "was there a render recently" at all.
  const compose = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const master = masterRef.current
    const { maxRows: mr, maxCols: mc } = deriveGridExtent(master)
    composeFrame({
      canvas,
      voxelMaster: master,
      maxRows: mr, maxCols: mc,
      cellSize: SCREEN_CELL_SIZE,
      offsetX: viewportRef.current.offsetX,
      offsetY: viewportRef.current.offsetY,
      scale: viewportRef.current.scale,
      showGrid,
    })
    // Everything read above is a ref/getter, not a render-scope value — compose's
    // identity therefore only changes on `showGrid`, never on content OR
    // viewport. The "full-repaint on structural/content change" effect below is
    // keyed on `compose`'s identity purely to re-run on a showGrid toggle /
    // mount / resize; content changes are what actually PAINT (via composeDirty
    // in the incremental-append effect) — this callback just needs to always be
    // safe to call, any time, imperatively.
  }, [showGrid])

  // Incremental visible update: blit ONLY the master sub-rect a paint changed,
  // instead of re-drawing (and downscaling) the whole master. Falls back to a
  // full compose when the partial blit can't be done safely. `appended` carries
  // its own canvas/bbox (same object the in-place append mutated) + lastDirtyPx.
  const composeDirty = useCallback((appended: VoxelMaster, forceFull = false): void => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dirty = appended.lastDirtyPx
    const t0 = performance.now()
    // On a bbox grow the memoized maxRows/maxCols are stale (still the pre-grow
    // master), so derive the grid extent from the appended master's own bbox.
    const ab = appended.bbox
    const aMaxCols = Math.max(1, ab.worldOffsetX + ab.cols)
    const aMaxRows = Math.max(1, ab.worldOffsetY + ab.rows)
    const args = {
      canvas,
      voxelMaster: appended,
      maxRows: forceFull ? aMaxRows : maxRows,
      maxCols: forceFull ? aMaxCols : maxCols,
      cellSize: SCREEN_CELL_SIZE,
      offsetX: viewportRef.current.offsetX,
      offsetY: viewportRef.current.offsetY,
      scale: viewportRef.current.scale,
      showGrid,
    }
    const ok = !forceFull && dirty ? composeDirtyRect(args, dirty) : false
    if (!ok) composeFrame(args)
    logComposeMs(appended.canvas.width, appended.canvas.height, ok, performance.now() - t0)
  }, [maxRows, maxCols, showGrid])

  // `compose`'s own identity only tracks `showGrid` now (it reads masterRef.current
  // fresh internally — see its definition above), so `liveMaster` is listed here
  // explicitly to keep firing this effect exactly when it used to: mount, a full
  // rebuild (new master adopted by the sync block above), resize/showGrid toggle.
  useEffect(() => {
    compose()
    // If a full rebuild was scheduled by the append effect, the timeline was left
    // open until the tile is ACTUALLY composited (here, after the rebuilt master
    // is drawn) so the [bake-perf] number reflects the real visible moment, not
    // merely "rebuild scheduled".
    if (pendingRebuildTimelineRef.current) {
      pendingRebuildTimelineRef.current = false
      markPaintDrawn('full-rebuild')
      endStageTimeline('visible (full-rebuild)')
    }
  }, [compose, liveMaster])

  // ── Incremental additive bake ─────────────────────────────────────────────
  // Runs after every content-changing render. If the master is incremental-safe
  // and the delta is purely additive (no removals / object cells), append the new
  // cells onto the SAME master canvas in O(k) and recompose — no full rebake, no
  // surface-cache invalidation. Anything else bumps rebuildEpoch so the structural
  // key changes and useLayerSurface does a correct full rebuild next render.
  useEffect(() => {
    // Reset-safety: an exception anywhere in the incremental-bake path must NEVER
    // leave the pipeline latched (which manifested as a mid-stroke dead-stop where
    // nothing could be painted anymore). On ANY throw we fall back to a clean full
    // rebuild — the slow-but-correct path — instead of silently disabling painting.
    try {
      const master = masterRef.current
      // Nothing baked yet, or this render already corresponds to a fresh full
      // rebuild (snapshot was reset in the sync block above) → nothing to append.
      if (!master || builtStructuralKeyRef.current !== structuralKey) {
        // A structural rebuild is in flight (useLayerSurface will rebuild). Drain
        // any pending paint delta NOW so it can't accumulate across the rebuild
        // boundary and later replay cells the rebuilt master already contains
        // (stale delta = the kind of desync that could wedge the fast path).
        if (master && builtStructuralKeyRef.current !== structuralKey) {
          consumeLastPaintDelta()
        }
        return
      }
      // Fast path (O(k)): consume the store's recorded additive suffix and replay
      // ONLY those cells, patching the snapshot cache in place. This avoids the
      // O(N) snapshot + diff over the whole (e.g. 25k-cell) layer that otherwise
      // ran in the paint→visible window. Falls back to the full snapshot/diff when
      // the delta isn't usable (non-append change, object-instance, layer mismatch).
      const delta = consumeLastPaintDelta()
      let added: AppendCell[]
      let needsFullRebuild: boolean
      const fast = delta ? deltaToAppendCells(delta, voxelInputs, prevSnapshotRef.current, snapCacheRef.current) : null
      if (fast) {
        added = fast
        needsFullRebuild = false
        if (added.length === 0) { endStageTimeline('visible (no-op)'); return }
      } else {
        const nextSnap = snapshotVoxelInputsIncremental(voxelInputs, snapCacheRef.current)
        const diff = diffSnapshots(prevSnapshotRef.current, nextSnap)
        added = diff.added
        needsFullRebuild = diff.needsFullRebuild
        // The full path replaces the prev snapshot wholesale; the fast path already
        // patched prevSnapshotRef.current in place (deltaToAppendCells).
        prevSnapshotRef.current = nextSnap
        if (!needsFullRebuild && added.length === 0) { endStageTimeline('visible (no-op)'); return }
      }
      if (!needsFullRebuild) {
        const bail = { reason: '' }
        const prevBbox = master.bbox
        const appended = appendCellsToVoxelMaster(master, added, {
          drawMode,
          aliases: assetCtx?.aliases,
          fuzzy: assetCtx?.fuzzy,
        }, bail)
        if (appended) {
          // Same canvas, pixels updated in place; recompose ONLY the dirty sub-rect
          // (not the whole — possibly enormous — master) without a rebuild. The
          // prev snapshot was already advanced above (fast path patched it in place;
          // full path replaced it wholesale), so no O(N) work remains here.
          masterRef.current = appended
          // Feed ONLY the new cells into the occupancy index in O(k) — the memo no
          // longer rebuilds the whole 25k-cell index per paint. occupancyRef mirrors
          // the same object the memo returned (unchanged this render since the
          // structuralKey is stable on an additive paint), so mutating it in place
          // keeps the hover hit-test correct without an O(N) recompute.
          const occT0 = performance.now()
          addCellsToColumnOccupancy(occupancyRef.current, added)
          logOccupancyMs('incremental', added.length, performance.now() - occT0)
          // A bbox GROW re-origins/resizes the master → the dirty-rect math (and the
          // memoized maxRows/maxCols, still from the pre-grow master) would be
          // misaligned; do one full compose and let the next render adopt the new
          // size. Ordinary in-bounds paints take the cheap dirty-rect blit.
          const grew = appended.bbox.cols !== prevBbox.cols || appended.bbox.rows !== prevBbox.rows ||
            appended.bbox.worldOffsetX !== prevBbox.worldOffsetX || appended.bbox.worldOffsetY !== prevBbox.worldOffsetY
          if (grew) composeDirty(appended, true)
          else composeDirty(appended)
          markPaintDrawn('incremental')
          endStageTimeline('visible (incremental)')
          return
        }
      }
      // Not append-safe (removal / object-instance cell / non-asset master): force
      // a full rebuild via the structural key. (Out-of-bbox is NO LONGER here — the
      // append path grows the master canvas incrementally instead.) Leave the perf
      // timeline OPEN; the compose effect closes it once the rebuilt master is
      // actually composited, so the logged number is the real visible latency.
      rebuildEpochRef.current++
      pendingRebuildTimelineRef.current = true
      bumpTick()
    } catch (err) {
      // A bad/edge paint must not permanently disable painting. Drop any stale
      // delta, force a clean full rebuild, and keep the timeline balanced so the
      // next paint starts fresh.
      consumeLastPaintDelta()
      // eslint-disable-next-line no-console
      console.error('paint-effect THREW — forcing full rebuild (painting stays alive):', err)
      rebuildEpochRef.current++
      pendingRebuildTimelineRef.current = true
      endStageTimeline('visible (error→rebuild)')
      bumpTick()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentSig, structuralKey])


  // 容器 resize 时重画(jsdom 等环境可能无 ResizeObserver,缺失则跳过)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => compose())
    ro.observe(parent)
    return () => ro.disconnect()
  }, [compose])

  // ── Edit overlay: translucent brush ghost + box-select rubber-band ─────────
  // A dedicated overlay canvas, drawn IMPERATIVELY (not via a render-subscribed
  // effect) so the brush ghost can follow the cursor at rAF cadence WITHOUT
  // re-rendering this heavy plugin on every hovered-cell change. editHoverCell /
  // editBox are read from the store at draw time (getState), never subscribed.
  // Uses the SAME viewport transform + grid origin as compose so ghost/box align.
  const drawOverlay = useCallback(() => {
    const canvas = overlayCanvasRef.current
    if (!canvas) return
    let ctx: CanvasRenderingContext2D | null = null
    try { ctx = canvas.getContext('2d') } catch { ctx = null }
    if (!ctx) return
    const { editHoverCell, editBox } = useRenderStore.getState()
    const dpr = devicePixelRatio()
    const sizeSource = canvas.parentElement ?? canvas
    const rect = sizeSource.getBoundingClientRect()
    const cssW = Math.round(rect.width)
    const cssH = Math.round(rect.height)
    if (cssW <= 0 || cssH <= 0) return
    const wantW = Math.round(cssW * dpr)
    const wantH = Math.round(cssH * dpr)
    if (canvas.width !== wantW || canvas.height !== wantH) {
      canvas.width = wantW
      canvas.height = wantH
      canvas.style.width = cssW + 'px'
      canvas.style.height = cssH + 'px'
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.scale(dpr, dpr)
    const cx = Math.round(cssW / 2)
    const cy = Math.round(cssH / 2)
    ctx.translate(cx + Math.round(viewportRef.current.offsetX), cy + Math.round(viewportRef.current.offsetY))
    ctx.scale(viewportRef.current.scale, viewportRef.current.scale)
    ctx.translate(-cx, -cy)
    ctx.imageSmoothingEnabled = false
    const cellSize = SCREEN_CELL_SIZE
    // Fresh from masterRef.current (not the render-scope maxRows/maxCols dep
    // below) for the same reason `compose` is: a pan/zoom no longer re-renders
    // this plugin, so a render-scope snapshot could be stale relative to an
    // incremental grow that happened without a render in between.
    const { maxRows: liveMaxRows, maxCols: liveMaxCols } = deriveGridExtent(masterRef.current)
    const { originX, originY } = topMasterOrigin(cssW, cssH, liveMaxCols, liveMaxRows, cellSize)
    const lw = 1 / viewportRef.current.scale

    // SELECT-tool scene highlight: outline + tint the resolved voxel(s), top cap
    // AND front wall, so the picked object lights up cell-for-cell exactly where
    // the painter drew it. Drawn regardless of edit mode (selecting is a query,
    // not a paint), and read imperatively from the store like editHoverCell.
    const { voxelSelection, selectedEditorNodeIds } = useRenderStore.getState()
    if (voxelSelection && voxelSelection.voxels.length > 0) {
      ctx.save()
      ctx.lineWidth = 2 * lw
      ctx.fillStyle = 'rgba(56,189,248,0.22)'
      ctx.strokeStyle = 'rgba(56,189,248,0.95)'
      for (const v of voxelSelection.voxels) {
        const top = billboardTopFaceCellForVoxel(v)
        const front = billboardFrontFaceCellForVoxel(v)
        const tx = originX + top.col * cellSize
        const ty = originY + top.row * cellSize
        const fx = originX + front.col * cellSize
        const fy = originY + front.row * cellSize
        ctx.fillRect(tx, ty, cellSize, cellSize)
        ctx.fillRect(fx, fy, cellSize, cellSize)
        ctx.strokeRect(tx, ty, cellSize, cellSize)
        ctx.strokeRect(fx, fy, cellSize, cellSize)
      }
      ctx.restore()
    }

    // Editor selection (kernel node picker): dashed bbox per matching voxel layer.
    // Deferred from master bake so clicking a battery does not rebuildVoxelMaster.
    if (selectedEditorNodeIds.length > 0) {
      const selectedSet = new Set(selectedEditorNodeIds)
      ctx.save()
      ctx.strokeStyle = 'rgba(62, 207, 107, 0.85)' // success green — mode-top parity
      ctx.lineWidth = 1.8 / viewportRef.current.scale
      ctx.setLineDash([6 / viewportRef.current.scale, 4 / viewportRef.current.scale])
      for (const entry of voxelLayersRef.current.values()) {
        const layerKey = entry.layer.nodeId === '__baked__'
          ? `baked:${entry.layer.nodePath}`
          : `${entry.layer.nodeId}:${entry.layer.nodePath}`
        if (!entry.layer.visible || (!selectedSet.has(entry.layer.nodeId) && !selectedSet.has(layerKey))) continue
        const { source } = entry
        const off = 1 / viewportRef.current.scale
        const x = originX + source.worldOffsetX * cellSize - off
        const y = originY + source.worldOffsetY * cellSize - off
        const w = source.cols * cellSize + 2 * off
        const h = source.rows * cellSize + 2 * off
        ctx.strokeRect(x, y, w, h)
      }
      ctx.setLineDash([])
      ctx.restore()
    }

    if (!editMode) return
    // Box-select rubber-band (inclusive cell range).
    if (editBox) {
      const xlo = Math.min(editBox.x0, editBox.x1)
      const xhi = Math.max(editBox.x0, editBox.x1)
      const ylo = Math.min(editBox.y0, editBox.y1)
      const yhi = Math.max(editBox.y0, editBox.y1)
      const top0 = billboardTopFaceCellForVoxel({ x: xlo, y: ylo, z: editBox.z })
      const top1 = billboardTopFaceCellForVoxel({ x: xhi, y: yhi, z: editBox.z })
      const rx = originX + Math.min(top0.col, top1.col) * cellSize
      const ry = originY + Math.min(top0.row, top1.row) * cellSize
      const rw = (xhi - xlo + 1) * cellSize
      const rh = (yhi - ylo + 1) * cellSize
      ctx.fillStyle = 'rgba(120,170,255,0.18)'
      ctx.fillRect(rx, ry, rw, rh)
      ctx.lineWidth = lw
      ctx.strokeStyle = 'rgba(120,170,255,0.7)'
      ctx.strokeRect(rx, ry, rw, rh)
    }

    // Brush ghost at the hovered cell (translucent representative sprite).
    if (editHoverCell && paintAsset) {
      const meta = aliasMetas.find((m) => m.alias === paintAsset.alias)
      const isObject = !!meta && !meta.tileType
      const objectFootprint = isObject ? computeCollisionFootprint(meta.geometry?.collisionMask, meta.ppu ?? 16, meta) : null
      const objectOrigin = objectFootprint ? snapFootprintToBottomCenter(editHoverCell, objectFootprint) : null
      const topCell = billboardTopFaceCellForVoxel(editHoverCell)
      const x0 = originX + topCell.col * cellSize
      const y0 = originY + topCell.row * cellSize
      if (objectOrigin && objectFootprint) {
        ctx.save()
        ctx.lineWidth = lw
        ctx.fillStyle = 'rgba(120,170,255,0.12)'
        ctx.strokeStyle = 'rgba(120,170,255,0.65)'
        for (let dy = 0; dy < objectFootprint.height; dy++) {
          for (let dx = 0; dx < objectFootprint.width; dx++) {
            const cell = billboardTopFaceCellForVoxel({ x: objectOrigin.x + dx, y: objectOrigin.y + dy, z: objectOrigin.z })
            ctx.fillRect(originX + cell.col * cellSize, originY + cell.row * cellSize, cellSize, cellSize)
            ctx.strokeRect(originX + cell.col * cellSize, originY + cell.row * cellSize, cellSize, cellSize)
          }
        }
        ctx.restore()
      }
      const img = getOrLoadImage(getRegisteredAssetUrl(paintAsset.alias))
      if (img) {
        ctx.save()
        ctx.globalAlpha = 0.5
        if (meta?.tileType) {
          // Tile ghost uses the same global PPU sizing as the baked asset path.
          const sp = getOrLoadRule(meta.tileType)?.sprites?.[0]
          if (sp) {
            ctx.drawImage(
              img,
              sp.x, sp.y, sp.w, sp.h,
              x0, y0,
              (sp.w / TEXTURE_PPU) * cellSize,
              (sp.h / TEXTURE_PPU) * cellSize,
            )
          } else {
            const natW = img.naturalWidth || img.width || cellSize
            const natH = img.naturalHeight || img.height || cellSize
            ctx.drawImage(
              img,
              x0, y0,
              (natW / TEXTURE_PPU) * cellSize,
              (natH / TEXTURE_PPU) * cellSize,
            )
          }
        } else {
          // object → real size by PPU, anchor aligned to the cell centre (matches
          // how paintCell will place it, so the ghost previews the true result).
          const footprint = billboardObjectAnchorCanvasXY(editHoverCell, {
            cols: 1,
            rows: 1,
            worldOffsetX: editHoverCell.x,
            worldOffsetY: editHoverCell.y - editHoverCell.z,
          }, cellSize)
          const natW = img.naturalWidth || img.width || cellSize
          const natH = img.naturalHeight || img.height || cellSize
          const drawW = (natW / TEXTURE_PPU) * cellSize
          const drawH = (natH / TEXTURE_PPU) * cellSize
          const ax = meta?.anchorX ?? 0.5
          const ay = meta?.anchorY ?? 0.5
          const fx = originX + editHoverCell.x * cellSize + footprint.x
          const fy = originY + (editHoverCell.y - editHoverCell.z) * cellSize + footprint.y
          ctx.drawImage(img, fx + cellSize / 2 - ax * drawW, fy + cellSize / 2 - (1 - ay) * drawH, drawW, drawH)
        }
        ctx.restore()
      } else {
        // Image still loading → outline the target cell or object footprint.
        ctx.lineWidth = lw
        ctx.strokeStyle = 'rgba(255,255,255,0.4)'
        if (!objectOrigin || !objectFootprint) ctx.strokeRect(x0, y0, cellSize, cellSize)
      }
    }

    if (editHoverCell) {
      const meta = paintAsset ? aliasMetas.find((m) => m.alias === paintAsset.alias) : undefined
      const objectFootprint = meta && !meta.tileType
        ? computeCollisionFootprint(meta.geometry?.collisionMask, meta.ppu ?? 16, meta)
        : null
      const tileTargetFace = meta?.tileType ? billboardTopFaceCellForVoxel(editHoverCell) : null
      const previewCells = objectFootprint
        ? billboardObjectFootprintPreviewIndexed(editHoverCell, objectFootprint, occupancyCache).cells
        : [{
            targetFace: tileTargetFace ?? billboardFrontFaceCellForVoxel(editHoverCell),
            projection: billboardProjectionFaceForVoxelIndexed(editHoverCell, occupancyCache),
          }]

      ctx.save()
      for (const previewCell of previewCells) {
        const targetFace = previewCell.targetFace
        const projection = previewCell.projection
        const tx = originX + targetFace.col * cellSize
        const ty = originY + targetFace.row * cellSize
        const px = originX + projection.cell.col * cellSize
        const py = originY + projection.cell.row * cellSize

        ctx.lineWidth = 2 * lw
        ctx.fillStyle = 'rgba(251,146,60,0.18)'
        ctx.strokeStyle = 'rgba(251,146,60,0.95)'
        ctx.fillRect(tx, ty, cellSize, cellSize)
        ctx.strokeRect(tx, ty, cellSize, cellSize)

        ctx.lineWidth = 2 * lw
        ctx.fillStyle = projection.kind === 'voxel'
          ? 'rgba(45,212,191,0.18)'
          : 'rgba(148,163,184,0.12)'
        ctx.strokeStyle = projection.kind === 'voxel'
          ? 'rgba(45,212,191,0.95)'
          : 'rgba(148,163,184,0.62)'
        ctx.strokeRect(px, py, cellSize, cellSize)
        ctx.fillRect(px, py, cellSize, cellSize)

        const fromX = tx + cellSize / 2
        const fromY = ty + cellSize / 2
        const toX = px + cellSize / 2
        const toY = py + cellSize / 2
        const dy = toY - fromY
        if (Math.abs(dy) > 1) {
          ctx.setLineDash([4 * lw, 3 * lw])
          ctx.strokeStyle = 'rgba(255,255,255,0.72)'
          ctx.lineWidth = 1.5 * lw
          ctx.beginPath()
          ctx.moveTo(fromX, fromY)
          ctx.lineTo(toX, toY)
          ctx.stroke()
          ctx.setLineDash([])

          const dir = dy >= 0 ? 1 : -1
          ctx.fillStyle = 'rgba(255,255,255,0.78)'
          ctx.beginPath()
          ctx.moveTo(toX, toY)
          ctx.lineTo(toX - 4 * lw, toY - dir * 7 * lw)
          ctx.lineTo(toX + 4 * lw, toY - dir * 7 * lw)
          ctx.closePath()
          ctx.fill()
        }
      }
      ctx.restore()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode, paintAsset, aliasMetas, occupancyCache])

  // rAF-coalesced overlay scheduler. Hover/box changes (per-move) and render-input
  // changes (viewport, paintAsset, occupancy) all funnel through one pending frame
  // so we never draw more than once per animation frame and never on the React
  // render/commit critical path of the mousemove handler.
  const drawOverlayRef = useRef(drawOverlay)
  drawOverlayRef.current = drawOverlay
  const overlayRafRef = useRef<number | null>(null)
  const scheduleOverlay = useCallback(() => {
    if (overlayRafRef.current !== null) return
    const raf = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number
    overlayRafRef.current = raf(() => {
      overlayRafRef.current = null
      drawOverlayRef.current()
    })
  }, [])

  // Redraw when render-derived inputs change (viewport/paintAsset/occupancy/mode).
  useEffect(() => { scheduleOverlay() }, [drawOverlay, scheduleOverlay])

  // Transiently subscribe to per-move hover/box fields WITHOUT render-subscribing:
  // this listener fires outside React's render cycle, so moving the cursor only
  // schedules an imperative overlay draw — it never re-renders the plugin or
  // re-runs the master/compose pipeline.
  useEffect(() => {
    let prevHover = useRenderStore.getState().editHoverCell
    let prevBox = useRenderStore.getState().editBox
    let prevSelection = useRenderStore.getState().voxelSelection
    let prevEditorSel = useRenderStore.getState().selectedEditorNodeIds
    const unsub = useRenderStore.subscribe((state) => {
      if (
        state.editHoverCell !== prevHover ||
        state.editBox !== prevBox ||
        state.voxelSelection !== prevSelection ||
        state.selectedEditorNodeIds !== prevEditorSel
      ) {
        prevHover = state.editHoverCell
        prevBox = state.editBox
        prevSelection = state.voxelSelection
        prevEditorSel = state.selectedEditorNodeIds
        scheduleOverlay()
      }
    })
    return () => {
      unsub()
      if (overlayRafRef.current !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(overlayRafRef.current)
        overlayRafRef.current = null
      }
    }
  }, [scheduleOverlay])

  // ── Pan/zoom: imperative compose, no React re-render ──────────────────────
  // Mirrors compose so the rAF callback below always re-blits with the LATEST
  // liveMaster/maxRows/maxCols/showGrid without re-subscribing the store
  // listener every time one of those (rare, real-content) deps changes.
  const composeRef = useRef(compose)
  composeRef.current = compose

  const viewportRafRef = useRef<number | null>(null)
  const scheduleViewportRedraw = useCallback(() => {
    if (viewportRafRef.current !== null) return
    const raf = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number
    viewportRafRef.current = raf(() => {
      viewportRafRef.current = null
      composeRef.current()
      scheduleOverlay() // ghost/box/selection share the same viewport transform
    })
  }, [scheduleOverlay])

  // Store subscription (not a React hook subscription): a wheel/pan burst can
  // fire many `setViewport2d`/`panViewport2d` calls per animation frame — this
  // updates the ref SYNCHRONOUSLY every time (so hit-testing below is never
  // stale) but coalesces the actual redraw to one per rAF via the scheduler
  // above, instead of one full React render + drawImage per tick.
  useEffect(() => {
    let prev = useRenderStore.getState().viewport2d
    const unsub = useRenderStore.subscribe((state) => {
      if (state.viewport2d === prev) return
      prev = state.viewport2d
      viewportRef.current = prev
      scheduleViewportRedraw()
    })
    return () => {
      unsub()
      if (viewportRafRef.current !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(viewportRafRef.current)
        viewportRafRef.current = null
      }
    }
  }, [scheduleViewportRedraw])

  // ── §7.2 / §7.3 反向接口(同 mode-top 模式) ────────────────────────────
  // No render-scope snapshot (no more `stateRef`) — every handle method below
  // reads viewportRef.current + deriveGridExtent(masterRef.current) fresh, at
  // CALL time, for the same reason `compose` does (see its comment above): a
  // click/hover right after a pan or an incremental grow, with no React render
  // in between, must never hit-test against a stale viewport/extent snapshot.
  // Mirror the live occupancy index for the imperative SELECT hit-test (read at
  // click time via getState-style access, never re-subscribing React).
  const occupancyRef = useRef<ColumnOccupancy>(occupancyCache)
  occupancyRef.current = occupancyCache
  useImperativeHandle(ref, () => ({
    getFrameCanvas: () => canvasRef.current,
    renderFrame: () => compose(),
    screenToCell: (cssX, cssY) => {
      const canvas = canvasRef.current
      if (!canvas) return null
      const cellSize = SCREEN_CELL_SIZE
      const { maxRows, maxCols } = deriveGridExtent(masterRef.current)
      const viewport = viewportRef.current
      const sizeSource = canvas.parentElement ?? canvas
      const rect = sizeSource.getBoundingClientRect()
      const cssW = Math.round(rect.width)
      const cssH = Math.round(rect.height)
      const cx = Math.round(cssW / 2)
      const cy = Math.round(cssH / 2)
      const worldX = (cssX - cx - viewport.offsetX) / viewport.scale + cx
      const worldY = (cssY - cy - viewport.offsetY) / viewport.scale + cy
      const { originX, originY } = topMasterOrigin(cssW, cssH, maxCols, maxRows, cellSize)
      // Global coordinate system: the cursor maps to a grid cell anywhere on the
      // canvas, not just inside the content bbox. The grid is just default
      // alignment, so coords keep reporting past the painted region (may be
      // negative). Same origin as the grid lines & z=0 paint for consistency.
      const col = Math.floor((worldX - originX) / cellSize)
      const row = Math.floor((worldY - originY) / cellSize)
      return { col, row }
    },
    voxelStackAtScreen: (cssX, cssY) => {
      const canvas = canvasRef.current
      if (!canvas) return []
      const cellSize = SCREEN_CELL_SIZE
      const { maxRows, maxCols } = deriveGridExtent(masterRef.current)
      const viewport = viewportRef.current
      const sizeSource = canvas.parentElement ?? canvas
      const rect = sizeSource.getBoundingClientRect()
      const cssW = Math.round(rect.width)
      const cssH = Math.round(rect.height)
      const cx = Math.round(cssW / 2)
      const cy = Math.round(cssH / 2)
      const worldX = (cssX - cx - viewport.offsetX) / viewport.scale + cx
      const worldY = (cssY - cy - viewport.offsetY) / viewport.scale + cy
      const { originX, originY } = topMasterOrigin(cssW, cssH, maxCols, maxRows, cellSize)
      const col = Math.floor((worldX - originX) / cellSize)
      const row = Math.floor((worldY - originY) / cellSize)
      return billboardVoxelStackAtScreenCell(occupancyRef.current, col, row)
    },
    cellToScreen: (col, row) => {
      const canvas = canvasRef.current
      if (!canvas) return null
      const cellSize = SCREEN_CELL_SIZE
      const { maxRows, maxCols } = deriveGridExtent(masterRef.current)
      const viewport = viewportRef.current
      const sizeSource = canvas.parentElement ?? canvas
      const rect = sizeSource.getBoundingClientRect()
      const cssW = Math.round(rect.width)
      const cssH = Math.round(rect.height)
      const { originX, originY } = topMasterOrigin(cssW, cssH, maxCols, maxRows, cellSize)
      const worldX = originX + (col + 0.5) * cellSize
      const worldY = originY + (row + 0.5) * cellSize
      const cx = Math.round(cssW / 2)
      const cy = Math.round(cssH / 2)
      return {
        x: (worldX - cx) * viewport.scale + cx + viewport.offsetX,
        y: (worldY - cy) * viewport.scale + cy + viewport.offsetY,
      }
    },
    // Edit mode: map the cursor's selected front/bottom grid cell to a world
    // voxel at the requested z layer. This makes placement feel anchored to the
    // footprint/front face instead of the raised top cap.
    screenToEditCell: (cssX, cssY, z) => {
      const canvas = canvasRef.current
      if (!canvas) return null
      const cellSize = SCREEN_CELL_SIZE
      const { maxRows, maxCols } = deriveGridExtent(masterRef.current)
      const viewport = viewportRef.current
      const sizeSource = canvas.parentElement ?? canvas
      const rect = sizeSource.getBoundingClientRect()
      const cssW = Math.round(rect.width)
      const cssH = Math.round(rect.height)
      const cx = Math.round(cssW / 2)
      const cy = Math.round(cssH / 2)
      const worldX = (cssX - cx - viewport.offsetX) / viewport.scale + cx
      const worldY = (cssY - cy - viewport.offsetY) / viewport.scale + cy
      const { originX, originY } = topMasterOrigin(cssW, cssH, maxCols, maxRows, cellSize)
      const frontCell = {
        col: Math.floor((worldX - originX) / cellSize),
        row: Math.floor((worldY - originY) / cellSize),
      }
      return billboardEditVoxelFromFrontFaceCell(frontCell, z)
    },
  }), [compose])

  // [bake-perf] After every commit, emit the consolidated render-phase line so
  // the WHOLE body cost (and which memos recomputed this render) is attributed.
  // Logged only when something actually recomputed, to avoid noise on idle
  // re-renders. bodyTotal is wall-time from the top of the body to this effect.
  useLayoutEffect(() => {
    const segs = renderSegRef.current
    if (segs.length === 0) return
    logRenderPhase(segs, performance.now() - bodyT0)
  })

  return (
    <>
      <canvas ref={canvasRef} className="mode-top-billboard-canvas" />
      <canvas ref={overlayCanvasRef} className="mode-top-billboard-overlay" />
      {voxelKeys.map((key, idx) => (
        <VoxelLayerSubscriber
          key={key}
          layerKey={key}
          layerIdx={idx}
          onLayerUpdate={onVoxelLayer}
        />
      ))}
      {bakedKeys.map((key, idx) => (
        <BakedLayerSubscriber
          key={key}
          layerKey={key}
          layerIdx={idx}
          onLayerUpdate={onVoxelLayer}
        />
      ))}
    </>
  )
})
ModeTopBillboardPlugin.displayName = 'ModeTopBillboardPlugin'

// ── voxel 层 subscriber(只把 source + layer 元数据上报给父,不构建 surface) ──

interface VoxelLayerSubscriberProps {
  layerKey: string
  layerIdx: number
  onLayerUpdate(key: string, entry: VoxelLayerEntry | null): void
}

function VoxelLayerSubscriber({ layerKey, layerIdx, onLayerUpdate }: VoxelLayerSubscriberProps) {
  const layer = useVoxelLayer(layerKey)
  const source: CellSource | null = useMemo(
    () => layer ? voxelLayerCellSource(layer) : null,
    [layer],
  )
  useEffect(() => {
    if (!source || !layer) {
      onLayerUpdate(layerKey, null)
      return
    }
    onLayerUpdate(layerKey, {
      source,
      layer: { nodeId: layer.nodeId, updatedAt: layer.updatedAt, visible: layer.visible, nodePath: layer.nodePath },
      layerIdx,
      assetName: layer.assetName,
      assetAlias: layer.assetAlias,
      assetType: layer.assetType,
    })
  }, [layerKey, source, layer, layerIdx, onLayerUpdate])
  useEffect(() => () => onLayerUpdate(layerKey, null), [layerKey, onLayerUpdate])
  return null
}

// Same as VoxelLayerSubscriber but subscribes the baked (graph-independent)
// bucket. Reports into the SAME parent map (keys are `baked:`-prefixed, never
// colliding with `${nodeId}:${nodePath}`), so they flow through one master bake.
function BakedLayerSubscriber({ layerKey, layerIdx, onLayerUpdate }: VoxelLayerSubscriberProps) {
  const layer = useBakedLayer(layerKey)
  const source: CellSource | null = useMemo(
    () => layer ? voxelLayerCellSource(layer) : null,
    [layer],
  )
  useEffect(() => {
    if (!source || !layer) {
      onLayerUpdate(layerKey, null)
      return
    }
    onLayerUpdate(layerKey, {
      source,
      layer: { nodeId: layer.nodeId, updatedAt: layer.updatedAt, visible: layer.visible, nodePath: layer.nodePath },
      layerIdx,
      assetName: layer.assetName,
      assetAlias: layer.assetAlias,
      assetType: layer.assetType,
    })
  }, [layerKey, source, layer, layerIdx, onLayerUpdate])
  useEffect(() => () => onLayerUpdate(layerKey, null), [layerKey, onLayerUpdate])
  return null
}

// ── 自注册 ────────────────────────────────────────────────────────────

// memo: RenderCanvas (host) re-renders on every wheel tick (it subscribes to
// viewport2d.scale for the on-screen zoom% readout). Without memo, React would
// re-render this WHOLE plugin subtree (and every VoxelLayerSubscriber/
// BakedLayerSubscriber child) on every tick regardless of this component's own
// viewport handling above — memo bails out early since its props never change
// (it takes none), so the cascade stops here instead of at the leaf.
const MemoizedModeTopBillboardPlugin = memo(ModeTopBillboardPlugin)

registerRenderPlugin({
  name: 'billboard',
  modes: ['topBillboard'],
  Component: MemoizedModeTopBillboardPlugin,
})

export default MemoizedModeTopBillboardPlugin
