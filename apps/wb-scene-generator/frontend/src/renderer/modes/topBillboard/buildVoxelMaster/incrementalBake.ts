// 💡 mode-topBillboard voxel master —— 增量(dirty-region)重烤
//
// 背景:每画一个 cell 就整场 recollect / cull / sort / rebind / 全量 drawImage 重
// 烤 master(O(N log N)/点)。绝大多数描边只是往最上层追加少量 tile,实际只影响
// 画布上一小块区域。本模块在「不涉及 non-tile object sprite」的安全前提下,只清掉
// 受影响的 dirty 矩形并按 painter 顺序重画与该矩形相交的 cells(增量约 O(k)/点)。
//
// 安全边界(任一不满足 → 返回 null 让调用方走全量 buildVoxelMaster):
//   * 没有前一帧 master / 没有 incremental 快照
//   * 新 cell 带 object instance(state.instanceId)—— 不规则大尺寸 sprite,跨区
//   * 新 cell 的 footprint 落在当前 master bbox 之外(需要扩画布 / 平移)
//   * color/wire 模式做了 occlusion cull(cullOccluded):追加 cell 可能让此前被
//     剔除的 cell 重新可见,dirty-region 无法还原被丢弃的 cell → bail。asset 模式
//     不 cull,安全。
//
// autotile(asset + rule)正确性:新增 cell 会改变其 8 邻域 + z±1 既有 cell 的
// 自动拼接 sprite,所以 dirty cell 集合要把这些既有邻居一并纳入重画。

import {
  billboardTopFaceCanvasXY,
  type VoxelBbox,
} from '../../../framework/geometry/topBillboard'
import { createSurface } from '../../../framework/canvas2d'
import type { Surface2D } from '../../../framework/canvas2d'
import { paintCell } from './paintCell'
import { logIncrementalBreakdown, nowMark } from '../../../framework/bakePerf'
import type { BuildVoxelMasterOpts, CollectedCell, VoxelMaster } from './types'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** A cell the caller wants to add to the existing master (world coords). */
export interface AppendCell {
  x: number
  y: number
  z: number
  value: number
  layerIdx: number
  isSelected: boolean
  isEditorSelected: boolean
  isMultiValue: boolean
  state?: Record<string, unknown>
}

interface PxRect { x0: number; y0: number; x1: number; y1: number }

function cellKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`
}

/**
 * Canvas footprint (in master px) of a single billboard cell: 1 column wide,
 * 2 cells tall (top face row `y-z-1` + front face row `y-z`).
 */
function cellFootprint(cell: { x: number; y: number; z: number }, bbox: VoxelBbox, cellSize: number): PxRect {
  const top = billboardTopFaceCanvasXY(cell, bbox, cellSize)
  return { x0: top.x, y0: top.y, x1: top.x + cellSize, y1: top.y + 2 * cellSize }
}

function rectsOverlap(a: PxRect, b: PxRect): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0
}

/**
 * Convert an object sprite's visual bounds (master-grid screen units: x = world
 * X, y = screen-Y `y-z`) into canvas px, matching billboardTopFaceCanvasXY.
 */
function boundsToPx(
  b: { minX: number; minY: number; maxX: number; maxY: number },
  bbox: VoxelBbox,
  cellSize: number,
): PxRect {
  return {
    x0: (b.minX - bbox.worldOffsetX) * cellSize,
    y0: (b.minY - bbox.worldOffsetY) * cellSize,
    x1: (b.maxX - bbox.worldOffsetX) * cellSize,
    y1: (b.maxY - bbox.worldOffsetY) * cellSize,
  }
}

/**
 * Try to add `newCells` to `master` by redrawing only the affected dirty region.
 * Returns the updated master (same canvas) on success, or null when the edit
 * isn't incremental-safe and the caller must do a full `buildVoxelMaster`.
 */
export interface AppendBailInfo { reason: string }

/** Optional out-param: per-append work counters, for perf assertions/logging. */
export interface AppendStats {
  n: number            // total cells in the merged snapshot
  cellsVisited: number // candidate cells the repaint loop iterated (should be O(k))
  cellsPainted: number
  dirtyPx: number
}

export function appendCellsToVoxelMaster(
  master: VoxelMaster | null,
  newCells: ReadonlyArray<AppendCell>,
  opts: BuildVoxelMasterOpts,
  bail?: AppendBailInfo,
  stats?: AppendStats,
): VoxelMaster | null {
  const fail = (r: string): null => { if (bail) bail.reason = r; return null }
  if (!master) return fail('no-master')
  if (!master.incremental) return fail('no-incremental-snapshot')
  if (newCells.length === 0) return master
  const state = master.incremental
  // drawMode / asset binding context must match the snapshot for a valid append.
  if (state.drawMode !== opts.drawMode) return fail(`drawMode-mismatch(state=${state.drawMode},opts=${opts.drawMode})`)
  // Object layers (non-tile binding): one layer = one sprite; incremental append
  // cannot recompute grouping/anchor → full rebuild.
  if (state.assetByLayer) {
    for (const c of newCells) {
      const binding = state.assetByLayer.get(c.layerIdx)
      if (binding && !binding.match.tileType) return fail('object-layer-cell')
    }
  }
  // Legacy painted columns carry instanceId metadata; still bail (irregular sprite).
  for (const c of newCells) {
    if (c.state && typeof c.state.instanceId === 'string' && c.state.instanceId.length > 0) return fail('object-instance-cell')
  }
  // color/wire mode applies occlusion culling; appending could un-occlude a
  // previously-dropped cell that the snapshot no longer knows about → bail.
  if (opts.drawMode !== 'asset') return fail(`non-asset-drawMode(${opts.drawMode})`)

  const { cellSize } = state
  const t0 = nowMark()

  // Promote append cells into CollectedCell shape (matching the snapshot).
  const added: CollectedCell[] = newCells.map((c) => ({
    x: c.x, y: c.y, z: c.z, value: c.value,
    layerIdx: c.layerIdx,
    isSelected: c.isSelected,
    isEditorSelected: c.isEditorSelected,
    isMultiValue: c.isMultiValue,
    ...(c.state ? { state: c.state } : {}),
  }))

  // Reuse (or lazily build) the spatial bucket index so existence checks, the
  // neighbor scan, and the repaint loop are all O(k) near the dirty rect — never
  // O(N) over the whole scene. Older snapshots (or the very first append after a
  // full build) may not carry it yet → build once, then mutate in place.
  const buckets = state.cellBuckets ?? buildCellBuckets(state.cells)

  // De-dup: skip cells already present (same x,y,z,layerIdx). Check only the few
  // buckets around each new cell instead of hashing all N cells.
  const isPresent = (c: CollectedCell): boolean => {
    const arr = buckets.get(bucketKey(Math.floor(c.x / BUCKET), Math.floor((c.y - c.z - 1) / BUCKET)))
    if (arr) for (const e of arr) if (e.x === c.x && e.y === c.y && e.z === c.z && e.layerIdx === c.layerIdx) return true
    // footprint spans two screen rows → also probe the lower bucket
    const arr2 = buckets.get(bucketKey(Math.floor(c.x / BUCKET), Math.floor((c.y - c.z) / BUCKET)))
    if (arr2 && arr2 !== arr) for (const e of arr2) if (e.x === c.x && e.y === c.y && e.z === c.z && e.layerIdx === c.layerIdx) return true
    return false
  }
  const freshAdded = added.filter((c) => !isPresent(c))
  if (freshAdded.length === 0) return master

  // ── bbox GROW fast path ──────────────────────────────────────────────────
  // The full build sizes the master canvas to TIGHTLY cover the painted cells
  // (zero margin). The user paints across the canvas, so the very next cell is
  // almost always outside that tight bbox. Instead of bailing to a full O(N)
  // rebuild, grow (and re-origin) the master canvas, blit the old pixels into
  // their new position, and continue the dirty-region append against the larger
  // canvas. This keeps the per-cell cost O(k): one resize + one blit + k draws.
  let { canvas, bbox } = master
  const grown = growBboxForCells(bbox, freshAdded)
  if (grown) {
    const next = growMasterCanvas(canvas, bbox, grown, cellSize)
    if (!next) return fail('grow-canvas-failed') // couldn't allocate/blit → full-rebuild
    canvas = next
    bbox = grown
  }
  const canvasRect: PxRect = { x0: 0, y0: 0, x1: canvas.width, y1: canvas.height }

  // After any grow, every cell must now fit the canvas; if not, something is off
  // (e.g. fractional object bounds) → bail to a full rebuild for correctness.
  for (const c of freshAdded) {
    const fp = cellFootprint(c, bbox, cellSize)
    if (fp.x0 < 0 || fp.y0 < 0 || fp.x1 > canvas.width || fp.y1 > canvas.height) return fail('cell-outside-after-grow')
  }

  // Update neighbor index for autotile: new cells affect their existing 8-neighbors
  // (+ z±1) sprites. Fetch candidate neighbors from buckets around the new cells
  // (O(k)) instead of scanning all N cells.
  const newKeys = new Set(freshAdded.map((c) => cellKey(c.x, c.y, c.z)))
  const dirtyCells: CollectedCell[] = [...freshAdded]
  const dirtyKeySet = new Set(freshAdded.map((c) => `${cellKey(c.x, c.y, c.z)}#${c.layerIdx}`))
  const neighborCandidates = new Set<CollectedCell>()
  for (const c of freshAdded) {
    // a new cell can dirty neighbors within ±1 cell → buckets covering that 3×3
    const bx = Math.floor(c.x / BUCKET), by = Math.floor((c.y - c.z) / BUCKET)
    for (let dbx = -1; dbx <= 1; dbx++) {
      for (let dby = -1; dby <= 1; dby++) {
        const arr = buckets.get(bucketKey(bx + dbx, by + dby))
        if (arr) for (const e of arr) neighborCandidates.add(e)
      }
    }
  }
  for (const c of neighborCandidates) {
    if (isNeighborOfAny(c, newKeys)) {
      const k = `${cellKey(c.x, c.y, c.z)}#${c.layerIdx}`
      if (!dirtyKeySet.has(k)) { dirtyKeySet.add(k); dirtyCells.push(c) }
    }
  }
  const prepMs = nowMark() - t0

  // Dirty rect = union of dirty cells' footprints (clamped to canvas).
  let dirty: PxRect | null = null
  for (const c of dirtyCells) {
    const fp = cellFootprint(c, bbox, cellSize)
    dirty = dirty ? unionRect(dirty, fp) : fp
  }
  if (!dirty) return master

  // Object sprites are OVERSIZED: their painted pixels far exceed their 1-cell
  // footprint. If a painted tile's dirty rect overlaps any object's true visual
  // bounds, expand the dirty rect to cover that whole object and force-repaint it
  // (otherwise a stale half-object would remain). This lets a composite scene that
  // merely CONTAINS an object stay on the O(k) append path for ordinary tile paints
  // (the object is only touched when the new tile actually overlaps it).
  const tFix = nowMark()
  const objectBounds = state.objectBoundsByCell
  const forceRepaint = new Set<CollectedCell>()
  if (objectBounds && objectBounds.size > 0) {
    let grew = true
    // Iterate to a fixpoint: pulling in one object can extend the dirty rect to
    // overlap another. Bounded by the (small) number of objects.
    while (grew) {
      grew = false
      for (const [cell, b] of objectBounds) {
        if (forceRepaint.has(cell)) continue
        const px = boundsToPx(b, bbox, cellSize)
        if (rectsOverlap(px, dirty)) {
          dirty = unionRect(dirty, px)
          forceRepaint.add(cell)
          grew = true
        }
      }
    }
  }
  const fixpointMs = nowMark() - tFix
  dirty = clampRect(dirty, canvasRect)

  // Maintain the autotile neighbor coord index so re-picked sprites see the new
  // cells. coordsByLayerIdx keys are world `x,y,z`.
  if (state.coordsByLayerIdx) {
    for (const c of freshAdded) {
      let set = state.coordsByLayerIdx.get(c.layerIdx)
      if (!set) { set = new Set(); state.coordsByLayerIdx.set(c.layerIdx, set) }
      set.add(cellKey(c.x, c.y, c.z))
    }
  }

  // Maintain the persistent painter-sorted cell list WITHOUT re-sorting all N.
  // freshAdded is tiny; splice each into its sorted position (the snapshot is
  // already painter-sorted from the build / previous append).
  const tSort = nowMark()
  const mergedCells = (state.cells as CollectedCell[]).slice()
  for (const c of freshAdded) {
    let lo = 0, hi = mergedCells.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (painterCompare(mergedCells[mid], c) < 0) lo = mid + 1
      else hi = mid
    }
    mergedCells.splice(lo, 0, c)
    indexCell(buckets, c) // keep the spatial index in lock-step
  }
  const sortMs = nowMark() - tSort

  // Redraw the dirty region: clear it, clip to it, repaint (in painter order)
  // only the cells whose footprint intersects the dirty rect. Candidates come
  // from the spatial buckets (O(k)) plus any force-repaint objects; we sort just
  // that small candidate set rather than the whole scene.
  const tRepaint = nowMark()
  let ctx: Ctx | null = null
  try {
    ctx = canvas.getContext('2d') as Ctx | null
  } catch {
    ctx = null
  }
  if (!ctx) return fail('no-2d-context')
  ctx.save()
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(dirty.x0, dirty.y0, dirty.x1 - dirty.x0, dirty.y1 - dirty.y0)
  if (typeof ctx.beginPath === 'function' && typeof ctx.rect === 'function' && typeof ctx.clip === 'function') {
    ctx.beginPath()
    ctx.rect(dirty.x0, dirty.y0, dirty.x1 - dirty.x0, dirty.y1 - dirty.y0)
    ctx.clip()
  }
  const columnCells = state.objectColumnCells
  const anchorPointsByLayer = state.objectAnchorPointByLayer
  // Gather candidates near the dirty rect + force-repaint objects, then paint in
  // global painter order (sorting only this small set).
  const candidateSet = new Set<CollectedCell>(cellsNearDirty(buckets, dirty, bbox, cellSize))
  for (const c of forceRepaint) candidateSet.add(c)
  const candidates = [...candidateSet].sort(painterCompare)
  let cellsPainted = 0
  for (const c of candidates) {
    // Object column cells are never drawn directly (only the anchor draws the
    // group sprite) — skip them exactly like the full build does.
    if (columnCells && columnCells.has(c)) continue
    // Object-drawing cells (anchors / free non-tile cells) use their TRUE sprite
    // bounds for the overlap test; ordinary tiles use their 1-cell footprint.
    const ob = objectBounds?.get(c)
    if (ob) {
      if (!forceRepaint.has(c) && !rectsOverlap(boundsToPx(ob, bbox, cellSize), dirty)) continue
    } else {
      const fp = cellFootprint(c, bbox, cellSize)
      if (!rectsOverlap(fp, dirty)) continue
    }
    const binding = state.assetByLayer?.get(c.layerIdx)
    const anchorPoint = binding && !binding.match.tileType && !(columnCells?.has(c))
      ? anchorPointsByLayer?.get(c.layerIdx)
      : undefined
    paintCell(
      ctx, c, bbox, cellSize, state.drawMode, state.assetByLayer, state.coordsByLayerIdx,
      undefined, anchorPoint,
    )
    cellsPainted++
  }
  ctx.restore()
  const repaintMs = nowMark() - tRepaint

  logIncrementalBreakdown({
    n: mergedCells.length,
    prepMs,
    sortMs,
    fixpointMs,
    fixpointObjs: forceRepaint.size,
    repaintMs,
    cellsVisited: candidates.length,
    cellsPainted,
    dirtyPx: (dirty.x1 - dirty.x0) * (dirty.y1 - dirty.y0),
  })
  if (stats) {
    stats.n = mergedCells.length
    stats.cellsVisited = candidates.length
    stats.cellsPainted = cellsPainted
    stats.dirtyPx = (dirty.x1 - dirty.x0) * (dirty.y1 - dirty.y0)
  }

  return {
    canvas,
    bbox,
    incremental: { ...state, cells: mergedCells, cellBuckets: buckets },
    lastDirtyPx: { x0: dirty.x0, y0: dirty.y0, x1: dirty.x1, y1: dirty.y1 },
  }
}

