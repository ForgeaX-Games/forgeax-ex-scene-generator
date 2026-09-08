// 💡 单 face 的 autotile sprite 选取
//
// ⓪ front 面 blockVariants(可选)—— 连续 3×3 实心墙块整体换大图,命中即返回,
//    跳过下面①-③(9 格必须用同一大图,不走逐格 map/randomRules)。
// 其余三步:
//   ① 算邻域 key —— 'top' 用 (u,d,l,r) 同 z 平面 4 邻;'front' 用 (t,b,l,r) z 上下 + xy 左右
//   ② 选 map     —— face.variants 顺序匹配 when.regionContains,首条命中走 variant.map,
//                    否则走默认 face.map
//   ③ 查表 + 变体 randomRules —— 命中 randomRules.tileId 时按 cellRng 决定保留 / 换变体

import { buildTopFaceKey, lookupWithWildcard } from '../../../framework/asset/neighborKey'
import { pickBlockVariantSpriteIndex } from '../../../framework/asset/blockVariant'
import type { FaceRule, RuleSprite } from '../../../framework/asset/ruleCache'
import { pickWeightedVariant, type VariantPool } from '../../../framework/asset/variantCandidates'
import type { CollectedCell } from './types'

/**
 * pickFaceSprite 的所有依赖打包。比一堆位置参数好读、好扩展。
 * 拓扑感知 / 区域查询的演化(加新 region source、加 face condition kind)只动 ctx
 * 类型 + 函数内部分支,调用方签名不变。
 */
export interface PickFaceContext {
  face: FaceRule
  faceTag: 'top' | 'front' | 'entry'
  sprites: ReadonlyArray<RuleSprite>
  /** Face-level fallback pool (face.variantIdxs filtered); used when a randomRule has no own pool. */
  validVariantIdxs: ReadonlyArray<number>
  /** Parallel to validVariantIdxs when face declares variantWeights. */
  validVariantWeights?: ReadonlyArray<number>
  /** Per-tileId filtered pools (idxs + optional weights). */
  validVariantPoolsByTileId?: ReadonlyMap<number, VariantPool>
  cell: CollectedCell
  /** per-layer 3D 坐标集,邻域 has() 查这里 */
  coordsByLayerIdx: Map<number, Set<string>>
  /** rule.regions 解析结果,name → "x,y" set;face.variants 评估查这里 */
  regions: Map<string, Set<string>>
}

export function pickFaceSprite(ctx: PickFaceContext): RuleSprite | null {
  const idx = pickFaceSpriteIndex(ctx)
  return ctx.sprites[idx] ?? ctx.sprites[0] ?? null
}

/**
 * The face's resolved sprite INDEX into `ctx.sprites` — the canonical autotile
 * pick (neighbour-key incl. `adjacent8` / `edgeDist2`, variant region-map selection,
 * randomRules variant substitution). `pickFaceSprite` is just this + an array
 * lookup; consumers that need the index itself (e.g. the headless scene
 * exporter, which maps the index to an atlas sub-tile) call this directly so
 * there is ONE implementation of the pick — no parallel re-derivation. Always
 * returns a valid index into `ctx.sprites` (clamped to 0).
 */
export function pickFaceSpriteIndex(ctx: PickFaceContext): number {
  return pickFaceSpriteIndexInner(ctx, false) ?? 0
}

/** Like pickFaceSpriteIndex but returns null when the face map has no match for the neighbour key. */
export function pickFaceSpriteIndexIfMapped(ctx: PickFaceContext): number | null {
  return pickFaceSpriteIndexInner(ctx, true)
}

