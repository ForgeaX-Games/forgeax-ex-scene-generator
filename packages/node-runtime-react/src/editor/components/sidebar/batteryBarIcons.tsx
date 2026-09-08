/** Inline close (×) icon — the package is intentionally lucide-free. */
export function PresetXIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

// ── Rail pictogram 图标（替代 ⭐ / 🔖 emoji，lucide-free，走 currentColor） ──
// 收藏 / 预设是两个合成大标签，rail 上原先用彩色 emoji 当图标，与其余文字标签
// 风格割裂。改为描边 SVG，统一由 .bb-rail-icon shell 承载（配色继承按钮 color）。

/** 收藏（星形轮廓）图标。 */
export function FavoritesRailIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="12 2.6 15.09 8.86 22 9.87 17 14.74 18.18 21.62 12 18.37 5.82 21.62 7 14.74 2 9.87 8.91 8.86 12 2.6" />
    </svg>
  )
}

/** 预设（书签轮廓）图标。 */
export function PresetsRailIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3.6h12a1 1 0 0 1 1 1v16.2l-7-4.3-7 4.3V4.6a1 1 0 0 1 1-1Z" />
    </svg>
  )
}

/** Develop ⇄ Templates 模式切换图标：环形双箭头（循环），随模式高亮由按钮 color 决定。 */
export function ModeToggleRailIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.5 12 A 7.5 7.5 0 0 1 19.5 12" />
      <polyline points="17.4 9.5 19.5 12 21.6 9.5" />
      <path d="M19.5 12 A 7.5 7.5 0 0 1 4.5 12" />
      <polyline points="2.4 14.5 4.5 12 6.6 14.5" />
    </svg>
  )
}

/** 展开 / 收起电池栏的小三角（chevron）。collapsed=true 指向右（展开），否则指向左（收起）。 */
export function CollapseRailIcon({ collapsed, size = 15 }: { collapsed: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {collapsed ? <polyline points="9 5 16 12 9 19" /> : <polyline points="15 5 8 12 15 19" />}
    </svg>
  )
}

/** 钉住大标签 rail 常驻展开的图钉图标（描边，pinned 态由按钮 active class 点亮）。 */
export function PinRailIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="17" x2="12" y2="22" />
      <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
    </svg>
  )
}

/** 已收藏标记：实心黄色五角星（电池/模板被加入收藏后展示）。 */
export function FavoriteStarIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#f5c518" stroke="none" aria-hidden="true">
      <polygon points="12 2.6 15.09 8.86 22 9.87 17 14.74 18.18 21.62 12 18.37 5.82 21.62 7 14.74 2 9.87 8.91 8.86 12 2.6" />
    </svg>
  )
}
