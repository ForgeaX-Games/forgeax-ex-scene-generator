// 💡 mode-top 几何工具
//
// 顶视(orthographic top-down)的 cell ↔ 屏幕坐标映射。其他视角(iso / free3d)
// 实现自己的 geometry 文件,签名同形式,plugin 内部只 import 自己那一份。
//
// 屏幕坐标系约定:
//   * CSS 像素,左上 (0,0),X 向右、Y 向下
//   * 主网格基准原点 originX/Y 由 host 计算并通过 params 传入
//   * 单元格大小 cellSize:屏幕模式统一 SCREEN_CELL_SIZE = 8 CSS px
//
// 图层对齐策略:
//   * 主 grid 尺寸 = 所有可见图层 bounding box 的 max(rows, cols)(host 算)
//   * 单层 layer(rows < master rows)按"左对齐 + 底对齐"放在主 grid 内,
//     与现有 rendererTypes.getLayerOrigin 一致(legacy 视觉不回归)

export interface TopGeometryParams {
  /** 主 grid 行数(所有可见图层 bbox 的 max) */
  maxRows: number
  /** 主 grid 列数 */
  maxCols: number
  /** 主网格在 canvas 中的左上角 CSS 像素坐标 */
  originX: number
  originY: number
  /** 1 cell = N CSS px(SCREEN_CELL_SIZE) */
  cellSize: number
}

/**
 * 计算主网格基准原点(左上角 CSS 像素)。
 * 原则:把主网格居中于 canvas;canvas 比 grid 大时左/上有空白。
 */
export function topMasterOrigin(
  cssWidth: number,
  cssHeight: number,
  maxCols: number,
  maxRows: number,
  cellSize: number,
): { originX: number; originY: number } {
  return {
    // 整数化:奇数尺寸下避免 0.5 偏移导致亚像素错配
    originX: Math.round((cssWidth - cellSize * maxCols) / 2),
    originY: Math.round((cssHeight - cellSize * maxRows) / 2),
  }
}

/**
 * 单层 layer 在主网格内的左上角 CSS 像素。
 * 左对齐 + 底对齐(layer rows 小于 master 时,从主网格底部往上贴齐)。
 */
export function topLayerOrigin(
  layerRows: number,
  layerCols: number,
  params: TopGeometryParams,
): { x: number; y: number } {
  void layerCols  // 当前左对齐,不用 cols;保留参数以备未来居中模式
  return {
    x: params.originX,
    y: params.originY + (params.maxRows - layerRows) * params.cellSize,
  }
}

/** Cell (col, row) 中心点的 CSS 像素(layer 局部) */
export function topCellCenter(
  layerOrigin: { x: number; y: number },
  col: number,
  row: number,
  cellSize: number,
): { x: number; y: number } {
  return {
    x: layerOrigin.x + (col + 0.5) * cellSize,
    y: layerOrigin.y + (row + 0.5) * cellSize,
  }
}

/**
 * CSS 像素 → cell (col, row),逆视口变换。
 *
 * 注意:viewport 变换(translate(cx+offX) → scale(viewScale) → translate(-cx))
 * 由调用方先逆掉,再调本函数。本函数只处理 layer-local 网格几何。
 */
export function topScreenToCell(
  layerOrigin: { x: number; y: number },
  cssX: number,
  cssY: number,
  cellSize: number,
  layerRows: number,
  layerCols: number,
): { col: number; row: number } | null {
  const col = Math.floor((cssX - layerOrigin.x) / cellSize)
  const row = Math.floor((cssY - layerOrigin.y) / cellSize)
  if (col < 0 || col >= layerCols || row < 0 || row >= layerRows) return null
  return { col, row }
}
