// 💡 voxel master pipeline ④ asset binding
//
// asset drawMode 的 per-layer 一次性预解析:每 layer match alias → 取 rule + img URL
// → 扫变体可见性 → 解析 rule.regions 到具体 set 引用。后续 paintCell 阶段每 cell 直接
// 查表,不再做 alias 匹配。
//
// regions 解析:rule 顶层声明 `{ source: "parent" }`,这里翻译成具体
// `Map<regionName, Set<"x,y">>` 挂到 binding,pickFaceSprite 评估 face.variants 时用。
//   * "parent" → 本 layer 直接父路径下所有 voxel 的 xy 并集
//   * "self"   → 本 layer 自己的 xy 并集
// 不复制 set 内容,挂的都是 collect 阶段产物的引用。

import type { AliasMeta } from '../../../framework/asset/matchAssetEntry'
import { matchAssetEntry } from '../../../framework/asset/matchAssetEntry'
import {
  getOrLoadImage, getRegisteredAssetUrl, getLoadTick,
} from '../../../framework/asset/imageCache'
import {
  getOrLoadRule, getRuleLoadTick,
  type FaceRule, type RuleSprite,
} from '../../../framework/asset/ruleCache'
import {
  computeValidVariantPool as computeValidVariantPoolShared,
  computeValidVariantPoolsByTileId as computeValidVariantPoolsByTileIdShared,
  type VariantPool,
} from '../../../framework/asset/variantCandidates'
import type { LayerAssetBinding, VoxelLayerInput } from './types'

/**
 * 扫每个 input 一次:
 *   1. 命名匹配 alias → tileType / primary 图
 *   2. 取 rule(异步,加载中返回 null,readiness pulse 后重 build)
 *   3. 扫变体可见性
 *   4. 解析 rule.regions
 */
export function buildLayerAssetBindings(
  inputs: ReadonlyArray<VoxelLayerInput>,
  aliases: ReadonlyArray<AliasMeta>,
  fuzzy: boolean,
  xyByParentPath: Map<string, Set<string>>,
  xyByLayerIdx: Map<number, Set<string>>,
  parentPathByLayerIdx: Map<number, string>,
): Map<number, LayerAssetBinding | null> {
  const out = new Map<number, LayerAssetBinding | null>()
  for (const input of inputs) {
    const m = matchAssetEntry(
      { assetName: input.assetName, assetAlias: input.assetAlias, assetType: input.assetType },
      aliases, fuzzy,
    )
    if (!m) { out.set(input.layerIdx, null); continue }
    // m.tileType = rule asset alias。getOrLoadRule 异步:命中且 ready 直接拿,fetch
    // 中返回 null → 整图直贴 → readiness pulse 后重 build → autotile 启用。
    const rule = m.tileType ? getOrLoadRule(m.tileType) : null
    const imgUrl = getRegisteredAssetUrl(m.primary)
    // 变体候选:per-face 各扫一份(basePieces 不同,变体区段不同)。图未加载完 → 空数组,
    // 等 readiness pulse 重 build 时再扫。
    const validVariantIdxs = { top: [] as number[], front: [] as number[], entry: [] as number[] }
    const validVariantWeights = { top: undefined as number[] | undefined, front: undefined as number[] | undefined, entry: undefined as number[] | undefined }
    const validVariantPoolsByTileId = { top: new Map<number, VariantPool>(), front: new Map<number, VariantPool>(), entry: new Map<number, VariantPool>() }
    if (rule && m.tileType) {
      const img = getOrLoadImage(imgUrl)
      if (img) {
        const rgba = readImageRgba(img)
        if (rule.faces.top?.randomRules?.length) {
          const topPool = computeValidVariantPoolCached(img, imgUrl, rule.sprites, rule.faces.top, m.primary, m.tileType, 'top', rgba)
          validVariantIdxs.top = topPool.idxs
          validVariantWeights.top = topPool.weights
          validVariantPoolsByTileId.top = computeValidVariantPoolsByTileIdCached(img, imgUrl, rule.sprites, rule.faces.top, m.primary, m.tileType, 'top', rgba)
        }
        if (rule.faces.front?.randomRules?.length) {
          const frontPool = computeValidVariantPoolCached(img, imgUrl, rule.sprites, rule.faces.front, m.primary, m.tileType, 'front', rgba)
          validVariantIdxs.front = frontPool.idxs
          validVariantWeights.front = frontPool.weights
          validVariantPoolsByTileId.front = computeValidVariantPoolsByTileIdCached(img, imgUrl, rule.sprites, rule.faces.front, m.primary, m.tileType, 'front', rgba)
        }
        if (rule.faces.entry?.randomRules?.length) {
          const entryPool = computeValidVariantPoolCached(img, imgUrl, rule.sprites, rule.faces.entry, m.primary, m.tileType, 'entry', rgba)
          validVariantIdxs.entry = entryPool.idxs
          validVariantWeights.entry = entryPool.weights
          validVariantPoolsByTileId.entry = computeValidVariantPoolsByTileIdCached(img, imgUrl, rule.sprites, rule.faces.entry, m.primary, m.tileType, 'entry', rgba)
        }
      }
    }
    // 解析 rule.regions 到具体 set 引用(不复制 set 内容)
    const regions = new Map<string, Set<string>>()
    if (rule?.regions) {
      const parentPath = parentPathByLayerIdx.get(input.layerIdx) ?? ''
      for (const [name, decl] of Object.entries(rule.regions)) {
        if (decl.source === 'parent') regions.set(name, xyByParentPath.get(parentPath) ?? new Set())
        else if (decl.source === 'self') regions.set(name, xyByLayerIdx.get(input.layerIdx) ?? new Set())
      }
    }
    out.set(input.layerIdx, {
      match: m,
      rule,
      imgUrl,
      validVariantIdxs,
      validVariantWeights,
      validVariantPoolsByTileId,
      regions,
    })
  }
  return out
}

