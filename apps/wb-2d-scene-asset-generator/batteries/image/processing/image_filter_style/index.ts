/**
 * image_filter_style — 风格滤镜调色（本地纯算法，无外部 API）
 *
 * 迁移自 pcg_generation 管线的 filter_image 步骤（apply_filter_agent.py + palette_rules.json）：
 * 输入一张图片，选择一个既定风格（下拉框），按该风格预设的「色相偏移 / 饱和度 / 亮度 /
 * 对比度 / 罩色染色 / 老照片」参数链式处理，输出调色后的图片。
 *
 * 调色链顺序：hue → saturation → brightness → contrast → tint → sepia，只作用于 RGB 通道、
 * 原样保留 alpha（抠图过的透明边不被破坏）。
 *
 * 罩色（tint）这一步是 Photoshop 风格的**混合模式图层**而非平涂：支持正常 / 正片叠底 /
 * 滤色 / 叠加 / 柔光。平涂（正常）会均匀压低局部对比，让画面像「糊一层面罩」；改用叠加/
 * 柔光只染中间调、保留高光与暗部结构，正片叠底则在阴影处加重色调——都能在定调的同时保住
 * 画面通透与对比，提升观感。每个风格预设自带合适的混合模式，也可用 `blend_mode` 输入覆盖。
 *
 * I/O 经 `_shared/asset2d.ts` 的 `processImage` 委托后端 asset2d 解码输入 / 编码输出 / 写入
 * generated 存储；本电池只产出 RGBA 像素。
 *
 * loader-entry 铁律：loader 取「首个 /^[a-z]/ 命名导出函数」作 execute，TS→ESM 转译会按
 * 字母序重排具名导出，故唯一的小写具名导出只能是入口 `imageFilterStyle`，其余 helper 均不导出。
 */

import { processImage, type DecodedImage } from '../../../_shared/asset2d.js'

/** Photoshop 风格混合模式（罩色图层用）。 */
export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'soft_light'

export interface StylePreset {
  label: string
  hue_shift?: number
  saturation_scale?: number
  brightness_scale?: number
  contrast_scale?: number
  tint_color?: string
  tint_strength?: number
  /** 罩色混合模式，缺省为 normal（平涂）；推荐 overlay/soft_light/multiply 以保持通透。 */
  tint_blend?: BlendMode
  sepia_strength?: number
}

/**
 * 风格预设表（键即下拉框选项值）。色相/饱和/亮度/对比沿用 palette_rules.json 的设计意图，
 * 罩色全部改为混合模式图层并重新调参——平涂会发闷糊脸，叠加/柔光保通透、正片叠底压暗部。
 */
export const _STYLE_PRESETS: Record<string, StylePreset> = {
  '中式仙侠': { label: '暖调、明亮、微黄、低对比', hue_shift: -5, saturation_scale: 1.18, brightness_scale: 1.06, contrast_scale: 1.02, tint_color: '#FFE8C0', tint_strength: 0.22, tint_blend: 'soft_light' },
  '中式恐怖': { label: '冷调、暗青绿、高对比', hue_shift: 30, saturation_scale: 0.78, brightness_scale: 0.9, contrast_scale: 1.22, tint_color: '#0B3D3D', tint_strength: 0.38, tint_blend: 'multiply' },
  '日式和风': { label: '清新、粉/青色调、高亮、柔和', saturation_scale: 1.15, brightness_scale: 1.06, contrast_scale: 1.02, tint_color: '#DCEBFF', tint_strength: 0.18, tint_blend: 'soft_light' },
  '标准西幻': { label: '自然、鲜艳、明亮、正色', saturation_scale: 1.2, brightness_scale: 1.03, contrast_scale: 1.08, tint_color: '#FFF2D8', tint_strength: 0.12, tint_blend: 'soft_light' },
  '黑暗奇幻': { label: '低饱和、灰蓝/褐色、粗粝', saturation_scale: 0.74, brightness_scale: 0.95, contrast_scale: 1.18, tint_color: '#2F4F4F', tint_strength: 0.3, tint_blend: 'overlay' },
  '历史复古': { label: '泛黄、做旧、煤烟色、暖褐', saturation_scale: 0.85, contrast_scale: 1.1, tint_color: '#B8860B', tint_strength: 0.24, tint_blend: 'overlay', sepia_strength: 0.35 },
  '赛博朋克': { label: '高饱和、紫/青偏色、暗背景', hue_shift: 12, saturation_scale: 1.45, brightness_scale: 0.98, contrast_scale: 1.2, tint_color: '#3A0A4D', tint_strength: 0.32, tint_blend: 'overlay' },
  '太空科技': { label: '冷白/蓝灰、极简、高亮', saturation_scale: 0.85, brightness_scale: 1.06, contrast_scale: 1.05, tint_color: '#DFF4FF', tint_strength: 0.22, tint_blend: 'soft_light' },
  '废土黄沙': { label: '极低饱和、枯黄/沙土色、高噪点', saturation_scale: 0.62, brightness_scale: 1.0, contrast_scale: 1.08, tint_color: '#8B7355', tint_strength: 0.28, tint_blend: 'overlay', sepia_strength: 0.4 },
  '血腥深渊': { label: '极暗、红/黑偏色、高对比', hue_shift: -8, saturation_scale: 1.25, brightness_scale: 0.82, contrast_scale: 1.32, tint_color: '#4A0000', tint_strength: 0.36, tint_blend: 'multiply' },
  '生化异星': { label: '诡异、荧光绿/紫', hue_shift: 110, saturation_scale: 1.35, contrast_scale: 1.12, tint_color: '#1FCF3A', tint_strength: 0.2, tint_blend: 'overlay' },
  '梦境糖果': { label: '糖果色、反常色相、极高亮', hue_shift: 175, saturation_scale: 1.3, brightness_scale: 1.1, contrast_scale: 1.0, tint_color: '#FFD6F5', tint_strength: 0.22, tint_blend: 'screen' },
  '原图': { label: '不做任何调色' },
}

