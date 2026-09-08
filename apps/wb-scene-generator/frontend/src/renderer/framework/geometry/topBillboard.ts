// 💡 mode-topBillboard 几何工具
//
// 视角:俯视 + voxel 高度 z 抬升 + 立面 sprite(同顶面但偏下 1 cell)。
// 「本质是 3D」(用户原话):每个 voxel 渲染两块,top 面 + front 面。
//
// ── 屏幕投影 ────────────────────────────────────────────────────────────
//
//   top  face → (x, y - z - 1)   ← 顶面在屏幕"上方一格",= 3D cube 的盖子可见区
//   front face → (x, y - z)      ← 立面在屏幕"下方一格",= 3D cube 的正面可见区
//
// 单个 voxel (x=2, y=3, z=1) 在 canvas 上占 2 cell:
//
//     canvas y                                               world (x, y, z)
//     ──────────────────                                     ────────────────
//      1   ┌──────┐  ← top.y    = (y - z - 1) * cellSize    cube 顶盖,仰视
//          │ top  │
//      2   ├──────┤  ← front.y  = (y - z)     * cellSize    cube 朝 camera 那面
//          │front │
//      3   └──────┘  ← (= top.y + 2*cellSize 的 bottom edge)
//
// stacked column (x=2, y=3, z=0..2)在 canvas 上叠 4 cell —— 高 z 的 front
// 自动覆盖低 z 的 top(painter z ASC + source-over):
//
//                                                  绘制顺序(painter z ASC):
//      0  ┌─sprite 0 (cap)──┐  ← z=2 top            z=0 paint:  top@2  front@3
//      1  ├─sprite 4 (上立面)┤  ← z=2 front         z=1 paint:  top@1  front@2
//                              (= z=1 top 位被覆盖)        ↑ 覆盖 z=0 top
//      2  ├─sprite 8 (中立面)┤  ← z=1 front         z=2 paint:  top@0  front@1
//                              (= z=0 top 位被覆盖)        ↑ 覆盖 z=1 top
//      3  └─sprite 13 (下立面)┘ ← z=0 front
//
// 即"中段顶面被 z+1 voxel 立面覆盖" —— **没有显式 cull 代码,靠 painter 顺序 +
// source-over 涌现**。ground+wall 同 (x,y) 不同 z 时,wall front 的透明像素也是
// 这条规律透出 ground top。
//
// 几何常量沿用 SCREEN_CELL_SIZE = 8 CSS px / cell。
// 多 voxel 跨层重叠 / 同一柱遮挡的处理在 modes/topBillboard/buildVoxelMaster 实施;
// 本文件只提供几何投影 + voxel master canvas 尺寸计算。

import { SCREEN_CELL_SIZE } from './constants'
import { snapFootprintToBottomCenter, type GridFootprint } from './objectPlacement'

export interface VoxelCellLite {
  x: number
  y: number
  z: number
}

