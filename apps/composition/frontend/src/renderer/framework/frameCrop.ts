// Crop a rendered frame down to its content bounding box.
//
// "Empty" means one of two things depending on the render mode. The three.js
// modes leave the surround transparent (`alpha: true` + setClearColor(_, 0)),
// but the 2D modes paint an OPAQUE backdrop over the whole frame (compose's
// step ① fills the canvas with the colour read off the pane's CSS background),
// so alpha alone would find content everywhere. We therefore also sample the
// frame's own backdrop colour from its corners and treat pixels within a small
// tolerance of it as empty — the same idea as scripts/crop-to-content.mjs,
// except the colour is detected instead of assumed to be #000.

export interface FrameCropBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export type FrameCropResult =
  | { status: 'ok'; canvas: HTMLCanvasElement; width: number; height: number; box: FrameCropBox }
  /** Frame is entirely transparent — nothing worth cropping to. */
  | { status: 'empty' }
  /** Pixels could not be read back (no 2D context, or a cross-origin taint). */
  | { status: 'unavailable' }

interface CropOptions {
  /** Alpha above which a pixel counts as content. */
  alphaThreshold?: number
  /** Extra margin kept around the bounding box, in device pixels. */
  padding?: number
  /** Per-channel difference from the backdrop colour still counted as empty. */
  colorTolerance?: number
}

const DEFAULT_COLOR_TOLERANCE = 8

type Rgb = readonly [number, number, number]

/**
 * The frame's opaque backdrop colour, or null when the corners disagree (the
 * content reaches an edge) or are transparent (nothing painted a backdrop).
 */
function detectBackdrop(
  pixels: Pick<ImageData, 'width' | 'height' | 'data'>,
  tolerance: number,
): Rgb | null {
  const { width: w, height: h, data } = pixels
  if (w < 2 || h < 2) return null
  const corners = [
    0,
    (w - 1) * 4,
    (h - 1) * w * 4,
    ((h - 1) * w + (w - 1)) * 4,
  ]
  const first = corners[0]
  if (data[first + 3] === 0) return null
  const rgb: Rgb = [data[first], data[first + 1], data[first + 2]]
  for (const i of corners) {
    if (data[i + 3] === 0) return null
    if (
      Math.abs(data[i] - rgb[0]) > tolerance ||
      Math.abs(data[i + 1] - rgb[1]) > tolerance ||
      Math.abs(data[i + 2] - rgb[2]) > tolerance
    ) {
      return null
    }
  }
  return rgb
}

function readPixels(source: HTMLCanvasElement): ImageData | null {
  const w = source.width
  const h = source.height
  if (!w || !h) return null
  let ctx: CanvasRenderingContext2D | null = null
  try {
    ctx = source.getContext('2d')
  } catch {
    ctx = null
  }
  if (!ctx) {
    // WebGL frame canvases (free3d / 3DMesh) have no 2D context; blit into a
    // scratch canvas first. Both renderers set preserveDrawingBuffer.
    const scratch = document.createElement('canvas')
    scratch.width = w
    scratch.height = h
    let scratchCtx: CanvasRenderingContext2D | null = null
    try {
      scratchCtx = scratch.getContext('2d')
    } catch {
      scratchCtx = null
    }
    if (!scratchCtx) return null
    scratchCtx.drawImage(source, 0, 0)
    ctx = scratchCtx
  }
  try {
    return ctx.getImageData(0, 0, w, h)
  } catch {
    return null
  }
}

/** Bounding box of the pixels that are neither transparent nor backdrop-coloured. */
export function findContentBox(
  pixels: Pick<ImageData, 'width' | 'height' | 'data'>,
  options?: CropOptions,
): FrameCropBox | null {
  const { width: w, height: h, data } = pixels
  const alphaThreshold = options?.alphaThreshold ?? 0
  const tolerance = options?.colorTolerance ?? DEFAULT_COLOR_TOLERANCE
  const backdrop = detectBackdrop(pixels, tolerance)
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < h; y++) {
    const rowStart = y * w * 4
    for (let x = 0; x < w; x++) {
      const i = rowStart + x * 4
      if (data[i + 3] <= alphaThreshold) continue
      if (
        backdrop &&
        Math.abs(data[i] - backdrop[0]) <= tolerance &&
        Math.abs(data[i + 1] - backdrop[1]) <= tolerance &&
        Math.abs(data[i + 2] - backdrop[2]) <= tolerance
      ) {
        continue
      }
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return null

  const padding = Math.max(0, Math.trunc(options?.padding ?? 0))
  return {
    minX: Math.max(0, minX - padding),
    minY: Math.max(0, minY - padding),
    maxX: Math.min(w - 1, maxX + padding),
    maxY: Math.min(h - 1, maxY + padding),
  }
}

export function cropCanvasToContent(source: HTMLCanvasElement, options?: CropOptions): FrameCropResult {
  const pixels = readPixels(source)
  if (!pixels) return { status: 'unavailable' }

  const box = findContentBox(pixels, options)
  if (!box) return { status: 'empty' }

  const width = box.maxX - box.minX + 1
  const height = box.maxY - box.minY + 1

  const cropped = document.createElement('canvas')
  cropped.width = width
  cropped.height = height
  const ctx = cropped.getContext('2d')
  if (!ctx) return { status: 'unavailable' }
  ctx.drawImage(source, box.minX, box.minY, width, height, 0, 0, width, height)
  return { status: 'ok', canvas: cropped, width, height, box }
}
