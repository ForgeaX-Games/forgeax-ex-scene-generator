/**
 * image_cut_by_mask — 按 mask 对齐裁切
 *
 * 把任意一张图（image）对齐到一张 mask 定义的「保留区域 + 原始尺寸」：
 *   1. 将 image 双线性缩放到 mask 的宽高（mask 为原始全尺寸）；
 *   2. 按 mask 强度乘到 alpha 上：mask 白色处保留、黑色/透明处裁掉；
 *   3. 可选裁剪（crop，默认开）到保留区域的外接框（+2px），从而得到与 RemoveBG
 *      `image` 输出完全对齐、同尺寸的「裁剪后区域图」。
 *
 * mask 通常来自 RemoveBG 电池的 `mask` 输出（原始尺寸、白=前景、黑=背景），这样
 * 多张同源尺寸的图都能被裁切/对齐到完全相同的轮廓、位置与尺寸，无需逐张重新抠图。
 * mask 自身的透明度也会被计入（透明处视为裁掉）。
 *
 * I/O：纯像素算法经 `processImages`（_shared/asset2d.ts）由后端 asset2d 服务解码
 *      两个输入、编码输出、写入 generated 存储。
 */

import { processImages, type DecodedImage } from '../../../_shared/asset2d.js'

export interface CutByMaskResult {
  /** RGBA, length = w * h * 4 */
  pixels: Uint8Array
  w: number
  h: number
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** 双线性缩放 RGBA：sw×sh → dw×dh。尺寸相同时直接拷贝。 */
function bilinearResize(src: Uint8Array, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  const dst = new Uint8Array(dw * dh * 4)
  if (sw === dw && sh === dh) {
    dst.set(src.subarray(0, dw * dh * 4))
    return dst
  }
  const sxr = sw / dw
  const syr = sh / dh
  for (let y = 0; y < dh; y++) {
    const fy = (y + 0.5) * syr - 0.5
    const y0 = clampInt(Math.floor(fy), 0, sh - 1)
    const y1 = clampInt(y0 + 1, 0, sh - 1)
    const wy = fy - Math.floor(fy)
    for (let x = 0; x < dw; x++) {
      const fx = (x + 0.5) * sxr - 0.5
      const x0 = clampInt(Math.floor(fx), 0, sw - 1)
      const x1 = clampInt(x0 + 1, 0, sw - 1)
      const wx = fx - Math.floor(fx)
      const i00 = (y0 * sw + x0) * 4
      const i01 = (y0 * sw + x1) * 4
      const i10 = (y1 * sw + x0) * 4
      const i11 = (y1 * sw + x1) * 4
      const di = (y * dw + x) * 4
      for (let c = 0; c < 4; c++) {
        const top = src[i00 + c] * (1 - wx) + src[i01 + c] * wx
        const bot = src[i10 + c] * (1 - wx) + src[i11 + c] * wx
        dst[di + c] = Math.round(top * (1 - wy) + bot * wy)
      }
    }
  }
  return dst
}

/** 裁剪到非透明内容的外接框（含 padding，越界夹紧）。 */
function cropToContent(pixels: Uint8Array, w: number, h: number, padding: number): CutByMaskResult {
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (pixels[(y * w + x) * 4 + 3] > 0) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
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
 * 纯像素按 mask 对齐裁切：image 缩放到 mask（原始）尺寸后按 mask 强度调制 alpha，
 * 可选裁剪到保留区域外接框。导出供单测直接验证。
 * @param mw/mh mask 的宽高（= 原始全尺寸）。
 * @param crop  为 true 时裁剪到保留区域外接框（+2px），得到裁剪后区域图。
 */
// NOTE: leading underscore keeps this OUT of the battery loader's entry-function
// detection (it picks the first export whose name matches /^[a-z]/, scanning the
// ES-module namespace in alphabetical order). Without the underscore, "cutByMask"
// would sort before "imageCutByMask" and be mis-selected as the op entry,
// producing a node that throws and emits no output. Same convention as
// _composeAtlas / _pixelScale in sibling batteries.
export function _cutByMask(
  img: Uint8Array,
  iw: number,
  ih: number,
  mask: Uint8Array,
  mw: number,
  mh: number,
  crop: boolean,
): CutByMaskResult {
  const resized = bilinearResize(img, iw, ih, mw, mh)
  const n = mw * mh
  const full = new Uint8Array(n * 4)
  for (let i = 0; i < n; i++) {
    const di = i * 4
    const lum = 0.299 * mask[di] + 0.587 * mask[di + 1] + 0.114 * mask[di + 2]
    const strength = (lum * mask[di + 3]) / 255 // 计入 mask 自身的透明度
    const a = Math.round((resized[di + 3] * strength) / 255)
    if (a <= 0) {
      full[di] = 0; full[di + 1] = 0; full[di + 2] = 0; full[di + 3] = 0
    } else {
      full[di] = resized[di]; full[di + 1] = resized[di + 1]; full[di + 2] = resized[di + 2]; full[di + 3] = a
    }
  }
  if (crop) return cropToContent(full, mw, mh, 2)
  return { pixels: full, w: mw, h: mh }
}

export async function imageCutByMask(
  input: Record<string, unknown>,
  ctx?: { services?: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  const crop = input.crop !== false

  const res = processImages(input, ctx, 'image_cut_by_mask', ['image', 'mask'], (imgs: DecodedImage[]) => {
    const [image, mask] = imgs
    const imgSrc = new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength)
    const maskSrc = new Uint8Array(mask.data.buffer, mask.data.byteOffset, mask.data.byteLength)
    const out = _cutByMask(imgSrc, image.width, image.height, maskSrc, mask.width, mask.height, crop)
    return { width: out.w, height: out.h, data: Buffer.from(out.pixels.buffer, out.pixels.byteOffset, out.pixels.byteLength) }
  }, { suffix: '_cut' })

  return { image: res.image, width: res.width, height: res.height, error: res.error }
}
