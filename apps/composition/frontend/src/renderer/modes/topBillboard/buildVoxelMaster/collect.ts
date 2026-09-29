// 💡 voxel master pipeline ① collect + ② cull + ③ painter sort
//
// 把 inputs 扁平化成 cells + 一组邻域 / 投影索引,供后续 bindings / paint 阶段用。
//
// 核心约束:**不去重**。同 (x,y,z) 多 layer 都进 allCells,后续 painter 顺序保证
// 晚 layer 压住早 layer。这样 sprite alpha 像素能让下层透出来(asset drawMode);
// color/wire 模式不透明 fill,效果仍是上层覆盖。

import type { CollectResult, CollectedCell, VoxelLayerInput } from './types'
import type { DrawMode } from '../../../types'
import { compareBillboardDrawOrder } from './billboardDrawOrder'

/**
 * scene tree path → 直接父路径:
 *   "/world/houseA/walls" → "/world/houseA"
 *   "/walls"              → "/"
 *   "/" / undefined       → ""(根作用域)
 */
export function parentOfNodePath(nodePath: string | undefined): string {
  if (!nodePath) return ''
  const segs = nodePath.split('/').filter(s => s.length > 0)
  if (segs.length <= 1) return segs.length === 1 ? '/' : ''
  return '/' + segs.slice(0, -1).join('/')
}

/**
 * Pipeline 第 ① 步:扁平化 cell + 建索引。
 *
 * 同时建:
 *   * hasCell —— 3D 占位
 *   * coordsByLayerIdx —— per-layer 3D 集合(autotile 邻域)
 *   * xyByLayerIdx —— per-layer xy 投影集(rule.regions source: "self")
 *   * xyByParentPath —— 按直接父路径分组的 xy 投影集(source: "parent")
 *   * parentPathByLayerIdx —— 给 bindings 阶段反查 region 用
 */
export function collectCells(inputs: ReadonlyArray<VoxelLayerInput>): CollectResult {
  const allCells: CollectedCell[] = []
  const hasCell = new Set<string>()
  const coordsByLayerIdx = new Map<number, Set<string>>()
  const xyByLayerIdx = new Map<number, Set<string>>()
  const xyByParentPath = new Map<string, Set<string>>()
  const parentPathByLayerIdx = new Map<number, string>()

  for (const input of inputs) {
    let layerSet = coordsByLayerIdx.get(input.layerIdx)
    if (!layerSet) { layerSet = new Set(); coordsByLayerIdx.set(input.layerIdx, layerSet) }
    let xyLayerSet = xyByLayerIdx.get(input.layerIdx)
    if (!xyLayerSet) { xyLayerSet = new Set(); xyByLayerIdx.set(input.layerIdx, xyLayerSet) }
    const parentPath = parentOfNodePath(input.nodePath)
    parentPathByLayerIdx.set(input.layerIdx, parentPath)
    let parentXySet = xyByParentPath.get(parentPath)
    if (!parentXySet) { parentXySet = new Set(); xyByParentPath.set(parentPath, parentXySet) }

    input.source.iterCells(({ col, row, value, z, state }) => {
      const wx = col + (input.source.worldOffsetX ?? 0)
      const wy = row + (input.source.worldOffsetY ?? 0)
      const wz = z ?? 0
      const key = `${wx},${wy},${wz}`
      const xyKey = `${wx},${wy}`
      hasCell.add(key)
      layerSet!.add(key)
      xyLayerSet!.add(xyKey)
      parentXySet!.add(xyKey)
      allCells.push({
        x: wx, y: wy, z: wz, value,
        layerIdx: input.layerIdx,
        isSelected: input.isSelected,
        isEditorSelected: input.isEditorSelected,
        isMultiValue: input.source.isMultiValue,
        ...(state ? { state } : {}),
      })
    })
  }

  return { allCells, hasCell, coordsByLayerIdx, xyByLayerIdx, xyByParentPath, parentPathByLayerIdx }
}

/**
 * Pipeline 第 ② 步:occlusion cull(仅 color/wire 模式)。
 *
 * 把"上方有 voxel(z+1)且 y+1 处也有同 z voxel"的 cell 整个剔除。
 *   * color/wire 模式 fillRect 是不透明的,被两侧 voxel 完全盖住 → 安全。
 *   * asset 模式 sprite 自带 alpha,本 voxel 的 top sprite 是上方 voxel front sprite
 *     透明像素的"背景图层"(典型:墙下面的地面 top)。剔掉就让上层透明像素透出 canvas
 *     bg 而不是地面。所以 asset 模式不做此 cull;painter 已按 z ASC 排好,后画的层
 *     透明像素自然透出先画的层。
 */
export function cullOccluded(
  allCells: ReadonlyArray<CollectedCell>,
  hasCell: Set<string>,
  drawMode: DrawMode,
): CollectedCell[] {
  if (drawMode === 'asset') return allCells.slice()  // 不 cull,只复制成可变数组
  const visible: CollectedCell[] = []
  for (const c of allCells) {
    const aboveCovered = hasCell.has(`${c.x},${c.y},${c.z + 1}`)
    const topCovered = hasCell.has(`${c.x},${c.y + 1},${c.z}`)
    if (aboveCovered && topCovered) continue
    visible.push(c)
  }
  return visible
}

export interface PainterSortOverride {
  y: number
  z?: number
}

/**
 * Pipeline 第 ③ 步:painter sort(y, z, layerIdx) ASC。
 *   * tile/autotile 维持原始 (y, z) 语义
 *   * non-tile object 可传入 sprite 最前缘 screen row,避免 footprint 南侧 z=0 地面
 *     在 object 之后绘制盖住立面
 *   * layerIdx 兜底:同 (y, z) 不同 layer 时,晚 layer 后画 → 覆盖早 layer
 */
export function painterSort(
  visible: CollectedCell[],
  overrides?: ReadonlyMap<CollectedCell, PainterSortOverride>,
): void {
  // Cell-level order = the shared billboard painter key on (y, z, layerIdx) with
  // object y/z overrides applied. Face is irrelevant here (paintCell draws both
  // faces of one cell consecutively); the shared comparator's face term is a
  // constant for the two cells being compared, so it never affects cell order.
  visible.sort((a, b) => compareBillboardDrawOrder(
    { y: overrides?.get(a)?.y ?? a.y, z: overrides?.get(a)?.z ?? a.z, layerIdx: a.layerIdx, face: 'top' },
    { y: overrides?.get(b)?.y ?? b.y, z: overrides?.get(b)?.z ?? b.z, layerIdx: b.layerIdx, face: 'top' },
  ))
}
