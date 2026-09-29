// 💡 2D 视口 pan/zoom 纯函数
//
// 与 legacy renderer(components/RenderCanvas)的「滚轮缩放 / 拖拽平移」数学保持一致,
// 抽成无副作用的纯函数以便:
//   * store action(panViewport2d / resetViewport2d)直接复用
//   * host RenderCanvas 的鼠标 / 滚轮事件处理器复用
//   * 单测断言(zoom-around-cursor 锚点、量化步进、min/max clamp)
//
// 坐标约定与 compose 的视口变换严格互逆:
//   compose: translate(cx + offset) → scale(viewScale) → translate(-cx)
//   屏幕点 (mouseX,mouseY) 相对容器左上;cx/cy = 容器中心(width/2, height/2)。

export interface Viewport2DState {
  offsetX: number
  offsetY: number
  scale: number
}

// 缩放下限沿用 legacy(滚轮 raw = Math.max(0.01, ...));上限新增护栏,防止
// 持续滚动把 scale 推到极端值导致 drawImage 退化 / 数值不稳。
export const MIN_SCALE = 0.01
export const MAX_SCALE = 64

/** 把量化后的 scale clamp 到 [MIN_SCALE, MAX_SCALE]。 */
function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))
}

/**
 * legacy 的「缩放到漂亮步长」量化:raw 取一个数量级以下的步长 magnitude,
 * 四舍五入到该步长的整数倍。返回 { nextScale, magnitude }(magnitude 供调用方做
 * "变化太小则忽略" 的阈值判断,完全复刻 legacy 行为)。
 */
function quantizeScale(raw: number): { nextScale: number; magnitude: number } {
  const bounded = Math.max(MIN_SCALE, raw)
  const magnitude = Math.pow(10, Math.floor(Math.log10(bounded)) - 1)
  const nextScale = Math.round(bounded / magnitude) * magnitude
  return { nextScale: clampScale(nextScale), magnitude }
}

/**
 * 增量平移(CSS 像素)。offset 全程取整,保证 compose 的 ctx.translate 与几何
 * 对齐基准拿到完全一致的整数 offset(避免亚像素漂移)。
 */
export function panViewport(vp: Viewport2DState, dx: number, dy: number): Viewport2DState {
  return {
    ...vp,
    offsetX: Math.round(vp.offsetX + dx),
    offsetY: Math.round(vp.offsetY + dy),
  }
}

export interface ZoomAtPointArgs {
  /** 鼠标相对容器左上角的 CSS 像素位置 */
  mouseX: number
  mouseY: number
  /** 容器中心(width/2, height/2) */
  cx: number
  cy: number
  /** 滚轮 deltaY(>0 缩小 / <0 放大) */
  deltaY: number
}

/**
 * 以光标为锚点缩放。返回新视口;若量化后 scale 变化太小(legacy 阈值
 * magnitude*0.5)则返回 null,表示"忽略这一步"(避免高频滚轮抖动)。
 *
 * 锚点修正:让光标下的世界点在缩放前后落在同一屏幕像素。
 *   newOffset = (mouse - center) - (mouse - center - oldOffset) * (next/old)
 */
export function zoomViewportAtPoint(vp: Viewport2DState, args: ZoomAtPointArgs): Viewport2DState | null {
  const dir = args.deltaY > 0 ? 0.9 : 1.1
  const { nextScale, magnitude } = quantizeScale(vp.scale * dir)
  if (Math.abs(nextScale - vp.scale) < magnitude * 0.5) return null
  const scaleDiff = nextScale / vp.scale
  const offsetX = Math.round((args.mouseX - args.cx) - (args.mouseX - args.cx - vp.offsetX) * scaleDiff)
  const offsetY = Math.round((args.mouseY - args.cy) - (args.mouseY - args.cy - vp.offsetY) * scaleDiff)
  return { scale: nextScale, offsetX, offsetY }
}

/**
 * 以视口中心为锚点缩放一步(供工具栏 +/- 按钮用,无需知道容器尺寸)。
 * 中心锚点下,新 offset 仅按 scaleDiff 等比缩放(mouse==center 时锚点公式化简)。
 */
export function zoomViewportCentered(vp: Viewport2DState, direction: 'in' | 'out'): Viewport2DState | null {
  const dir = direction === 'in' ? 1.1 : 0.9
  const { nextScale, magnitude } = quantizeScale(vp.scale * dir)
  if (Math.abs(nextScale - vp.scale) < magnitude * 0.5) return null
  const scaleDiff = nextScale / vp.scale
  return {
    scale: nextScale,
    offsetX: Math.round(vp.offsetX * scaleDiff),
    offsetY: Math.round(vp.offsetY * scaleDiff),
  }
}

/** 默认视口(offset=0,0 / scale=1)。 */
export const DEFAULT_VIEWPORT_2D: Viewport2DState = { offsetX: 0, offsetY: 0, scale: 1 }
