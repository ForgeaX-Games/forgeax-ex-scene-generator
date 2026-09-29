// 💡 mode-top:把单层 CellSource 编译成一份 OffscreenCanvas
//
// 两种 drawMode 由本文件分支处理:
//   * 'color' —— 1 px = 1 cell 的 ImageData 直写 RGBA;compose drawImage 时
//     按 SCREEN_CELL_SIZE 倍 nearest-neighbor 缩放 → 像素方块,GPU 加速
//   * 'wire'  —— **预先栅格化**到 (cols × cellSize) × (rows × cellSize) 的高分辨率
//     OffscreenCanvas,fill + stroke 都在 build 阶段做完。compose drawImage 跟
//     color 同款 → GPU 加速。线宽 1 buffer-pixel = 1 CSS px(at 1× viewport)
//     /N CSS px(at N× viewport)。viewport-aware 的"恒定 1 CSS px"丢了,
//     换来每帧 stroke 路径栅格化的 CPU 开销消失
//
// 选中态(layer/editor 选中)在本 slice 暂未接入 store,统一 isSelected:false /
// isEditorSelected:false(选中高亮 deferred)。

import type { CellSource } from '../../framework/cellSource'
import { createSurface, type Surface2D } from '../../framework/canvas2d'
import type { DrawMode } from '../../types'
import { colorForValue } from '../../framework/palette'
import { SCREEN_CELL_SIZE } from '../../framework/geometry/constants'
import type { AliasMeta } from '../../framework/asset/matchAssetEntry'
import { matchAssetEntry } from '../../framework/asset/matchAssetEntry'
import { getOrLoadImage, getRegisteredAssetUrl, getLoadTick } from '../../framework/asset/imageCache'
import { getOrLoadRule, getRuleLoadTick, type FaceRule, type NormalizedRule } from '../../framework/asset/ruleCache'
import { buildTopFaceKey, lookupWithWildcard } from '../../framework/asset/neighborKey'
import { pickWeightedVariant, resolveRandomRuleRawPool, filterVisibleVariantPool } from '../../framework/asset/variantCandidates'

/** 多值 wire 模式：按值索引分配不同透明度红色，便于区分相邻区域（与 legacy render2d 一致） */
const MULTI_VALUE_ALPHAS = [0.75, 0.55, 0.38, 0.62, 0.45, 0.28, 0.68, 0.50, 0.33, 0.72, 0.52, 0.35]
const MULTI_VALUE_ALPHAS_SELECTED = MULTI_VALUE_ALPHAS.map(a => Math.min(a + 0.15, 1))

const WIRE_RED = { r: 220, g: 45, b: 45 } as const
const WIRE_GREEN_LAYER = { r: 212, g: 255, b: 72 } as const   // accent
const WIRE_GREEN_EDITOR = { r: 62, g: 207, b: 107 } as const  // success
const WIRE_GREEN_SUB = { r: 60, g: 200, b: 80 } as const      // 子值选中（legacy render2d）

export interface BuildSurfaceOpts {
  drawMode: DrawMode
  /** 当前 source 在画板 z-order 中的 idx;单值层 'color' 用作 hue 选取 */
  layerIdx: number
  /** 当前选中的子值(若该 source 命中);非选中值在 'color' 下降饱和 */
  selectedSubValue: number | null
  /** layer 自身被选中(LayersSidePanel/画布点击);wire 用 accent 绿描边 */
  isSelected: boolean
  /** editor 端选中;wire 用 success 绿描边 */
  isEditorSelected: boolean
  /** scene 节点 asset_name(asset drawMode 顶面 autotile 用) */
  assetName?: string
  /** scene 节点 asset_alias; 存在时精确绑定到用户选择的素材 */
  assetAlias?: string
  /** scene 节点 asset_type('tile' / 'asset' / undefined) */
  assetType?: string
  /** 合并后的 alias 池(asset drawMode 必备;空则 asset 退化为 color) */
  aliases?: ReadonlyArray<AliasMeta>
}

/**
 * 把 CellSource 编译为 OffscreenCanvas。
 * Stage-2c.2: asset autotile —— 'asset' drawMode 走顶面 sprite 路径(直接用
 * framework/asset 原语:matchAssetEntry → getOrLoadRule + getOrLoadImage →
 * 顶面 4 邻域 key → sprite idx → drawImage)。无 alias 命中 / rule 或图未就绪时
 * 优雅降级回 color(顶视至少有色块,不空屏 / 不抛错)。
 */
