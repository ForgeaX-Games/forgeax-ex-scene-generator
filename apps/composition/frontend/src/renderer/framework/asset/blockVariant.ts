// 💡 face.front "大变体" —— 连续 3×3 实心墙块整体替换成一张大图的候选选取
//
// 触发条件:以世界坐标网格对齐(anchor = floor(x/3)*3, floor(z/3)*3)划出的
// 3×3 "巨格"若 9 格全部同 layer 同 type 占位,按 blockVariants.probability
// 掷骰决定是否用某个候选 group 整体替换这 9 格的默认逐格 autotile pick——一旦
// 命中,9 格必须用同一候选 group 的 9 个子图(不会各自独立 roll),否则拼不成
// 一张连续大图。
//
// 对齐世界坐标而非扫描顺序,保证同一位置的判定结果只取决于该巨格自身是否
// 实心,与墙体形状/其它格子无关(跟 pickFaceSprite.ts 的 cellRng 同款"按坐标
// 定死"风格),不会随墙体增减而闪烁,也不会因重叠窗口产生歧义。

import type { FaceBlockVariant } from './ruleCache'

/** 把 (x, z, salt) 散到 [0,1)。同 (x,z) 跨帧返回同样值。*/
function blockRng(x: number, z: number, salt: number): number {
  const h = ((x * 2654435769) ^ (z * 1234567891) ^ (salt * 1013904223)) >>> 0
  return h / 4294967296
}

/**
 * 若 (x,z) 所在的对齐 3×3 巨格整体实心且掷骰命中,返回该格应绘制的大变体
 * sprite idx;否则返回 null(调用方回退默认逐格 pick)。
 *
 * `hasAt(ax, az)` 用**绝对**坐标探测同 layer 同 type 是否占位(同 y,front 面
 * 语义:ax = x 轴, az = z 轴/高度),不是相对 (x,z) 的偏移。
 */
export function pickBlockVariantSpriteIndex(
  hasAt: (ax: number, az: number) => boolean,
  x: number,
  z: number,
  blockVariants: FaceBlockVariant,
): number | null {
  const anchorX = Math.floor(x / 3) * 3
  const anchorZ = Math.floor(z / 3) * 3
  for (let dz = 0; dz < 3; dz++) {
    for (let dx = 0; dx < 3; dx++) {
      if (!hasAt(anchorX + dx, anchorZ + dz)) return null
    }
  }
  if (blockRng(anchorX, anchorZ, 701) >= blockVariants.probability) return null
  const groupIdx = Math.min(
    blockVariants.groups.length - 1,
    Math.floor(blockRng(anchorX, anchorZ, 702) * blockVariants.groups.length),
  )
  const group = blockVariants.groups[groupIdx]!
  const localX = x - anchorX
  const localZ = z - anchorZ
  return group[localZ * 3 + localX] ?? null
}
