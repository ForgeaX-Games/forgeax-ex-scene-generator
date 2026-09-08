/**
 * image_resize — 图像等比缩放
 *
 * 算法移植自共享电池库 (materials/batteries/ts/image/processing/image_resize)：
 *   nearest — 最近邻插值，保留像素硬边缘，适合像素风
 *   smart   — 腐蚀(kernel=2) → 面积插值(box filter) → USM 锐化，适合写实贴图降采样
 *
 * I/O 通过 `processImage`（_shared/asset2d.ts）委托后端 asset2d 服务解码/编码，
 * 本电池只做纯像素缩放。
 */

import { processImage, type DecodedImage } from '../../../_shared/asset2d.js'

function clampUint8(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v)
}

function nearestNeighbor(src: Uint8Array, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  const dst = new Uint8Array(dw * dh * 4)
  const scaleX = sw / dw
  const scaleY = sh / dh
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(Math.floor(x * scaleX), sw - 1)
      const sy = Math.min(Math.floor(y * scaleY), sh - 1)
      const si = (sy * sw + sx) * 4
      const di = (y * dw + x) * 4
      dst[di] = src[si]; dst[di + 1] = src[si + 1]; dst[di + 2] = src[si + 2]; dst[di + 3] = src[si + 3]
    }
  }
  return dst
}

function areaResize(src: Uint8Array, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  const dst = new Uint8Array(dw * dh * 4)
  const scaleX = sw / dw
  const scaleY = sh / dh
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const x0 = x * scaleX, y0 = y * scaleY
      const x1 = (x + 1) * scaleX, y1 = (y + 1) * scaleY
      let r = 0, g = 0, b = 0, a = 0, cnt = 0
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          if (sx >= 0 && sx < sw && sy >= 0 && sy < sh) {
            const i = (sy * sw + sx) * 4
            r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3]; cnt++
          }
        }
      }
      const di = (y * dw + x) * 4
      if (cnt > 0) {
        dst[di] = clampUint8(r / cnt); dst[di + 1] = clampUint8(g / cnt)
        dst[di + 2] = clampUint8(b / cnt); dst[di + 3] = clampUint8(a / cnt)
      }
    }
  }
  return dst
}

function erodeRGBA(src: Uint8Array, w: number, h: number, kernelSize: number): Uint8Array {
  const dst = new Uint8Array(src.length)
  const half = Math.floor(kernelSize / 2)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let minR = 255, minG = 255, minB = 255, maxA = 0
      for (let ky = -half; ky <= half; ky++) {
        for (let kx = -half; kx <= half; kx++) {
          const ny = y + ky, nx = x + kx
          if (ny >= 0 && ny < h && nx >= 0 && nx < w) {
            const i = (ny * w + nx) * 4
            if (src[i] < minR) minR = src[i]
            if (src[i + 1] < minG) minG = src[i + 1]
            if (src[i + 2] < minB) minB = src[i + 2]
            if (src[i + 3] > maxA) maxA = src[i + 3]
          }
        }
      }
      const di = (y * w + x) * 4
      dst[di] = minR; dst[di + 1] = minG; dst[di + 2] = minB; dst[di + 3] = maxA
    }
  }
  return dst
}

function gaussianBlurRGBA(src: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  if (radius < 0.5) return Uint8Array.from(src)
  const size = Math.ceil(radius * 3) * 2 + 1
  const half = Math.floor(size / 2)
  const kernel = new Float64Array(size)
  let sum = 0
  for (let i = 0; i < size; i++) {
    const x = i - half
    kernel[i] = Math.exp(-(x * x) / (2 * radius * radius))
    sum += kernel[i]
  }
  for (let i = 0; i < size; i++) kernel[i] /= sum
  const temp = new Float64Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 4; c++) {
        let val = 0
        for (let k = 0; k < size; k++) {
          const nx = Math.max(0, Math.min(w - 1, x + k - half))
          val += src[(y * w + nx) * 4 + c] * kernel[k]
        }
        temp[(y * w + x) * 4 + c] = val
      }
    }
  }
  const dst = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 4; c++) {
        let val = 0
        for (let k = 0; k < size; k++) {
          const ny = Math.max(0, Math.min(h - 1, y + k - half))
          val += temp[(ny * w + x) * 4 + c] * kernel[k]
        }
        dst[(y * w + x) * 4 + c] = clampUint8(val)
      }
    }
  }
  return dst
}

function unsharpMask(src: Uint8Array, w: number, h: number, radius: number, amount: number, threshold: number): Uint8Array {
  const blurred = gaussianBlurRGBA(src, w, h, radius)
  const dst = new Uint8Array(src.length)
  for (let i = 0; i < w * h; i++) {
    const idx = i * 4
    for (let c = 0; c < 3; c++) {
      const orig = src[idx + c], blur = blurred[idx + c]
      const diff = orig - blur
      dst[idx + c] = Math.abs(diff) > threshold ? clampUint8(orig + amount * diff) : src[idx + c]
    }
    dst[idx + 3] = src[idx + 3]
  }
  return dst
}

/** 纯像素缩放：RGBA in → RGBA out。导出供单测直接验证。 */
export function resizePixels(
  src: Uint8Array, sw: number, sh: number,
  targetW: number, targetH: number, smart: boolean,
): { pixels: Uint8Array; w: number; h: number } {
  let dw = targetW, dh = targetH
  if (dw <= 0 && dh <= 0) { dw = sw; dh = sh }
  else if (dw <= 0) dw = Math.max(1, Math.round((sw * dh) / sh))
  else if (dh <= 0) dh = Math.max(1, Math.round((sh * dw) / sw))

  if (smart) {
    const eroded = erodeRGBA(src, sw, sh, 2)
    const resized = areaResize(eroded, sw, sh, dw, dh)
    const sharpened = unsharpMask(resized, dw, dh, 1.0, 1.5, 3)
    return { pixels: sharpened, w: dw, h: dh }
  }
  return { pixels: nearestNeighbor(src, sw, sh, dw, dh), w: dw, h: dh }
}

export async function imageResize(
  input: Record<string, unknown>,
  ctx?: { services?: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  const targetW = typeof input.width === 'number' ? Math.round(input.width) : 128
  const targetH = typeof input.height === 'number' ? Math.round(input.height) : 0
  const smart = input.mode === 'smart'

  const res = processImage(input, ctx, 'image_resize', (img: DecodedImage) => {
    const src = new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength)
    const out = resizePixels(src, img.width, img.height, targetW, targetH, smart)
    return { width: out.w, height: out.h, data: Buffer.from(out.pixels.buffer, out.pixels.byteOffset, out.pixels.byteLength) }
  }, { suffix: '_resized' })

  return { image: res.image, out_width: res.width, out_height: res.height, error: res.error }
}
