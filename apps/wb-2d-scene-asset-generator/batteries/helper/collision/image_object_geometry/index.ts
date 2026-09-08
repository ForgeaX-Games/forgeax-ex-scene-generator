/**
 * image_object_geometry — 碰撞 mask + 物体贴图 → 场景 object 放置几何 JSON
 *
 * 从 **碰撞 footprint 黑白图**（mask）与 **同尺寸物体贴图**（image）计算：
 *   - anchor_x / anchor_y：左下角原点、0~1 归一化（与资产库 anchor_x/anchor_y 一致）
 *   - object_height：像素高度（自物体可见顶到 footprint 底边的垂直跨度）
 *   - geometry_json：可直接传给 `publishToGame.geometryJson` 的字符串，字段对齐
 *     wb-scene-generator 资产库 `geometry_json` 规范（object_height + collision_category
 *     + collision_mask 两角点 + pivot）。
 *
 * mask：黑=地面碰撞实心区（经 remove_wireframe 后）；image：透明底物体 sprite。
 */

import { decodeInputImage } from '../../../_shared/asset2d.js'
import { _binarize } from '../image_black_collision/index.js'

export interface ObjectGeometryResult {
  anchorX: number
  anchorY: number
  objectHeight: number
  geometryJson: string
  width: number
  height: number
  error: string
}

export interface BBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const EMPTY: ObjectGeometryResult = {
  anchorX: 0,
  anchorY: 0,
  objectHeight: 0,
  geometryJson: '{}',
  width: 0,
  height: 0,
  error: '',
}

export async function imageObjectGeometry(
  input: Record<string, unknown>,
  ctx?: { services?: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  const threshold = typeof input.threshold === 'number' ? input.threshold : 128
  const alphaMin = typeof input.alpha_min === 'number' ? input.alpha_min : 8

  const maskDec = decodeInputImage(input, ctx, 'mask')
  if (!maskDec.image) {
    return { ...EMPTY, error: maskDec.error ?? 'mask decode failed' }
  }
  const spriteDec = decodeInputImage(input, ctx, 'image')
  if (!spriteDec.image) {
    return { ...EMPTY, error: spriteDec.error ?? 'image decode failed' }
  }

  const { width, height } = maskDec.image
  if (spriteDec.image.width !== width || spriteDec.image.height !== height) {
    return {
      ...EMPTY,
      error: `mask (${width}×${height}) and image (${spriteDec.image.width}×${spriteDec.image.height}) size mismatch`,
    }
  }

  const maskSrc = new Uint8Array(maskDec.image.data.buffer, maskDec.image.data.byteOffset, maskDec.image.data.byteLength)
  const spriteSrc = new Uint8Array(spriteDec.image.data.buffer, spriteDec.image.data.byteOffset, spriteDec.image.data.byteLength)

  const result = _computeObjectGeometry(maskSrc, spriteSrc, width, height, threshold, alphaMin)
  if (result.error) return { ...EMPTY, width, height, error: result.error }

  return {
    anchor_x: result.anchorX,
    anchor_y: result.anchorY,
    object_height: result.objectHeight,
    geometry_json: result.geometryJson,
    width,
    height,
    error: '',
  }
}

/** 不透明内容外接框（image 顶原点 y 向下）。导出供单测。 */
export function _opaqueBBox(src: Uint8Array, w: number, h: number, alphaMin: number): BBox | null {
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = src[(y * w + x) * 4 + 3]
      if (a >= alphaMin) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  return { minX, minY, maxX, maxY }
}

/** 黑 footprint 外接框（mask 顶原点 y 向下）。导出供单测。 */
export function _footprintBBox(mask: Uint8Array, w: number, h: number): BBox | null {
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return null
  return { minX, minY, maxX, maxY }
}

/** 图像顶原点 y → 资产库底原点归一化 v（0=底，1=顶）。 */
export function _normV(yTopDown: number, height: number): number {
  if (height <= 0) return 0
  return (height - yTopDown) / height
}

/** 核心算法。导出供单测。 */
export function _computeObjectGeometry(
  maskSrc: Uint8Array,
  spriteSrc: Uint8Array,
  width: number,
  height: number,
  threshold = 128,
  alphaMin = 8,
): ObjectGeometryResult {
  const mask = _binarize(maskSrc, width, height, threshold)
  const footprint = _footprintBBox(mask, width, height)
  if (!footprint) {
    return { ...EMPTY, error: 'no collision footprint in mask' }
  }

  const content = _opaqueBBox(spriteSrc, width, height, alphaMin)
  if (!content) {
    return { ...EMPTY, error: 'no opaque content in image' }
  }

  const uMin = footprint.minX / width
  const uMax = (footprint.maxX + 1) / width
  const vBottom = _normV(footprint.maxY, height)
  const vTop = _normV(footprint.minY, height)

  const anchorX = ((footprint.minX + footprint.maxX + 1) / 2) / width
  const anchorY = vBottom

  const objectHeight = Math.max(1, footprint.maxY - content.minY + 1)

  const geometry = {
    object_height: objectHeight,
    collision_category: 'Rectangler',
    collision_mask: [
      [roundRatio(uMin), roundRatio(vBottom)],
      [roundRatio(uMax), roundRatio(vTop)],
    ],
    pivot: [roundRatio(anchorX), roundRatio(anchorY)],
  }

  return {
    anchorX: roundRatio(anchorX),
    anchorY: roundRatio(anchorY),
    objectHeight,
    geometryJson: JSON.stringify(geometry),
    width,
    height,
    error: '',
  }
}

function roundRatio(v: number): number {
  return Math.round(v * 1e10) / 1e10
}
