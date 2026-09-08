/**
 * house_footprint — 房屋底面：把房顶二维数组 + 高度，渲染成一张黑白「底面」图，
 * 黑色 = 房屋接触地面的部分（footprint），白色 = 背景。
 *
 * 与 house_template 的**尺寸/位置严格对应**：
 *   house_template 管线是 ExpandMask → OffsetByHeight → DifferentiateFacades → ResizeMask → render，
 *   而 ResizeMask 的缩放/居中**只依赖网格尺寸 H×W**；OffsetByHeight/DifferentiateFacades 不改尺寸，
 *   ExpandMask 把高度设为 (height+origH)×W。因此只要底面图也走同一个 ExpandMask(roof, height)
 *   得到相同的 (height+origH)×W 网格、再走同一个 ResizeMask(_, size)，缩放与居中即逐像素一致。
 *   「接触地面的部分」正是原始房顶 mask（建筑平面占位），位于扩展网格底部 [height, height+origH) 行——
 *   恰好落在 house_template 渲染图中房屋底部所在的像素，从而严格对齐。
 *
 * 几何直接复用 house_template 已导出的纯函数（ParseMasks / ExpandMask / ResizeMask），
 * 保证底面图永远跟随主电池的几何，无需重复实现、不会漂移。
 *
 * 电池入口为本文件唯一小写开头导出函数 houseFootprint（加载器约定）。
 */

import { createImage } from '../../../_shared/asset2d.js'
import { ParseMasks, ExpandMask, ResizeMask } from '../house_template/index.js'

type Grid = number[][]

const COLOR_BG = 255 // 白底
const COLOR_FOOTPRINT = 0 // 底面（接触地面）= 纯黑

/**
 * 单个房顶 mask → size×size 黑白底面 RGBA Buffer（导出供单测）。
 * 与 house_template 同源几何：ExpandMask(roof, height) → ResizeMask(_, size)，
 * 底面格(非 0)着黑、其余着白；缩放后网格即 size×size，逐格 1:1 写像素。
 */
export function FootprintGray(roof: Grid, height: number, size: number): Buffer {
  const expanded = ExpandMask(roof, height)
  const resized = ResizeMask(expanded, size)
  const data = Buffer.alloc(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    const di = i * 4
    data[di] = COLOR_BG; data[di + 1] = COLOR_BG; data[di + 2] = COLOR_BG; data[di + 3] = 255
  }
  for (let r = 0; r < size; r++) {
    const row = resized[r]
    if (!row) continue
    for (let c = 0; c < size; c++) {
      if (row[c] !== 0) {
        const di = (r * size + c) * 4
        data[di] = COLOR_FOOTPRINT; data[di + 1] = COLOR_FOOTPRINT; data[di + 2] = COLOR_FOOTPRINT; data[di + 3] = 255
      }
    }
  }
  return data
}

/**
 * 电池入口：唯一小写开头导出函数（被加载器选作 entry）。
 */
export async function houseFootprint(
  input: Record<string, unknown>,
  ctx?: { services?: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  const size = typeof input.imageSize === 'number' && input.imageSize > 0 ? Math.trunc(input.imageSize) : 300
  const height = typeof input.height === 'number' && input.height >= 0 ? Math.trunc(input.height) : 1

  const masks = ParseMasks(input.spec)
  if (masks.length === 0) {
    return { image: [], error: 'invalid spec: expected a roof-mask 2D array string like [[1,1,0],[1,1,1]]' }
  }

  const images: string[] = []
  const errors: string[] = []

  for (let i = 0; i < masks.length; i++) {
    const rgba = FootprintGray(masks[i], height, size)
    const res = createImage(ctx, rgba, size, size, { name: `footprint_${String(i + 1).padStart(3, '0')}`, nodeId: 'house_footprint', folder: 'grayscale' })
    if (res.error && !res.image) errors.push(`entry ${i + 1}: ${res.error}`)
    else {
      images.push(res.image)
      if (res.error) errors.push(`entry ${i + 1} (archive): ${res.error}`)
    }
  }

  return { image: images, error: errors.join('; ') }
}
