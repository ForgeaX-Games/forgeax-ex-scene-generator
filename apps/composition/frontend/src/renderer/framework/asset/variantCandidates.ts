// 💡 变体可见性候选集(透明像素探测)—— RENDER 与 EXPORT 共用的唯一实现
//
// autotile 的 randomRules 在 sprites[basePieces..] 的变体区段里随机替换,但 atlas
// 上变体槽不一定都有内容(可能是空/透明占位)。挑选候选时必须先把"全透明"的变体槽
// 剔除,否则随机替换会把一个透明块当作有效变体选中 —— 渲染器看到的是空,导出却落了
// 一个透明占位块,二者发散。
//
// 关键点:渲染器(浏览器 canvas / @napi-rs/canvas)用 getImageData 取变体子矩形的
// 像素;导出(headless)用自带的 PNG 解码器取像素。二者像素来源不同,但"哪些变体非
// 透明"这个判定逻辑必须是同一份代码,否则又退化成两套实现 —— 这正是 common-16 透明
// 变体 bug 的根因。本模块把该判定收敛为一个纯函数,只吃一个最小 RGBA 视图,render
// 和 export 都喂各自解出来的像素进来,得到逐字节一致的候选集。

import type { FaceRule, RandomRule, RuleSprite } from './ruleCache'

/**
 * 最小 RGBA 视图。浏览器侧用 `ctx.getImageData(...).data`(Uint8ClampedArray),
 * headless 侧用 PNG 解码出的 Buffer —— 两者都满足 `data[(y*width+x)*4 + 3]` 是 alpha。
 */
export interface RgbaView {
  width: number
  height: number
  /** Straight RGBA8, row-major; length = width*height*4. */
  data: { readonly length: number; readonly [i: number]: number }
}

/** 像素过滤后的变体候选；weights 与 idxs 等长时按权重采样，否则等概率。 */
export interface VariantPool {
  idxs: number[]
  weights?: number[]
}

/**
 * 变体面的"原始"候选区段:面显式声明 `variantIdxs` 用之,否则按习惯取
 * `sprites[basePieces..length-1]`。这是 OPACITY 过滤之前的全集。
 */
export function rawVariantCandidates(face: FaceRule, spriteCount: number): number[] {
  if (face.variantIdxs) return face.variantIdxs.slice()
  const range: number[] = []
  for (let i = face.basePieces; i < spriteCount; i++) range.push(i)
  return range
}

/**
 * 一个变体槽被认为"有内容"所需的最少非透明像素数。1~5 个像素的残留(切图边缘漏出的
 * 抗锯齿点、素材上的孤立噪点)不足以构成一块可用的变体,按空槽剔除。
 */
export const MIN_VISIBLE_PIXELS = 6

/**
 * 变体子矩形是否含可见像素(非透明像素数 ≥ MIN_VISIBLE_PIXELS)。`img` 为 null
 * (无法取像素)时乐观判定为 true —— 与渲染器"无 ctx 不丢候选"的行为一致,避免误删
 * 本该有内容的变体。
 */
export function spriteHasVisiblePixel(img: RgbaView | null, sprite: RuleSprite): boolean {
  if (!img) return true
  const x0 = Math.max(0, Math.floor(sprite.x))
  const y0 = Math.max(0, Math.floor(sprite.y))
  const x1 = Math.min(img.width, x0 + Math.max(1, Math.floor(sprite.w)))
  const y1 = Math.min(img.height, y0 + Math.max(1, Math.floor(sprite.h)))
  let visible = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (img.data[(y * img.width + x) * 4 + 3]! > 0) {
        visible++
        if (visible >= MIN_VISIBLE_PIXELS) return true
      }
    }
  }
  return false
}

export function filterVisibleVariantPool(
  idxs: ReadonlyArray<number>,
  weights: ReadonlyArray<number> | undefined,
  sprites: ReadonlyArray<RuleSprite>,
  img: RgbaView | null,
): VariantPool {
  const outIdxs: number[] = []
  const outWeights: number[] = []
  const useWeights = weights && weights.length === idxs.length
  for (let i = 0; i < idxs.length; i++) {
    const idx = idxs[i]!
    if (idx < 0 || idx >= sprites.length) continue
    if (!spriteHasVisiblePixel(img, sprites[idx]!)) continue
    outIdxs.push(idx)
    if (useWeights) outWeights.push(weights[i]!)
  }
  return {
    idxs: outIdxs,
    weights: useWeights && outWeights.length === outIdxs.length ? outWeights : undefined,
  }
}

