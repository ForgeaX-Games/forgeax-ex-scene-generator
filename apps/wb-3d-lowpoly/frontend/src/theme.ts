// 💡 3D Lowpoly Generator — 设计 token 的唯一权威来源（SSOT）。
//    这份 JS 对象与 `design-tokens.css` 的 `:root` 变量保持一一对应（改一处务必同步改
//    另一处）：CSS 侧给静态样式表用，这里给需要在 JS/three.js 里读取颜色的地方用
//    （目前接入点：viewerStore 的默认背景色 + useThreeScene 的默认 scene.background）。
//    多个 `?pane=` 文档（left / center / viewer3d）共享同一份 bundle，design-tokens.css
//    在 main.tsx 里全局引入一次，保证三个面板视觉规范一致。
export const theme = {
  name: 'wb-3d-lowpoly',
  colors: {
    accent: '#d4ff48',
    accentRgb: '212, 255, 72',
    bgPrimary: '#070b08',
    bgSecondary: '#101912',
    bgTertiary: '#162219',
    bgElevated: '#1d2b20',
    textPrimary: '#f3f7ee',
    textSecondary: '#9aa894',
    textMuted: '#667260',
    border: '#263326',
    borderStrong: '#3a4b38',
    success: '#3ECF6B',
    warning: '#F59E0B',
    error: '#F04E52',
    info: '#38BDF8',
    /** three.js 场景默认背景色（与 --viewport-bg 一致）。 */
    viewportBackground: '#070b08',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
  },
  radius: {
    sm: 4,
    md: 8,
  },
} as const

export type Theme = typeof theme
