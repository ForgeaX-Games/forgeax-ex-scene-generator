/**
 * image_despeckle — 抠图残留白/灰杂点修复（内容识别填充的轻量版）
 *
 * 背景移除后常残留「蒙版没抠干净」的孤立白点/灰点：本应是主体色的像素，却保留
 * 成低饱和的白或灰。本电池检测这些孤立杂点并用周围有效像素插值填充，使其融入
 * 邻近颜色。流程：
 *   1. 候选检测：不透明 + 低饱和（白/灰）+ 局部离群（与邻域中位色差异大）
 *   2. 连通块面积过滤：只清「点状」小连通块，保留线/面，避免误删正当灰色区域
 *   3. 内向传播填充：对杂点反复取 8 邻域有效像素平均（normalized convolution），
 *      逐圈向内补间，平滑融入周围色——比 Photoshop PatchMatch 轻量且确定可复现
 * 只替换 RGB，alpha 保持不变。I/O 经 `processImage` 委托后端 asset2d 服务。
 */

import { processImage, type DecodedImage } from '../../../_shared/asset2d.js'

interface DespeckleConfig {
  alphaThreshold: number
  satThreshold: number
  valueMin: number
  outlierThreshold: number
  maxSpeckSize: number
  outlierRadius: number
  maxFillIterations: number
}

function defaultConfig(): DespeckleConfig {
  return {
    alphaThreshold: 128,
    satThreshold: 0.18,
    valueMin: 0.35,
    outlierThreshold: 48,
    maxSpeckSize: 12,
    outlierRadius: 2,
    maxFillIterations: 64,
  }
}

/** sRGB → HSV 的 S、V（0..1）。白=高 V 低 S，灰=中 V 低 S，皆为低饱和。 */
function satVal(r: number, g: number, b: number): { s: number; v: number } {
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const v = mx / 255
  const s = mx === 0 ? 0 : (mx - mn) / mx
  return { s, v }
}

/**
 * 检测白/灰杂点掩码（1=杂点）。三条件 AND：不透明、低饱和（白或灰）、局部离群
 * （与邻域非候选有效像素中位色的色差超阈值），再用连通块面积过滤只留点状小块。
 * 导出供单测直接验证。名字以 `_` 前缀落在 loader 入口正则 `/^[a-z]/` 之外，确保
 * loader 选 `imageDespeckle` 作 execute 入口（见 image_pixel_fix 的 loader-entry 教训）。
 */
export function _detectSpeckles(src: Uint8Array, w: number, h: number, config: DespeckleConfig): Uint8Array {
  const n = w * h
  const opaque = new Uint8Array(n)
  const grayish = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (src[i * 4 + 3] < config.alphaThreshold) continue
    opaque[i] = 1
    const { s, v } = satVal(src[i * 4], src[i * 4 + 1], src[i * 4 + 2])
    if (s <= config.satThreshold && v >= config.valueMin) grayish[i] = 1
  }

  // 局部离群：候选像素 vs 邻域内「非候选不透明像素」的中位色，差异大才算杂点。
  const cand = new Uint8Array(n)
  const rad = Math.max(1, config.outlierRadius)
  const rs: number[] = [], gs: number[] = [], bs: number[] = []
  for (let i = 0; i < n; i++) {
    if (!grayish[i]) continue
    const x = i % w, y = (i / w) | 0
    rs.length = 0; gs.length = 0; bs.length = 0
    for (let dy = -rad; dy <= rad; dy++) {
      const ny = y + dy
      if (ny < 0 || ny >= h) continue
      for (let dx = -rad; dx <= rad; dx++) {
        const nx = x + dx
        if (nx < 0 || nx >= w) continue
        const j = ny * w + nx
        if (j === i || !opaque[j] || grayish[j]) continue
        rs.push(src[j * 4]); gs.push(src[j * 4 + 1]); bs.push(src[j * 4 + 2])
      }
    }
    if (rs.length === 0) { cand[i] = 1; continue } // 无正常邻居 → 视为杂点
    const mr = median(rs), mg = median(gs), mb = median(bs)
    const dr = src[i * 4] - mr, dg = src[i * 4 + 1] - mg, db = src[i * 4 + 2] - mb
    if (Math.sqrt(dr * dr + dg * dg + db * db) > config.outlierThreshold) cand[i] = 1
  }

  // 连通块面积过滤：仅保留面积 ≤ maxSpeckSize 的点状块（4 邻接 flood fill）。
  const mask = new Uint8Array(n)
  const visited = new Uint8Array(n)
  const stack: number[] = []
  for (let start = 0; start < n; start++) {
    if (!cand[start] || visited[start]) continue
    stack.length = 0
    stack.push(start)
    visited[start] = 1
    const comp: number[] = []
    while (stack.length) {
      const idx = stack.pop() as number
      comp.push(idx)
      const x = idx % w, y = (idx / w) | 0
      if (x > 0 && cand[idx - 1] && !visited[idx - 1]) { visited[idx - 1] = 1; stack.push(idx - 1) }
      if (x < w - 1 && cand[idx + 1] && !visited[idx + 1]) { visited[idx + 1] = 1; stack.push(idx + 1) }
      if (y > 0 && cand[idx - w] && !visited[idx - w]) { visited[idx - w] = 1; stack.push(idx - w) }
      if (y < h - 1 && cand[idx + w] && !visited[idx + w]) { visited[idx + w] = 1; stack.push(idx + w) }
    }
    if (comp.length <= config.maxSpeckSize) for (const idx of comp) mask[idx] = 1
  }
  return mask
}

