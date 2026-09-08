/**
 * image_pixel_scale — 像素图缩放（最近邻，保留硬边缘 / 不混色）
 *
 * 直接把源图按目标宽/高做最近邻重采样：每个目标像素取源图对应位置的单个像素颜色，
 * **不做任何插值/混色**，保留像素风的硬边缘。这与「pixel-scale 整数倍无损缩放」不同——
 * 整数倍方案只能产出源网格的整数倍尺寸（无法精确缩到任意目标，如 182→29），故这里改为
 * 直达目标尺寸的最近邻缩放，既能命中任意目标宽/高，又不引入混色。
 *
 * 锁定横纵比：只用「目标宽优先、否则目标高」推一个缩放比例，另一轴按原比例等比换算；
 * 两轴都给了也以该单一比例为准（保持像素方块不变形）。不锁定：两轴各自缩到各自目标。
 * I/O 经 `processImage` 委托后端 asset2d 解码/编码。
 *
 * loader-entry 铁律：loader 取「首个 /^[a-z]/ 命名导出函数」作 execute，而 TS→ESM
 * 转译（tsx/esbuild）会按**字母序**重排具名导出，声明序不保证。故纯算法导出（供单测）
 * 一律以 `_` 前缀避开该正则，确保唯一的小写入口是 `imagePixelScale`。
 */

import { processImage, type DecodedImage } from '../../../_shared/asset2d.js'

export async function imagePixelScale(
  input: Record<string, unknown>,
  ctx?: { services?: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  const targetW = typeof input.width === 'number' ? Math.round(input.width) : 0
  const targetH = typeof input.height === 'number' ? Math.round(input.height) : 0
  const lockAspect = input.lock_aspect !== false

  const res = processImage(input, ctx, 'image_pixel_scale', (img: DecodedImage) => {
    const src = new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength)
    const out = _pixelScale(src, img.width, img.height, targetW, targetH, lockAspect)
    return { width: out.w, height: out.h, data: Buffer.from(out.pixels.buffer, out.pixels.byteOffset, out.pixels.byteLength) }
  }, { suffix: '_pixscale' })

  return { image: res.image, out_width: res.width, out_height: res.height, error: res.error }
}

/**
 * 解算目标尺寸：把用户给的目标宽/高（0=未指定）结合锁横纵比，换算成最终输出宽高。
 * 锁定时以「目标宽优先、否则目标高」推统一比例 r，另一轴按源比例等比；都未给则保持原尺寸。
 * 不锁定时各轴独立（缺的轴回退源尺寸）。导出供单测验证。
 */
export function _resolveTarget(
  sw: number, sh: number, targetW: number, targetH: number, lockAspect: boolean,
): { w: number; h: number } {
  if (lockAspect) {
    let r: number
    if (targetW > 0) r = targetW / sw
    else if (targetH > 0) r = targetH / sh
    else r = 1
    return { w: Math.max(1, Math.round(sw * r)), h: Math.max(1, Math.round(sh * r)) }
  }
  return {
    w: targetW > 0 ? targetW : sw,
    h: targetH > 0 ? targetH : sh,
  }
}

/**
 * 最近邻缩放：把源 RGBA（sw×sh）重采样到目标宽/高（结合锁横纵比解算），不混色。
 * 导出供单测直接验证。
 */
export function _pixelScale(
  src: Uint8Array, sw: number, sh: number,
  targetW: number, targetH: number, lockAspect: boolean,
): { pixels: Uint8Array; w: number; h: number } {
  const { w: dw, h: dh } = _resolveTarget(sw, sh, targetW, targetH, lockAspect)
  return _nearestResample(src, sw, sh, dw, dh)
}

/** 纯最近邻重采样：dst[x,y] = src[round-ish 映射]，逐通道直接拷贝，不插值。导出供单测验证。 */
export function _nearestResample(
  src: Uint8Array, sw: number, sh: number, dw: number, dh: number,
): { pixels: Uint8Array; w: number; h: number } {
  const out = new Uint8Array(dw * dh * 4)
  const scaleX = sw / dw
  const scaleY = sh / dh
  let w = 0
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor((y + 0.5) * scaleY))
    const rowBase = sy * sw
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor((x + 0.5) * scaleX))
      const si = (rowBase + sx) * 4
      out[w++] = src[si]; out[w++] = src[si + 1]; out[w++] = src[si + 2]; out[w++] = src[si + 3]
    }
  }
  return { pixels: out, w: dw, h: dh }
}
