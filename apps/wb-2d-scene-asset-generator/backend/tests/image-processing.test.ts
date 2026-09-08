import { Buffer } from 'node:buffer'
import { encode as encodeJpeg } from 'jpeg-js'
import { describe, expect, it } from 'vitest'
import { decodePng, encodePng, decodeImageBytes, decodeJpegImage } from '../src/utils/png_codec.js'
import { removeBg, maskToRGBA } from '../../batteries/image/processing/image_remove_bg/index.js'
import { removeWireframe, selectLargestBottomComponent } from '../../batteries/image/processing/image_remove_wireframe/index.js'
import { _cutByMask as cutByMask } from '../../batteries/image/processing/image_cut_by_mask/index.js'
import { _despeckle, _detectSpeckles } from '../../batteries/image/processing/image_despeckle/index.js'
import { resizePixels } from '../../batteries/image/processing/image_resize/index.js'
import { _resolveTarget, _pixelScale } from '../../batteries/image/processing/image_pixel_scale/index.js'
import { seamlessMoisan } from '../../batteries/image/tiles/make_seamless_moisan/index.js'
import { terrainExtractPixels } from '../../batteries/image/tiles/image_terrain_extract/index.js'
import { seamlessPoisson } from '../../batteries/image/tiles/image_seamless_poisson/index.js'
import { _composeAtlas, imageAtlasCompose } from '../../batteries/image/tiles/image_atlas_compose/index.js'
import { createHash } from 'node:crypto'
import { _computeObjectGeometry } from '../../batteries/helper/collision/image_object_geometry/index.js'
import { _applyStyle, _STYLE_PRESETS } from '../../batteries/image/processing/image_filter_style/index.js'

function makeRGBA(w: number, h: number): Buffer {
  // White border (background) around a solid colored interior — exercises the
  // RemoveBG edge-flood path and gives a sharp edge for resize.
  const data = Buffer.alloc(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const onEdge = i < w || i >= w * (h - 1) || i % w === 0 || i % w === w - 1
    data[i * 4] = onEdge ? 255 : 20
    data[i * 4 + 1] = onEdge ? 255 : 120
    data[i * 4 + 2] = onEdge ? 255 : 200
    data[i * 4 + 3] = 255
  }
  return data
}

const W = 16
const H = 12

describe('png_codec', () => {
  it('round-trips RGBA through PNG losslessly', () => {
    const rgba = makeRGBA(W, H)
    const dec = decodePng(encodePng(W, H, rgba))
    expect(dec.width).toBe(W)
    expect(dec.height).toBe(H)
    expect(dec.data.equals(rgba)).toBe(true)
  })

  it('decodes JPEG bytes to RGBA (lossy)', () => {
    const rgba = makeRGBA(W, H)
    const jpg = encodeJpeg({ width: W, height: H, data: rgba }, 90).data
    const dec = decodeJpegImage(jpg)
    expect(dec.width).toBe(W)
    expect(dec.height).toBe(H)
    expect(dec.data.length).toBe(W * H * 4)
  })

  it('decodeImageBytes dispatches by signature and mime hint', () => {
    const rgba = makeRGBA(W, H)
    const png = encodePng(W, H, rgba)
    const jpg = encodeJpeg({ width: W, height: H, data: rgba }, 90).data
    expect(decodeImageBytes(png).width).toBe(W)
    expect(decodeImageBytes(jpg).width).toBe(W)
    expect(decodeImageBytes(jpg, 'image/jpeg').width).toBe(W)
    expect(() => decodeImageBytes(Buffer.from([1, 2, 3, 4]))).toThrow()
  })
})

/** Build a pixel-art image: a base grid of distinct colors upscaled by `scale`. */
function makeScaled(baseW: number, baseH: number, scale: number): { data: Uint8Array; w: number; h: number } {
  const w = baseW * scale, h = baseH * scale
  const data = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const bx = Math.floor(x / scale), by = Math.floor(y / scale)
      const i = (y * w + x) * 4
      data[i] = (bx * 37) & 0xff
      data[i + 1] = (by * 53) & 0xff
      data[i + 2] = ((bx + by) * 29) & 0xff
      data[i + 3] = 255
    }
  }
  return { data, w, h }
}

