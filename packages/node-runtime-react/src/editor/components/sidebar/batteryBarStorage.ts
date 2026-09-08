// BatteryBar 的 localStorage 持久化与覆盖层键工具（自 BatteryBar.tsx 抽出）。
//   ─ 电池栏宽度（拖拽把手持久化）
//   ─ 活动大标签 / 展开的小标签 map / 纵向滚动位置 map
//   ─ 大/小标签合成的覆盖层 key
// 全部为纯 IO/字符串工具，不依赖 React。所有读取在异常时回退到安全默认值。

// ── 宽度限制 ────────────────────────────────────────────────────────────────
export const BATTERY_BAR_WIDTH_DEFAULT = 293
export const BATTERY_BAR_WIDTH_MIN = 160
export const BATTERY_BAR_WIDTH_MAX = 420

// 电池栏宽度（拖拽把手持久化到 localStorage，跨刷新保留）。
const LS_WIDTH = 'battery-bar-width'

export function readBatteryBarWidth(): number {
  try {
    const raw = localStorage.getItem(LS_WIDTH)
    if (!raw) return BATTERY_BAR_WIDTH_DEFAULT
    const n = Number(raw)
    if (!Number.isFinite(n)) return BATTERY_BAR_WIDTH_DEFAULT
    return Math.max(BATTERY_BAR_WIDTH_MIN, Math.min(BATTERY_BAR_WIDTH_MAX, n))
  } catch {
    return BATTERY_BAR_WIDTH_DEFAULT
  }
}

export function writeBatteryBarWidth(width: number): void {
  try {
    localStorage.setItem(LS_WIDTH, String(Math.round(width)))
  } catch { /* ignore */ }
}

// ── localStorage 键 ────────────────────────────────────────────────────────────
const LS_ACTIVE_BIG_LABEL = 'battery-bar-active-big-label'
// 收起的小标签集合：{ [bigLabel]: string[] }。语义为「已折叠」（默认展开，
// 入集合即收起）；旧键 battery-bar-open-small-labels 语义不一致已废弃。
const LS_COLLAPSED_SMALL_MAP = 'battery-bar-collapsed-small-labels'
const LS_VSCROLL_TOP_MAP = 'battery-bar-vscroll-top'           // { [activeBigLabels|__search__|__all__]: number }
// 大标签拖拽排序：按模式分桶持久化 { develop: string[], templates: string[] }。
// develop 与 templates 的大标签集合不同，必须各存各的，互不污染。
const LS_BIG_LABEL_ORDER = 'battery-bar-big-label-order'

export type BatteryFilterMode = 'develop' | 'templates'

export function readBigLabelOrder(mode: BatteryFilterMode): string[] {
  try {
    const raw = localStorage.getItem(LS_BIG_LABEL_ORDER)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return []
    const arr = (parsed as Record<string, unknown>)[mode]
    return Array.isArray(arr) ? arr.filter(x => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function writeBigLabelOrder(mode: BatteryFilterMode, labels: string[]): void {
  try {
    const raw = localStorage.getItem(LS_BIG_LABEL_ORDER)
    let map: Record<string, string[]> = {}
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        map = parsed as Record<string, string[]>
      }
    }
    map[mode] = labels
    localStorage.setItem(LS_BIG_LABEL_ORDER, JSON.stringify(map))
  } catch { /* ignore */ }
}

export function readActiveBigLabels(): string[] {
  try {
    const raw = localStorage.getItem(LS_ACTIVE_BIG_LABEL)
    if (!raw) return []
    if (raw.trim().startsWith('[')) {
      const parsed = JSON.parse(raw) as unknown
      return Array.isArray(parsed) ? parsed.filter(x => typeof x === 'string') : []
    }
    return [raw]
  } catch {
    return []
  }
}

export function writeActiveBigLabels(labels: string[]): void {
  try {
    if (labels.length === 0) {
      localStorage.removeItem(LS_ACTIVE_BIG_LABEL)
    } else {
      localStorage.setItem(LS_ACTIVE_BIG_LABEL, JSON.stringify(labels))
    }
  } catch { /* ignore */ }
}

export function readCollapsedSmallMap(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(LS_COLLAPSED_SMALL_MAP)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const out: Record<string, string[]> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (Array.isArray(v)) out[k] = v.filter(x => typeof x === 'string')
    }
    return out
  } catch {
    return {}
  }
}

export function writeCollapsedSmallMap(map: Record<string, string[]>): void {
  try {
    localStorage.setItem(LS_COLLAPSED_SMALL_MAP, JSON.stringify(map))
  } catch { /* ignore */ }
}

export function readVScrollMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(LS_VSCROLL_TOP_MAP)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

export function writeVScrollSlot(key: string, top: number): void {
  try {
    const map = readVScrollMap()
    map[key] = Math.round(top)
    localStorage.setItem(LS_VSCROLL_TOP_MAP, JSON.stringify(map))
  } catch { /* ignore */ }
}

export function vScrollKey(searchQuery: string): string {
  if (searchQuery.trim()) return '__search__'
  return '__all__'
}

// Unit-separator (U+001F) joins big/small label into a single overlay key.
const SMALL_GROUP_KEY_SEP = String.fromCharCode(0x1f)

export function smallGroupKey(bigLabel: string, smallLabel: string): string {
  return `${bigLabel}${SMALL_GROUP_KEY_SEP}${smallLabel}`
}

export function parseSmallGroupKey(key: string): { bigLabel: string; smallLabel: string } | null {
  const idx = key.indexOf(SMALL_GROUP_KEY_SEP)
  if (idx < 0) return null
  return { bigLabel: key.slice(0, idx), smallLabel: key.slice(idx + SMALL_GROUP_KEY_SEP.length) }
}