export function buildSurfaceForSource(
  source: CellSource,
  opts: BuildSurfaceOpts,
): Surface2D | null {
  if (opts.drawMode === 'wire') return buildWireSurface(source, opts)
  if (opts.drawMode === 'asset') {
    const asset = buildAssetSurface(source, opts)
    if (asset) return asset
    // 降级:无命中 / 资产未就绪 → color(下次 readiness pulse 后重 build 启用 sprite)
    return buildColorSurface(source, opts)
  }
  return buildColorSurface(source, opts)
}

// ── asset: 顶面 autotile sprite(framework/asset 原语,直接用,不依赖 billboard)─
//
// 顶面专属(top 视角只画顶面,不画立面):每 cell 用同层 4 邻 (up,down,left,right)
// 占位算 key,lookupWithWildcard 查 rule.faces.top.map → sprite idx → atlas rect →
// drawImage。randomRules 命中按 (x,y) 稳定散列做变体替换(同帧间不闪烁)。
//
// surface 像素密度用 rule.ppu(默认 SCREEN_CELL_SIZE)避免在 build 阶段就 nearest 下采样;
// compose 那侧 dst 仍按 SCREEN_CELL_SIZE logical 缩放。
//
// 任一前置缺失(无 alias 命中 / rule 未加载 / 图未加载)→ 返回 null,调用方降级到 color。

function buildAssetSurface(
  source: CellSource,
  opts: BuildSurfaceOpts,
): Surface2D | null {
  const { assetName, assetAlias, aliases } = opts
  if ((!assetName && !assetAlias) || !aliases || aliases.length === 0) return null

  const match = matchAssetEntry(
    { assetName: assetName ?? '', assetAlias, assetType: opts.assetType },
    aliases, false,
  )
  if (!match) return null

  // tileType 缺失 → 无 autotile 模板,顶面无法查表 → 降级。
  const rule = match.tileType ? getOrLoadRule(match.tileType) : null
  const topFace = rule?.faces.top
  if (!rule || !topFace) return null

  const img = getOrLoadImage(getRegisteredAssetUrl(match.primary))
  if (!img) return null

  const ppu = rule.ppu > 0 ? rule.ppu : SCREEN_CELL_SIZE
  const cols = Math.max(1, source.cols)
  const rows = Math.max(1, source.rows)
  const w = cols * ppu
  const h = rows * ppu
  const canvas = createSurface(w, h)
  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null
  try {
    ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  } catch {
    ctx = null
  }
  if (!ctx) return null
  ctx.imageSmoothingEnabled = false

  // 同层 2D 占位集(top 忽略 z;顶面邻域查的是 xy 平面 4 邻)
  const occ = new Set<string>()
  source.iterCells(({ col, row }) => { occ.add(`${col},${row}`) })

  source.iterCells(({ col, row }) => {
    const sprite = pickTopSprite(rule, topFace, col, row, occ)
    if (!sprite) return
    ctx!.drawImage(
      img,
      sprite.x, sprite.y, sprite.w, sprite.h,
      col * ppu, row * ppu, ppu, ppu,
    )
  })

  return canvas
}

/**
 * 顶面单 cell sprite 选取:邻域 key → map 查表 → randomRules 变体替换。
 *   * key = "up,down,left,right" = (x,y-1) (x,y+1) (x-1,y) (x+1,y) 同层占位
 *   * randomRules 命中后从 sprites[basePieces..] 区段按稳定散列采样变体
 */
function pickTopSprite(
  rule: NormalizedRule,
  face: FaceRule,
  col: number,
  row: number,
  occ: Set<string>,
): { x: number; y: number; w: number; h: number } | null {
  const has = (dx: number, dy: number): boolean => occ.has(`${col + dx},${row + dy}`)
  const key = buildTopFaceKey(has, face.keyMode)
  let idx = lookupWithWildcard(face.map, key) ?? 0

  if (face.randomRules && face.randomRules.length > 0) {
    for (const r of face.randomRules) {
      if (idx !== r.tileId) continue
      const raw = resolveRandomRuleRawPool(face, r, rule.sprites.length)
      const pool = filterVisibleVariantPool(raw.idxs, raw.weights, rule.sprites, null)
      if (pool.idxs.length === 0) break
      if (cellRng(col, row, 0) < r.keepProbability) break
      idx = pickWeightedVariant(pool, cellRng(col, row, 1))
      break
    }
  }
  return rule.sprites[idx] ?? rule.sprites[0] ?? null
}

/** 缺省变体区段:sprites[basePieces..length-1] */
function defaultVariantRange(face: FaceRule, spriteCount: number): number[] {
  const range: number[] = []
  for (let i = face.basePieces; i < spriteCount; i++) range.push(i)
  return range
}

