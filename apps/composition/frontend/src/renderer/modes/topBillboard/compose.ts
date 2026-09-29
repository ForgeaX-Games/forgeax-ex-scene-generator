// 💡 mode-topBillboard 主画布合成
//
// 输入:一张 voxel master surface(billboard 立面 + z 抬升预先栅格化的结果) + viewport。
// 输出:绘制到主 canvas。
//
// 顺序:
//   ① clear + bg
//   ② DPR scale
//   ③ viewport transform
//   ④ voxel master drawImage(一次,全部 voxel)
//
// Stage-2c.1: voxel only —— legacy 还有 GridLayer per-layer drawImage 路径(复用
// mode-top buildSurface),scene-generator 无 grid 数据源,整段 drop。voxel master
// 没有 per-layer 选中描边(选中态作为 stroke/fill 调子直接进 master 像素;本 slice
// 选中态恒 false,实际不触发)。

import { topMasterOrigin } from '../../framework/geometry/top'
import type { VoxelBbox } from '../../framework/geometry/topBillboard'
import { devicePixelRatio, type Surface2D } from '../../framework/canvas2d'
import { drawOrthographicGuides2d } from '../../framework/guides2d'

export interface ComposeArgs {
  canvas: HTMLCanvasElement
  /** voxel 整组合成的 master surface;为 null 表示无 voxel 层 */
  voxelMaster: { canvas: Surface2D; bbox: VoxelBbox } | null
  /** 主 grid bounding box(voxel 占据的世界坐标极值,用于居中) */
  maxRows: number
  maxCols: number
  cellSize: number
  /** viewport2d */
  offsetX: number
  offsetY: number
  scale: number
  /** Draw the infinite alignment grid lines and origin axes (view aid). */
  showGrid?: boolean
}

/** 从 CSS background 读画布底色(与 mode-top compose 行为一致) */
function readCanvasBg(el: HTMLElement): string {
  const cs = window.getComputedStyle(el)
  const bg = cs.backgroundColor
  if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg
  return '#000'
}

export function composeFrame(args: ComposeArgs): void {
  const { canvas, voxelMaster, maxRows, maxCols, cellSize, offsetX, offsetY, scale, showGrid } = args
  // jsdom (no `canvas` pkg) throws on getContext rather than returning null;
  // treat any failure as "no 2D context" so the plugin still mounts cleanly.
  let ctx: CanvasRenderingContext2D | null = null
  try { ctx = canvas.getContext('2d') } catch { ctx = null }
  if (!ctx) return

  const dpr = devicePixelRatio()
  const sizeSource = canvas.parentElement ?? canvas
  const rect = sizeSource.getBoundingClientRect()
  const cssW = Math.round(rect.width)
  const cssH = Math.round(rect.height)
  if (cssW <= 0 || cssH <= 0) return

  // resize drawing buffer 仅当尺寸变化(避免每帧重 setSize 导致清屏)
  const wantW = Math.round(cssW * dpr)
  const wantH = Math.round(cssH * dpr)
  if (canvas.width !== wantW || canvas.height !== wantH) {
    canvas.width = wantW
    canvas.height = wantH
    canvas.style.width = cssW + 'px'
    canvas.style.height = cssH + 'px'
  }

  // ① bg
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = readCanvasBg(canvas)
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // Nothing to draw (no content and no grid) → leave the cleared bg.
  if (!voxelMaster && !showGrid) return

  // ② DPR
  ctx.scale(dpr, dpr)

  // ③ viewport transform
  const cx = Math.round(cssW / 2)
  const cy = Math.round(cssH / 2)
  const offX = Math.round(offsetX)
  const offY = Math.round(offsetY)
  ctx.translate(cx + offX, cy + offY)
  ctx.scale(scale, scale)
  ctx.translate(-cx, -cy)

  // Grid origin (shared with screenToCell / paint). maxRows/maxCols are ≥1 even
  // with no content, so the grid still has a stable anchor on an empty canvas.
  const { originX, originY } = topMasterOrigin(cssW, cssH, maxCols, maxRows, cellSize)

  ctx.imageSmoothingEnabled = false

  // ④ voxel master:画在 worldOffset 处,顶上 z 抬升的 cells 自然超出 master grid 上沿
  if (voxelMaster && maxRows > 0 && maxCols > 0) {
    const { canvas: vmCanvas, bbox } = voxelMaster
    const vx = originX + bbox.worldOffsetX * cellSize
    const vy = originY + bbox.worldOffsetY * cellSize
    ctx.drawImage(vmCanvas as unknown as CanvasImageSource, vx, vy, bbox.cols * cellSize, bbox.rows * cellSize)
  }

  // ⑤ grid lines — drawn LAST so they overlay every layer (alignment guide).
  if (showGrid) {
    drawOrthographicGuides2d(ctx, { cssW, cssH, cellSize, offsetX: offX, offsetY: offY, scale, originX, originY })
  }
}

