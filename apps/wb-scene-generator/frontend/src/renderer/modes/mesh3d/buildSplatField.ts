// 💡 Bake per-cell material weights → RGBA splat control map (up to 4 layers).
// Mode-local; driven by surfaceOwner.assetName (exact PBR pack names).

import * as THREE from 'three'
import type { SurfaceField } from './surfaceOwner'

export const SPLAT_SLOT_COUNT = 4

export interface SplatField {
  /** Up to 4 material names (exact pack names), slot order = R,G,B,A. */
  slots: string[]
  width: number
  height: number
  minX: number
  minY: number
  /** RGBA bytes, length width*height*4, each channel 0–255 weight. */
  weights: Uint8Array
}

/** Rank non-empty assetNames by occupied cell count (desc). */
export function rankSplatMaterialNames(field: SurfaceField, limit = SPLAT_SLOT_COUNT): string[] {
  const counts = new Map<string, number>()
  for (const o of field.owners.values()) {
    const name = o.assetName?.trim() ?? ''
    if (!name) continue
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([n]) => n)
}

/**
 * Hard-assign each occupied cell to one splat slot, then optional blur for soft
 * brush-like edges. Empty cells stay zero (no contribution).
 */
export function buildSplatField(
  field: SurfaceField,
  slots: readonly string[],
  opts?: { blurPasses?: number },
): SplatField | null {
  if (field.owners.size === 0 || slots.length === 0) return null
  if (field.maxX < field.minX || field.maxY < field.minY) return null

  const width = field.maxX - field.minX + 1
  const height = field.maxY - field.minY + 1
  const slotIndex = new Map<string, number>()
  slots.forEach((n, i) => {
    if (i < SPLAT_SLOT_COUNT) slotIndex.set(n, i)
  })

  const weights = new Uint8Array(width * height * 4)
  for (const o of field.owners.values()) {
    const name = o.assetName?.trim() ?? ''
    const si = slotIndex.get(name)
    if (si === undefined) continue
    const lx = o.x - field.minX
    const ly = o.y - field.minY
    if (lx < 0 || ly < 0 || lx >= width || ly >= height) continue
    weights[(ly * width + lx) * 4 + si] = 255
  }

  const passes = opts?.blurPasses ?? 1
  let cur: Uint8Array<ArrayBufferLike> = weights
  for (let p = 0; p < passes; p++) {
    cur = boxBlurRgba(cur, width, height)
  }

  return {
    slots: slots.slice(0, SPLAT_SLOT_COUNT),
    width,
    height,
    minX: field.minX,
    minY: field.minY,
    weights: cur,
  }
}

/** Separable-ish 3×3 box blur per channel; renormalize where sum > 0. */
function boxBlurRgba(src: Uint8Array, w: number, h: number): Uint8Array {
  const dst = new Uint8Array(src.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const acc = [0, 0, 0, 0]
      let n = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          const yy = y + dy
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
          const o = (yy * w + xx) * 4
          acc[0] += src[o]
          acc[1] += src[o + 1]
          acc[2] += src[o + 2]
          acc[3] += src[o + 3]
          n++
        }
      }
      const o = (y * w + x) * 4
      if (n === 0) continue
      let sum = 0
      for (let c = 0; c < 4; c++) {
        acc[c] = Math.round(acc[c] / n)
        sum += acc[c]
      }
      if (sum === 0) continue
      // Keep energy for occupied neighborhoods; leave empty cells empty.
      const srcSum = src[o] + src[o + 1] + src[o + 2] + src[o + 3]
      if (srcSum === 0 && sum < 32) continue
      for (let c = 0; c < 4; c++) dst[o + c] = acc[c]
    }
  }
  return dst
}

export function createSplatControlTexture(splat: SplatField): THREE.DataTexture {
  const tex = new THREE.DataTexture(
    splat.weights,
    splat.width,
    splat.height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  )
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.colorSpace = THREE.NoColorSpace
  tex.needsUpdate = true
  tex.flipY = false
  return tex
}

/** Corner (i,j) in local grid → splat UV for LinearFilter soft edges. */
export function splatUvAtCorner(
  i: number,
  j: number,
  cols: number,
  rows: number,
): [number, number] {
  const u = cols <= 0 ? 0 : i / cols
  const v = rows <= 0 ? 0 : j / rows
  return [u, v]
}

export function listSplatNamesFromSamples(
  field: SurfaceField,
): string[] {
  return rankSplatMaterialNames(field, SPLAT_SLOT_COUNT)
}