/** Resolve raw idx/weight lists for one randomRules entry (before pixel filter). */
export function resolveRandomRuleRawPool(
  face: FaceRule,
  rule: RandomRule,
  spriteCount: number,
): { idxs: number[]; weights?: number[] } {
  const idxs = rule.variantIdxs?.length
    ? rule.variantIdxs.slice()
    : face.variantIdxs?.length
      ? face.variantIdxs.slice()
      : rawVariantCandidates(face, spriteCount)
  let weights = rule.variantWeights?.length
    ? rule.variantWeights.slice()
    : face.variantWeights?.length
      ? face.variantWeights.slice()
      : undefined
  if (weights && weights.length !== idxs.length) weights = undefined
  return { idxs, weights }
}

/**
 * 给定 face + 全部 sprite 矩形 + 解出的 sheet 像素,返回**非透明**变体候选 idx。
 * randomRules 只会从这个集合里采样,因此透明占位块永远不会被选中。RENDER 与 EXPORT
 * 都调用本函数(各自喂像素),所以两侧候选集逐字节一致。
 *
 * `img` 为 null 时退化为原始候选区段(乐观:像素不可得就不剔除)。
 */
export function computeValidVariantIdxs(
  face: FaceRule,
  sprites: ReadonlyArray<RuleSprite>,
  img: RgbaView | null,
): number[] {
  return computeValidVariantPool(face, sprites, img).idxs
}

export function computeValidVariantPool(
  face: FaceRule,
  sprites: ReadonlyArray<RuleSprite>,
  img: RgbaView | null,
): VariantPool {
  const idxs = rawVariantCandidates(face, sprites.length)
  const weights = face.variantWeights?.length === idxs.length ? face.variantWeights : undefined
  return filterVisibleVariantPool(idxs, weights, sprites, img)
}

/** Face slice used when a randomRule declares its own variantIdxs pool. */
export function faceForRandomRulePool(face: FaceRule, rule: RandomRule): FaceRule {
  if (!rule.variantIdxs?.length) return face
  return {
    basePieces: face.basePieces,
    map: face.map,
    variantIdxs: rule.variantIdxs,
    ...(rule.variantWeights?.length ? { variantWeights: rule.variantWeights } : {}),
  }
}

/**
 * Pixel-filtered variant pools keyed by randomRules tileId.
 * Entries without variantIdxs reuse the face-level pool (same as pickFaceSprite fallback).
 */
export function computeValidVariantIdxsByTileId(
  face: FaceRule,
  sprites: ReadonlyArray<RuleSprite>,
  img: RgbaView | null,
): Map<number, number[]> {
  const pools = computeValidVariantPoolsByTileId(face, sprites, img)
  const out = new Map<number, number[]>()
  for (const [tileId, pool] of pools) out.set(tileId, pool.idxs)
  return out
}

export function computeValidVariantPoolsByTileId(
  face: FaceRule,
  sprites: ReadonlyArray<RuleSprite>,
  img: RgbaView | null,
): Map<number, VariantPool> {
  const out = new Map<number, VariantPool>()
  if (!face.randomRules?.length) return out
  const facePool = computeValidVariantPool(face, sprites, img)
  for (const r of face.randomRules) {
    if (r.variantIdxs?.length || r.variantWeights?.length) {
      const raw = resolveRandomRuleRawPool(face, r, sprites.length)
      out.set(r.tileId, filterVisibleVariantPool(raw.idxs, raw.weights, sprites, img))
    } else {
      out.set(r.tileId, facePool)
    }
  }
  return out
}

/** Pick one sprite idx from a pool; `rngUnit` ∈ [0,1). Uniform when weights absent. */
export function pickWeightedVariant(pool: VariantPool, rngUnit: number): number {
  const { idxs, weights } = pool
  if (idxs.length === 0) return 0
  if (!weights || weights.length !== idxs.length) {
    return idxs[Math.floor(rngUnit * idxs.length)]!
  }
  let total = 0
  for (const w of weights) total += w > 0 ? w : 0
  if (total <= 0) return idxs[0]!
  let roll = rngUnit * total
  for (let i = 0; i < idxs.length; i++) {
    roll -= weights[i]! > 0 ? weights[i]! : 0
    if (roll <= 0) return idxs[i]!
  }
  return idxs[idxs.length - 1]!
}