/** Whether `c` is an 8-neighbor (or z±1, same column) of any new cell. */
function isNeighborOfAny(c: { x: number; y: number; z: number }, newKeys: Set<string>): boolean {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dy === 0 && dz === 0) continue
        if (newKeys.has(cellKey(c.x + dx, c.y + dy, c.z + dz))) return true
      }
    }
  }
  return false
}

function unionRect(a: PxRect, b: PxRect): PxRect {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  }
}

function clampRect(r: PxRect, bounds: PxRect): PxRect {
  return {
    x0: Math.max(r.x0, bounds.x0),
    y0: Math.max(r.y0, bounds.y0),
    x1: Math.min(r.x1, bounds.x1),
    y1: Math.min(r.y1, bounds.y1),
  }
}

// ── Spatial bucket index ─────────────────────────────────────────────────────
// Cells are bucketed by coarse WORLD screen-grid tiles so the append path can
// fetch only the cells near a dirty rect (O(k)) instead of scanning all N. A
// cell at (x,y,z) spans world screen columns [x, x+1) and rows [y-z-1, y-z+1).
// Keys are world-grid (origin-independent) so a bbox grow never invalidates them.

const BUCKET = 8 // world cells per bucket side

function bucketKey(bx: number, by: number): string {
  return `${bx}|${by}`
}

