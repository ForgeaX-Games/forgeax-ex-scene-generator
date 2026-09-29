// 💡 mode-iso 几何工具(2:1 dimetric / "isometric pixel art")
//
// voxel (x, y, z) → screen (sx, sy) 投影:
//   sx = (x - y) * cellW / 2
//   sy = (x + y) * cellH / 2 - z * cellH
//
// 其中 cellW : cellH = 2 : 1。比"真 30° 等角"计算便宜,跟像素 grid 也对齐。
// 每 voxel 在屏幕上占一个 cellW × (cellH * 2) 的菱形外接矩形,内部三面:
//   * top    —— 上方菱形(俯视的盖子)
//   * left   —— 左下平行四边形(camera 左边的立面)
//   * right  —— 右下平行四边形(camera 右边的立面)
//
// 几何常量沿用 SCREEN_CELL_SIZE = 8 CSS px / cell。dimetric 下:
//   cellW = SCREEN_CELL_SIZE * 2 = 16
//   cellH = SCREEN_CELL_SIZE     = 8
//
// painter sort 用 (x + y + z) ASC:对角线越小越远(屏幕上越左上),晚 layer 后画。

import { SCREEN_CELL_SIZE } from './constants'

export const ISO_CELL_W = SCREEN_CELL_SIZE * 2
export const ISO_CELL_H = SCREEN_CELL_SIZE

export interface IsoVoxelCellLite {
  x: number
  y: number
  z: number
}

export interface IsoBbox {
  /** master canvas 像素宽 / 高 */
  pxW: number
  pxH: number
  /**
   * voxel master canvas 的世界原点偏移(屏幕坐标)。compose 阶段把 master 画到
   *   (frameOriginX + worldOffsetX, frameOriginY + worldOffsetY)
   * voxel (0,0,0) 在 master canvas 内的像素位置 = (-worldOffsetX, -worldOffsetY)。
   */
  worldOffsetX: number
  worldOffsetY: number
}

/**
 * 给定一组 voxel cells,算出 master canvas 需要的尺寸 + 世界原点偏移。
 *
 * 思路:
 *   1. 对每个 cell 投影出"包络矩形"(x: [sx-cellW/2, sx+cellW/2], y: [sy-cellH, sy+cellH])
 *   2. 取最 small/large 的 sx / sy 算 bbox
 *   3. worldOffsetX = -minSx,worldOffsetY = -minSy(让 master canvas (0,0) 对应 minSx/minSy)
 */
export function computeIsoBbox(cells: ReadonlyArray<IsoVoxelCellLite>): IsoBbox {
  if (cells.length === 0) {
    return { pxW: 1, pxH: 1, worldOffsetX: 0, worldOffsetY: 0 }
  }
  let minSx = Infinity, maxSx = -Infinity
  let minSy = Infinity, maxSy = -Infinity
  for (const c of cells) {
    const sx = (c.x - c.y) * (ISO_CELL_W / 2)
    const sy = (c.x + c.y) * (ISO_CELL_H / 2) - c.z * ISO_CELL_H
    // top face 上沿 = sy - cellH;left/right face 下沿 = sy + cellH
    if (sx - ISO_CELL_W / 2 < minSx) minSx = sx - ISO_CELL_W / 2
    if (sx + ISO_CELL_W / 2 > maxSx) maxSx = sx + ISO_CELL_W / 2
    if (sy - ISO_CELL_H < minSy) minSy = sy - ISO_CELL_H
    if (sy + ISO_CELL_H > maxSy) maxSy = sy + ISO_CELL_H
  }
  return {
    pxW: Math.max(1, Math.ceil(maxSx - minSx)),
    pxH: Math.max(1, Math.ceil(maxSy - minSy)),
    worldOffsetX: -minSx,
    worldOffsetY: -minSy,
  }
}

/**
 * voxel cell 在 master canvas 内的"锚点"像素坐标。
 *
 * 锚点 = world (x, y, z) 的投影 = voxel 立方体的 back-left-bottom 角(camera 看不见
 * 的最后角)。dimetric 投影下,front-right-top 角 (x+1, y+1, z+1) **正好投到同一个
 * 屏幕点** —— 所以这个锚点也是三个可见面(top / right / left)的公共顶点。
 *
 * paintCell 拿这个锚点 ± W/2、± H/2 算三面其它顶点(详见 modes/iso/paintCell.ts)。
 */
export function isoVoxelAnchorPx(
  cell: IsoVoxelCellLite,
  bbox: IsoBbox,
): { x: number; y: number } {
  const sx = (cell.x - cell.y) * (ISO_CELL_W / 2)
  const sy = (cell.x + cell.y) * (ISO_CELL_H / 2) - cell.z * ISO_CELL_H
  return { x: sx + bbox.worldOffsetX, y: sy + bbox.worldOffsetY }
}