describe('image_pixel_scale algorithm', () => {
  it('resizes to an arbitrary target width keeping aspect (182x204 -> 29 wide)', () => {
    const { data } = makeScaled(182, 204, 1)
    const out = _pixelScale(data, 182, 204, 29, 0, true)
    expect(out.w).toBe(29)
    expect(out.h).toBe(Math.round(204 * (29 / 182))) // 33
    expect(out.pixels.length).toBe(out.w * out.h * 4)
  })

  it('aspect lock derives height from width', () => {
    expect(_resolveTarget(100, 50, 20, 0, true)).toEqual({ w: 20, h: 10 })
  })

  it('aspect lock derives width from height when width is 0', () => {
    expect(_resolveTarget(100, 50, 0, 10, true)).toEqual({ w: 20, h: 10 })
  })

  it('unlocked aspect scales each axis to its own target', () => {
    expect(_resolveTarget(100, 50, 30, 40, false)).toEqual({ w: 30, h: 40 })
  })

  it('unlocked aspect keeps the missing axis at source size', () => {
    expect(_resolveTarget(100, 50, 30, 0, false)).toEqual({ w: 30, h: 50 })
  })

  it('upscales without color blending (nearest copies exact source pixels)', () => {
    const { data, w, h } = makeScaled(4, 4, 1) // 4x4 distinct colors
    const out = _pixelScale(data, w, h, 8, 0, true) // 2x
    expect(out.w).toBe(8)
    expect(out.h).toBe(8)
    // top-left output pixel equals source top-left exactly (no interpolation)
    expect(out.pixels[0]).toBe(data[0])
    expect(out.pixels[1]).toBe(data[1])
    expect(out.pixels[2]).toBe(data[2])
  })

  it('works on a non-4-aligned buffer (JPEG-style pooled data)', () => {
    const { data } = makeScaled(8, 8, 1)
    const padded = new Uint8Array(data.length + 1)
    padded.set(data, 1)
    const misaligned = padded.subarray(1)
    expect(misaligned.byteOffset % 4).not.toBe(0)
    const out = _pixelScale(misaligned, 8, 8, 4, 0, true)
    expect(out.w).toBe(4)
    expect(out.h).toBe(4)
  })
})

describe('image_remove_bg algorithm', () => {
  it('cuts out the flood-filled background and crops to content', () => {
    const rgba = makeRGBA(W, H)
    const src = new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength)
    const out = removeBg(src, W, H, 50, 14, 4, true)
    expect(out.pixels.length).toBe(out.w * out.h * 4)
    expect(out.w).toBeLessThanOrEqual(W)
    expect(out.h).toBeLessThanOrEqual(H)
  })
})