/** World screen-grid extent (col/row range) a cell footprint covers. */
function cellScreenExtent(c: { x: number; y: number; z: number }): { x0: number; y0: number; x1: number; y1: number } {
  return { x0: c.x, y0: c.y - c.z - 1, x1: c.x + 1, y1: c.y - c.z + 1 }
}

/** Insert a cell into every bucket its footprint touches. */
export function indexCell(buckets: Map<string, CollectedCell[]>, c: CollectedCell): void {
  const e = cellScreenExtent(c)
  const bx0 = Math.floor(e.x0 / BUCKET), bx1 = Math.floor((e.x1 - 1e-6) / BUCKET)
  const by0 = Math.floor(e.y0 / BUCKET), by1 = Math.floor((e.y1 - 1e-6) / BUCKET)
  for (let bx = bx0; bx <= bx1; bx++) {
    for (let by = by0; by <= by1; by++) {
      const k = bucketKey(bx, by)
      const arr = buckets.get(k)
      if (arr) arr.push(c)
      else buckets.set(k, [c])
    }
  }
}

/** Build a fresh bucket index for a list of cells. */
export function buildCellBuckets(cells: ReadonlyArray<CollectedCell>): Map<string, CollectedCell[]> {
  const buckets = new Map<string, CollectedCell[]>()
  for (const c of cells) indexCell(buckets, c)
  return buckets
}

