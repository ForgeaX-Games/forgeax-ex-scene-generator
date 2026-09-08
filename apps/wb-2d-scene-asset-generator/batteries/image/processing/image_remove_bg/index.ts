/**
 * image_remove_bg — 本地纯算法背景移除（无外部 API）
 *
 * 算法移植自共享电池库 (materials/batteries/ts/image/processing/image_remove_bg)：
 *   1. 从图像角落采样背景色（Lab 色彩空间）
 *   2. 计算每个像素到背景色的 ΔE，生成严格/宽松两层相似度 mask
 *   3. 从图像四边泛洪：严格 mask 作为种子，在宽松 mask 范围内生长 → 背景 mask
 *   4. 反转得到前景 mask，应用形态学闭合（填补小孔洞）
 *   5. 应用 hard matte（二值化 alpha），背景像素清零
 *   6. 可选：裁剪到前景内容的边界框
 *
 * I/O：纯像素算法与资产读写解耦——通过 `processImage`（_shared/asset2d.ts）让
 *      后端 asset2d 服务负责解码输入 ImageRef、编码输出、写入 generated 存储。
 *      本电池只产出 RGBA 像素，因此 alpha 抠图结果可无损回传给下游。
 */

import { processImage, type DecodedImage } from '../../../_shared/asset2d.js'

interface Lab { L: number; A: number; B: number }

function rgbToLab(r: number, g: number, b: number): Lab {
  let rf = r / 255, gf = g / 255, bf = b / 255
  rf = rf > 0.04045 ? Math.pow((rf + 0.055) / 1.055, 2.4) : rf / 12.92
  gf = gf > 0.04045 ? Math.pow((gf + 0.055) / 1.055, 2.4) : gf / 12.92
  bf = bf > 0.04045 ? Math.pow((bf + 0.055) / 1.055, 2.4) : bf / 12.92
  rf *= 100; gf *= 100; bf *= 100
  let x = (rf * 0.4124564 + gf * 0.3575761 + bf * 0.1804375) / 95.047
  let y = (rf * 0.2126729 + gf * 0.7151522 + bf * 0.0721750) / 100.0
  let z = (rf * 0.0193339 + gf * 0.1191920 + bf * 0.9503041) / 108.883
  const f = (t: number) => (t > 0.008856 ? Math.pow(t, 1 / 3) : 7.787 * t + 16 / 116)
  x = f(x); y = f(y); z = f(z)
  return { L: 116 * y - 16, A: 500 * (x - y), B: 200 * (y - z) }
}

function labDist(a: Lab, b: Lab): number {
  const dL = a.L - b.L, dA = a.A - b.A, dB = a.B - b.B
  return Math.sqrt(dL * dL + dA * dA + dB * dB)
}

function labSpread(samples: Lab[]): number {
  if (!samples.length) return 0
  const mean: Lab = { L: 0, A: 0, B: 0 }
  for (const s of samples) { mean.L += s.L; mean.A += s.A; mean.B += s.B }
  const inv = 1 / samples.length
  mean.L *= inv; mean.A *= inv; mean.B *= inv
  return samples.reduce((acc, s) => acc + labDist(s, mean), 0) * inv
}

function morphDilate(mask: Uint8Array, w: number, h: number, k: number): Uint8Array {
  const dst = new Uint8Array(mask.length)
  const half = Math.floor(k / 2)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let maxV = 0
      for (let ky = -half; ky <= half; ky++) {
        for (let kx = -half; kx <= half; kx++) {
          const ny = y + ky, nx = x + kx
          if (ny >= 0 && ny < h && nx >= 0 && nx < w && mask[ny * w + nx] > maxV) maxV = mask[ny * w + nx]
        }
      }
      dst[y * w + x] = maxV
    }
  }
  return dst
}

function morphErode(mask: Uint8Array, w: number, h: number, k: number): Uint8Array {
  const dst = new Uint8Array(mask.length)
  const half = Math.floor(k / 2)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let minV = 255
      for (let ky = -half; ky <= half; ky++) {
        for (let kx = -half; kx <= half; kx++) {
          const ny = y + ky, nx = x + kx
          if (ny >= 0 && ny < h && nx >= 0 && nx < w && mask[ny * w + nx] < minV) minV = mask[ny * w + nx]
        }
      }
      dst[y * w + x] = minV
    }
  }
  return dst
}

