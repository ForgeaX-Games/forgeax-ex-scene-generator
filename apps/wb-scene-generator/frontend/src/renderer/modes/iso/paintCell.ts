// 💡 mode-iso 单 cell 绘制
//
// dimetric 投影下,camera 朝 (-x, -y, -z) 方向看,可见三面是 +x, +y, +z 朝向的:
//   * top   —— +z 面(俯视盖子,菱形)
//   * right —— +x 面(屏幕右侧立面,平行四边形)
//   * left  —— +y 面(屏幕左侧立面,平行四边形)—— +y 在 dimetric 投影里映射到屏幕左下
//
// anchor (cx, cy) = voxel 的 back-left-bottom 角(world (x, y, z))在屏幕上的位置;
// 由 isoVoxelAnchorPx 算出。注意 dimetric 投影下,voxel 的 front-right-top 角
// (world (x+1, y+1, z+1))**会投到同一个屏幕点** (cx, cy) —— 这是 2:1 dimetric 的
// 几何性质(沿对角线的分量正好抵消)。三面在屏幕上以此点为公共顶点。
//
// 立方体 8 顶点投影(W = ISO_CELL_W = 16,H = ISO_CELL_H = 8):
//
//   A back-left-bot  (x,   y,   z)   → (cx,        cy        )
//   B back-right-bot (x+1, y,   z)   → (cx + W/2,  cy + H/2  )
//   C front-right-bot(x+1, y+1, z)   → (cx,        cy + H    )
//   D front-left-bot (x,   y+1, z)   → (cx - W/2,  cy + H/2  )
//   E back-left-top  (x,   y,   z+1) → (cx,        cy - H    )
//   F back-right-top (x+1, y,   z+1) → (cx + W/2,  cy - H/2  )
//   G front-right-top(x+1, y+1, z+1) → (cx,        cy        )   ← 同 A
//   H front-left-top (x,   y+1, z+1) → (cx - W/2,  cy - H/2  )
//
// 三个可见面的顶点(按顺时针):
//   * top   E F G H  = (cx, cy-H), (cx+W/2, cy-H/2), (cx, cy), (cx-W/2, cy-H/2)
//   * right F B C G  = (cx+W/2, cy-H/2), (cx+W/2, cy+H/2), (cx, cy+H), (cx, cy)
//   * left  H D C G  = (cx-W/2, cy-H/2), (cx-W/2, cy+H/2), (cx, cy+H), (cx, cy)
//
// drawMode 路由:
//   * 'color' —— 三面分别填色(top 基色 / left ×0.75 / right ×0.55),给立体感
//   * 'wire'  —— 三面只 stroke + 半透极浅底色

import { ISO_CELL_W, ISO_CELL_H } from '../../framework/geometry/iso'
import { colorForValue, rgbaToCss } from '../../framework/palette'
import type { DrawMode } from '../../types'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
type Rgba = { r: number; g: number; b: number; a: number }
type Pts = ReadonlyArray<[number, number]>

interface CellLite {
  x: number
  y: number
  z: number
  value: number
  layerIdx: number
  isSelected: boolean
  isEditorSelected: boolean
  isMultiValue: boolean
}

export function paintIsoCell(
  ctx: Ctx,
  cell: CellLite,
  anchor: { x: number; y: number },
  drawMode: DrawMode,
): void {
  const baseColor = colorForValue(cell.value, {
    selected: cell.isSelected,
    editorSelected: cell.isEditorSelected,
  })

  const faces = computeFaces(anchor.x, anchor.y)
  // Stage-2c.2: asset autotile —— 'asset' drawMode 暂统一走 color 分支
  if (drawMode === 'wire') paintWire(ctx, faces, baseColor)
  else paintColor(ctx, faces, baseColor)
}

// ── 三面顶点计算 ────────────────────────────────────────────────────────

function computeFaces(cx: number, cy: number): { top: Pts; right: Pts; left: Pts } {
  const halfW = ISO_CELL_W / 2     // 8
  const halfH = ISO_CELL_H / 2     // 4
  const fullH = ISO_CELL_H          // 8

  // top face (rhombus,顶点 E F G H 顺时针)
  const top: Pts = [
    [cx,         cy - fullH],     // E:back
    [cx + halfW, cy - halfH],     // F:right
    [cx,         cy        ],     // G:front (= A)
    [cx - halfW, cy - halfH],     // H:left
  ]
  // right face (+x,顶点 F B C G 顺时针)
  const right: Pts = [
    [cx + halfW, cy - halfH],     // F:top-back
    [cx + halfW, cy + halfH],     // B:bot-back
    [cx,         cy + fullH],     // C:bot-front
    [cx,         cy        ],     // G:top-front
  ]
  // left face (+y,顶点 H D C G 顺时针)
  const left: Pts = [
    [cx - halfW, cy - halfH],     // H:top-back
    [cx - halfW, cy + halfH],     // D:bot-back
    [cx,         cy + fullH],     // C:bot-front
    [cx,         cy        ],     // G:top-front
  ]
  return { top, right, left }
}

// ── color 三面 fill ─────────────────────────────────────────────────────

function paintColor(ctx: Ctx, faces: { top: Pts; right: Pts; left: Pts }, base: Rgba): void {
  fillPath(ctx, faces.left,  rgbaToCss(scaleRgb(base, 0.75)))
  fillPath(ctx, faces.right, rgbaToCss(scaleRgb(base, 0.55)))
  fillPath(ctx, faces.top,   rgbaToCss(base))
  // 选中态:colorForValue 收到 selected/editorSelected 时已经提亮
  // 了 base,三面颜色对应跟着变;不再额外画轮廓 stroke(iso 视角下 6 条外轮廓边的
  // 信息量小,叠 stroke 反而增噪)。
}

// ── wire:三面 stroke + 极浅半透底 ─────────────────────────────────────

function paintWire(ctx: Ctx, faces: { top: Pts; right: Pts; left: Pts }, base: Rgba): void {
  const stroke = rgbaToCss(base)
  const fill = rgbaToCss({ ...base, a: Math.max(20, Math.round(base.a * 0.15)) })

  fillPath(ctx, faces.left,  fill)
  fillPath(ctx, faces.right, fill)
  fillPath(ctx, faces.top,   fill)

  ctx.lineWidth = 1
  ctx.lineCap = 'butt'
  strokePath(ctx, faces.top,   stroke)
  strokePath(ctx, faces.right, stroke)
  strokePath(ctx, faces.left,  stroke)
}

// ── helpers ────────────────────────────────────────────────────────────

function fillPath(ctx: Ctx, pts: Pts, fillStyle: string): void {
  ctx.fillStyle = fillStyle
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
  ctx.closePath()
  ctx.fill()
}

function strokePath(ctx: Ctx, pts: Pts, strokeStyle: string): void {
  ctx.strokeStyle = strokeStyle
  ctx.beginPath()
  ctx.moveTo(pts[0][0] + 0.5, pts[0][1] + 0.5)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] + 0.5, pts[i][1] + 0.5)
  ctx.closePath()
  ctx.stroke()
}

function scaleRgb(c: Rgba, factor: number): Rgba {
  return {
    r: Math.round(c.r * factor),
    g: Math.round(c.g * factor),
    b: Math.round(c.b * factor),
    a: c.a,
  }
}
