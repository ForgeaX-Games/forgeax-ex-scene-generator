// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  EDITOR_OPACITY_MIN,
  LS_EDITOR,
  LS_EDITOR_INLINE_LEGACY,
  LS_RENDERER,
  LS_SIDEBAR_WIDTH_LEGACY,
  LS_WORKBENCH_HEIGHT_LEGACY,
  clampEditorSurfaceOpacity,
  isDefaultWorkspaceLayout,
  restoreDefaultWorkspace,
} from '../workbenchLayout'
import { DEFAULT_DRAWER_WIDTH, PREVIEW_DRAWER_WIDTH_KEY } from '../../surfaces/previewDrawerLayout'

beforeEach(() => localStorage.clear())
afterEach(() => localStorage.clear())

describe('workbenchLayout', () => {
  it('clamps editor opacity to the Bundle-supported 20–100% range', () => {
    expect(EDITOR_OPACITY_MIN).toBe(20)
    expect(clampEditorSurfaceOpacity(20)).toBe(20)
    expect(clampEditorSurfaceOpacity(92)).toBe(92)
    expect(clampEditorSurfaceOpacity(150)).toBe(100)
  })

  it('restores default workspace without touching unrelated keys', () => {
    localStorage.setItem(LS_RENDERER, 'false')
    localStorage.setItem(LS_EDITOR, 'true')
    localStorage.setItem(PREVIEW_DRAWER_WIDTH_KEY, '360')
    localStorage.setItem(LS_EDITOR_INLINE_LEGACY, 'true')
    localStorage.setItem(LS_SIDEBAR_WIDTH_LEGACY, '293')
    localStorage.setItem(LS_WORKBENCH_HEIGHT_LEGACY, '50')
    localStorage.setItem('forgeax.locale', 'zh')
    localStorage.setItem('wb-scene-generator.controls-heights', '{"nodeInfo":170}')

    const layout = restoreDefaultWorkspace()

    expect(layout.rendererVisible).toBe(true)
    expect(layout.editorVisible).toBe(true)
    expect(layout.previewDrawerWidth).toBe(DEFAULT_DRAWER_WIDTH)
    expect(localStorage.getItem(LS_RENDERER)).toBe('true')
    expect(localStorage.getItem(LS_EDITOR)).toBe('true')
    expect(localStorage.getItem(PREVIEW_DRAWER_WIDTH_KEY)).toBe(String(DEFAULT_DRAWER_WIDTH))
    expect(localStorage.getItem(LS_EDITOR_INLINE_LEGACY)).toBeNull()
    expect(localStorage.getItem(LS_SIDEBAR_WIDTH_LEGACY)).toBeNull()
    expect(localStorage.getItem(LS_WORKBENCH_HEIGHT_LEGACY)).toBeNull()
    expect(localStorage.getItem('forgeax.locale')).toBe('zh')
    expect(localStorage.getItem('wb-scene-generator.controls-heights')).toBe('{"nodeInfo":170}')
    expect(isDefaultWorkspaceLayout()).toBe(true)
  })

  it('detects non-default layout state', () => {
    localStorage.setItem(LS_RENDERER, 'false')
    expect(isDefaultWorkspaceLayout()).toBe(false)
  })
})