/**
 * Incremental compose: after an in-place dirty-region append, ONLY a small
 * master sub-rect (`dirtyMasterPx`, in master-canvas px) changed. Re-blit just
 * that sub-rect to its screen position instead of re-drawing (and downscaling)
 * the ENTIRE — potentially thousands×thousands px — master every paint.
 *
 * Returns false if it can't safely do the partial blit (caller falls back to a
 * full composeFrame): no ctx, size mismatch (needs resize), or no master.
 *
 * NOTE: does NOT clear the whole canvas or repaint the grid globally — the prior
 * frame's pixels outside the dirty rect remain valid (the master only changed
 * inside the dirty rect, and the viewport didn't move). We DO clear+redraw the
 * background under the dirty rect (so cleared/erased master pixels show bg) and,
 * if the grid is on, re-stroke grid lines clipped to the dirty rect.
 */
export function composeDirtyRect(
  args: ComposeArgs,
  dirtyMasterPx: { x0: number; y0: number; x1: number; y1: number },
): boolean {
  const { canvas, voxelMaster, maxRows, maxCols, cellSize, offsetX, offsetY, scale, showGrid } = args
  if (!voxelMaster || maxRows <= 0 || maxCols <= 0) return false
  let ctx: CanvasRenderingContext2D | null = null
  try { ctx = canvas.getContext('2d') } catch { ctx = null }
  if (!ctx) return false

  const dpr = devicePixelRatio()
  const sizeSource = canvas.parentElement ?? canvas
  const rect = sizeSource.getBoundingClientRect()
  const cssW = Math.round(rect.width)
  const cssH = Math.round(rect.height)
  if (cssW <= 0 || cssH <= 0) return false
  // A buffer-size change requires a full repaint (the whole canvas was cleared).
  const wantW = Math.round(cssW * dpr)
  const wantH = Math.round(cssH * dpr)
  if (canvas.width !== wantW || canvas.height !== wantH) return false

  const dw = dirtyMasterPx.x1 - dirtyMasterPx.x0
  const dh = dirtyMasterPx.y1 - dirtyMasterPx.y0
  if (dw <= 0 || dh <= 0) return false

  // Apply the SAME transform stack as composeFrame so screen coords line up.
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.scale(dpr, dpr)
  const cx = Math.round(cssW / 2)
  const cy = Math.round(cssH / 2)
  const offX = Math.round(offsetX)
  const offY = Math.round(offsetY)
  ctx.translate(cx + offX, cy + offY)
  ctx.scale(scale, scale)
  ctx.translate(-cx, -cy)
  const { originX, originY } = topMasterOrigin(cssW, cssH, maxCols, maxRows, cellSize)
  ctx.imageSmoothingEnabled = false

  const { canvas: vmCanvas, bbox } = voxelMaster
  const vx = originX + bbox.worldOffsetX * cellSize
  const vy = originY + bbox.worldOffsetY * cellSize
  // The master is drawn scaled from (bbox.cols*cellSize × bbox.rows*cellSize) px
  // down to (bbox.cols × bbox.rows) world units at `cellSize`-per-cell logical.
  // Source→dest scale = 1 / (cellSize_master / cellSize_logical). Since master is
  // baked at its own cellSize and drawn at logical cellSize, the per-axis ratio
  // is logicalCellSpan / masterPxSpan = (bbox.cols*cellSize)/(masterW). Compute
  // the dest rect for the dirty sub-rect directly from that ratio.
  const masterW = vmCanvas.width
  const masterH = vmCanvas.height
  if (masterW <= 0 || masterH <= 0) return false
  const destFullW = bbox.cols * cellSize
  const destFullH = bbox.rows * cellSize
  const sx = dirtyMasterPx.x0
  const sy = dirtyMasterPx.y0
  const destX = vx + (sx / masterW) * destFullW
  const destY = vy + (sy / masterH) * destFullH
  const destW = (dw / masterW) * destFullW
  const destH = (dh / masterH) * destFullH

  ctx.save()
  // Clip to the dest dirty rect so bg fill + grid strokes don't bleed outside.
  if (typeof ctx.beginPath === 'function' && typeof ctx.rect === 'function' && typeof ctx.clip === 'function') {
    ctx.beginPath()
    ctx.rect(destX, destY, destW, destH)
    ctx.clip()
  }
  // Repaint bg under the dirty rect first (so erased master pixels show bg, and
  // the source-over master blit composites cleanly over it).
  ctx.fillStyle = readCanvasBg(canvas)
  ctx.fillRect(destX, destY, destW, destH)
  ctx.drawImage(
    vmCanvas as unknown as CanvasImageSource,
    sx, sy, dw, dh,
    destX, destY, destW, destH,
  )
  if (showGrid) {
    drawOrthographicGuides2d(ctx, { cssW, cssH, cellSize, offsetX: offX, offsetY: offY, scale, originX, originY })
  }
  ctx.restore()
  return true
}