/** Collect (de-duplicated) cells whose buckets intersect a px dirty rect. */
function cellsNearDirty(
  buckets: Map<string, CollectedCell[]>,
  dirty: PxRect,
  bbox: VoxelBbox,
  cellSize: number,
): CollectedCell[] {
  // px dirty rect → world screen-grid range → bucket range.
  const gx0 = dirty.x0 / cellSize + bbox.worldOffsetX
  const gy0 = dirty.y0 / cellSize + bbox.worldOffsetY
  const gx1 = dirty.x1 / cellSize + bbox.worldOffsetX
  const gy1 = dirty.y1 / cellSize + bbox.worldOffsetY
  const bx0 = Math.floor(gx0 / BUCKET), bx1 = Math.floor(gx1 / BUCKET)
  const by0 = Math.floor(gy0 / BUCKET), by1 = Math.floor(gy1 / BUCKET)
  const seen = new Set<CollectedCell>()
  const out: CollectedCell[] = []
  for (let bx = bx0; bx <= bx1; bx++) {
    for (let by = by0; by <= by1; by++) {
      const arr = buckets.get(bucketKey(bx, by))
      if (!arr) continue
      for (const c of arr) {
        if (!seen.has(c)) { seen.add(c); out.push(c) }
      }
    }
  }
  return out
}

