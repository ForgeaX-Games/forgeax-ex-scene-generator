// 💡 视角无关的单元格源(CellSource)
//
// 把 RendererVoxelLayer(稀疏 3D 体素)抽象为统一的"非零格子可遍历对象"。
// 各个 ViewMode plugin 按 CellSource 而非具体类型来构造 surface,从而:
//   * mode-top 消费 voxel(投顶视图,忽略 z)
//   * mode-iso / mode-free3d 同样消费,只是几何映射不同(iso 用 z 改投影坐标;
//     free3d 直接 3D)
//
// CellSource 不持有 layer 引用之外的状态;.iterCells 每次调用都重走一遍底层数据。
// 调用方应该把 CellSource 包在 useLayerSurface 的 build 函数里,缓存结果。

import type { GridLayer, RendererVoxelLayer } from '../types'

/** 单个非零格子的视角无关描述 */
export interface CellRecord {
  col: number
  row: number
  value: number
  /** 仅 voxel 来源携带;top 视角忽略,iso/free3d 用作高度 */
  z?: number
  /** Optional baked-object instance metadata; legacy cells omit it. */
  state?: Record<string, unknown>
}

export interface CellSource {
  /** layer-local rows(紧贴非零 cell 的 bbox 高度) */
  rows: number
  /** layer-local cols(紧贴非零 cell 的 bbox 宽度) */
  cols: number
  /**
   * 世界坐标偏移:layer-local (0,0) 对应世界 (worldOffsetX, worldOffsetY)。
   * iterCells 报的 cell.col / cell.row 已经是 layer-local(减掉 worldOffset 后),
   * compose 将 layer 整体平移 (worldOffsetX, worldOffsetY) 个 cellSize 即可还原。
   *
   *   * RendererVoxelLayer 顶视投影:offset = (minX, minY),让 OffscreenCanvas
   *     紧贴 cells bbox,选中描边等几何也对齐到真实矩形
   */
  worldOffsetX: number
  worldOffsetY: number
  /** 该 source 对应的 store layerKey;选中态比对用 */
  layerKey: string
  /** 该 source 对应的 nodeId;editor 选中比对用 */
  nodeId: string
  /** 用作 useLayerSurface version(数据未变 → version 不变 → 不重 build) */
  version: number
  /** 多值标识:value 域大小 > 1 时为 true(供 plugin 决定是否按值取色) */
  isMultiValue: boolean
  /** 遍历可见非零格子;col/row 为 layer-local */
  iterCells(visit: (cell: CellRecord) => void): void
}

// ── GridLayer 适配(稠密 2D 预览;来自任意节点的 grid 输出) ──────────
//
// grid.data 是 [row][col] 稠密数组,值 0 表示空格(不绘制),非 0 视为填充并按值取色。
// worldOffset 永远 (0,0)(dense 数组从 0 起)。isMultiValue 由非零去重值数量 > 1 决定:
//   * binary grid(如 max_rectangle 的 0/1)→ 单值 → 按 cell.value 取色(colorForValue)
//   * 多值 / 浮点场(如 cellular_noise)→ 多值 → 按 value 取色(热力图)
export function gridLayerCellSource(layer: GridLayer): CellSource {
  const data = layer.data
  const seen = new Set<number>()
  for (let r = 0; r < data.length && seen.size <= 1; r++) {
    const row = data[r]
    if (!row) continue
    for (let c = 0; c < row.length; c++) {
      const v = row[c]
      if (v !== 0) seen.add(v)
      if (seen.size > 1) break
    }
  }
  return {
    rows: layer.rows,
    cols: layer.cols,
    worldOffsetX: 0,
    worldOffsetY: 0,
    layerKey: layer.key,
    nodeId: layer.nodeId,
    version: layer.updatedAt,
    isMultiValue: seen.size > 1,
    iterCells: (visit) => {
      for (let r = 0; r < data.length; r++) {
        const row = data[r]
        if (!row) continue
        for (let c = 0; c < row.length; c++) {
          const v = row[c]
          if (v === 0) continue
          visit({ col: c, row: r, value: v })
        }
      }
    },
  }
}

// ── RendererVoxelLayer 适配(顶视投影) ──────────────────────────────────────

/**
 * voxel 图层所有 cells 共用 layer.value(SceneOutput 投影下来,每个体素层 = 一种类型);
 * 即"单值"图层。
 *
 * cell.x/y 是世界坐标(可能不从 0 开始)。这里用 (minX, minY, maxX, maxY) 紧贴
 * 包围盒做 OffscreenCanvas:
 *   * rows = maxY - minY + 1, cols = maxX - minX + 1(紧凑,无前导空白)
 *   * iterCells 报 layer-local 坐标:col = cell.x - minX, row = cell.y - minY
 *   * worldOffsetX/Y = (minX, minY),compose 把 layer 整体平移即还原世界位置
 *
 * 这样选中描边、layer 包围盒、内存占用都是真实矩形,不会被前导空白拉成 (0,0..maxX/Y)。
 */
export function voxelLayerCellSource(layer: RendererVoxelLayer): CellSource {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  // The store maintains layer.bbox incrementally (O(k) per additive paint); when
  // present we skip the O(N) scan over all cells, which otherwise re-ran on every
  // paint because the cell-source is recreated each time the layer ref changes.
  if (layer.bbox) {
    ({ minX, minY, maxX, maxY } = layer.bbox)
  } else {
    for (const c of layer.cells) {
      if (c.x < minX) minX = c.x
      if (c.y < minY) minY = c.y
      if (c.x > maxX) maxX = c.x
      if (c.y > maxY) maxY = c.y
    }
  }
  // 空 cells:返回 1×1 占位,layer.visible / build 函数会处理
  if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 0; maxY = 0 }
  const cols = maxX - minX + 1
  const rows = maxY - minY + 1
  return {
    rows,
    cols,
    worldOffsetX: minX,
    worldOffsetY: minY,
    layerKey: `${layer.nodeId}:${layer.nodePath}`,
    nodeId: layer.nodeId,
    version: layer.updatedAt,
    isMultiValue: false,
    iterCells: (visit) => {
      const v = layer.value
      for (const c of layer.cells) {
        visit({ col: c.x - minX, row: c.y - minY, value: v, z: c.z, state: c.state })
      }
    },
  }
}
