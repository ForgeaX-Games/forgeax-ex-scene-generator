/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setLocale } from '@forgeax/i18n'
import {
  STUDIO_LOCALE_KEY,
  ensureSceneI18n,
  sceneLoadingTaskLabel,
  sceneT,
} from '../sceneI18n.js'

beforeEach(() => {
  localStorage.clear()
  ensureSceneI18n()
})

afterEach(() => {
  localStorage.clear()
  setLocale('en')
})

describe('scene locale', () => {
  it('falls back to English when forgeax.locale is unset', () => {
    expect(sceneT('preview.title')).toBe('Scene Preview')
    expect(sceneT('workbench.title')).toBe('Scene Generator')
  })

  it('reads zh from forgeax.locale SSOT', () => {
    localStorage.setItem(STUDIO_LOCALE_KEY, 'zh')
    ensureSceneI18n()
    expect(sceneT('preview.title')).toBe('场景预览')
    expect(sceneT('controls.nodeInfo')).toBe('节点信息')
  })

  it('maps zh-CN variants to zh catalog entries', () => {
    localStorage.setItem(STUDIO_LOCALE_KEY, 'zh-CN')
    ensureSceneI18n()
    expect(sceneT('editor.title')).toBe('节点编辑器')
  })

  it('interpolates variables in catalog strings', () => {
    expect(sceneT('layers.deleteSelected', { count: 3 })).toBe('Delete (3)')
    localStorage.setItem(STUDIO_LOCALE_KEY, 'zh')
    ensureSceneI18n()
    expect(sceneT('layers.deleteSelected', { count: 2 })).toBe('删除（2）')
  })

  it('localizes renderer loading task labels', () => {
    expect(sceneLoadingTaskLabel('previews')).toBe('Node previews')
    localStorage.setItem(STUDIO_LOCALE_KEY, 'zh')
    ensureSceneI18n()
    expect(sceneLoadingTaskLabel('baked')).toBe('烘焙图层')
  })
})