export interface VoxelVisualBoundsLite {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface VoxelBbox {
  /** voxel master canvas 列宽(单位 cell) */
  cols: number
  /** voxel master canvas 行高(单位 cell);包含 z 抬升后所有 cells 的合理跨度 */
  rows: number
  /** voxel master 在 master grid 世界坐标下的 (col, row) 偏移 */
  worldOffsetX: number
  /**
   * voxel master canvas (0,0) 对应的 master grid 世界 row 坐标。
   * 由于 z 抬升让 cells 可能投到负的 screen y,这个值通常为负数(=最高 cell 的 front face 所在 row)。
   * compose 阶段:voxel master 画在 (originX + worldOffsetX*cs, originY + worldOffsetY*cs)。
   */
  worldOffsetY: number
}

export interface TopFaceCell {
  col: number
  row: number
}

/**
 * 计算所有可见 voxel cells 在 billboard 投影后的包围盒 + master canvas 所需尺寸。
 * 同时返回 worldOffset,用于 compose 阶段把 master canvas 摆到正确世界位置。
 */
export function computeVoxelMasterBbox(
  cells: ReadonlyArray<VoxelCellLite>,
  extraBounds: ReadonlyArray<VoxelVisualBoundsLite> = [],
): VoxelBbox {
  if (cells.length === 0) {
    return { cols: 1, rows: 1, worldOffsetX: 0, worldOffsetY: 0 }
  }
  let minX = Infinity, maxX = -Infinity
  let minScreenY = Infinity, maxScreenY = -Infinity
  for (const c of cells) {
    if (c.x < minX) minX = c.x
    if (c.x + 1 > maxX) maxX = c.x + 1
    // top face 上沿 = y - z - 1(屏上方);front face 下沿 = y - z + 1(屏下方一格)
    const topTop = c.y - c.z - 1
    const frontBottom = c.y - c.z + 1
    if (topTop < minScreenY) minScreenY = topTop
    if (frontBottom > maxScreenY) maxScreenY = frontBottom
  }
  for (const bounds of extraBounds) {
    if (bounds.minX < minX) minX = bounds.minX
    if (bounds.maxX > maxX) maxX = bounds.maxX
    if (bounds.minY < minScreenY) minScreenY = bounds.minY
    if (bounds.maxY > maxScreenY) maxScreenY = bounds.maxY
  }
  // Keep the master origin on whole grid coordinates. Object sprite bounds can
  // be fractional because anchors are normalized, but shifting the entire master
  // to a fractional worldOffset makes tile faces land on subpixels and creates
  // visible seams between adjacent tiles.
  const worldOffsetX = Math.floor(minX)
  const worldOffsetY = Math.floor(minScreenY)
  const cols = Math.ceil(maxX) - worldOffsetX
  const rows = Math.ceil(maxScreenY) - worldOffsetY
  return { cols, rows, worldOffsetX, worldOffsetY }
}

/**
 * 给定 voxel cell 在 master grid 世界坐标系下的 (x, y, z),返回它在
 * voxel master canvas 内的 top face 像素位置(左上角)。
 *
 * voxel master canvas 自己的坐标系 = world 坐标 - bbox.worldOffset,然后 ×cellSize。
 */
export function billboardTopFaceCanvasXY(
  cell: VoxelCellLite,
  bbox: VoxelBbox,
  cellSize: number = SCREEN_CELL_SIZE,
): { x: number; y: number } {
  return {
    x: (cell.x - bbox.worldOffsetX) * cellSize,
    y: (cell.y - cell.z - 1 - bbox.worldOffsetY) * cellSize,
  }
}

/** 同上,但取 front face 的左上角(= top face 下方一个 cell) */
export function billboardFrontFaceCanvasXY(
  cell: VoxelCellLite,
  bbox: VoxelBbox,
  cellSize: number = SCREEN_CELL_SIZE,
): { x: number; y: number } {
  return {
    x: (cell.x - bbox.worldOffsetX) * cellSize,
    y: (cell.y - cell.z - bbox.worldOffsetY) * cellSize,
  }
}

/**
 * Legacy edit semantic: the selected grid cell is the final voxel's top face.
 * New edit flow uses the front/bottom face below, but keeping this helper
 * preserves tests and callers that explicitly need top-face addressing.
 */
export function billboardEditVoxelFromTopFaceCell(cell: TopFaceCell, z: number): VoxelCellLite {
  const zi = Math.trunc(z)
  return { x: cell.col, y: cell.row + zi + 1, z: zi }
}

/** 把 voxel 映回用户看到/选中的 top-face 格子。 */
export function billboardTopFaceCellForVoxel(cell: VoxelCellLite): TopFaceCell {
  return { col: cell.x, row: cell.y - cell.z - 1 }
}

/**
 * Edit semantic: the selected grid cell is the final voxel's visible front face
 * / footprint-bottom position. Billboard front row = y - z, so the written voxel
 * is one world row lower than the old top-face mapping.
 */
export function billboardEditVoxelFromFrontFaceCell(cell: TopFaceCell, z: number): VoxelCellLite {
  const zi = Math.trunc(z)
  return { x: cell.col, y: cell.row + zi, z: zi }
}

/** Map a voxel back to its visible front/bottom grid cell. */
export function billboardFrontFaceCellForVoxel(cell: VoxelCellLite): TopFaceCell {
  return { col: cell.x, row: cell.y - cell.z }
}

export type BillboardProjectionFace =
  | { kind: 'voxel'; cell: TopFaceCell; support: VoxelCellLite }
  | { kind: 'ground'; cell: TopFaceCell }

export interface BillboardObjectFootprintPreviewCell {
  voxel: VoxelCellLite
  targetFace: TopFaceCell
  projection: BillboardProjectionFace
}

export interface BillboardObjectFootprintPreview {
  origin: VoxelCellLite
  cells: BillboardObjectFootprintPreviewCell[]
}

/**
 * Placement aid: project the target voxel downward along the same x/y column.
 * If a lower voxel exists, highlight the closest lower top face; otherwise use a
 * faint ground/grid fallback at the target footprint row.
 */
export function billboardProjectionFaceForVoxel(
  target: VoxelCellLite,
  cells: ReadonlyArray<VoxelCellLite>,
): BillboardProjectionFace {
  let support: VoxelCellLite | null = null
  for (const c of cells) {
    if (c.x !== target.x || c.y !== target.y || c.z >= target.z) continue
    if (!support || c.z > support.z) support = c
  }
  if (support) {
    return { kind: 'voxel', cell: billboardTopFaceCellForVoxel(support), support }
  }
  return { kind: 'ground', cell: { col: target.x, row: target.y } }
}

/**
 * O(1)-per-move occupancy index for projection/support lookups. Built ONCE per
 * scene-content change (not per mousemove) and keyed by world column `x,y`, so
 * the brush-ghost overlay can find the closest lower voxel without scanning all
 * occupied cells on every hover. Replaces the O(N)-per-move linear scan in
 * `billboardProjectionFaceForVoxel`.
 */
export interface ColumnOccupancy {
  /** column key `x,y` → cells in that column, ascending by z. */
  byColumn: Map<string, VoxelCellLite[]>
  /** world column `x` → ALL voxels at that x (any y/z). Used by the screen-cell
   *  hit-test: a screen column `col` is fed only by world column `x = col`, so we
   *  can enumerate hit candidates in O(voxels at x) without scanning the scene. */
  byX: Map<number, VoxelCellLite[]>
}

function columnKey(x: number, y: number): string {
  return `${x},${y}`
}

export function buildColumnOccupancy(cells: ReadonlyArray<VoxelCellLite>): ColumnOccupancy {
  const byColumn = new Map<string, VoxelCellLite[]>()
  const byX = new Map<number, VoxelCellLite[]>()
  for (const c of cells) {
    const k = columnKey(c.x, c.y)
    const arr = byColumn.get(k)
    if (arr) arr.push(c)
    else byColumn.set(k, [c])
    const xarr = byX.get(c.x)
    if (xarr) xarr.push(c)
    else byX.set(c.x, [c])
  }
  for (const arr of byColumn.values()) arr.sort((a, b) => a.z - b.z)
  return { byColumn, byX }
}

/** Incrementally insert cells into an EXISTING occupancy index (mutates it),
 *  O(k·log h) for k new cells instead of O(N) rebuilding over the whole scene.
 *  Skips cells already present (same x,y,z) so additive paint replays are
 *  idempotent. Keeps each column z-ascending via binary insertion. This is the
 *  occupancy twin of the incremental master append: a paint only touches the new
 *  cells, never re-scanning all N voxels. */
export function addCellsToColumnOccupancy(
  occ: ColumnOccupancy,
  cells: ReadonlyArray<VoxelCellLite>,
): void {
  for (const c of cells) {
    const k = columnKey(c.x, c.y)
    let arr = occ.byColumn.get(k)
    if (!arr) {
      occ.byColumn.set(k, [c])
    } else {
      // Binary-insert by z, skipping an exact duplicate (same z already there).
      let lo = 0, hi = arr.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (arr[mid].z < c.z) lo = mid + 1
        else hi = mid
      }
      if (lo < arr.length && arr[lo].z === c.z) continue // duplicate cell
      arr.splice(lo, 0, c)
    }
    const xarr = occ.byX.get(c.x)
    if (xarr) xarr.push(c)
    else occ.byX.set(c.x, [c])
  }
}