// ── 变体可见性扫描(透明像素探测)─────────────────────────────────────
//
// rule.sprites[basePieces..] 区段是变体行,但实际 atlas 上的内容数量不固定:
// 可能 0 块 / 1 块 / 多块,中间也可能有空槽。把整张 sheet 一次性栅格到临时 canvas
// 取 RGBA,然后交给 RENDER/EXPORT 共用的纯函数 computeValidVariantIdxs 判定哪些变体
// 槽非透明 —— 透明判定逻辑只此一份(variantCandidates.ts),导出端喂自己解出的像素
// 调用同一函数,二者候选集逐字节一致。结果按 (imgUrl, ruleAlias) 加各自 loadTick 缓存。

const visibleVariantPoolCache = new Map<string, VariantPool>()
const visibleVariantPoolsByTileIdCache = new Map<string, Map<number, VariantPool>>()

function computeValidVariantPoolCached(
  img: HTMLImageElement,
  imgUrl: string,
  sprites: ReadonlyArray<RuleSprite>,
  face: FaceRule,
  sheetIdentity: string,
  ruleAlias: string,
  faceTag: 'top' | 'front' | 'entry',
  rgba?: { width: number; height: number; data: Uint8ClampedArray } | null,
): VariantPool {
  const cacheKey = `${sheetIdentity}|${imgUrl}@${getLoadTick(imgUrl)}|${ruleAlias}@${getRuleLoadTick(ruleAlias)}|${faceTag}|pool`
  const cached = visibleVariantPoolCache.get(cacheKey)
  if (cached) return cached
  const sheet = rgba ?? readImageRgba(img)
  const out = computeValidVariantPoolShared(face, sprites, sheet)
  visibleVariantPoolCache.set(cacheKey, out)
  return out
}

function computeValidVariantPoolsByTileIdCached(
  img: HTMLImageElement,
  imgUrl: string,
  sprites: ReadonlyArray<RuleSprite>,
  face: FaceRule,
  sheetIdentity: string,
  ruleAlias: string,
  faceTag: 'top' | 'front' | 'entry',
  rgba?: { width: number; height: number; data: Uint8ClampedArray } | null,
): Map<number, VariantPool> {
  const cacheKey = `${sheetIdentity}|${imgUrl}@${getLoadTick(imgUrl)}|${ruleAlias}@${getRuleLoadTick(ruleAlias)}|${faceTag}|byTileId`
  const cached = visibleVariantPoolsByTileIdCache.get(cacheKey)
  if (cached) return cached
  const sheet = rgba ?? readImageRgba(img)
  const out = computeValidVariantPoolsByTileIdShared(face, sprites, sheet)
  visibleVariantPoolsByTileIdCache.set(cacheKey, out)
  return out
}

/** 把整张图栅格到临时 canvas 并取 RGBA;无 2D ctx(如 jsdom)返回 null。
 *  服务端(renderToPng / 测试)没有 document,但注入的 image 本身就是一张
 *  napi canvas(自带 getContext),此时直接读它的像素 —— 与浏览器临时 canvas
 *  得到同一份 RGBA,让变体透明过滤在 server 端也生效(否则 server 退化为不过滤)。 */
function readImageRgba(
  img: HTMLImageElement,
): { width: number; height: number; data: Uint8ClampedArray } | null {
  const w = Math.max(1, img.naturalWidth || img.width)
  const h = Math.max(1, img.naturalHeight || img.height)
  const hasDoc = typeof document !== 'undefined'
  if (!hasDoc) {
    // Server path: the injected image is canvas-like — read straight from it.
    const direct = (img as unknown as { getContext?: (t: '2d') => CanvasRenderingContext2D | null }).getContext
    if (typeof direct === 'function') {
      const sctx = direct.call(img, '2d') as CanvasRenderingContext2D | null
      if (!sctx) return null
      return { width: w, height: h, data: sctx.getImageData(0, 0, w, h).data }
    }
    return null
  }
  const probe = document.createElement('canvas')
  probe.width = w
  probe.height = h
  const ctx = probe.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0)
  return { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data }
}
