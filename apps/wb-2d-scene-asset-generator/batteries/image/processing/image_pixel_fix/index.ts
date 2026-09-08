/**
 * image_pixel_fix — 伪像素图修复（完美像素化）
 *
 * 算法移植自 Pixel-Fixer (DDDeeeee/Pixel-Fixer, process_pixel_art.py)：把 AI 生成
 * 的「伪像素图」（像素块大小不一、边缘模糊抗锯齿、一个色块几十种相近色）还原成
 * 真正的点对点像素图。流程：
 *   1. 色彩量化：k-means 把所有颜色聚成 k 类，合并噪点（k 可指定或自动探测）
 *   2. 网格检测：对量化图按行/列算梯度投影，找峰值估计「像素块」步长
 *   3. 网格行走 + 稳定化：从 0 起按步长行走，在峰值附近吸附切割线；不足则均匀回退
 *   4. 重采样：每个检测出的格子内取众数颜色 → 输出一个像素（点对点缩小）
 *
 * I/O 通过 `processImage`（_shared/asset2d.ts）委托后端 asset2d 服务解码/编码，
 * 本电池只做纯像素算法，输出真正像素分辨率的小图 + 其宽高。
 */

import { processImage, type DecodedImage } from '../../../_shared/asset2d.js'

interface PixelFixConfig {
  kColors: number
  kSeed: number
  maxKmeansIterations: number
  peakThresholdMultiplier: number
  peakDistanceFilter: number
  walkerSearchWindowRatio: number
  walkerMinSearchWindow: number
  walkerStrengthThreshold: number
  minCutsPerAxis: number
  fallbackTargetSegments: number
}

function defaultConfig(kColors: number): PixelFixConfig {
  return {
    kColors,
    kSeed: 42,
    maxKmeansIterations: 15,
    peakThresholdMultiplier: 0.2,
    peakDistanceFilter: 4,
    walkerSearchWindowRatio: 0.35,
    walkerMinSearchWindow: 2.0,
    walkerStrengthThreshold: 0.5,
    minCutsPerAxis: 4,
    fallbackTargetSegments: 64,
  }
}

/** 可重现的轻量 PRNG（mulberry32），让 k-means 初始质心选取在给定 seed 下确定。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 自适应识别颜色数量：统计不透明像素频率，按频率合并视觉相近色（阈值 35），
 * 直到覆盖 ~98% 像素或达到 maxK。对应 Python `auto_detect_k`。
 */
function autoDetectK(opaque: Float64Array, count: number, maxK = 64): number {
  if (count === 0) return 2
  const freq = new Map<number, number>()
  for (let i = 0; i < count; i++) {
    const r = opaque[i * 3] | 0, g = opaque[i * 3 + 1] | 0, b = opaque[i * 3 + 2] | 0
    const key = (r << 16) | (g << 8) | b
    freq.set(key, (freq.get(key) ?? 0) + 1)
  }
  const entries = [...freq.entries()].sort((p, q) => q[1] - p[1])
  const distThresholdSq = 35 * 35
  const principal: Array<[number, number, number]> = []
  let coverage = 0
  const target = count * 0.98
  for (const [key, c] of entries) {
    const r = (key >> 16) & 0xff, g = (key >> 8) & 0xff, b = key & 0xff
    let near = false
    for (const [pr, pg, pb] of principal) {
      const dr = pr - r, dg = pg - g, db = pb - b
      if (dr * dr + dg * dg + db * db <= distThresholdSq) { near = true; break }
    }
    if (!near) { principal.push([r, g, b]); coverage += c }
    if (principal.length >= maxK || coverage >= target) break
  }
  return Math.max(2, principal.length)
}

/**
 * k-means（Lloyd 迭代）对所有不透明像素聚类，返回每个像素的标签图、调色板。
 * 透明像素也按其 RGB 就近归类（用于后续重采样投票），但不参与质心更新。
 */
