// 💡 mode-top 主画布合成
//
// 输入:每层 OffscreenCanvas(layerKey → surface) + 每层 metadata + viewport。
// 输出:绘制到主 canvas。
//
// 顺序:
//   ① clear + 背景填充
//   ② DPR 缩放
//   ③ viewport 变换:translate(cx + offset) → scale(viewScale) → translate(-cx)
//   ④ 每层按 z-order 调 drawImage(surface, originX, originY, cols×cellSize, rows×cellSize)
//      imageSmoothingEnabled = false(nearest neighbor,1 px=1 cell)
//   ⑤ 选中 stroke pass(本 slice 选中态恒 false,实际不触发)
//
// viewport 变化只触发本函数,不触发 buildSurface —— 这是「局部重绘」的关键。

import { topLayerOrigin, topMasterOrigin, type TopGeometryParams } from '../../framework/geometry/top'
import { devicePixelRatio, type Surface2D } from '../../framework/canvas2d'
import { drawOrthographicGuides2d } from '../../framework/guides2d'

export interface ComposeLayer {
  layerKey: string
  /** 该层在 z-order 中的位置(由 plugin 内部排序后传入,不在合成阶段重排) */
  rows: number
  cols: number
  surface: Surface2D
  /** §7.1 选中协议:layer 自身被点中(LayersSidePanel / 画布点击) */
  isSelected?: boolean
  /** §7.1 选中协议:editor 选中(WS editor:selection 同步) */
  isEditorSelected?: boolean
  /**
   * 世界对齐:layer-local (0,0) 对应世界 (worldOffsetX, worldOffsetY)。
   *   * voxel 来源(SceneOutput 投影):worldOffsetX/Y = (minX, minY),layer
   *     整体偏移到 cells 的真实包围盒位置;选中描边 / 布局都按真实矩形
   */
  worldAlign?: boolean
  worldOffsetX?: number
  worldOffsetY?: number
  /** 非零 mask 的 cell-unit 外轮廓，用于选中态实线描边 */
  maskOutlinePath?: Path2D
}

export interface ComposeArgs {
  canvas: HTMLCanvasElement
  layers: ComposeLayer[]
  /** 主 grid bounding box(所有可见层的 max);决定坐标系基准 */
  maxRows: number
  maxCols: number
  cellSize: number
  /** 来自 store viewport2d */
  offsetX: number
  offsetY: number
  scale: number
  /** Draw viewport-spanning grid lines and emphasized origin axes. */
  showGrid?: boolean
}

/** 从 CSS background 读画布底色(与 mode-iso compose 行为一致) */
function readCanvasBg(el: HTMLElement): string {
  const cs = window.getComputedStyle(el)
  const bg = cs.backgroundColor
  if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg
  return '#000'
}

export function composeFrame(args: ComposeArgs): void {
  const { canvas, layers, maxRows, maxCols, cellSize, offsetX, offsetY, scale, showGrid } = args
  // jsdom (no `canvas` pkg) throws on getContext rather than returning null;
  // treat any failure as "no 2D context" so the plugin still mounts cleanly.
  let ctx: CanvasRenderingContext2D | null = null
  try { ctx = canvas.getContext('2d') } catch { ctx = null }
  if (!ctx) return

  const dpr = devicePixelRatio()
  // ⚠️ 必须读父容器的 rect,不是 canvas 自己的:canvas 一旦被 inline
  // style.width/height 钉住,后续 getBoundingClientRect 返回的是钉住的旧值,
  // 父容器(侧栏开关 / window resize)真实尺寸变化拿不到。
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

  // ① 背景
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = readCanvasBg(canvas)
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  if ((layers.length === 0 && !showGrid) || maxRows <= 0 || maxCols <= 0) return

  // ② DPR
  ctx.scale(dpr, dpr)

  // ③ viewport 变换
  const cx = Math.round(cssW / 2)
  const cy = Math.round(cssH / 2)
  const offX = Math.round(offsetX)
  const offY = Math.round(offsetY)
  ctx.translate(cx + offX, cy + offY)
  ctx.scale(scale, scale)
  ctx.translate(-cx, -cy)

  // ④ 逐层 drawImage(nearest neighbor,1 px = 1 cell)
  ctx.imageSmoothingEnabled = false
  const { originX, originY } = topMasterOrigin(cssW, cssH, maxCols, maxRows, cellSize)
  const params: TopGeometryParams = { maxRows, maxCols, originX, originY, cellSize }
  const layerOrigins: Array<{ x: number; y: number }> = []
  for (const layer of layers) {
    // worldAlign(voxel)→ 平移到 cells 真实 bbox 起点(originX + minX*cs, originY + minY*cs);
    //                   layer 内 cell 是 layer-local 坐标(已减 minX/minY)
    const lo = layer.worldAlign
      ? {
          x: originX + (layer.worldOffsetX ?? 0) * cellSize,
          y: originY + (layer.worldOffsetY ?? 0) * cellSize,
        }
      : topLayerOrigin(layer.rows, layer.cols, params)
    layerOrigins.push(lo)
    ctx.drawImage(layer.surface as unknown as CanvasImageSource, lo.x, lo.y, layer.cols * cellSize, layer.rows * cellSize)
  }

  // ⑤ wire 模式的外轮廓已经预先栅格化进 layer.surface(buildWireSurface 阶段),
  // compose 不再做 stroke pass。
  //
  // 选中 stroke pass:
  //   * 非零 mask 外轮廓:细实线
  //   * 整层包围盒:虚线,用于和 mask 轮廓区分
  // editor 选中 → success 绿;layer 选中 → accent 绿(优先级:layer > editor)
  const SELECT_LAYER_COLOR = 'rgba(212, 255, 72, 0.95)'   // accent
  const SELECT_EDITOR_COLOR = 'rgba(62, 207, 107, 0.85)'  // success
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]
    if (!layer.isSelected && !layer.isEditorSelected) continue
    const lo = layerOrigins[i]
    const strokeColor = layer.isSelected ? SELECT_LAYER_COLOR : SELECT_EDITOR_COLOR
    ctx.save()

    if (layer.maskOutlinePath) {
      ctx.save()
      ctx.translate(lo.x, lo.y)
      ctx.scale(cellSize, cellSize)
      ctx.strokeStyle = strokeColor
      ctx.lineWidth = (1.1 / scale) / cellSize
      ctx.lineCap = 'butt'
      ctx.setLineDash([])
      ctx.stroke(layer.maskOutlinePath)
      ctx.restore()
    }

    ctx.strokeStyle = strokeColor
    ctx.lineWidth = 1.8 / scale
    ctx.setLineDash([6 / scale, 4 / scale])
    // 略微外扩让虚线框贴在图层外缘
    const off = 1 / scale
    ctx.strokeRect(
      lo.x - off, lo.y - off,
      layer.cols * cellSize + 2 * off,
      layer.rows * cellSize + 2 * off,
    )
    ctx.setLineDash([])
    ctx.restore()
  }

  if (showGrid) {
    drawOrthographicGuides2d(ctx, {
      cssW,
      cssH,
      cellSize,
      offsetX: offX,
      offsetY: offY,
      scale,
      originX,
      originY,
    })
  }
}