/** Same result as `billboardProjectionFaceForVoxel`, but O(column height) using
 *  the prebuilt index — column heights are tiny in practice, so this is O(1)
 *  per move instead of O(total cells). */
export function billboardProjectionFaceForVoxelIndexed(
  target: VoxelCellLite,
  occupancy: ColumnOccupancy,
): BillboardProjectionFace {
  const column = occupancy.byColumn.get(columnKey(target.x, target.y))
  let support: VoxelCellLite | null = null
  if (column) {
    // Ascending by z → last element with z < target.z is the closest support.
    for (let i = column.length - 1; i >= 0; i--) {
      if (column[i].z < target.z) { support = column[i]; break }
    }
  }
  if (support) {
    return { kind: 'voxel', cell: billboardTopFaceCellForVoxel(support), support }
  }
  return { kind: 'ground', cell: { col: target.x, row: target.y } }
}

/** Which face of a voxel a given screen cell hits (top cap vs front wall). */
export type BillboardHitFace = 'top' | 'front'

/** One voxel that projects onto a queried screen cell, with the face hit. */
export interface BillboardVoxelHit {
  voxel: VoxelCellLite
  /** Which of the voxel's two drawn faces the screen cell lands on. */
  face: BillboardHitFace
}

// Painter rank for occlusion-correct "top-most first" ordering. The billboard
// painter draws columns z ASC and, per voxel, the top cap BEFORE the front wall.
// The LAST pixel drawn at a screen cell is what the user sees on top, so a higher
// rank = visually-higher. We encode `z*2 (+1 for the front wall)`:
//   * a larger z always wins (its front wall paints over lower tops),
//   * at the same z the front wall (rank+1) sits above the top cap.
function billboardHitRank(voxel: VoxelCellLite, face: BillboardHitFace): number {
  return voxel.z * 2 + (face === 'front' ? 1 : 0)
}