function quantize(
  src: Uint8Array, w: number, h: number, config: PixelFixConfig,
): { indexMap: Int32Array; palette: Uint8Array; k: number } {
  const n = w * h
  const opaque = new Float64Array(n * 3)
  let opaqueCount = 0
  for (let i = 0; i < n; i++) {
    if (src[i * 4 + 3] > 0) {
      opaque[opaqueCount * 3] = src[i * 4]
      opaque[opaqueCount * 3 + 1] = src[i * 4 + 1]
      opaque[opaqueCount * 3 + 2] = src[i * 4 + 2]
      opaqueCount++
    }
  }

  if (opaqueCount === 0) {
    return { indexMap: new Int32Array(n), palette: new Uint8Array([0, 0, 0, 0]), k: 1 }
  }

  const finalK = config.kColors > 0 ? config.kColors : autoDetectK(opaque, opaqueCount)
  const k = Math.max(1, Math.min(finalK, opaqueCount))

  const rand = mulberry32(config.kSeed)
  const centroids = new Float64Array(k * 3)
  const chosen = new Set<number>()
  for (let c = 0; c < k; c++) {
    let idx = Math.floor(rand() * opaqueCount)
    let guard = 0
    while (chosen.has(idx) && guard++ < opaqueCount) idx = (idx + 1) % opaqueCount
    chosen.add(idx)
    centroids[c * 3] = opaque[idx * 3]
    centroids[c * 3 + 1] = opaque[idx * 3 + 1]
    centroids[c * 3 + 2] = opaque[idx * 3 + 2]
  }

  const assign = new Int32Array(opaqueCount)
  for (let iter = 0; iter < config.maxKmeansIterations; iter++) {
    let changed = false
    for (let p = 0; p < opaqueCount; p++) {
      const r = opaque[p * 3], g = opaque[p * 3 + 1], b = opaque[p * 3 + 2]
      let best = 0, bestDist = Infinity
      for (let c = 0; c < k; c++) {
        const dr = r - centroids[c * 3], dg = g - centroids[c * 3 + 1], db = b - centroids[c * 3 + 2]
        const d = dr * dr + dg * dg + db * db
        if (d < bestDist) { bestDist = d; best = c }
      }
      if (assign[p] !== best) { assign[p] = best; changed = true }
    }
    const sums = new Float64Array(k * 3)
    const counts = new Int32Array(k)
    for (let p = 0; p < opaqueCount; p++) {
      const c = assign[p]
      sums[c * 3] += opaque[p * 3]; sums[c * 3 + 1] += opaque[p * 3 + 1]; sums[c * 3 + 2] += opaque[p * 3 + 2]
      counts[c]++
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) {
        centroids[c * 3] = sums[c * 3] / counts[c]
        centroids[c * 3 + 1] = sums[c * 3 + 1] / counts[c]
        centroids[c * 3 + 2] = sums[c * 3 + 2] / counts[c]
      }
    }
    if (!changed && iter > 0) break
  }

  const palette = new Uint8Array(k * 4)
  for (let c = 0; c < k; c++) {
    palette[c * 4] = clampByte(centroids[c * 3])
    palette[c * 4 + 1] = clampByte(centroids[c * 3 + 1])
    palette[c * 4 + 2] = clampByte(centroids[c * 3 + 2])
    palette[c * 4 + 3] = 255
  }

  const indexMap = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    const r = src[i * 4], g = src[i * 4 + 1], b = src[i * 4 + 2]
    let best = 0, bestDist = Infinity
    for (let c = 0; c < k; c++) {
      const dr = r - centroids[c * 3], dg = g - centroids[c * 3 + 1], db = b - centroids[c * 3 + 2]
      const d = dr * dr + dg * dg + db * db
      if (d < bestDist) { bestDist = d; best = c }
    }
    indexMap[i] = best
  }

  return { indexMap, palette, k }
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v)
}

/** 量化图的行/列梯度投影（对应 Python `compute_profiles_vectorized`）。 */
function computeProfiles(
  indexMap: Int32Array, palette: Uint8Array, alpha: Uint8Array, w: number, h: number,
): { col: Float64Array; row: Float64Array } {
  const gray = new Float64Array(w * h)
  for (let i = 0; i < w * h; i++) {
    if (alpha[i] === 0) { gray[i] = 0; continue }
    const c = indexMap[i]
    gray[i] = 0.299 * palette[c * 4] + 0.587 * palette[c * 4 + 1] + 0.114 * palette[c * 4 + 2]
  }
  const col = new Float64Array(w)
  for (let x = 0; x < w; x++) {
    let s = 0
    const xl = Math.max(0, x - 1), xr = Math.min(w - 1, x + 1)
    for (let y = 0; y < h; y++) s += Math.abs(gray[y * w + xr] - gray[y * w + xl])
    col[x] = s
  }
  const row = new Float64Array(h)
  for (let y = 0; y < h; y++) {
    let s = 0
    const yt = Math.max(0, y - 1), yb = Math.min(h - 1, y + 1)
    for (let x = 0; x < w; x++) s += Math.abs(gray[yb * w + x] - gray[yt * w + x])
    row[y] = s
  }
  return { col, row }
}

function maxOf(p: Float64Array): number {
  let m = 0
  for (let i = 0; i < p.length; i++) if (p[i] > m) m = p[i]
  return m
}

