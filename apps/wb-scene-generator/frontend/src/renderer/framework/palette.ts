// 💡 跨插件共享调色板
//
// 设计目标:同一图层 / 同一值 在不同视角与 Output 列表色标上染同色。
//
// 主路径:
//   * colorForValue(value) —— 按 value 黄金角散列色相;Output voxel / 多值格子 /
//     Billboard·Top·Iso·Free3D Color 与侧栏色标共用
//
// 遗留:
//   * colorForLayerIdx(idx) —— 仅给没有稳定 value 语义的调用方;新代码勿再用于 voxel Output
//
// 选中 / 子值降饱和 通过 ColorOpts:
//   * editorSelected → success 绿(与 store.selectedEditorNodeIds 协议一致)
//   * selected       → accent 绿(layer 自己被选中)
//   * subDimmed      → 多值层中未选中的值,降到原色 50% 饱和

const GOLDEN_ANGLE = 137.508

/** Forgeax 暗底上的默认可区分饱和/亮度(比旧 70/55、Free3D 85/55 更收一点) */
const FORGEAX_SAT = 62
const FORGEAX_LIG = 52

/** @deprecated Prefer colorForValue; kept for any non-value callers. */
export const LAYER_BASE_HUES = [
  0, 120, 240, 60, 180, 300, 30, 150, 270, 90, 210, 330,
] as const

export interface RGBA {
  r: number  // 0-255
  g: number
  b: number
  a: number  // 0-255
}

export interface ColorOpts {
  /** 在 LayersSidePanel / 画布点击选中(accent 绿) */
  selected?: boolean
  /** 编辑器画布选中(success 绿) */
  editorSelected?: boolean
  /** 多值层中未选中的子值,降饱和 */
  subDimmed?: boolean
  /** 整体不透明度系数(0-1),与上述 selected 状态独立 */
  alpha?: number
}

/** HSL → RGB(h ∈ [0, 360), s/l ∈ [0, 100]),返回 0-255 整数 */
export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const sN = s / 100
  const lN = l / 100
  const c = (1 - Math.abs(2 * lN - 1)) * sN
  const hp = ((h % 360) + 360) % 360 / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0, g = 0, b = 0
  if (hp < 1) [r, g, b] = [c, x, 0]
  else if (hp < 2) [r, g, b] = [x, c, 0]
  else if (hp < 3) [r, g, b] = [0, c, x]
  else if (hp < 4) [r, g, b] = [0, x, c]
  else if (hp < 5) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const m = lN - c / 2
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  }
}

/** value → 色相(与 colorForValue 同源) */
export function hueForValue(value: number): number {
  return ((value * GOLDEN_ANGLE) % 360 + 360) % 360
}

function applyOpts(h: number, opts?: ColorOpts): RGBA {
  let s = FORGEAX_SAT
  let l = FORGEAX_LIG
  if (opts?.editorSelected) {
    // success 绿(与 --color-success #3ECF6B 对齐)
    return { r: 62, g: 207, b: 107, a: Math.round(255 * (opts?.alpha ?? 1)) }
  }
  if (opts?.selected) {
    // accent 绿(柠檬绿,与 --color-accent #d4ff48 对齐)
    return { r: 212, g: 255, b: 72, a: Math.round(255 * (opts?.alpha ?? 1)) }
  }
  if (opts?.subDimmed) {
    s = 35
    l = 45
  }
  const { r, g, b } = hslToRgb(h, s, l)
  return { r, g, b, a: Math.round(255 * (opts?.alpha ?? 1)) }
}

/** @deprecated Prefer colorForValue for Output / Color 模式对齐. */
export function colorForLayerIdx(layerIdx: number, opts?: ColorOpts): RGBA {
  const h = LAYER_BASE_HUES[((layerIdx % LAYER_BASE_HUES.length) + LAYER_BASE_HUES.length) % LAYER_BASE_HUES.length]
  return applyOpts(h, opts)
}

/** 按 value 黄金角取色 — Preview Color / Output 色标的唯一真相源 */
export function colorForValue(value: number, opts?: ColorOpts): RGBA {
  return applyOpts(hueForValue(value), opts)
}

/** CSS 用(侧栏色标 / style.backgroundColor) */
export function colorForValueCss(value: number, opts?: ColorOpts): string {
  return rgbaToCss(colorForValue(value, opts))
}

/** 把 RGBA 转成 CSS 字符串(stroke / fill 用) */
export function rgbaToCss(c: RGBA): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${(c.a / 255).toFixed(3)})`
}
