import { processImage, type DecodedImage } from '../../../_shared/asset2d.js'

function rowMean(src: Uint8Array, w: number, y: number): number {
  let sum = 0
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4
    sum += (src[i] + src[i + 1] + src[i + 2]) / 3
  }
  return sum / w
}

function cropVertical(src: Uint8Array, w: number, h: number, threshold: number): { pixels: Uint8Array; w: number; h: number; cropped: boolean } {
  let top = 0
  let bottom = h - 1
  while (top < h - 1 && rowMean(src, w, top) < threshold) top++
  while (bottom > top && rowMean(src, w, bottom) < threshold) bottom--
  const nh = bottom - top + 1
  if (top === 0 && bottom === h - 1) return { pixels: src, w, h, cropped: false }
  const out = new Uint8Array(w * nh * 4)
  out.set(src.subarray(top * w * 4, (bottom + 1) * w * 4))
  return { pixels: out, w, h: nh, cropped: true }
}

export function sidescrollerCropLetterbox(input: Record<string, unknown>, ctx?: { services?: Record<string, unknown> }): Record<string, unknown> {
  const threshold = typeof input.threshold === 'number' ? input.threshold : 15
  let cropped = false
  const res = processImage(input, ctx, 'sidescroller_crop_letterbox', (img: DecodedImage) => {
    const src = new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength)
    const out = cropVertical(src, img.width, img.height, threshold)
    cropped = out.cropped
    return { width: out.w, height: out.h, data: Buffer.from(out.pixels.buffer, out.pixels.byteOffset, out.pixels.byteLength) }
  }, { suffix: '_crop' })
  return { image: res.image, width: res.width, height: res.height, cropped, error: res.error }
}