/** 闭运算：先膨胀再腐蚀，填补前景内小孔洞 */
function morphClose(mask: Uint8Array, w: number, h: number, k: number): Uint8Array {
  return morphErode(morphDilate(mask, w, h, k), w, h, k)
}

/** 双层泛洪：严格 mask 作种子，在宽松 mask 范围内从四边生长 → 背景 mask */
function floodFillFromEdgesLoose(strict: Uint8Array, loose: Uint8Array, w: number, h: number): Uint8Array {
  const result = new Uint8Array(w * h)
  const visited = new Uint8Array(w * h)
  const queue: number[] = []
  const push = (x: number, y: number) => {
    const idx = y * w + x
    if (strict[idx] === 255) queue.push(idx)
  }
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1) }
  for (let y = 1; y < h - 1; y++) { push(0, y); push(w - 1, y) }
  if (!queue.length) {
    for (let x = 0; x < w; x++) {
      if (loose[x] === 255) queue.push(x)
      if (loose[(h - 1) * w + x] === 255) queue.push((h - 1) * w + x)
    }
    for (let y = 1; y < h - 1; y++) {
      if (loose[y * w] === 255) queue.push(y * w)
      if (loose[y * w + w - 1] === 255) queue.push(y * w + w - 1)
    }
  }
  let head = 0
  while (head < queue.length) {
    const idx = queue[head++]
    if (visited[idx] || loose[idx] !== 255) continue
    visited[idx] = 1
    result[idx] = 255
    const x = idx % w, y = Math.floor(idx / w)
    if (x > 0) queue.push(idx - 1)
    if (x < w - 1) queue.push(idx + 1)
    if (y > 0) queue.push(idx - w)
    if (y < h - 1) queue.push(idx + w)
  }
  return result
}

function cropToContent(pixels: Uint8Array, w: number, h: number, padding: number): { pixels: Uint8Array; w: number; h: number } {
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (pixels[(y * w + x) * 4 + 3] > 0) {
        if (x < minX) minX = x; if (x > maxX) maxX = x
        if (y < minY) minY = y; if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return { pixels, w, h }
  minX = Math.max(0, minX - padding); minY = Math.max(0, minY - padding)
  maxX = Math.min(w - 1, maxX + padding); maxY = Math.min(h - 1, maxY + padding)
  const nw = maxX - minX + 1, nh = maxY - minY + 1
  const out = new Uint8Array(nw * nh * 4)
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const si = ((minY + y) * w + minX + x) * 4
      const di = (y * nw + x) * 4
      out[di] = pixels[si]; out[di + 1] = pixels[si + 1]; out[di + 2] = pixels[si + 2]; out[di + 3] = pixels[si + 3]
    }
  }
  return { pixels: out, w: nw, h: nh }
}

/**
 * 纯像素抠图：RGBA in → RGBA out（背景透明）。导出供单测直接验证。
 * 除裁剪后的结果外，还返回**裁剪前原始尺寸**的前景 mask（cleanMask，单通道
 * 0/255），用于生成「标出保留区域」的全尺寸 mask。
 */
