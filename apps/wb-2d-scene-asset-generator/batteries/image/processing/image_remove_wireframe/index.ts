/**
 * image_remove_wireframe — 去线框，只留黑色实心区域
 *
 * 输入一张黑白图（常见于 AI 生成）：图中黑色像素分两类——
 *   1. 线框：只有黑色线条轮廓（细），如空心矩形、描边、灯柱轮廓；
 *   2. 实心区域：大块的黑色填充（如底座）。
 * 本电池去掉线框、只保留实心区域，**即使线框与实心区域相连也能去除**。
 *
 * 算法（形态学开运算 = 腐蚀 + 膨胀，morphological opening）：
 *   1. 二值化：亮度 < threshold 且不透明的像素记为黑（mask=1）。
 *   2. 腐蚀（半径 r）：最薄方向宽度 ≤ 2r 的细线被完全消除——连它与实心区域
 *      的连接处一起消失；只有足够粗的实心块留下「核心」。
 *   3. 膨胀（半径 r）：把核心长回原大小，实心块恢复（边角略圆），细线因无核心
 *      不会重新长出。这是开运算能「断开并去除相连细线」的关键。
 *   4. 渲染：保留区涂黑，其余为白底（或可选透明）。
 *
 * I/O：纯像素算法与资产读写解耦——经 `processImage`（_shared/asset2d.ts）由后端
 *      asset2d 服务负责解码输入 ImageRef、编码输出、写入 generated 存储。
 */

import { processImage, type DecodedImage } from '../../../_shared/asset2d.js'

export interface RemoveWireframeResult {
  /** RGBA, length = w * h * 4 */
  pixels: Uint8Array
  w: number
  h: number
}

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/**
 * 方形（Chebyshev）腐蚀，半径 r：仅当以像素为中心的 (2r+1)×(2r+1) 邻域全部为前景
 * 且完全位于图内时，结果像素才为 1（越界邻域视为背景，故边缘像素被腐蚀）。
 * 可分离实现：先水平、再垂直各做一次 (2r+1) 窗口的「全 1」判定 → O(n) 复杂度。
 */
function erodeSquare(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const n = w * h
  const win = 2 * r + 1

  const tmp = new Uint8Array(n)
  const rowPref = new Int32Array(w + 1)
  for (let y = 0; y < h; y++) {
    const row = y * w
    rowPref[0] = 0
    for (let x = 0; x < w; x++) rowPref[x + 1] = rowPref[x] + mask[row + x]
    for (let x = 0; x < w; x++) {
      const lo = x - r
      const hi = x + r
      tmp[row + x] = lo >= 0 && hi < w && rowPref[hi + 1] - rowPref[lo] === win ? 1 : 0
    }
  }

  const out = new Uint8Array(n)
  const colPref = new Int32Array(h + 1)
  for (let x = 0; x < w; x++) {
    colPref[0] = 0
    for (let y = 0; y < h; y++) colPref[y + 1] = colPref[y] + tmp[y * w + x]
    for (let y = 0; y < h; y++) {
      const lo = y - r
      const hi = y + r
      out[y * w + x] = lo >= 0 && hi < h && colPref[hi + 1] - colPref[lo] === win ? 1 : 0
    }
  }
  return out
}

/**
 * 方形膨胀，半径 r：以像素为中心的 (2r+1)×(2r+1) 邻域内只要有一个前景像素，
 * 结果即为 1（越界邻域视为背景）。同样可分离实现，O(n)。
 */
function dilateSquare(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const n = w * h

  const tmp = new Uint8Array(n)
  const rowPref = new Int32Array(w + 1)
  for (let y = 0; y < h; y++) {
    const row = y * w
    rowPref[0] = 0
    for (let x = 0; x < w; x++) rowPref[x + 1] = rowPref[x] + mask[row + x]
    for (let x = 0; x < w; x++) {
      const lo = Math.max(0, x - r)
      const hi = Math.min(w - 1, x + r)
      tmp[row + x] = rowPref[hi + 1] - rowPref[lo] > 0 ? 1 : 0
    }
  }

  const out = new Uint8Array(n)
  const colPref = new Int32Array(h + 1)
  for (let x = 0; x < w; x++) {
    colPref[0] = 0
    for (let y = 0; y < h; y++) colPref[y + 1] = colPref[y] + tmp[y * w + x]
    for (let y = 0; y < h; y++) {
      const lo = Math.max(0, y - r)
      const hi = Math.min(h - 1, y + r)
      out[y * w + x] = colPref[hi + 1] - colPref[lo] > 0 ? 1 : 0
    }
  }
  return out
}

/** 默认只保留面积 ≥ 最大连通域 50% 的候选里最靠下的那个，杜绝麻麻点点。 */
const COMPONENT_AREA_FRAC = 0.5

