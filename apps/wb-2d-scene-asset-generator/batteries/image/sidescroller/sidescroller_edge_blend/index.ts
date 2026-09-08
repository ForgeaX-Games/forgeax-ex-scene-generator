import { processImage, type DecodedImage } from '../../../_shared/asset2d.js'

function blendHorizontal(src: Uint8Array, w: number, h: number, overlapInput: number): { pixels: Uint8Array; overlap: number } {
  const overlap = Math.max(1, Math.min(Math.floor(w / 4), Math.round(overlapInput)))
  const out = new Uint8Array(src)
  for (let x = 0; x < overlap; x++) {
    const t = (1 - Math.cos((Math.PI * x) / Math.max(1, overlap - 1))) / 2
    const rx = w - overlap + x
    for (let y = 0; y < h; y++) {
      const li = (y * w + x) * 4
      const ri = (y * w + rx) * 4
      for (let c = 0; c < 4; c++) {
        out[ri + c] = Math.round(src[ri + c] * (1 - t) + src[li + c] * t)
      }
    }
  }
  return { pixels: out, overlap }
}

export function sidescrollerEdgeBlend(input: Record<string, unknown>, ctx?: { services?: Record<string, unknown> }): Record<string, unknown> {
  const requested = typeof input.overlap === 'number' ? input.overlap : 32
  let actualOverlap = 0
  const res = processImage(input, ctx, 'sidescroller_edge_blend', (img: DecodedImage) => {
    const src = new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength)
    const out = blendHorizontal(src, img.width, img.height, requested)
    actualOverlap = out.overlap
    return { width: img.width, height: img.height, data: Buffer.from(out.pixels.buffer, out.pixels.byteOffset, out.pixels.byteLength) }
  }, { suffix: '_hseam' })
  return { image: res.image, width: res.width, height: res.height, overlap: actualOverlap, error: res.error }
}