describe('image_remove_wireframe algorithm', () => {
  // 20×20 white canvas with: a 1px hollow rectangle outline (wireframe) top-left,
  // and a 6×6 solid black square bottom-right.
  const w = 20, h = 20
  function makeWireframeImage(): Uint8Array {
    const data = new Uint8Array(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = 255; data[i * 4 + 1] = 255; data[i * 4 + 2] = 255; data[i * 4 + 3] = 255
    }
    const setBlack = (x: number, y: number) => {
      const di = (y * w + x) * 4
      data[di] = 0; data[di + 1] = 0; data[di + 2] = 0; data[di + 3] = 255
    }
    // hollow rectangle outline: perimeter of [2..8] × [2..8], 1px thick
    for (let x = 2; x <= 8; x++) { setBlack(x, 2); setBlack(x, 8) }
    for (let y = 2; y <= 8; y++) { setBlack(2, y); setBlack(8, y) }
    // solid 6×6 square: rows/cols 12..17
    for (let y = 12; y <= 17; y++) for (let x = 12; x <= 17; x++) setBlack(x, y)
    return data
  }
  const isBlack = (px: Uint8Array, x: number, y: number) => px[(y * w + x) * 4 + 3] > 0 && px[(y * w + x) * 4] < 128

  it('removes the thin wireframe outline and keeps the solid region', () => {
    const out = removeWireframe(makeWireframeImage(), w, h, 128, 2, false)
    expect(out.w).toBe(w)
    expect(out.h).toBe(h)
    // wireframe gone: outline pixels are now white
    expect(isBlack(out.pixels, 2, 2)).toBe(false)
    expect(isBlack(out.pixels, 5, 2)).toBe(false)
    expect(isBlack(out.pixels, 8, 5)).toBe(false)
    // solid region kept (opening restores the core back to ~original size)
    expect(isBlack(out.pixels, 14, 14)).toBe(true)
    expect(isBlack(out.pixels, 12, 12)).toBe(true)
    expect(isBlack(out.pixels, 17, 17)).toBe(true)
    // background opaque white when transparent_bg is false
    expect(out.pixels[(0 * w + 0) * 4 + 3]).toBe(255)
    expect(out.pixels[(0 * w + 0) * 4]).toBe(255)
  })

  it('removes a thin line even when it is connected to the solid region (the lamp-post case)', () => {
    // Solid 8×8 square (rows 10..17, cols 6..13) with a 1px vertical line
    // sticking UP out of it (rows 0..9 at col 9) — line is fused to the solid.
    const data = new Uint8Array(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = 255; data[i * 4 + 1] = 255; data[i * 4 + 2] = 255; data[i * 4 + 3] = 255
    }
    const setBlack = (x: number, y: number) => {
      const di = (y * w + x) * 4
      data[di] = 0; data[di + 1] = 0; data[di + 2] = 0; data[di + 3] = 255
    }
    for (let y = 10; y <= 17; y++) for (let x = 6; x <= 13; x++) setBlack(x, y)
    for (let y = 0; y <= 9; y++) setBlack(9, y) // thin line fused to the solid top

    const out = removeWireframe(data, w, h, 128, 2, false)
    // connected thin line is removed all the way down to the solid boundary
    expect(isBlack(out.pixels, 9, 3)).toBe(false)
    expect(isBlack(out.pixels, 9, 9)).toBe(false)
    // solid square kept (center + corners restored by dilation)
    expect(isBlack(out.pixels, 9, 13)).toBe(true)
    expect(isBlack(out.pixels, 6, 10)).toBe(true)
    expect(isBlack(out.pixels, 13, 17)).toBe(true)
  })

  it('keeps the solid as transparent-background mask when requested', () => {
    const out = removeWireframe(makeWireframeImage(), w, h, 128, 2, true)
    // kept solid is opaque black
    expect(out.pixels[(14 * w + 14) * 4 + 3]).toBe(255)
    // removed/background is transparent
    expect(out.pixels[(2 * w + 2) * 4 + 3]).toBe(0)
    expect(out.pixels[(0 * w + 0) * 4 + 3]).toBe(0)
  })

  it('a large enough radius can erase a thin solid too (whole component dropped)', () => {
    // radius 4 → needs width ≥ 9 to survive; the 6×6 solid no longer has a core → removed
    const out = removeWireframe(makeWireframeImage(), w, h, 128, 4, false)
    expect(isBlack(out.pixels, 14, 14)).toBe(false)
  })

  it('keeps only the single largest, bottom-most solid and drops smaller specks', () => {
    // 8×8 base at the bottom + a 4×4 speck near the top; both survive opening (r=1),
    // but only the base must remain.
    const data = new Uint8Array(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = 255; data[i * 4 + 1] = 255; data[i * 4 + 2] = 255; data[i * 4 + 3] = 255
    }
    const setBlack = (x: number, y: number) => {
      const di = (y * w + x) * 4
      data[di] = 0; data[di + 1] = 0; data[di + 2] = 0; data[di + 3] = 255
    }
    for (let y = 2; y <= 5; y++) for (let x = 2; x <= 5; x++) setBlack(x, y) // 4×4 speck (top)
    for (let y = 10; y <= 17; y++) for (let x = 6; x <= 13; x++) setBlack(x, y) // 8×8 base (bottom)

    const out = removeWireframe(data, w, h, 128, 1, false)
    // base kept
    expect(isBlack(out.pixels, 9, 13)).toBe(true)
    expect(isBlack(out.pixels, 6, 10)).toBe(true)
    // speck removed
    expect(isBlack(out.pixels, 3, 3)).toBe(false)
    expect(isBlack(out.pixels, 4, 4)).toBe(false)
  })

  it('on comparable-area regions, single_region picks the lower one', () => {
    // two equal 3×3 solids: one top, one bottom → bottom wins, top dropped
    const mask = new Uint8Array(8 * 8)
    const set = (x: number, y: number) => { mask[y * 8 + x] = 1 }
    for (let y = 0; y <= 2; y++) for (let x = 0; x <= 2; x++) set(x, y) // 3×3 top
    for (let y = 5; y <= 7; y++) for (let x = 5; x <= 7; x++) set(x, y) // 3×3 bottom
    const keep = selectLargestBottomComponent(mask, 8, 8, 0.5)
    expect(keep[6 * 8 + 6]).toBe(1) // bottom kept
    expect(keep[1 * 8 + 1]).toBe(0) // top dropped
  })

  it('selectLargestBottomComponent returns empty when there is no foreground', () => {
    const keep = selectLargestBottomComponent(new Uint8Array(4 * 4), 4, 4, 0.5)
    expect(keep.some((v) => v === 1)).toBe(false)
  })
})

