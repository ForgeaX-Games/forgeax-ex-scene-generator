import { afterEach, describe, expect, it, vi } from 'vitest'
import { launcherFxPrefixFromPathname, pluginUrl, pluginWsUrl } from '../pluginHttp'

describe('scene websocket routing', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('uses the renderer proxy in Studio while HTTP stays at the API root', () => {
    vi.stubGlobal('location', { origin: 'https://studio.example', pathname: '/extensions/scene-generator/modules/composition/dist/index.html' })
    expect(pluginWsUrl()).toBe('wss://studio.example/ws/render')
    expect(pluginUrl('/api/v1/health')).toBe('/api/v1/health')
  })
  it('preserves standalone and launcher socket routes', () => {
    vi.stubGlobal('location', { origin: 'http://localhost:9556', pathname: '/' })
    expect(pluginWsUrl()).toBe('ws://localhost:9556/ws')
    vi.stubGlobal('location', { origin: 'https://studio.example', pathname: '/__fx/scene/' })
    expect(pluginWsUrl()).toBe('wss://studio.example/__fx/scene/ws')
  })
})

describe('launcherFxPrefixFromPathname', () => {
  it('extracts the embed prefix from launcher URLs', () => {
    expect(launcherFxPrefixFromPathname('/__fx/wb_scene_generator/')).toBe('/__fx/wb_scene_generator')
    expect(launcherFxPrefixFromPathname('/__fx/wb_scene_generator/?pane=center')).toBe('/__fx/wb_scene_generator')
  })

  it('returns empty for direct dev-server URLs', () => {
    expect(launcherFxPrefixFromPathname('/')).toBe('')
    expect(launcherFxPrefixFromPathname('/?pane=left')).toBe('')
  })
})

describe('pluginUrl under launcher embed', () => {
  it('prefixes API paths with /__fx/<id> when location is embedded', () => {
    const prev = globalThis.location
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { ...prev, pathname: '/__fx/wb_scene_generator/' },
    })
    try {
      expect(pluginUrl('/api/v1/projects/main/batch')).toBe(
        '/__fx/wb_scene_generator/api/v1/projects/main/batch',
      )
      expect(pluginUrl('/ws')).toBe('/__fx/wb_scene_generator/ws')
    } finally {
      Object.defineProperty(globalThis, 'location', { configurable: true, value: prev })
    }
  })
})