export function removeBg(
  src: Uint8Array, w: number, h: number,
  labTolerance: number, bgGrowTolerance: number, samplePoints: number, crop: boolean,
): { pixels: Uint8Array; w: number; h: number; mask: Uint8Array; maskW: number; maskH: number } {
  const corners = [
    { x: 0, y: 0 }, { x: w - 1, y: 0 },
    { x: 0, y: h - 1 }, { x: w - 1, y: h - 1 },
  ].slice(0, Math.max(1, Math.min(4, samplePoints)))

  const bgLabs: Lab[] = corners.map(({ x, y }) => {
    const i = (y * w + x) * 4
    return rgbToLab(src[i], src[i + 1], src[i + 2])
  })

  const cornerSigma = labSpread(bgLabs)
  const looseTolerance = Math.max(labTolerance, labTolerance + bgGrowTolerance + 0.6 * cornerSigma)

  const strict = new Uint8Array(w * h)
  const loose = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const pi = i * 4
    const pLab = rgbToLab(src[pi], src[pi + 1], src[pi + 2])
    const minDist = bgLabs.reduce((m, bg) => Math.min(m, labDist(pLab, bg)), Infinity)
    if (minDist < labTolerance) strict[i] = 255
    if (minDist < looseTolerance) loose[i] = 255
  }

  const bgMask = floodFillFromEdgesLoose(strict, loose, w, h)
  const fgMask = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) fgMask[i] = bgMask[i] === 0 ? 255 : 0
  const cleanMask = morphClose(fgMask, w, h, 3)
  for (let i = 0; i < w * h; i++) cleanMask[i] = cleanMask[i] >= 128 ? 255 : 0

  const result = Uint8Array.from(src)
  for (let i = 0; i < w * h; i++) {
    result[i * 4 + 3] = cleanMask[i]
    if (cleanMask[i] === 0) { result[i * 4] = 0; result[i * 4 + 1] = 0; result[i * 4 + 2] = 0 }
  }

  // cleanMask is at the ORIGINAL (pre-crop) size — it marks which region was kept
  // in the source's own coordinate space, so any same-size image can be aligned
  // and cropped to the identical region downstream.
  if (crop) {
    const c = cropToContent(result, w, h, 2)
    return { pixels: c.pixels, w: c.w, h: c.h, mask: cleanMask, maskW: w, maskH: h }
  }
  return { pixels: result, w, h, mask: cleanMask, maskW: w, maskH: h }
}

/**
 * 单通道前景 mask（0/255）→ 灰度 RGBA：白=保留区、黑=背景，输出不透明。
 * mask 为**裁剪前的原始尺寸**，标出在原图坐标系里保留了哪片区域。导出供单测验证。
 */
export function maskToRGBA(mask: Uint8Array, w: number, h: number): Uint8Array {
  const n = w * h
  const out = new Uint8Array(n * 4)
  for (let i = 0; i < n; i++) {
    const v = mask[i]
    const di = i * 4
    out[di] = v
    out[di + 1] = v
    out[di + 2] = v
    out[di + 3] = 255
  }
  return out
}

export async function imageRemoveBg(
  input: Record<string, unknown>,
  ctx?: { services?: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  const labTolerance = typeof input.lab_tolerance === 'number' ? input.lab_tolerance : 13
  const bgGrowTolerance = typeof input.bg_grow_tolerance === 'number' ? input.bg_grow_tolerance : 14
  const samplePoints = typeof input.sample_points === 'number' ? Math.round(input.sample_points) : 4
  const crop = input.crop !== false

  // Compute removeBg ONCE; capture the FULL-SIZE (pre-crop) region mask for the
  // 2nd output, so downstream CutByMask can align any same-size image and crop
  // it to the identical kept region.
  let maskCap: { pixels: Uint8Array; w: number; h: number } | null = null
  const res = processImage(input, ctx, 'image_remove_bg', (img: DecodedImage) => {
    const src = new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength)
    const out = removeBg(src, img.width, img.height, labTolerance, bgGrowTolerance, samplePoints, crop)
    maskCap = { pixels: maskToRGBA(out.mask, out.maskW, out.maskH), w: out.maskW, h: out.maskH }
    return { width: out.w, height: out.h, data: Buffer.from(out.pixels.buffer, out.pixels.byteOffset, out.pixels.byteLength) }
  }, { suffix: '_nobg' })

  let mask = ''
  let maskError = ''
  if (!res.error && maskCap) {
    const cap: { pixels: Uint8Array; w: number; h: number } = maskCap
    // Force a distinct '_mask' suffix regardless of the user's `suffix` param
    // (which names the main cutout); pass a clone so input.suffix can't override it.
    const m = processImage({ ...input, suffix: '_mask' }, ctx, 'image_remove_bg', () => ({
      width: cap.w,
      height: cap.h,
      data: Buffer.from(cap.pixels.buffer, cap.pixels.byteOffset, cap.pixels.byteLength),
    }), { suffix: '_mask' })
    mask = m.image
    maskError = m.error
  }

  return { image: res.image, mask, width: res.width, height: res.height, error: res.error || maskError }
}