function meanOf(p: Float64Array): number {
  if (p.length === 0) return 0
  let s = 0
  for (let i = 0; i < p.length; i++) s += p[i]
  return s / p.length
}

/** 由梯度投影峰间距估计像素块步长（对应 Python `estimate_step_size`）。 */
function estimateStepSize(profile: Float64Array, config: PixelFixConfig): number | null {
  const mx = maxOf(profile)
  if (mx === 0) return null
  const thresh = mx * config.peakThresholdMultiplier
  const peaks: number[] = []
  for (let i = 1; i < profile.length - 1; i++) {
    if (profile[i] > thresh && profile[i] >= profile[i - 1] && profile[i] >= profile[i + 1]) peaks.push(i)
  }
  if (peaks.length < 2) return null
  const clean = [peaks[0]]
  for (let i = 1; i < peaks.length; i++) {
    if (peaks[i] - clean[clean.length - 1] >= config.peakDistanceFilter) clean.push(peaks[i])
  }
  if (clean.length < 2) return null
  const diffs: number[] = []
  for (let i = 1; i < clean.length; i++) diffs.push(clean[i] - clean[i - 1])
  diffs.sort((a, b) => a - b)
  const mid = Math.floor(diffs.length / 2)
  return diffs.length % 2 ? diffs[mid] : (diffs[mid - 1] + diffs[mid]) / 2
}

/** 从 0 起按步长行走，在峰值附近吸附切割线（对应 Python `walk`）。 */
function walk(profile: Float64Array, stepSize: number, limit: number, config: PixelFixConfig): number[] {
  const cuts = [0]
  let curr = 0
  const win = Math.max(stepSize * config.walkerSearchWindowRatio, config.walkerMinSearchWindow)
  const meanV = meanOf(profile)
  let guard = 0
  while (curr < limit && guard++ < limit * 4 + 16) {
    const target = curr + stepSize
    if (target >= limit) { cuts.push(limit); break }
    const start = Math.max(Math.floor(target - win), Math.floor(curr + 1))
    const end = Math.min(Math.floor(target + win), limit)
    if (end <= start) { curr = target; cuts.push(Math.floor(target)); continue }
    let maxIdx = start, maxVal = -Infinity
    for (let i = start; i < end; i++) if (profile[i] > maxVal) { maxVal = profile[i]; maxIdx = i }
    if (maxVal > meanV * config.walkerStrengthThreshold) { curr = maxIdx; cuts.push(maxIdx) }
    else { curr = target; cuts.push(Math.floor(target)) }
  }
  return uniqueSorted(cuts)
}

/** 均匀回退切割（对应 Python `snap_uniform_cuts`）。 */
function snapUniformCuts(
  profile: Float64Array, limit: number, targetStep: number, config: PixelFixConfig, minReq: number,
): number[] {
  const cells = Math.min(Math.max(Math.round(limit / targetStep), minReq - 1), limit)
  const cellW = limit / cells
  const win = Math.max(cellW * config.walkerSearchWindowRatio, config.walkerMinSearchWindow)
  const meanV = meanOf(profile)
  const cuts = [0]
  for (let i = 1; i < cells; i++) {
    const target = cellW * i
    const prev = cuts[cuts.length - 1]
    const start = Math.max(prev + 1, Math.floor(target - win))
    const end = Math.min(limit - 1, Math.floor(target + win))
    if (end < start) { cuts.push(Math.min(prev + 1, limit - 1)); continue }
    let maxIdx = start, maxVal = -Infinity
    for (let i2 = start; i2 <= end; i2++) if (profile[i2] > maxVal) { maxVal = profile[i2]; maxIdx = i2 }
    if (maxVal > meanV * config.walkerStrengthThreshold) cuts.push(maxIdx)
    else cuts.push(Math.min(Math.max(Math.round(target), prev + 1), limit - 1))
  }
  cuts.push(limit)
  return uniqueSorted(cuts)
}

/** 保证两轴各自有足够切割线，不足则均匀回退（对应 Python `stabilize_both_axes`）。 */
function stabilizeAxis(profile: Float64Array, rawCuts: number[], limit: number, config: PixelFixConfig): number[] {
  const c = uniqueSorted([0, limit, ...rawCuts.map((x) => Math.floor(x))])
  const minReq = Math.min(Math.max(config.minCutsPerAxis, 2), limit + 1)
  if (c.length >= minReq) return c
  const tStep = config.fallbackTargetSegments > 1 ? limit / config.fallbackTargetSegments : 10.0
  return snapUniformCuts(profile, limit, tStep, config, minReq)
}

function uniqueSorted(arr: number[]): number[] {
  return [...new Set(arr)].sort((a, b) => a - b)
}

