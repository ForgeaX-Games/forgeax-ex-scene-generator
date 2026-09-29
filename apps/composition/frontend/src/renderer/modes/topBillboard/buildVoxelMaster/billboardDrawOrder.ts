// 💡 Billboard 画家序(painter order)—— RENDER 与 EXPORT 共用的唯一排序语义
//
// 渲染器烤 master 时,先把可见 cell 按 painterSort `(y, z, layerIdx) ASC` 排好,再
// 逐 cell 先画 top 后画 front。所以"同一屏幕格上多块 sprite 谁压谁"完全由这个全局
// 绘制次序决定:后画的(painter key 更大的)盖在先画的上面。导出端要逐格复现编辑器
// 的叠放,就必须用**同一把排序键**,而不是另造一套(历史上 cooker 用的是
// `orderKey=[faceOrder, layerSeq]`,与渲染器的 `(y,z,layerIdx)+face` 不是同一个模型,
// 多模板/多层在同一屏幕格重叠时会发散)。本模块把该键收敛为一个纯函数。
//
// 纯粹性:只吃 `{ y, z, layerIdx, face }`,无 canvas / 无图,render 和 export 都能调。

/** Within one cell the bake draws the top cap BEFORE the front wall. */
export type BillboardFaceOrder = 'top' | 'front' | 'object'

export interface BillboardDrawOrderKey {
  /** Source voxel world row (painterSort 第一键). */
  y: number
  /** Source voxel elevation (painterSort 第二键). */
  z: number
  /** Layer z-order index (painterSort 第三键 / tie-break). */
  layerIdx: number
  /** Face drawn within the cell: top first (0), then front (1); objects last. */
  face: BillboardFaceOrder
}

function faceRank(face: BillboardFaceOrder): number {
  // paintAssetCell draws top, then front. Object sprites draw once (treated as a
  // front-row anchor) — rank them with front so a same-cell object sits above a
  // top cap, matching the single drawImage after the cap in the bake loop.
  return face === 'top' ? 0 : 1
}

/**
 * Painter comparator matching the renderer's bake draw order EXACTLY:
 * `(y, z, layerIdx) ASC` then top-before-front within a cell. Negative = `a`
 * drawn first (visually lower). Two draws landing on the same screen cell stack
 * in this order; the greater key paints last and wins.
 */
export function compareBillboardDrawOrder(a: BillboardDrawOrderKey, b: BillboardDrawOrderKey): number {
  if (a.y !== b.y) return a.y - b.y
  if (a.z !== b.z) return a.z - b.z
  if (a.layerIdx !== b.layerIdx) return a.layerIdx - b.layerIdx
  return faceRank(a.face) - faceRank(b.face)
}
