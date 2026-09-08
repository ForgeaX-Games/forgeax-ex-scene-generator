import { processImage, type DecodedImage } from '../../../_shared/asset2d.js'

function stitch(src: Uint8Array, w: number, h: number, tilesInput: number, overlapInput: number): { pixels: Uint8Array; w: number; h: number } {
  const tiles = Math.max(1, Math.round(tilesInput))
  const overlap = Math.max(0, Math.min(w - 1, Math.round(overlapInput)))
  const outW = w + (tiles - 1) * (w - overlap)
  const out = new Uint8Array(outW * h * 4)
  for (let t = 0; t < tiles; t++) {
    const dx = t * (w - overlap)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const di = (y * outW + dx + x) * 4
        const si = (y * w + x) * 4
        if (overlap > 0 && t > 0 && x < overlap) {
          const fade = x / Math.max(1, overlap - 1)
          for (let c = 0; c < 4; c++) out[di + c] = Math.round(out[di + c] * (1 - fade) + src[si + c] * fade)
        } else {
          out[di] = src[si]; out[di + 1] = src[si + 1]; out[di + 2] = src[si + 2]; out[di + 3] = src[si + 3]
        }
      }
    }
  }
  return { pixels: out, w: outW, h }
}

export function sidescrollerStitchTiles(input: Record<string, unknown>, ctx?: { services?: Record<string, unknown> }): Record<string, unknown> {
  const tiles = typeof input.tiles === 'number' ? input.tiles : 3
  const overlap = typeof input.overlap === 'number' ? input.overlap : 0
  const res = processImage(input, ctx, 'sidescroller_stitch_tiles', (img: DecodedImage) => {
    const src = new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength)
    const out = stitch(src, img.width, img.height, tiles, overlap)
    return { width: out.w, height: out.h, data: Buffer.from(out.pixels.buffer, out.pixels.byteOffset, out.pixels.byteLength) }
  }, { suffix: `_x${Math.max(1, Math.round(tiles))}` })
  return { image: res.image, width: res.width, height: res.height, error: res.error }
}
