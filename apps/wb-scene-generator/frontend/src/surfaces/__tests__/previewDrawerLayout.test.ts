// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_DRAWER_WIDTH,
  LEGACY_LAYERS_WIDTH_KEY,
  PREVIEW_DRAWER_WIDTH_KEY,
  clampDrawerWidth,
  effectiveDrawerWidth,
  loadPreviewDrawerWidth,
  savePreviewDrawerWidth,
} from '../previewDrawerLayout'

beforeEach(() => localStorage.clear())
afterEach(() => localStorage.clear())

describe('previewDrawerLayout', () => {
  it('clamps drawer width into the secure bounds', () => {
    expect(clampDrawerWidth(80)).toBe(140)
    expect(clampDrawerWidth(999)).toBe(520)
    expect(clampDrawerWidth(260)).toBe(260)
  })

  it('applies container-query cap for narrow previews', () => {
    expect(effectiveDrawerWidth(300, 320)).toBe(230)
    expect(effectiveDrawerWidth(220, 800)).toBe(220)
  })

  it('migrates legacy renderer-layers-width once', () => {
    localStorage.setItem(LEGACY_LAYERS_WIDTH_KEY, '280')
    expect(loadPreviewDrawerWidth()).toBe(280)
    expect(localStorage.getItem(PREVIEW_DRAWER_WIDTH_KEY)).toBe('280')
    localStorage.setItem(LEGACY_LAYERS_WIDTH_KEY, '140')
    expect(loadPreviewDrawerWidth()).toBe(280)
  })

  it('falls back to default when no stored width exists', () => {
    expect(loadPreviewDrawerWidth()).toBe(DEFAULT_DRAWER_WIDTH)
  })

  it('persists user-resized width', () => {
    savePreviewDrawerWidth(360)
    expect(localStorage.getItem(PREVIEW_DRAWER_WIDTH_KEY)).toBe('360')
    expect(loadPreviewDrawerWidth()).toBe(360)
  })
})
