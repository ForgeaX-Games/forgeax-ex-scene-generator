/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest'
import { paneUrl } from '../paneUrls'

describe('paneUrl', () => {
  const original = window.location.href

  afterEach(() => {
    window.history.replaceState({}, '', original)
  })

  it('forwards slug, projectId, and locale from the host URL into child panes', () => {
    window.history.replaceState({}, '', '/scene/?pane=center&slug=demo-game&projectId=p1&locale=zh-CN&extra=1')
    expect(paneUrl('renderer')).toBe('/scene/?pane=renderer&slug=demo-game&projectId=p1&locale=zh-CN')
  })

  it('works when host has no slug', () => {
    window.history.replaceState({}, '', '/scene/?pane=center')
    expect(paneUrl('renderer')).toBe('/scene/?pane=renderer')
  })
})
