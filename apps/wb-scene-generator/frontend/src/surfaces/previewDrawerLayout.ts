// Preview-internal drawer width persistence (Page-compatible localStorage key).
// One-time migration from the transitional right-panel key
// `wb-scene-generator.renderer-layers-width`.

export const PREVIEW_DRAWER_WIDTH_KEY = 'wb-scene-generator.preview-drawer-width'
export const LEGACY_LAYERS_WIDTH_KEY = 'wb-scene-generator.renderer-layers-width'
const MIGRATION_FLAG_KEY = 'wb-scene-generator.preview-drawer-width-migrated'

export const DEFAULT_DRAWER_WIDTH = 220
export const MIN_DRAWER_WIDTH = 140
export const MAX_DRAWER_WIDTH = 520

/** Container-query cap: drawers never consume more than ~72% of preview width. */
export const DRAWER_WIDTH_CQ_RATIO = 0.72
export const DRAWER_WIDTH_CQ_MIN = 200
export const DRAWER_WIDTH_CQ_MAX = 292

export function clampDrawerWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_DRAWER_WIDTH
  return Math.max(MIN_DRAWER_WIDTH, Math.min(MAX_DRAWER_WIDTH, Math.round(width)))
}

export function effectiveDrawerWidth(userWidth: number, containerWidth: number): number {
  const clamped = clampDrawerWidth(userWidth)
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return clamped
  const responsiveCap = Math.max(
    DRAWER_WIDTH_CQ_MIN,
    Math.min(DRAWER_WIDTH_CQ_MAX, Math.round(containerWidth * DRAWER_WIDTH_CQ_RATIO)),
  )
  return Math.min(clamped, responsiveCap)
}

function readStoredWidth(key: string): number | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const n = Number.parseInt(raw, 10)
    return Number.isFinite(n) ? clampDrawerWidth(n) : null
  } catch {
    return null
  }
}

function writeStoredWidth(key: string, width: number): void {
  try {
    localStorage.setItem(key, String(clampDrawerWidth(width)))
  } catch { /* ignore quota / private mode */ }
}

/** Migrate legacy right-panel width once, then prefer the preview drawer key. */
export function loadPreviewDrawerWidth(): number {
  const migrated = (() => {
    try { return localStorage.getItem(MIGRATION_FLAG_KEY) === 'true' } catch { return false }
  })()
  const current = readStoredWidth(PREVIEW_DRAWER_WIDTH_KEY)
  if (current !== null) {
    if (!migrated) {
      try { localStorage.setItem(MIGRATION_FLAG_KEY, 'true') } catch { /* ignore */ }
    }
    return current
  }
  const legacy = readStoredWidth(LEGACY_LAYERS_WIDTH_KEY)
  const width = legacy ?? DEFAULT_DRAWER_WIDTH
  writeStoredWidth(PREVIEW_DRAWER_WIDTH_KEY, width)
  try { localStorage.setItem(MIGRATION_FLAG_KEY, 'true') } catch { /* ignore */ }
  return width
}

export function savePreviewDrawerWidth(width: number): void {
  writeStoredWidth(PREVIEW_DRAWER_WIDTH_KEY, width)
}