describe('image_remove_bg mask output', () => {
  it('renders a single-channel 0/255 region mask to grayscale RGBA', () => {
    // 2×2 region mask: kept, removed, removed, kept
    const m = new Uint8Array([255, 0, 0, 255])
    const rgba = maskToRGBA(m, 2, 2)
    expect([rgba[0], rgba[1], rgba[2], rgba[3]]).toEqual([255, 255, 255, 255]) // kept → white opaque
    expect([rgba[4], rgba[5], rgba[6], rgba[7]]).toEqual([0, 0, 0, 255]) // removed → black opaque
    expect([rgba[12], rgba[13], rgba[14], rgba[15]]).toEqual([255, 255, 255, 255])
  })

  it('removeBg returns a full pre-crop region mask alongside the cropped cutout', () => {
    // 8×8: white border background, solid colored 4×4 interior (rows/cols 2..5).
    const W2 = 8, H2 = 8
    const data = new Uint8Array(W2 * H2 * 4)
    for (let i = 0; i < W2 * H2; i++) {
      data[i * 4] = 255; data[i * 4 + 1] = 255; data[i * 4 + 2] = 255; data[i * 4 + 3] = 255
    }
    for (let y = 2; y <= 5; y++) for (let x = 2; x <= 5; x++) {
      const di = (y * W2 + x) * 4
      data[di] = 20; data[di + 1] = 120; data[di + 2] = 200; data[di + 3] = 255
    }
    const src = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    const out = removeBg(src, W2, H2, 50, 14, 4, true)
    // mask is the ORIGINAL size, not the cropped size
    expect(out.maskW).toBe(W2)
    expect(out.maskH).toBe(H2)
    expect(out.mask.length).toBe(W2 * H2)
    // cropped cutout is smaller than original
    expect(out.w).toBeLessThanOrEqual(W2)
    // interior is kept (mask 255), a corner background is removed (mask 0)
    expect(out.mask[(3 * W2 + 3)]).toBe(255)
    expect(out.mask[(0 * W2 + 0)]).toBe(0)
  })
})

describe('image_cut_by_mask algorithm', () => {
  // 4×4 mask: left two columns white (keep), right two black (cut), opaque.
  function makeMask(): Uint8Array {
    const m = new Uint8Array(4 * 4 * 4)
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const di = (y * 4 + x) * 4
        const v = x < 2 ? 255 : 0
        m[di] = v; m[di + 1] = v; m[di + 2] = v; m[di + 3] = 255
      }
    }
    return m
  }
  // 4×4 solid opaque red image.
  function makeRed(): Uint8Array {
    const im = new Uint8Array(4 * 4 * 4)
    for (let i = 0; i < 16; i++) { im[i * 4] = 200; im[i * 4 + 1] = 30; im[i * 4 + 2] = 30; im[i * 4 + 3] = 255 }
    return im
  }

  it('keeps pixels under the white mask region and cuts the black region (no crop)', () => {
    const out = cutByMask(makeRed(), 4, 4, makeMask(), 4, 4, false)
    expect(out.w).toBe(4)
    expect(out.h).toBe(4)
    // left columns kept (opaque red)
    expect(out.pixels[(0 * 4 + 0) * 4 + 3]).toBe(255)
    expect(out.pixels[(0 * 4 + 0) * 4]).toBe(200)
    // right columns cut (transparent)
    expect(out.pixels[(0 * 4 + 3) * 4 + 3]).toBe(0)
  })

  it('resizes the image to the mask size (aligns image size)', () => {
    // 8×8 red image, 4×4 mask → output is 4×4 (crop off to assert exact size)
    const big = new Uint8Array(8 * 8 * 4)
    for (let i = 0; i < 64; i++) { big[i * 4] = 200; big[i * 4 + 1] = 30; big[i * 4 + 2] = 30; big[i * 4 + 3] = 255 }
    const out = cutByMask(big, 8, 8, makeMask(), 4, 4, false)
    expect(out.w).toBe(4)
    expect(out.h).toBe(4)
    expect(out.pixels[(2 * 4 + 0) * 4 + 3]).toBe(255) // white region kept
    expect(out.pixels[(2 * 4 + 3) * 4 + 3]).toBe(0) // black region cut
  })

  it('respects the mask own transparency (transparent = cut)', () => {
    // all-white mask but fully transparent → everything cut
    const m = new Uint8Array(4 * 4 * 4)
    for (let i = 0; i < 16; i++) { m[i * 4] = 255; m[i * 4 + 1] = 255; m[i * 4 + 2] = 255; m[i * 4 + 3] = 0 }
    const out = cutByMask(makeRed(), 4, 4, m, 4, 4, false)
    expect(out.pixels[(1 * 4 + 1) * 4 + 3]).toBe(0)
  })

  it('crop=true trims to the kept-region bbox (+2px) → cropped-region image', () => {
    // 8×8 mask, white only at the 2×2 center (cols/rows 3..4) → bbox+2 = 6×6
    const mw = 8, mh = 8
    const m = new Uint8Array(mw * mh * 4)
    for (let i = 0; i < mw * mh; i++) { m[i * 4 + 3] = 255 } // opaque black everywhere
    for (let y = 3; y <= 4; y++) for (let x = 3; x <= 4; x++) {
      const di = (y * mw + x) * 4
      m[di] = 255; m[di + 1] = 255; m[di + 2] = 255
    }
    const img = new Uint8Array(mw * mh * 4)
    for (let i = 0; i < mw * mh; i++) { img[i * 4] = 10; img[i * 4 + 1] = 220; img[i * 4 + 2] = 80; img[i * 4 + 3] = 255 }
    const out = cutByMask(img, mw, mh, m, mw, mh, true)
    expect(out.w).toBe(6)
    expect(out.h).toBe(6)
    // center of the cropped image (the kept block) is opaque; a corner is cut
    expect(out.pixels[(0 * 6 + 0) * 4 + 3]).toBe(0)
    expect(out.pixels[(2 * 6 + 2) * 4 + 3]).toBe(255)
  })
})

