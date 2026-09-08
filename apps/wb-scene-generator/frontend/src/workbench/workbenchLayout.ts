// Plugin-scoped workbench layout persistence for Page v2.
// Page owns the outer sidebar/dock/locale; this module only manages keys inside
// the scene-generator center + left iframes.

import {
  DEFAULT_DRAWER_WIDTH,
  PREVIEW_DRAWER_WIDTH_KEY,
  LEGACY_LAYERS_WIDTH_KEY,
  clampDrawerWidth,
  loadPreviewDrawerWidth,
} from '../surfaces/previewDrawerLayout.js'

export const LS_RENDERER = 'wb-scene-generator.rendererInline'
export const LS_EDITOR = 'wb-scene-generator.editorFloatingVisible'

/** Pre-M02 vertically-split editor visibility — never read, only cleaned up. */
export const LS_EDITOR_INLINE_LEGACY = 'wb-scene-generator.editorInline'
/** Bundle center-column sidebar width — Page sidebar owns width now. */
export const LS_SIDEBAR_WIDTH_LEGACY = 'wb-scene-generator.sidebarWidth'
/** Old vertically-split resize height between preview and editor. */
export const LS_WORKBENCH_HEIGHT_LEGACY = 'wb-scene-generator.workbench-height'

export const OBSOLETE_LAYOUT_KEYS = [
  LS_EDITOR_INLINE_LEGACY,
  LS_SIDEBAR_WIDTH_LEGACY,
  LS_WORKBENCH_HEIGHT_LEGACY,
] as const

export const DEFAULT_RENDERER_VISIBLE = true
// Bundle keeps the editor mounted and starts only its floating card collapsed.
export const DEFAULT_EDITOR_VISIBLE = true

/**
 * Minimum floating-editor opacity (%).
 * This is the Bundle's range. Its editor canvas and sidebars use the same
 * alpha variable, so users can expose the live Preview without fading text
 * and controls as a single composited layer.
 */
export const EDITOR_OPACITY_MIN = 20
export const EDITOR_OPACITY_DEFAULT = EDITOR_OPACITY_MIN
export const EDITOR_OPACITY_MAX = 100

export type WorkspaceLayoutSnapshot = {
  rendererVisible: boolean
  editorVisible: boolean
  previewDrawerWidth: number
}

function readBool(key: string, fallback: boolean, storage: Pick<Storage, 'getItem'>): boolean {
  try {
    const raw = storage.getItem(key)
    return raw === null ? fallback : raw === 'true'
  } catch {
    return fallback
  }
}

export function clampEditorSurfaceOpacity(value: number): number {
  if (!Number.isFinite(value)) return EDITOR_OPACITY_DEFAULT
  return Math.max(EDITOR_OPACITY_MIN, Math.min(EDITOR_OPACITY_MAX, Math.round(value)))
}

export function resetPreviewDrawerWidth(storage: Pick<Storage, 'removeItem'> = localStorage): void {
  try {
    storage.removeItem(PREVIEW_DRAWER_WIDTH_KEY)
    storage.removeItem(LEGACY_LAYERS_WIDTH_KEY)
    storage.removeItem('wb-scene-generator.preview-drawer-width-migrated')
  } catch { /* ignore */ }
}

export function removeObsoleteLayoutKeys(storage: Pick<Storage, 'removeItem'> = localStorage): void {
  for (const key of OBSOLETE_LAYOUT_KEYS) {
    try { storage.removeItem(key) } catch { /* ignore */ }
  }
}

export function readWorkspaceLayout(
  storage: Pick<Storage, 'getItem'> = localStorage,
): WorkspaceLayoutSnapshot {
  return {
    rendererVisible: readBool(LS_RENDERER, DEFAULT_RENDERER_VISIBLE, storage),
    editorVisible: readBool(LS_EDITOR, DEFAULT_EDITOR_VISIBLE, storage),
    previewDrawerWidth: loadPreviewDrawerWidth(),
  }
}

export function isDefaultWorkspaceLayout(
  storage: Pick<Storage, 'getItem'> = localStorage,
): boolean {
  const rendererOk = readBool(LS_RENDERER, DEFAULT_RENDERER_VISIBLE, storage) === DEFAULT_RENDERER_VISIBLE
  const editorOk = readBool(LS_EDITOR, DEFAULT_EDITOR_VISIBLE, storage) === DEFAULT_EDITOR_VISIBLE
  let drawerOk = true
  try {
    const raw = storage.getItem(PREVIEW_DRAWER_WIDTH_KEY)
    drawerOk = raw === null || clampDrawerWidth(Number.parseInt(raw, 10)) === DEFAULT_DRAWER_WIDTH
  } catch {
    drawerOk = true
  }
  for (const key of OBSOLETE_LAYOUT_KEYS) {
    try {
      if (storage.getItem(key) !== null) return false
    } catch { /* ignore */ }
  }
  return rendererOk && editorOk && drawerOk
}

/** Reset plugin-owned layout keys to M02 defaults. Does not touch Page/locale/asset keys. */
export function restoreDefaultWorkspace(storage: Storage = localStorage): WorkspaceLayoutSnapshot {
  try { storage.setItem(LS_RENDERER, String(DEFAULT_RENDERER_VISIBLE)) } catch { /* ignore */ }
  try { storage.setItem(LS_EDITOR, String(DEFAULT_EDITOR_VISIBLE)) } catch { /* ignore */ }
  resetPreviewDrawerWidth(storage)
  removeObsoleteLayoutKeys(storage)
  return readWorkspaceLayout(storage)
}