/** 下拉框选项值（中文）→ 内部混合模式；"跟随风格" = undefined（用预设自带）。 */
const BLEND_LABEL_TO_MODE: Record<string, BlendMode | undefined> = {
  '跟随风格': undefined,
  '正常': 'normal',
  '正片叠底': 'multiply',
  '滤色': 'screen',
  '叠加': 'overlay',
  '柔光': 'soft_light',
}

export async function imageFilterStyle(
  input: Record<string, unknown>,
  ctx?: { services?: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  const styleKey = typeof input.style === 'string' && input.style in _STYLE_PRESETS ? input.style : '标准西幻'
  const preset = _STYLE_PRESETS[styleKey]
  const blendLabel = typeof input.blend_mode === 'string' ? input.blend_mode : '跟随风格'
  const blendOverride = blendLabel in BLEND_LABEL_TO_MODE ? BLEND_LABEL_TO_MODE[blendLabel] : undefined

  const res = processImage(input, ctx, 'image_filter_style', (img: DecodedImage) => {
    const src = new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength)
    const out = _applyStyle(src, img.width, img.height, preset, blendOverride)
    return { width: img.width, height: img.height, data: Buffer.from(out.buffer, out.byteOffset, out.byteLength) }
  }, { suffix: '_filter' })

  return { image: res.image, width: res.width, height: res.height, applied_style: styleKey, error: res.error }
}

const clamp = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v))

/**
 * 按预设链式处理：hue → saturation → brightness → contrast → tint → sepia（仅作用 RGB，保留 alpha）。
 * 以 `_` 前缀导出供单测直接验证——避开 loader 取首个 /^[a-z]/ 具名导出作 execute 的正则。
 */
export function _applyStyle(src: Uint8Array, w: number, h: number, p: StylePreset, blendOverride?: BlendMode): Uint8Array {
  let out = Uint8Array.from(src)
  if (p.hue_shift !== undefined && p.hue_shift !== 0) hueShift(out, p.hue_shift)
  if (p.saturation_scale !== undefined && p.saturation_scale !== 1) enhanceColor(out, p.saturation_scale)
  if (p.brightness_scale !== undefined && p.brightness_scale !== 1) enhanceBrightness(out, p.brightness_scale)
  if (p.contrast_scale !== undefined && p.contrast_scale !== 1) enhanceContrast(out, p.contrast_scale)
  if (p.tint_color !== undefined) applyTint(out, p.tint_color, p.tint_strength ?? 0.2, blendOverride ?? p.tint_blend ?? 'normal')
  if (p.sepia_strength !== undefined) out = applySepia(out, p.sepia_strength)
  return out
}

/** 色相偏移：RGB→HSV，H 加 shift 度（环绕），HSV→RGB；alpha 不动。 */
function hueShift(px: Uint8Array, degrees: number): void {
  const dh = ((degrees % 360) + 360) % 360 / 360
  for (let i = 0; i < px.length; i += 4) {
    const [hh, s, v] = rgbToHsv(px[i], px[i + 1], px[i + 2])
    const [r, g, b] = hsvToRgb((hh + dh) % 1, s, v)
    px[i] = r; px[i + 1] = g; px[i + 2] = b
  }
}

/** ITU-R 601-2 亮度，对应 PIL convert("L")。 */
const luma = (r: number, g: number, b: number): number => r * 299 / 1000 + g * 587 / 1000 + b * 114 / 1000

/** 饱和度：对应 PIL ImageEnhance.Color，degenerate=灰度图，out=gray*(1-f)+orig*f。 */
function enhanceColor(px: Uint8Array, factor: number): void {
  for (let i = 0; i < px.length; i += 4) {
    const gray = luma(px[i], px[i + 1], px[i + 2])
    px[i] = clamp(gray + (px[i] - gray) * factor)
    px[i + 1] = clamp(gray + (px[i + 1] - gray) * factor)
    px[i + 2] = clamp(gray + (px[i + 2] - gray) * factor)
  }
}