/** 每个格子内取众数调色板颜色 → 一个输出像素（对应 Python `resample_optimized`）。 */
function resample(
  indexMap: Int32Array, palette: Uint8Array, alpha: Uint8Array, w: number,
  cols: number[], rows: number[], k: number,
): { pixels: Uint8Array; w: number; h: number } {
  const outW = cols.length - 1, outH = rows.length - 1
  const out = new Uint8Array(outW * outH * 4)
  const bins = new Int32Array(k)
  for (let y = 0; y < outH; y++) {
    const ys = rows[y], ye = rows[y + 1]
    for (let x = 0; x < outW; x++) {
      const xs = cols[x], xe = cols[x + 1]
      const di = (y * outW + x) * 4
      let total = 0, transparent = 0
      for (let yy = ys; yy < ye; yy++) for (let xx = xs; xx < xe; xx++) { total++; if (alpha[yy * w + xx] < 128) transparent++ }
      if (total === 0) continue
      if (transparent / total > 0.5) { out[di] = 0; out[di + 1] = 0; out[di + 2] = 0; out[di + 3] = 0; continue }
      bins.fill(0)
      let voted = false
      for (let yy = ys; yy < ye; yy++) for (let xx = xs; xx < xe; xx++) {
        if (alpha[yy * w + xx] > 128) { bins[indexMap[yy * w + xx]]++; voted = true }
      }
      if (!voted) for (let yy = ys; yy < ye; yy++) for (let xx = xs; xx < xe; xx++) bins[indexMap[yy * w + xx]]++
      let best = 0, bestCount = -1
      for (let c = 0; c < k; c++) if (bins[c] > bestCount) { bestCount = bins[c]; best = c }
      out[di] = palette[best * 4]; out[di + 1] = palette[best * 4 + 1]
      out[di + 2] = palette[best * 4 + 2]; out[di + 3] = 255
    }
  }
  return { pixels: out, w: outW, h: outH }
}

/**
 * 纯像素化修复：RGBA in → RGBA out（点对点像素分辨率）。导出供单测直接验证。
 * 名字以 `_` 前缀落在 battery loader 入口正则 `/^[a-z]/` 之外，确保 loader 选
 * `imagePixelFix` 作 execute 入口（见 image_atlas_compose 的 loader-entry 教训）。
 */
export function _pixelFix(
  src: Uint8Array, w: number, h: number, kColors: number, squareGrid = true,
): { pixels: Uint8Array; w: number; h: number } {
  const config = defaultConfig(kColors)
  const { indexMap, palette, k } = quantize(src, w, h, config)
  const alpha = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) alpha[i] = src[i * 4 + 3]

  const { col, row } = computeProfiles(indexMap, palette, alpha, w, h)
  const estX = estimateStepSize(col, config)
  const estY = estimateStepSize(row, config)

  // 伪像素图的像素块几乎总是正方形。某一轴（通常是图像内容更窄/背景更多的那一轴）
  // 峰少而不规律，会估出偏大的步长 → 该轴格子被合并 → 输出被压扁。默认开启
  // squareGrid：当两轴都成功估出步长时，取「更小的有效步长」统一两轴（更细网格、
  // 不丢格）；只有一轴成功时，把该步长复制给另一轴；都失败才各自回退。
  let sx: number
  let sy: number
  if (squareGrid && (estX != null || estY != null)) {
    const shared = estX != null && estY != null
      ? Math.min(estX, estY)
      : (estX ?? estY) as number
    sx = shared
    sy = shared
  } else {
    sx = estX ?? w / config.fallbackTargetSegments
    sy = estY ?? h / config.fallbackTargetSegments
  }

  const rawCols = walk(col, sx, w, config)
  const rawRows = walk(row, sy, h, config)
  const cols = stabilizeAxis(col, rawCols, w, config)
  const rows = stabilizeAxis(row, rawRows, h, config)
  return resample(indexMap, palette, alpha, w, cols, rows, k)
}

export async function imagePixelFix(
  input: Record<string, unknown>,
  ctx?: { services?: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  const kColors = typeof input.k_colors === 'number' ? Math.round(input.k_colors) : 0
  const squareGrid = input.square_grid !== false

  const res = processImage(input, ctx, 'image_pixel_fix', (img: DecodedImage) => {
    const src = new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength)
    const out = _pixelFix(src, img.width, img.height, kColors, squareGrid)
    return { width: out.w, height: out.h, data: Buffer.from(out.pixels.buffer, out.pixels.byteOffset, out.pixels.byteLength) }
  }, { suffix: '_pixfix' })

  return { image: res.image, width: res.width, height: res.height, error: res.error }
}
