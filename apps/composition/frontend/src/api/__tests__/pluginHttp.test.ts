import { describe, expect, it } from 'vitest'
import { launcherFxPrefixFromPathname, pluginUrl, pluginWsUrl } from '../pluginHttp'

describe('launcherFxPrefixFromPathname', () => {
  it('extracts the embed prefix from launcher URLs', () => {
    expect(launcherFxPrefixFromPathname('/__fx/scene_generator/')).toBe('/__fx/scene_generator')
    expect(launcherFxPrefixFromPathname('/__fx/scene_generator/?pane=center')).toBe('/__fx/scene_generator')
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
      value: { ...prev, pathname: '/__fx/scene_generator/' },
    })
    try {
      expect(pluginUrl('/api/v1/projects/main/batch')).toBe(
        '/__fx/scene_generator/api/v1/projects/main/batch',
      )
      expect(pluginUrl('/ws')).toBe('/__fx/scene_generator/ws')
    } finally {
      Object.defineProperty(globalThis, 'location', { configurable: true, value: prev })
    }
  })
})

describe('pluginUrl under stock Studio /extensions/', () => {
  it('keeps /api/v1 on the host origin and bridges /ws to /ws/editor', () => {
    const prev = globalThis.location
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: {
        ...prev,
        pathname: '/extensions/scene-generator/',
        origin: 'https://studio.example',
      },
    })
    try {
      expect(pluginUrl('/api/v1/projects')).toBe('/api/v1/projects')
      expect(pluginUrl('/ws')).toBe('/ws/editor')
      expect(pluginWsUrl('/ws')).toBe('wss://studio.example/ws/editor')
    } finally {
      Object.defineProperty(globalThis, 'location', { configurable: true, value: prev })
    }
  })
})


describe('explicit WebSocket bases', () => {
  it('preserves absolute and launcher bases without a browser location for absolute URLs', () => {
    expect(pluginWsUrl('/ws', 'https://scene.example/')).toBe('wss://scene.example/ws')
  })
})