/**
 * Multi-voxel hit-test: enumerate EVERY voxel whose drawn footprint (top cap at
 * `y-z-1` or front wall at `y-z`) covers the queried screen cell `(col, row)`,
 * ordered VISUALLY top-most first — matching exactly what the painter stacks on
 * screen. A single screen cell can belong to multiple voxels (different heights
 * along the same screen column project onto it), so this returns the full stack
 * used for first-click → top-most and repeat-click → progressively-lower cycling.
 *
 * Uses the prebuilt column occupancy `byX` index (world column `x` → its
 * voxels), so it is O(voxels at x = col): a screen column `col` is fed by
 * exactly the world column `x = col`, and a voxel `(col, y, z)` lands on screen
 * row `y-z-1` (top cap) or `y-z` (front wall). We test each voxel's projected
 * rows directly — exact, with no separate height assumption.
 */
export function billboardVoxelStackAtScreenCell(
  occupancy: ColumnOccupancy,
  col: number,
  row: number,
): BillboardVoxelHit[] {
  const hits: BillboardVoxelHit[] = []
  const cells = occupancy.byX.get(col)
  if (cells) {
    for (const c of cells) {
      // top cap → screen row (y - z - 1); front wall → screen row (y - z).
      if (c.y - c.z - 1 === row) hits.push({ voxel: c, face: 'top' })
      else if (c.y - c.z === row) hits.push({ voxel: c, face: 'front' })
    }
  }
  hits.sort((a, b) => {
    const ra = billboardHitRank(a.voxel, a.face)
    const rb = billboardHitRank(b.voxel, b.face)
    if (rb !== ra) return rb - ra // higher rank = visually on top → first
    // Deterministic tie-break: higher world y (closer to camera) first, then x.
    if (b.voxel.y !== a.voxel.y) return b.voxel.y - a.voxel.y
    return a.voxel.x - b.voxel.x
  })
  return hits
}

export function billboardObjectFootprintPreview(
  target: VoxelCellLite,
  footprint: GridFootprint,
  occupiedCells: ReadonlyArray<VoxelCellLite>,
): BillboardObjectFootprintPreview {
  const origin = snapFootprintToBottomCenter(target, footprint)
  const safeWidth = Math.max(1, Math.floor(footprint.width))
  const safeHeight = Math.max(1, Math.floor(footprint.height))
  const cells: BillboardObjectFootprintPreviewCell[] = []
  for (let dy = 0; dy < safeHeight; dy++) {
    for (let dx = 0; dx < safeWidth; dx++) {
      const voxel = { x: origin.x + dx, y: origin.y + dy, z: origin.z }
      cells.push({
        voxel,
        targetFace: billboardFrontFaceCellForVoxel(voxel),
        projection: billboardProjectionFaceForVoxel(voxel, occupiedCells),
      })
    }
  }
  return { origin, cells }
}

/** Indexed variant of `billboardObjectFootprintPreview` (O(footprint) per move
 *  instead of O(footprint × total cells)). */
export function billboardObjectFootprintPreviewIndexed(
  target: VoxelCellLite,
  footprint: GridFootprint,
  occupancy: ColumnOccupancy,
): BillboardObjectFootprintPreview {
  const origin = snapFootprintToBottomCenter(target, footprint)
  const safeWidth = Math.max(1, Math.floor(footprint.width))
  const safeHeight = Math.max(1, Math.floor(footprint.height))
  const cells: BillboardObjectFootprintPreviewCell[] = []
  for (let dy = 0; dy < safeHeight; dy++) {
    for (let dx = 0; dx < safeWidth; dx++) {
      const voxel = { x: origin.x + dx, y: origin.y + dy, z: origin.z }
      cells.push({
        voxel,
        targetFace: billboardFrontFaceCellForVoxel(voxel),
        projection: billboardProjectionFaceForVoxelIndexed(voxel, occupancy),
      })
    }
  }
  return { origin, cells }
}

/**
 * Object sprites are authored as footprint objects, not cube top-face textures.
 * Their anchor should land on the front/footprint face; using the top face shifts
 * z=0 objects one cell upward.
 */
export function billboardObjectAnchorCanvasXY(
  cell: VoxelCellLite,
  bbox: VoxelBbox,
  cellSize: number = SCREEN_CELL_SIZE,
): { x: number; y: number } {
  return billboardFrontFaceCanvasXY(cell, bbox, cellSize)
}