function median(arr: number[]): number {
  const a = arr.slice().sort((p, q) => p - q)
  const m = a.length >> 1
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}

/**
 * 内向传播填充：对掩码像素反复取 8 邻域「有效」像素平均，逐圈向内补间，直到全部
 * 填满或达迭代上限。只改 RGB，alpha 不动。导出供单测直接验证。
 */
export function _despeckle(src: Uint8Array, w: number, h: number, config: DespeckleConfig): Uint8Array {
  const n = w * h
  const out = Uint8Array.from(src)
  const mask = _detectSpeckles(src, w, h, config)

  // valid：不透明且非杂点 → 可作填充来源；杂点初始为待填。
  const valid = new Uint8Array(n)
  for (let i = 0; i < n; i++) valid[i] = src[i * 4 + 3] >= config.alphaThreshold && !mask[i] ? 1 : 0

  let remaining = 0
  for (let i = 0; i < n; i++) if (mask[i]) remaining++

  for (let iter = 0; iter < config.maxFillIterations && remaining > 0; iter++) {
    const fillR = new Float64Array(n)
    const fillG = new Float64Array(n)
    const fillB = new Float64Array(n)
    const filledNow = new Uint8Array(n)
    let progressed = false
    for (let i = 0; i < n; i++) {
      if (!mask[i] || valid[i]) continue
      const x = i % w, y = (i / w) | 0
      let sr = 0, sg = 0, sb = 0, cnt = 0
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          if (nx < 0 || nx >= w) continue
          const j = ny * w + nx
          if (!valid[j]) continue
          sr += out[j * 4]; sg += out[j * 4 + 1]; sb += out[j * 4 + 2]; cnt++
        }
      }
      if (cnt > 0) {
        fillR[i] = sr / cnt; fillG[i] = sg / cnt; fillB[i] = sb / cnt
        filledNow[i] = 1
        progressed = true
      }
    }
    if (!progressed) break
    for (let i = 0; i < n; i++) {
      if (!filledNow[i]) continue
      out[i * 4] = Math.round(fillR[i])
      out[i * 4 + 1] = Math.round(fillG[i])
      out[i * 4 + 2] = Math.round(fillB[i])
      valid[i] = 1
      remaining--
    }
  }
  return out
}

export async function imageDespeckle(
  input: Record<string, unknown>,
  ctx?: { services?: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  const config = defaultConfig()
  if (typeof input.sat_threshold === 'number') config.satThreshold = input.sat_threshold
  if (typeof input.value_min === 'number') config.valueMin = input.value_min
  if (typeof input.outlier_threshold === 'number') config.outlierThreshold = input.outlier_threshold
  if (typeof input.max_speck_size === 'number') config.maxSpeckSize = Math.round(input.max_speck_size)

  const res = processImage(input, ctx, 'image_despeckle', (img: DecodedImage) => {
    const src = new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength)
    const out = _despeckle(src, img.width, img.height, config)
    return { width: img.width, height: img.height, data: Buffer.from(out.buffer, out.byteOffset, out.byteLength) }
  }, { suffix: '_despeckle' })

  return { image: res.image, width: res.width, height: res.height, error: res.error }
}