/**
 * (x,y,salt) → [0,1) 稳定散列;同 cell 跨帧同值 → 变体不闪烁。
 * fmix32 雪崩混合与 topBillboard/pickFaceSprite.ts::cellRng 保持一致
 * (同一 bug 修复,见该处注释:相邻 salt 的朴素 xor 组合会让 keepProbability
 * 掷骰与选变体这两次取数相关,导致权重变体统计上选不到)。
 */
function cellRng(x: number, y: number, salt: number): number {
  let h = ((x * 2654435769) ^ (y * 1234567891) ^ (salt * 1013904223)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 2246822519) >>> 0
  h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

// ── color: 1 px = 1 cell ImageData ──────────────────────────────────────

function buildColorSurface(source: CellSource, opts: BuildSurfaceOpts): Surface2D | null {
  const w = Math.max(1, source.cols)
  const h = Math.max(1, source.rows)
  const canvas = createSurface(w, h)
  // jsdom (no `canvas` pkg) throws on getContext rather than returning null;
  // treat any failure as "no 2D context" so the build is a clean no-op.
  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null
  try {
    ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  } catch {
    ctx = null
  }
  if (!ctx) return null

  const img = ctx.createImageData(w, h)
  const buf = img.data

  const { selectedSubValue } = opts
  source.iterCells(({ col, row, value }) => {
    const isSubDimmed = selectedSubValue !== null && value !== selectedSubValue
    const c = colorForValue(value, { subDimmed: isSubDimmed, alpha: 0.78 })
    const idx = (row * w + col) * 4
    buf[idx]     = c.r
    buf[idx + 1] = c.g
    buf[idx + 2] = c.b
    buf[idx + 3] = c.a
  })
  ctx.putImageData(img, 0, 0)
  return canvas
}

// ── wire: 高分辨率(每 cell = cellSize buffer 像素)+ pre-baked stroke ────────
//
// 走「build 阶段一次性栅格化 → compose 阶段 GPU drawImage」的路径。
// 关键性能要点:不再在 compose 主画布上 stroke Path2D —— 它是 CPU 路径,
// run-merge 后仍卡。pre-bake 后 compose 跟 color 同款 = O(1) drawImage。
//
// 视觉:线宽 1 buffer-pixel(= 1 CSS px @ 1× viewport;N CSS px @ N×)。

function buildWireSurface(source: CellSource, opts: BuildSurfaceOpts): Surface2D | null {
  const cellSize = SCREEN_CELL_SIZE
  const w = Math.max(1, source.cols * cellSize)
  const h = Math.max(1, source.rows * cellSize)
  const canvas = createSurface(w, h)
  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null
  try {
    ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  } catch {
    ctx = null
  }
  if (!ctx) return null

  const { selectedSubValue, isSelected, isEditorSelected } = opts
  const subSelected = selectedSubValue

  // ── ① fill:每非零 cell 一个 cellSize × cellSize 块的轻微底色 ──
  const img = ctx.createImageData(w, h)
  const buf = img.data

  if (source.isMultiValue) {
    // 多值：按值索引分配不同透明度；子值选中时仅该值高亮为绿色
    const valueIndexMap = buildValueIndexMap(source)
    source.iterCells(({ col, row, value }) => {
      const vi = valueIndexMap.get(value) ?? 0
      const valueIsSelected = subSelected !== null
        ? value === subSelected
        : (isSelected || isEditorSelected)
      const alphas = valueIsSelected ? MULTI_VALUE_ALPHAS_SELECTED : MULTI_VALUE_ALPHAS
      const alpha = Math.round(alphas[vi % alphas.length] * 255)
      const rgb = valueIsSelected ? WIRE_GREEN_SUB : WIRE_RED
      fillCellBlock(buf, w, col, row, cellSize, rgb.r, rgb.g, rgb.b, alpha)
    })
  } else {
    // 单值：整层统一颜色
    let fillR: number, fillG: number, fillB: number, fillA: number
    if (isSelected) {
      fillR = WIRE_GREEN_LAYER.r; fillG = WIRE_GREEN_LAYER.g; fillB = WIRE_GREEN_LAYER.b; fillA = 50
    } else if (isEditorSelected) {
      fillR = WIRE_GREEN_EDITOR.r; fillG = WIRE_GREEN_EDITOR.g; fillB = WIRE_GREEN_EDITOR.b; fillA = 50
    } else {
      fillR = WIRE_RED.r; fillG = WIRE_RED.g; fillB = WIRE_RED.b; fillA = 38
    }
    source.iterCells(({ col, row }) => {
      fillCellBlock(buf, w, col, row, cellSize, fillR, fillG, fillB, fillA)
    })
  }
  ctx.putImageData(img, 0, 0)

  // ── ② stroke:外轮廓 ──
  ctx.save()
  ctx.scale(cellSize, cellSize)
  ctx.lineWidth = 1 / cellSize
  ctx.lineCap = 'butt'

  if (source.isMultiValue && subSelected !== null) {
    // 子值选中：每个 cell 单独描边（选中值绿色，其余红色）
    strokePerCellOutlines(ctx, source, (value) => {
      const selected = value === subSelected
      const rgb = selected ? WIRE_GREEN_SUB : WIRE_RED
      return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${selected ? 0.95 : 0.9})`
    })
  } else {
    // 整层 / 单值：run-merged 外轮廓
    let strokeR: number, strokeG: number, strokeB: number, strokeA: number
    if (isSelected) {
      strokeR = WIRE_GREEN_LAYER.r; strokeG = WIRE_GREEN_LAYER.g; strokeB = WIRE_GREEN_LAYER.b; strokeA = 240
    } else if (isEditorSelected) {
      strokeR = WIRE_GREEN_EDITOR.r; strokeG = WIRE_GREEN_EDITOR.g; strokeB = WIRE_GREEN_EDITOR.b; strokeA = 220
    } else {
      strokeR = WIRE_RED.r; strokeG = WIRE_RED.g; strokeB = WIRE_RED.b; strokeA = 220
    }
    const path = buildMaskOutlinePath(source)
    ctx.strokeStyle = `rgba(${strokeR}, ${strokeG}, ${strokeB}, ${(strokeA / 255).toFixed(3)})`
    ctx.stroke(path)
  }
  ctx.restore()

  return canvas
}

/** 收集 source 中所有非零值的升序索引，供多值 alpha 查表 */
function buildValueIndexMap(source: CellSource): Map<number, number> {
  const valueSet = new Set<number>()
  source.iterCells(({ value }) => valueSet.add(value))
  const uniqueValues = Array.from(valueSet).sort((a, b) => a - b)
  return new Map(uniqueValues.map((v, i) => [v, i]))
}

/** ImageData 块写入：在 buffer 中填充一个 cellSize × cellSize 的色块 */
function fillCellBlock(
  buf: Uint8ClampedArray, w: number,
  col: number, row: number, cellSize: number,
  r: number, g: number, b: number, a: number,
): void {
  const px0 = col * cellSize
  const py0 = row * cellSize
  for (let dy = 0; dy < cellSize; dy++) {
    const yIdx = (py0 + dy) * w
    for (let dx = 0; dx < cellSize; dx++) {
      const idx = (yIdx + (px0 + dx)) * 4
      buf[idx]     = r
      buf[idx + 1] = g
      buf[idx + 2] = b
      buf[idx + 3] = a
    }
  }
}

/**
 * 多值子图层选中时：逐 cell 描外轮廓（邻居为 0 / 出界时才画边）。
 * 与 legacy render2d 一致，允许不同子值使用不同描边色。
 */
function strokePerCellOutlines(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  source: CellSource,
  strokeForValue: (value: number) => string,
): void {
  const cols = source.cols
  const rows = source.rows
  const bitmap = new Uint8Array(cols * rows)
  const valueGrid = new Int32Array(cols * rows)
  source.iterCells(({ col, row, value }) => {
    if (col >= 0 && col < cols && row >= 0 && row < rows) {
      const idx = row * cols + col
      bitmap[idx] = 1
      valueGrid[idx] = value
    }
  })
  const has = (c: number, r: number): boolean =>
    c >= 0 && c < cols && r >= 0 && r < rows && bitmap[r * cols + c] === 1
  const valAt = (c: number, r: number): number =>
    has(c, r) ? valueGrid[r * cols + c] : 0

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (!has(col, row)) continue
      const value = valAt(col, row)
      ctx.strokeStyle = strokeForValue(value)
      const x = col
      const y = row
      if (!has(col, row - 1)) { ctx.beginPath(); ctx.moveTo(x, y);     ctx.lineTo(x + 1, y);     ctx.stroke() }
      if (!has(col, row + 1)) { ctx.beginPath(); ctx.moveTo(x, y + 1); ctx.lineTo(x + 1, y + 1); ctx.stroke() }
      if (!has(col - 1, row)) { ctx.beginPath(); ctx.moveTo(x, y);     ctx.lineTo(x, y + 1);     ctx.stroke() }
      if (!has(col + 1, row)) { ctx.beginPath(); ctx.moveTo(x + 1, y); ctx.lineTo(x + 1, y + 1); ctx.stroke() }
    }
  }
}

// ── 外轮廓 Path2D in cell-unit coords(buildWireSurface 内部用) ────────────
//
// run-merge:同一行连续 cell 的上边合成一段。一个 64×64 满块从 16K 条 → 4 条。

export function buildMaskOutlinePath(source: CellSource): Path2D {
  const cols = source.cols
  const rows = source.rows
  const bitmap = new Uint8Array(cols * rows)
  source.iterCells(({ col, row }) => {
    if (col >= 0 && col < cols && row >= 0 && row < rows) {
      bitmap[row * cols + col] = 1
    }
  })
  const has = (c: number, r: number): boolean =>
    c >= 0 && c < cols && r >= 0 && r < rows && bitmap[r * cols + c] === 1
  const path = new Path2D()

  for (let row = 0; row < rows; row++) {
    let runStart = -1
    for (let col = 0; col <= cols; col++) {
      const onEdge = col < cols && has(col, row) && !has(col, row - 1)
      if (onEdge && runStart === -1) runStart = col
      else if (!onEdge && runStart !== -1) {
        path.moveTo(runStart, row); path.lineTo(col, row)
        runStart = -1
      }
    }
    runStart = -1
    for (let col = 0; col <= cols; col++) {
      const onEdge = col < cols && has(col, row) && !has(col, row + 1)
      if (onEdge && runStart === -1) runStart = col
      else if (!onEdge && runStart !== -1) {
        path.moveTo(runStart, row + 1); path.lineTo(col, row + 1)
        runStart = -1
      }
    }
  }
  for (let col = 0; col < cols; col++) {
    let runStart = -1
    for (let row = 0; row <= rows; row++) {
      const onEdge = row < rows && has(col, row) && !has(col - 1, row)
      if (onEdge && runStart === -1) runStart = row
      else if (!onEdge && runStart !== -1) {
        path.moveTo(col, runStart); path.lineTo(col, row)
        runStart = -1
      }
    }
    runStart = -1
    for (let row = 0; row <= rows; row++) {
      const onEdge = row < rows && has(col, row) && !has(col + 1, row)
      if (onEdge && runStart === -1) runStart = row
      else if (!onEdge && runStart !== -1) {
        path.moveTo(col + 1, runStart); path.lineTo(col + 1, row)
        runStart = -1
      }
    }
  }
  return path
}

// ── cacheKey:让 drawMode / 子值选中 / layer 选中态变化时触发 rebuild ──────

/** asset drawMode 的 cacheKey 上下文:alias 池 + 本层 asset 属性 */
export interface SurfaceAssetCtx {
  aliases: ReadonlyArray<AliasMeta>
  assetName?: string
  assetAlias?: string
  assetType?: string
}

export function makeSurfaceCacheKey(
  source: CellSource,
  drawMode: DrawMode,
  selectedSubValue: number | null,
  isSelected: boolean,
  isEditorSelected: boolean,
  assetCtx?: SurfaceAssetCtx,
): string {
  // 选中态只对 wire 影响 build 输出(stroke 颜色);color 模式 selected 不进 build,
  // 仍由 compose 外框 stroke 表达 —— 所以 color 时把 selected 编码为 '-' 避免无谓 rebuild
  const selKey = drawMode === 'wire' ? `${isSelected ? 'L' : ''}${isEditorSelected ? 'E' : ''}` : '-'
  // asset 模式:把命中 alias 的 rule@tick / img@tick 拼进 key —— 异步资产加载完
  // (tick +1)时该层 cacheKey 变化 → 仅这一层 rebuild 启用 sprite;无命中则不进 key。
  const assetKey = (drawMode === 'asset' && assetCtx && (assetCtx.assetName || assetCtx.assetAlias) && assetCtx.aliases.length > 0)
    ? assetAtlasTickKey(assetCtx)
    : '-'
  return `${source.version}:${drawMode}:${selectedSubValue ?? '-'}:${selKey}:${assetKey}`
}

function assetAtlasTickKey(ctx: SurfaceAssetCtx): string {
  const m = matchAssetEntry({ assetName: ctx.assetName ?? '', assetAlias: ctx.assetAlias, assetType: ctx.assetType }, ctx.aliases, false)
  if (!m) return `n=${ctx.aliases.length}`
  const url = getRegisteredAssetUrl(m.primary)
  const ruleTick = m.tileType ? getRuleLoadTick(m.tileType) : 0
  return `${m.primary}@${getLoadTick(url)}|${m.tileType ?? ''}@${ruleTick}`
}
