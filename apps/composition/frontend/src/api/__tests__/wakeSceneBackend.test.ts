import { afterEach, describe, expect, it, vi } from 'vitest'
import { wakeSceneBackend } from '../wakeSceneBackend'

describe('wakeSceneBackend', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns immediately when the host-proxied API is already up', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('/api/v1/projects')
      return new Response('[]', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    await wakeSceneBackend(1_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('asks the host to load tool-handlers when the API is down', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/tools/call')) {
        expect(init?.method).toBe('POST')
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      return new Response('offline', { status: 502 })
    })
    vi.stubGlobal('fetch', fetchMock)
    await wakeSceneBackend(10)
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/tools/call'))).toBe(true)
  })

  it('stops polling when aborted', async () => {
    const fetchMock = vi.fn(async () => new Response('offline', { status: 502 }))
    vi.stubGlobal('fetch', fetchMock)
    const abort = new AbortController()
    const pending = wakeSceneBackend(60_000, abort.signal)
    abort.abort()
    await pending
    expect(fetchMock.mock.calls.length).toBeLessThan(6)
  })
})
