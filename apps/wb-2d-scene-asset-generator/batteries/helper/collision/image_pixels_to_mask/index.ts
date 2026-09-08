/**
 * image_pixels_to_mask — 像素图 → 掩码网格
 *
 * 把输入位图按「每个图像像素 = 一个逻辑格点」直接转成掩码 grid（不降采样，
 * grid 尺寸 = 图像宽×高）。颜色量化 key = `r,g,b,a`：统计各颜色出现次数，
 * 出现最多的颜色视为背景 → 0；其余颜色按从上到下、从左到右首次出现顺序递增
 * 分配 1、2、3…，输出 number[][] 掩码矩阵。
 *
 * I/O：经 `decodeInputImage`（_shared/asset2d.ts）委托后端 asset2d.decodeImage
 * 把 ImageRef 解码为 RGBA，再跑纯算法。纯算法以 `_` 前缀导出供单测，唯一小写
 * 开头导出函数 `imagePixelsToMask` 作为 loader entry（铁律见 image_pixel_scale）。
 */

import { decodeInputImage, type DecodedImage } from '../../../_shared/asset2d.js'

export async function imagePixelsToMask(
  input: Record<string, unknown>,
  ctx?: { services?: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  const dec = decodeInputImage(input, ctx)
  if (!dec.image) {
    return { grid: [], width: 0, height: 0, error: dec.error ?? 'decode failed' }
  }
  const { width, height, data } = dec.image
  const src = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)

  const grid = _pixelsToMask(src, width, height)
  return { grid, width, height, error: '' }
}

/**
 * 把 RGBA 像素映射为掩码矩阵：出现最多的颜色 → 0（背景），其余颜色按首次出现
 * 顺序（行优先扫描）递增分配 1、2、3…。导出供单测。
 */
export function _pixelsToMask(src: Uint8Array, w: number, h: number): number[][] {
  const n = w * h
  // 1) 统计每种颜色出现次数，确定背景色（出现最多者）。
  const counts = new Map<number, number>()
  const keyAt = (i: number): number => {
    const r = src[i * 4], g = src[i * 4 + 1], b = src[i * 4 + 2], a = src[i * 4 + 3]
    // 打包成 32-bit 无符号整数 key（避免字符串开销）。
    return (((r << 24) | (g << 16) | (b << 8) | a) >>> 0)
  }
  for (let i = 0; i < n; i++) {
    const k = keyAt(i)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  let bgKey = -1
  let bgCount = -1
  for (const [k, c] of counts) {
    if (c > bgCount) { bgCount = c; bgKey = k }
  }

  // 2) 行优先扫描，按首次出现顺序给非背景色分配递增掩码值。
  const valueOf = new Map<number, number>()
  valueOf.set(bgKey, 0)
  let next = 1
  const grid: number[][] = Array.from({ length: h }, () => new Array(w).fill(0))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = keyAt(y * w + x)
      let v = valueOf.get(k)
      if (v === undefined) { v = next++; valueOf.set(k, v) }
      grid[y][x] = v
    }
  }
  return grid
}

export type { DecodedImage }