function pickFaceSpriteIndexInner(ctx: PickFaceContext, requireMapMatch: boolean): number | null {
  const { face, faceTag, sprites, validVariantIdxs, cell, coordsByLayerIdx, regions } = ctx // ctx also carries validVariantWeights / validVariantPoolsByTileId
  const layerSet = coordsByLayerIdx.get(cell.layerIdx)
  const has = (dx: number, dy: number, dz: number): boolean =>
    !!layerSet && layerSet.has(`${cell.x + dx},${cell.y + dy},${cell.z + dz}`)

  // front 面"大变体":连续 3×3 实心墙块整体换大图,优先于逐格 map/randomRules——
  // 命中就直接返回,不再走下面的 key/map/randomRules 流程(9 格必须用同一大图)。
  if (faceTag === 'front' && face.blockVariants) {
    const hasAt = (ax: number, az: number): boolean => has(ax - cell.x, 0, az - cell.z)
    const blockIdx = pickBlockVariantSpriteIndex(hasAt, cell.x, cell.z, face.blockVariants)
    if (blockIdx !== null) return blockIdx < 0 || blockIdx >= sprites.length ? 0 : blockIdx
  }

  // ① 邻域 key
  let key: string
  if (faceTag === 'top' || faceTag === 'entry') {
    // top / entry 面:adjacent4 = (u,d,l,r);adjacent8 额外带四角对角;edgeDist2 额外带 (u2,d2)。
    key = buildTopFaceKey((dx, dy) => has(dx, dy, 0), face.keyMode)
  } else {
    // front: t/b 走 z 轴,l/r 同 z 平面
    const t = has(0, 0,  1) ? 1 : 0
    const b = has(0, 0, -1) ? 1 : 0
    const l = has(-1, 0, 0) ? 1 : 0
    const r = has( 1, 0, 0) ? 1 : 0
    key = `${t},${b},${l},${r}`
  }

  // ② 选 map:variants 顺序匹配,首条 when 命中的 variant.map 取代默认 face.map。
  //   * regionContains:相对当前 voxel 的 xy 偏移 cell 是否在指定 region 集合内
  //     (region 已在 binding 阶段解析为 Set<"x,y">,O(1) 查表)。
  //   * stateEquals:当前 cell 的 state[key] 是否等于某值(per-cell 标签,如上游
  //     地形派发的 slopeDir);state 随 CollectedCell 透传进来。
  let map: Record<string, number> = face.map
  if (face.variants && face.variants.length > 0) {
    for (const v of face.variants) {
      const w = v.when
      if ('stateEquals' in w) {
        const st = cell.state
        if (st && String(st[w.stateEquals.key]) === w.stateEquals.value) {
          map = v.map
          break
        }
        continue
      }
      const rc = w.regionContains
      const set = regions.get(rc.region)
      if (!set) continue
      const probeKey = `${cell.x + rc.offset[0]},${cell.y + rc.offset[1]}`
      if (set.has(probeKey)) {
        map = v.map
        break
      }
    }
  }

  // ③ 查表 + randomRules 变体替换
  const mapped = lookupWithWildcard(map, key)
  if (mapped === undefined) {
    if (requireMapMatch) return null
  }
  let idx = mapped ?? 0
  if (face.randomRules && face.randomRules.length > 0) {
    // saltBase 把 face 拉开,避免同一 (x,y) 顶面立面变体撞车
    const saltBase = faceTag === 'top' ? 0 : faceTag === 'entry' ? 200 : 100
    for (const r of face.randomRules) {
      if (idx !== r.tileId) continue
      const tilePool = ctx.validVariantPoolsByTileId?.get(r.tileId)
      const pool: VariantPool = tilePool ?? {
        idxs: [...validVariantIdxs],
        weights: ctx.validVariantWeights?.length === validVariantIdxs.length
          ? [...ctx.validVariantWeights]
          : undefined,
      }
      if (pool.idxs.length === 0) break
      if (cellRng(cell.x, cell.y, saltBase) < r.keepProbability) break
      idx = pickWeightedVariant(pool, cellRng(cell.x, cell.y, saltBase + 1))
      break
    }
  }
  if (idx < 0 || idx >= sprites.length) idx = 0
  return idx
}

/**
 * 把 (x, y, salt) 散到 [0,1)。同 (x,y) 跨帧返回同样值 → 变体不闪烁。
 * 不同 cell 之间散列均匀(三个素数倍数 + xor + 32-bit 截断)。
 *
 * 混合步骤(fmix32 雪崩)不可省:同一 (x,y) 会以相邻 salt 连续取两次数
 * (keepProbability 掷骰用 saltBase,选变体用 saltBase+1),若只有线性乘 +
 * xor 组合,`h(salt=1) = h(salt=0) xor 常数`——对 h(salt=0) 设阈值(掷骰)
 * 后,h(salt=1) 的取值范围会被该 xor 常数确定性地搬到另一个子区间,导致
 * "选变体"这一步在统计上不再均匀:变体池里某些权重最高的候选永远选不到
 * (simple_common_16 的 4:2:2:2 权重实测 100% 落不到权重 4 的那个变体)。
 * fmix32 打散后两个 salt 的输出互不相关,恢复真正独立采样。
 */
function cellRng(x: number, y: number, salt: number): number {
  let h = ((x * 2654435769) ^ (y * 1234567891) ^ (salt * 1013904223)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 2246822519) >>> 0
  h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}
