import { processImage, type DecodedImage } from '../../../_shared/asset2d.js'

function clampByte(v: number): number {
  return v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v)
}

function bilinearResize(src: Uint8Array, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  const out = new Uint8Array(dw * dh * 4)
  const xRatio = sw > 1 && dw > 1 ? (sw - 1) / (dw - 1) : 0
  const yRatio = sh > 1 && dh > 1 ? (sh - 1) / (dh - 1) : 0
  let p = 0
  for (let y = 0; y < dh; y++) {
    const sy = y * yRatio
    const y0 = Math.floor(sy)
    const y1 = Math.min(sh - 1, y0 + 1)
    const fy = sy - y0
    for (let x = 0; x < dw; x++) {
      const sx = x * xRatio
      const x0 = Math.floor(sx)
      const x1 = Math.min(sw - 1, x0 + 1)
      const fx = sx - x0
      const i00 = (y0 * sw + x0) * 4
      const i10 = (y0 * sw + x1) * 4
      const i01 = (y1 * sw + x0) * 4
      const i11 = (y1 * sw + x1) * 4
      for (let c = 0; c < 4; c++) {
        const top = src[i00 + c] * (1 - fx) + src[i10 + c] * fx
        const bot = src[i01 + c] * (1 - fx) + src[i11 + c] * fx
        out[p++] = clampByte(top * (1 - fy) + bot * fy)
      }
    }
  }
  return out
}

export function sidescrollerResizeTile(input: Record<string, unknown>, ctx?: { services?: Record<string, unknown> }): Record<string, unknown> {
  const width = Math.max(1, Math.round(typeof input.width === 'number' ? input.width : 640))
  const height = Math.max(1, Math.round(typeof input.height === 'number' ? input.height : 360))
  const res = processImage(input, ctx, 'sidescroller_resize_tile', (img: DecodedImage) => {
    const src = new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength)
    const pixels = bilinearResize(src, img.width, img.height, width, height)
    return { width, height, data: Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength) }
  }, { suffix: `_tile${width}x${height}` })
  return { image: res.image, width: res.width, height: res.height, error: res.error }
}