describe('image_despeckle algorithm', () => {
  const cfg = {
    alphaThreshold: 128,
    satThreshold: 0.18,
    valueMin: 0.35,
    outlierThreshold: 48,
    maxSpeckSize: 12,
    outlierRadius: 2,
    maxFillIterations: 64,
  }

  /** Solid green field with isolated white/gray speck pixels. */
  function makeSpeckled(w: number, h: number, specks: Array<[number, number, number, number, number]>) {
    const data = new Uint8Array(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = 40; data[i * 4 + 1] = 120; data[i * 4 + 2] = 50; data[i * 4 + 3] = 255
    }
    for (const [x, y, r, g, b] of specks) {
      const i = (y * w + x) * 4
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255
    }
    return data
  }

  it('detects isolated white and gray specks but not the solid field', () => {
    const w = 16, h = 16
    const src = makeSpeckled(w, h, [[5, 5, 255, 255, 255], [10, 9, 180, 182, 185]])
    const mask = _detectSpeckles(src, w, h, cfg)
    expect(mask[5 * w + 5]).toBe(1)
    expect(mask[9 * w + 10]).toBe(1)
    // A normal green pixel must not be flagged.
    expect(mask[2 * w + 2]).toBe(0)
  })

  it('fills specks with surrounding color and preserves alpha', () => {
    const w = 16, h = 16
    const src = makeSpeckled(w, h, [[5, 5, 255, 255, 255]])
    const out = _despeckle(src, w, h, cfg)
    const i = (5 * w + 5) * 4
    expect(out[i]).toBeCloseTo(40, -1)
    expect(out[i + 1]).toBeCloseTo(120, -1)
    expect(out[i + 2]).toBeCloseTo(50, -1)
    expect(out[i + 3]).toBe(255)
  })

  it('keeps large low-saturation regions intact (size filter)', () => {
    const w = 16, h = 16
    // A whole gray quadrant: large connected component, must survive.
    const src = makeSpeckled(w, h, [])
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const i = (y * w + x) * 4
      src[i] = 200; src[i + 1] = 200; src[i + 2] = 200
    }
    const mask = _detectSpeckles(src, w, h, cfg)
    expect(mask[3 * w + 3]).toBe(0)
  })
})

describe('image_resize algorithm', () => {
  it('nearest keeps aspect ratio when only width is given', () => {
    const rgba = makeRGBA(W, H)
    const src = new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength)
    const out = resizePixels(src, W, H, 8, 0, false)
    expect(out.w).toBe(8)
    expect(out.h).toBe(6)
    expect(out.pixels.length).toBe(out.w * out.h * 4)
  })

  it('smart upscale produces the requested dims and re-encodes', () => {
    const rgba = makeRGBA(W, H)
    const src = new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength)
    const out = resizePixels(src, W, H, 32, 24, true)
    expect(out.w).toBe(32)
    expect(out.h).toBe(24)
    const png = encodePng(out.w, out.h, Buffer.from(out.pixels.buffer, out.pixels.byteOffset, out.pixels.byteLength))
    expect(decodePng(png).width).toBe(32)
  })
})