/** 亮度：对应 PIL ImageEnhance.Brightness，degenerate=黑，out=orig*f。 */
function enhanceBrightness(px: Uint8Array, factor: number): void {
  for (let i = 0; i < px.length; i += 4) {
    px[i] = clamp(px[i] * factor)
    px[i + 1] = clamp(px[i + 1] * factor)
    px[i + 2] = clamp(px[i + 2] * factor)
  }
}

/** 对比度：对应 PIL ImageEnhance.Contrast，degenerate=全图灰度均值的纯色，out=mean*(1-f)+orig*f。 */
function enhanceContrast(px: Uint8Array, factor: number): void {
  let sum = 0
  let n = 0
  for (let i = 0; i < px.length; i += 4) { sum += Math.round(luma(px[i], px[i + 1], px[i + 2])); n++ }
  const mean = n > 0 ? sum / n : 0
  for (let i = 0; i < px.length; i += 4) {
    px[i] = clamp(mean + (px[i] - mean) * factor)
    px[i + 1] = clamp(mean + (px[i + 1] - mean) * factor)
    px[i + 2] = clamp(mean + (px[i + 2] - mean) * factor)
  }
}

/**
 * 单通道混合（base、layer 均归一化到 0..1）。对应 Photoshop / W3C 混合模式公式。
 * 正片叠底压暗、滤色提亮、叠加=按 base 自适应的乘/滤、柔光=更柔和的叠加。
 */
function blendChannel(b: number, l: number, mode: BlendMode): number {
  switch (mode) {
    case 'multiply': return b * l
    case 'screen': return 1 - (1 - b) * (1 - l)
    case 'overlay': return b < 0.5 ? 2 * b * l : 1 - 2 * (1 - b) * (1 - l)
    case 'soft_light': {
      if (l <= 0.5) return b - (1 - 2 * l) * b * (1 - b)
      const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b)
      return b + (2 * l - 1) * (d - b)
    }
    default: return l // normal：图层色直接覆盖（再由 strength 当作图层不透明度回混）
  }
}

/**
 * 罩色图层：以 PS「混合模式 + 图层不透明度」叠在原图上。
 * out = base*(1-strength) + blend(base, tint, mode)*strength；alpha 不动。
 * 关键：normal 是平涂会糊画面，overlay/soft_light/multiply 保留明暗结构→更通透。
 */
function applyTint(px: Uint8Array, hex: string, strength: number, mode: BlendMode): void {
  if (strength <= 0) return
  const t = hexToRgb(hex)
  const tn = [t[0] / 255, t[1] / 255, t[2] / 255]
  const inv = 1 - strength
  for (let i = 0; i < px.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const base = px[i + c] / 255
      const blended = blendChannel(base, tn[c], mode)
      px[i + c] = clamp((base * inv + blended * strength) * 255)
    }
  }
}

/** 老照片：灰度→染 #704214(0.5)→与原图按 strength 混合；alpha 取原图。 */
function applySepia(px: Uint8Array, strength: number): Uint8Array {
  const sepia = Uint8Array.from(px)
  for (let i = 0; i < sepia.length; i += 4) {
    const g = clamp(luma(sepia[i], sepia[i + 1], sepia[i + 2]))
    sepia[i] = g; sepia[i + 1] = g; sepia[i + 2] = g
  }
  applyTint(sepia, '#704214', 0.5, 'normal')
  const out = Uint8Array.from(px)
  const inv = 1 - strength
  for (let i = 0; i < out.length; i += 4) {
    out[i] = clamp(out[i] * inv + sepia[i] * strength)
    out[i + 1] = clamp(out[i + 1] * inv + sepia[i + 1] * strength)
    out[i + 2] = clamp(out[i + 2] * inv + sepia[i + 2] * strength)
  }
  return out
}

function hexToRgb(hex: string): [number, number, number] {
  const s = hex.replace('#', '')
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s
  return [parseInt(full.slice(0, 2), 16) || 0, parseInt(full.slice(2, 4), 16) || 0, parseInt(full.slice(4, 6), 16) || 0]
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rf = r / 255, gf = g / 255, bf = b / 255
  const max = Math.max(rf, gf, bf), min = Math.min(rf, gf, bf)
  const d = max - min
  let hh = 0
  if (d !== 0) {
    if (max === rf) hh = ((gf - bf) / d) % 6
    else if (max === gf) hh = (bf - rf) / d + 2
    else hh = (rf - gf) / d + 4
    hh /= 6
    if (hh < 0) hh += 1
  }
  const s = max === 0 ? 0 : d / max
  return [hh, s, max]
}

function hsvToRgb(hh: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(hh * 6)
  const f = hh * 6 - i
  const p = v * (1 - s)
  const q = v * (1 - f * s)
  const t = v * (1 - (1 - f) * s)
  let r = 0, g = 0, b = 0
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break
    case 1: r = q; g = v; b = p; break
    case 2: r = p; g = v; b = t; break
    case 3: r = p; g = q; b = v; break
    case 4: r = t; g = p; b = v; break
    case 5: r = v; g = p; b = q; break
  }
  return [clamp(r * 255), clamp(g * 255), clamp(b * 255)]
}