/** Painter comparator for the small candidate set (matches collect.painterSort,
 *  no overrides — objects are force-included separately). */
function painterCompare(a: CollectedCell, b: CollectedCell): number {
  if (a.y !== b.y) return a.y - b.y
  if (a.z !== b.z) return a.z - b.z
  return a.layerIdx - b.layerIdx
}

/**
 * If any of `cells` projects outside `bbox`, return a grown bbox that covers the
 * union of the old bbox and the new cells (whole-grid origin preserved). Returns
 * null when no growth is needed (the cells already fit) so callers can skip the
 * resize/blit entirely.
 *
 * bbox is in master-grid SCREEN space: a cell at (x,y,z) spans screen columns
 * [x, x+1) and screen rows [y-z-1, y-z+1) (top face top sentinel … front face
 * bottom), matching computeVoxelMasterBbox / billboardTopFaceCanvasXY.
 */
function growBboxForCells(bbox: VoxelBbox, cells: ReadonlyArray<{ x: number; y: number; z: number }>): VoxelBbox | null {
  let minX = bbox.worldOffsetX
  let minY = bbox.worldOffsetY
  let maxX = bbox.worldOffsetX + bbox.cols
  let maxY = bbox.worldOffsetY + bbox.rows
  let changed = false
  for (const c of cells) {
    const cMinX = c.x
    const cMaxX = c.x + 1
    const cMinY = c.y - c.z - 1
    const cMaxY = c.y - c.z + 1
    if (cMinX < minX) { minX = cMinX; changed = true }
    if (cMinY < minY) { minY = cMinY; changed = true }
    if (cMaxX > maxX) { maxX = cMaxX; changed = true }
    if (cMaxY > maxY) { maxY = cMaxY; changed = true }
  }
  if (!changed) return null
  return {
    worldOffsetX: Math.floor(minX),
    worldOffsetY: Math.floor(minY),
    cols: Math.ceil(maxX) - Math.floor(minX),
    rows: Math.ceil(maxY) - Math.floor(minY),
  }
}

/**
 * Allocate a larger master canvas for `next` bbox and blit the existing `old`
 * canvas into its new position (origin shift = old.worldOffset - next.worldOffset,
 * in cells × cellSize). Returns the new Surface2D, or null if a 2D context can't
 * be obtained (caller then falls back to a full rebuild). O(1) pixels copy.
 */
function growMasterCanvas(
  old: Surface2D,
  oldBbox: VoxelBbox,
  next: VoxelBbox,
  cellSize: number,
): Surface2D | null {
  const W = Math.max(1, Math.ceil(next.cols * cellSize))
  const H = Math.max(1, Math.ceil(next.rows * cellSize))
  const surface = createSurface(W, H)
  let ctx: Ctx | null = null
  try {
    ctx = surface.getContext('2d') as Ctx | null
  } catch {
    ctx = null
  }
  if (!ctx) return null
  ctx.imageSmoothingEnabled = false
  const dx = (oldBbox.worldOffsetX - next.worldOffsetX) * cellSize
  const dy = (oldBbox.worldOffsetY - next.worldOffsetY) * cellSize
  if (old.width > 0 && old.height > 0) {
    try {
      ctx.drawImage(old as unknown as CanvasImageSource, dx, dy)
    } catch {
      // jsdom (no canvas pkg) can throw on drawImage; treat as un-growable so the
      // caller does a clean full rebuild instead of producing a blank master.
      return null
    }
  }
  return surface
}