describe('make_seamless_moisan algorithm', () => {
  it('produces a same-size image whose opposite edges become continuous', () => {
    // Non-pow2 size to exercise the reflect-pad path.
    const w = 20, h = 20
    const data = Buffer.alloc(w * h * 4)
    // Horizontal gradient → large left/right seam before processing.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        data[i] = Math.round((x / (w - 1)) * 255)
        data[i + 1] = 128
        data[i + 2] = 64
        data[i + 3] = 255
      }
    }
    const src = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)

    function seamEnergy(px: Uint8Array): number {
      let e = 0
      for (let y = 0; y < h; y++) {
        const l = (y * w) * 4
        const r = (y * w + (w - 1)) * 4
        e += Math.abs(px[l] - px[r])
      }
      return e
    }

    const out = seamlessMoisan(src, w, h, false)
    expect(out.w).toBe(w)
    expect(out.h).toBe(h)
    expect(out.pixels.length).toBe(w * h * 4)
    // Periodic component should shrink the left/right edge discontinuity.
    expect(seamEnergy(out.pixels)).toBeLessThan(seamEnergy(src))
  })
})

describe('image_terrain_extract algorithm', () => {
  it('quilts a clean size×size texture from a noisy two-cluster source', () => {
    // 48×48 with a dominant green "terrain" + a few darker "decoration" blobs.
    const w = 48, h = 48
    const data = Buffer.alloc(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        const decoration = ((x >> 3) + (y >> 3)) % 7 === 0
        data[i] = decoration ? 40 : 60 + ((x * 3 + y * 2) % 20)
        data[i + 1] = decoration ? 30 : 150 + ((x + y) % 30)
        data[i + 2] = decoration ? 35 : 50 + ((x * 2) % 15)
        data[i + 3] = 255
      }
    }
    const src = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    const out = terrainExtractPixels(src, w, h, {
      size: 32, patchSize: 12, overlap: 4, candidates: 8, seed: 7,
      kClusters: 3, terrainRadius: 80, minDecorationSize: 2, maxSourcePatches: 4096,
    })
    expect(out.w).toBe(32)
    expect(out.h).toBe(32)
    expect(out.pixels.length).toBe(32 * 32 * 4)
    expect(out.sourcePatches).toBeGreaterThan(0)
  })
})

describe('image_seamless_poisson algorithm', () => {
  it('makes opposite edges continuous while leaving the center untouched', () => {
    const w = 24, h = 24
    const data = Buffer.alloc(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        data[i] = Math.round((x / (w - 1)) * 255)
        data[i + 1] = Math.round((y / (h - 1)) * 255)
        data[i + 2] = 64
        data[i + 3] = 255
      }
    }
    const src = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    const out = seamlessPoisson(src, w, h, 6, true, true, false)
    expect(out.w).toBe(w)
    expect(out.h).toBe(h)
    // After fixing, left↔right and top↔bottom edges should match closely.
    expect(out.maxAfterH).toBeLessThan(1.5)
    expect(out.maxAfterV).toBeLessThan(1.5)
    // Band-outer center pixel must be unchanged (band=6 < 12).
    const c = (12 * w + 12) * 4
    expect(out.pixels[c]).toBe(src[c])
    expect(out.pixels[c + 1]).toBe(src[c + 1])
  })
})

describe('image_object_geometry algorithm', () => {
  const W = 48, H = 48

  function makeRGBA(width: number, height: number, paint: (x: number, y: number, data: Uint8Array) => void): Uint8Array {
    const data = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) paint(x, y, data)
    return data
  }

  it('computes normalized anchor, rectangle corners, and object_height from mask + sprite', () => {
    const sprite = makeRGBA(W, H, (x, y, data) => {
      if (x >= 10 && x <= 37 && y >= 4 && y <= 40) {
        const di = (y * W + x) * 4
        data[di] = 80; data[di + 1] = 180; data[di + 2] = 60; data[di + 3] = 255
      }
    })
    const mask = makeRGBA(W, H, (x, y, data) => {
      if (x >= 16 && x <= 31 && y >= 40 && y <= 47) {
        const di = (y * W + x) * 4
        data[di] = 0; data[di + 1] = 0; data[di + 2] = 0; data[di + 3] = 255
      }
    })

    const out = _computeObjectGeometry(mask, sprite, W, H)
    expect(out.error).toBe('')
    expect(out.objectHeight).toBe(44)
    expect(out.anchorX).toBeCloseTo(0.5, 5)
    expect(out.anchorY).toBeCloseTo((H - 47) / H, 5)

    const geo = JSON.parse(out.geometryJson) as {
      object_height: number
      collision_category: string
      collision_mask: [number, number][]
      pivot: [number, number]
    }
    expect(geo.object_height).toBe(44)
    expect(geo.collision_category).toBe('Rectangler')
    expect(geo.collision_mask[0][0]).toBeCloseTo(16 / W, 5)
    expect(geo.collision_mask[1][0]).toBeCloseTo(32 / W, 5)
    expect(geo.collision_mask[0][1]).toBeCloseTo((H - 47) / H, 5)
    expect(geo.collision_mask[1][1]).toBeCloseTo((H - 40) / H, 5)
    expect(geo.pivot[0]).toBeCloseTo(out.anchorX, 8)
    expect(geo.pivot[1]).toBeCloseTo(out.anchorY, 8)
  })

  it('returns error when mask has no black footprint', () => {
    const white = makeRGBA(W, H, (x, y, data) => {
      const di = (y * W + x) * 4
      data[di] = 255; data[di + 1] = 255; data[di + 2] = 255; data[di + 3] = 255
    })
    const out = _computeObjectGeometry(white, white, W, H)
    expect(out.error).toContain('no collision footprint')
  })
})