/**
 * 在二值 mask（0/1）上求 8 连通域，挑出「最大且最靠下」的那一块，返回只含该块
 * 的 keep mask（其余清零，从而消除所有零碎小斑点）。选择规则：先取面积 ≥
 * 最大面积×areaFrac 的候选（排除小斑点），再在候选里选底边最靠下（maxY 最大）
 * 的一块，并列时取面积更大者。导出供单测验证。
 */
export function selectLargestBottomComponent(
  mask: Uint8Array,
  w: number,
  h: number,
  areaFrac: number,
): Uint8Array {
  const n = w * h
  const label = new Int32Array(n).fill(-1)
  const stack = new Int32Array(n)
  const areas: number[] = []
  const maxYs: number[] = []
  let compId = 0
  for (let start = 0; start < n; start++) {
    if (mask[start] === 0 || label[start] !== -1) continue
    let sp = 0
    let area = 0
    let maxY = 0
    stack[sp++] = start
    label[start] = compId
    while (sp > 0) {
      const idx = stack[--sp]
      area++
      const y = (idx / w) | 0
      if (y > maxY) maxY = y
      const x = idx % w
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          if (nx < 0 || nx >= w) continue
          const nb = ny * w + nx
          if (mask[nb] === 1 && label[nb] === -1) {
            label[nb] = compId
            stack[sp++] = nb
          }
        }
      }
    }
    areas.push(area)
    maxYs.push(maxY)
    compId++
  }

  const keep = new Uint8Array(n)
  if (compId === 0) return keep

  let maxArea = 0
  for (let c = 0; c < compId; c++) if (areas[c] > maxArea) maxArea = areas[c]
  const threshold = maxArea * areaFrac

  let best = -1
  for (let c = 0; c < compId; c++) {
    if (areas[c] < threshold) continue
    if (best === -1 || maxYs[c] > maxYs[best] || (maxYs[c] === maxYs[best] && areas[c] > areas[best])) {
      best = c
    }
  }
  if (best === -1) return keep
  for (let i = 0; i < n; i++) if (label[i] === best) keep[i] = 1
  return keep
}

/**
 * 纯像素去线框：RGBA in → RGBA out。导出供单测直接验证。
 * 形态学开运算（腐蚀→膨胀）去掉细线框、保留实心区域（相连的线框也能去除）；
 * 之后按连通域只保留「最大且最靠下」的一块，杜绝零碎小斑点。
 * @param threshold     二值化阈值（亮度 < threshold 视为黑），0–255。
 * @param erodeRadius   结构元半径 r（px），最薄方向宽度 ≤ 2r 的线框会被去除。
 * @param transparentBg 为 true 时非保留区输出透明；否则输出白底。
 * @param singleRegion  为 true（默认）时只保留最大最靠下的一个连通域。
 */
export function removeWireframe(
  src: Uint8Array,
  w: number,
  h: number,
  threshold: number,
  erodeRadius: number,
  transparentBg: boolean,
  singleRegion = true,
): RemoveWireframeResult {
  const n = w * h
  const r = Math.max(1, Math.trunc(erodeRadius))

  const mask = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const di = i * 4
    if (src[di + 3] < 8) continue // 透明像素当作背景
    mask[i] = luminance(src[di], src[di + 1], src[di + 2]) < threshold ? 1 : 0
  }

  // 开运算：先腐蚀（消除细线及其与实心的连接），再膨胀（实心块长回原大小）。
  const opened = dilateSquare(erodeSquare(mask, w, h, r), w, h, r)
  // 只保留最大最靠下的一个连通域，去掉所有零碎小斑点。
  const keep = singleRegion ? selectLargestBottomComponent(opened, w, h, COMPONENT_AREA_FRAC) : opened

  const out = new Uint8Array(n * 4)
  for (let i = 0; i < n; i++) {
    const di = i * 4
    if (keep[i]) {
      out[di] = 0
      out[di + 1] = 0
      out[di + 2] = 0
      out[di + 3] = 255
    } else if (transparentBg) {
      out[di + 3] = 0
    } else {
      out[di] = 255
      out[di + 1] = 255
      out[di + 2] = 255
      out[di + 3] = 255
    }
  }
  return { pixels: out, w, h }
}

export async function imageRemoveWireframe(
  input: Record<string, unknown>,
  ctx?: { services?: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  const threshold = typeof input.threshold === 'number'
    ? Math.max(0, Math.min(255, input.threshold))
    : 128
  const erodeRadius = typeof input.erode_radius === 'number' ? input.erode_radius : 3
  const transparentBg = input.transparent_bg === true
  const singleRegion = input.single_region !== false

  const res = processImage(input, ctx, 'image_remove_wireframe', (img: DecodedImage) => {
    const src = new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength)
    const out = removeWireframe(src, img.width, img.height, threshold, erodeRadius, transparentBg, singleRegion)
    return {
      width: out.w,
      height: out.h,
      data: Buffer.from(out.pixels.buffer, out.pixels.byteOffset, out.pixels.byteLength),
    }
  }, { suffix: '_solid' })

  return { image: res.image, width: res.width, height: res.height, error: res.error }
}
