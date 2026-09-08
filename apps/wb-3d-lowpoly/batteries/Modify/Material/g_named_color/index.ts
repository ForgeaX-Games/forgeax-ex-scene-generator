/**
 * g_named_color —— 选一个预设颜色 / 材质名，输出 r/g/b/a 四个数。
 *
 * 不动 Geometry；下游接 g_material 的 r/g/b/a 端口完成上色。
 *
 * 配色采用 "named material preset" 风格 + 常见 URDF 渲染颜色：
 *   - 中性：white / gray / black / silver
 *   - 金属：steel / brass / copper / gold
 *   - 暖色：red / orange / yellow
 *   - 冷色：green / blue / cyan / purple / pink
 *   - 工程材料：plastic / rubber / wood / glass
 */

interface ColorPreset {
  rgba: readonly [number, number, number, number];
}

const PRESETS: Readonly<Record<string, ColorPreset>> = {
  white:    { rgba: [0.95, 0.95, 0.95, 1] },
  gray:     { rgba: [0.55, 0.55, 0.55, 1] },
  grey:     { rgba: [0.55, 0.55, 0.55, 1] },
  black:    { rgba: [0.08, 0.08, 0.08, 1] },
  silver:   { rgba: [0.78, 0.78, 0.80, 1] },

  steel:    { rgba: [0.55, 0.58, 0.62, 1] },
  brass:    { rgba: [0.85, 0.70, 0.30, 1] },
  copper:   { rgba: [0.80, 0.45, 0.30, 1] },
  gold:     { rgba: [0.95, 0.78, 0.30, 1] },

  red:      { rgba: [0.85, 0.20, 0.20, 1] },
  orange:   { rgba: [0.95, 0.55, 0.15, 1] },
  yellow:   { rgba: [0.95, 0.85, 0.20, 1] },

  green:    { rgba: [0.25, 0.70, 0.30, 1] },
  blue:     { rgba: [0.20, 0.45, 0.85, 1] },
  cyan:     { rgba: [0.20, 0.80, 0.85, 1] },
  purple:   { rgba: [0.55, 0.30, 0.75, 1] },
  pink:     { rgba: [0.95, 0.55, 0.70, 1] },

  plastic:  { rgba: [0.78, 0.78, 0.74, 1] },
  rubber:   { rgba: [0.18, 0.18, 0.18, 1] },
  wood:     { rgba: [0.65, 0.45, 0.25, 1] },
  glass:    { rgba: [0.85, 0.92, 0.95, 0.35] },
};

export function gNamedColor(input: Record<string, unknown>): Record<string, unknown> {
  const raw = String(input.name ?? 'gray').trim().toLowerCase();
  const preset = PRESETS[raw];
  if (!preset) {
    const known = Object.keys(PRESETS).sort().join(', ');
    return {
      r: 0.55, g: 0.55, b: 0.55, a: 1,
      name: raw,
      error: `unknown color "${raw}"; known: ${known}`,
    };
  }
  const [r, g, b, a] = preset.rgba;
  return { r, g, b, a, name: raw };
}

export default gNamedColor;