describe('image_filter_style algorithm', () => {
  /** Mid-gray opaque field with one transparent pixel to assert alpha is preserved. */
  function makeField(w: number, h: number): Uint8Array {
    const data = new Uint8Array(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = 120; data[i * 4 + 1] = 90; data[i * 4 + 2] = 60; data[i * 4 + 3] = 255
    }
    data[3] = 0 // first pixel fully transparent
    return data
  }

  it('exposes every palette_rules style as a dropdown preset (incl. passthrough)', () => {
    expect(Object.keys(_STYLE_PRESETS)).toContain('标准西幻')
    expect(Object.keys(_STYLE_PRESETS)).toContain('赛博朋克')
    expect(Object.keys(_STYLE_PRESETS)).toContain('原图')
  })

  it('passthrough style leaves pixels untouched', () => {
    const w = 8, h = 8
    const src = makeField(w, h)
    const out = _applyStyle(src, w, h, _STYLE_PRESETS['原图'])
    expect(Buffer.from(out).equals(Buffer.from(src))).toBe(true)
  })

  it('grades color and always preserves the alpha channel', () => {
    const w = 8, h = 8
    const src = makeField(w, h)
    const out = _applyStyle(src, w, h, _STYLE_PRESETS['赛博朋克'])
    expect(out.length).toBe(src.length)
    // RGB changed somewhere…
    let rgbChanged = false
    for (let i = 0; i < w * h; i++) {
      if (out[i * 4] !== src[i * 4] || out[i * 4 + 1] !== src[i * 4 + 1] || out[i * 4 + 2] !== src[i * 4 + 2]) rgbChanged = true
    }
    expect(rgbChanged).toBe(true)
    // …but alpha is byte-for-byte identical (transparent pixel stays transparent).
    for (let i = 0; i < w * h; i++) expect(out[i * 4 + 3]).toBe(src[i * 4 + 3])
  })

  it('brightness scale > 1 lightens, < 1 darkens', () => {
    const w = 4, h = 4
    const src = makeField(w, h)
    const up = _applyStyle(src, w, h, { label: 'up', brightness_scale: 1.5 })
    const down = _applyStyle(src, w, h, { label: 'down', brightness_scale: 0.5 })
    expect(up[4]).toBeGreaterThan(src[4]) // pixel 1 R (pixel 0 has alpha 0 but still graded)
    expect(down[4]).toBeLessThan(src[4])
  })

  it('multiply blend darkens toward the tint while normal flat-blends', () => {
    const w = 4, h = 4
    const src = makeField(w, h) // mid-gray field (120,90,60)
    // Dark blue tint at full strength: multiply must darken every channel below the source.
    const mult = _applyStyle(src, w, h, { label: 'm', tint_color: '#202060', tint_strength: 1, tint_blend: 'multiply' })
    // pixel 1 (opaque). Multiply result = base*tint/255 <= base.
    expect(mult[4]).toBeLessThanOrEqual(src[4])
    expect(mult[5]).toBeLessThanOrEqual(src[5])
    expect(mult[6]).toBeLessThanOrEqual(src[6])
    // Alpha untouched by the blend layer.
    for (let i = 0; i < w * h; i++) expect(mult[i * 4 + 3]).toBe(src[i * 4 + 3])
  })

  it('soft_light preserves contrast better than a flat normal tint (less veil)', () => {
    // Build a high-contrast pair: dark vs light pixel, then tint both ways.
    const px = new Uint8Array([30, 30, 30, 255, 220, 220, 220, 255])
    const tint = '#406080'
    const normal = _applyStyle(Uint8Array.from(px), 2, 1, { label: 'n', tint_color: tint, tint_strength: 0.4, tint_blend: 'normal' })
    const soft = _applyStyle(Uint8Array.from(px), 2, 1, { label: 's', tint_color: tint, tint_strength: 0.4, tint_blend: 'soft_light' })
    const spread = (a: Uint8Array) => a[4] - a[0] // light R - dark R
    // Flat normal blend pulls both toward the same color → smaller spread (the veil).
    // soft_light keeps shadows/highlights apart → larger spread.
    expect(spread(soft)).toBeGreaterThan(spread(normal))
  })

  it('blend_mode override replaces the preset blend mode', () => {
    const w = 4, h = 4
    const src = makeField(w, h)
    const preset = _STYLE_PRESETS['标准西幻'] // soft_light by default
    const asMultiply = _applyStyle(src, w, h, preset, 'multiply')
    const asScreen = _applyStyle(src, w, h, preset, 'screen')
    // Multiply (toward a light warm tint) vs screen produce different results.
    let differ = false
    for (let i = 0; i < src.length; i++) if (asMultiply[i] !== asScreen[i]) differ = true
    expect(differ).toBe(true)
  })

  it('every tinted preset declares a blend mode (no accidental flat veil)', () => {
    for (const [key, p] of Object.entries(_STYLE_PRESETS)) {
      if (p.tint_color) expect(p.tint_blend, `${key} needs tint_blend`).toBeDefined()
    }
  })
})

describe('image_atlas_compose algorithm', () => {
  it('composes a 4×N atlas matching the template resolution', () => {
    // Terrain: 32×32 greenish texture.
    const tw = 32, th = 32
    const tData = Buffer.alloc(tw * th * 4)
    for (let i = 0; i < tw * th; i++) {
      tData[i * 4] = 60 + (i % 20)
      tData[i * 4 + 1] = 150
      tData[i * 4 + 2] = 50
      tData[i * 4 + 3] = 255
    }
    const terrain = { width: tw, height: th, data: tData }
    // Template: 4 cols × 4 rows of 8px cells → 32×32. Interior cell 6 fully opaque.
    const cell = 8
    const tplW = cell * 4, tplH = cell * 4
    const tpl = Buffer.alloc(tplW * tplH * 4)
    for (let i = 0; i < tplW * tplH; i++) {
      tpl[i * 4] = 200; tpl[i * 4 + 1] = 200; tpl[i * 4 + 2] = 200; tpl[i * 4 + 3] = 255
    }
    const template = { width: tplW, height: tplH, data: tpl }
    const out = _composeAtlas(terrain, template, 127, true, 6)
    expect(out.w).toBe(tplW)
    expect(out.h).toBe(tplH)
    expect(out.pixels.length).toBe(tplW * tplH * 4)
    expect(out.terrainSize).toBe(32)
  })

  it('defaults template to the built-in preset when the port is unconnected', async () => {
    // Capture what refs the battery hands the backend `processImages` service.
    let captured: string[] = []
    const ctx = {
      services: {
        asset2d: {
          processImages: (images: string[]) => {
            captured = images
            return { image: 'data:image/png;base64,AAA', width: 64, height: 80, error: '' }
          },
        },
      },
    }
    // terrain wired, template OMITTED → battery must inject the built-in template.
    const res = await imageAtlasCompose({ terrain: JSON.stringify({ alias: 'sand_terrain', blobId: 'b1' }) }, ctx)
    expect(res.error).toBe('')
    expect(captured).toHaveLength(2)
    const tplRef = JSON.parse(captured[1]) as { alias: string; blobId: string }
    expect(tplRef.alias).toBe('preset:tiles/tile模板.png')
    // blobId is the deterministic sha256 of `presets/<rel>` (matches presetAssets.ts).
    expect(tplRef.blobId).toBe(createHash('sha256').update('presets/tiles/tile模板.png').digest('hex'))
  })

  it('uses an explicitly-wired template ref instead of the built-in', async () => {
    let captured: string[] = []
    const ctx = {
      services: {
        asset2d: {
          processImages: (images: string[]) => {
            captured = images
            return { image: 'data:image/png;base64,AAA', width: 32, height: 32, error: '' }
          },
        },
      },
    }
    const customTpl = JSON.stringify({ alias: 'my_custom_template', blobId: 'b2' })
    await imageAtlasCompose(
      { terrain: JSON.stringify({ alias: 'sand_terrain', blobId: 'b1' }), template: customTpl },
      ctx,
    )
    expect(captured[1]).toBe(customTpl)
  })
})
