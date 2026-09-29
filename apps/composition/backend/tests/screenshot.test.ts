import { describe, it, expect, beforeEach } from 'vitest'
import { setTimeout as delay } from 'node:timers/promises'
import { getScreenshotService } from '../src/agent/screenshot.service.js'
import { buildApp } from '../src/main.js'
import { SCREENSHOT_DISABLED_BODY, setScreenshotEnabled } from '../src/agent/routes.js'

describe('screenshot-disabled copy', () => {
  it('tells the agent to look at Default instead of delivering from verify', () => {
    expect(SCREENSHOT_DISABLED_BODY.nextAction).toContain('Look at Default')
    expect(SCREENSHOT_DISABLED_BODY.message).toContain('not visual acceptance')
    expect(JSON.stringify(SCREENSHOT_DISABLED_BODY)).not.toMatch(
      /do not use the browser|without visual review|deliver without visual/i,
    )
  })
})

describe('screenshot service', () => {
  it('createCapture resolves when resolveCapture is called', async () => {
    const svc = getScreenshotService()
    const { captureId, promise } = svc.createCapture(2000)
    const ok = svc.resolveCapture(captureId, { captureId, dataUrl: 'data:image/png;base64,AA==', width: 1, height: 1, capturedAt: new Date().toISOString() })
    expect(ok).toBe(true)
    const rec = await promise
    expect(rec.width).toBe(1)
    expect(svc.getLatest()?.captureId).toBe(captureId)
  })
  it('rejects on timeout', async () => {
    const { promise } = getScreenshotService().createCapture(20)
    await expect(promise).rejects.toThrow('timeout')
  })
  it('resolveCapture returns false for an unknown id', () => {
    expect(getScreenshotService().resolveCapture('nope', { captureId: 'nope', dataUrl: '', width: 0, height: 0, capturedAt: '' })).toBe(false)
  })
})

describe('screenshot routes', () => {
  beforeEach(() => {
    setScreenshotEnabled(false)
  })

  async function enableScreenshot(app: Awaited<ReturnType<typeof buildApp>>): Promise<void> {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/screenshot/config',
      payload: { enabled: true },
    })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toEqual({ ok: true, enabled: true })
  }
  it('store 404/ok=false for an unknown captureId', async () => {
    const app = await buildApp()
    const r = await app.inject({ method: 'POST', url: '/api/v1/agent/screenshot/store',
      payload: { captureId: 'nope', dataUrl: 'data:image/png;base64,AA==', width: 1, height: 1 } })
    expect(r.json()).toMatchObject({ ok: false })
    await app.close()
  })

  it('capture times out (504) when no renderer is connected', async () => {
    const app = await buildApp()
    await enableScreenshot(app)
    const r = await app.inject({ method: 'POST', url: '/api/v1/agent/screenshot/capture', payload: { timeout: 50 } })
    expect(r.statusCode).toBe(504)
    await app.close()
  })

  it('rejects a project-bound capture before broadcasting the wrong or empty frame', async () => {
    const app = await buildApp()
    await enableScreenshot(app)
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/screenshot/capture',
      payload: { projectId: 'lake-city', timeout: 50 },
    })
    expect(r.statusCode).toBe(409)
    expect(r.json()).toEqual(expect.objectContaining({
      status: 'rejected',
      code: 'screenshot-project-not-ready',
      projectId: 'lake-city',
      nextAction: expect.stringContaining('scene:script.commitProject'),
    }))
    await app.close()
  })

  it('capture resolves 200 when a real WS client stores the broadcast captureId', async () => {
    const app = await buildApp()
    await enableScreenshot(app)
    await app.listen({ port: 0, host: '127.0.0.1' })
    const addr = app.server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    const { WebSocket } = await import('ws')
    const sock = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    await new Promise<void>((res) => sock.on('open', () => res()))

    // The renderer receives screenshot:request{captureId} over WS, then POSTs /store.
    const stored = new Promise<void>((res) => {
      sock.on('message', async (raw: Buffer) => {
        const msg = JSON.parse(raw.toString())
        if (msg.event !== 'screenshot:request') return
        await app.inject({ method: 'POST', url: '/api/v1/agent/screenshot/store',
          payload: { captureId: msg.payload.captureId, dataUrl: 'data:image/png;base64,AA==', width: 2, height: 3 } })
        res()
      })
    })

    const capPromise = app.inject({ method: 'POST', url: '/api/v1/agent/screenshot/capture', payload: { timeout: 3000 } })
    await stored
    const r = await capPromise
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ width: 2, height: 3 })
    // Agent view persists the PNG to disk and returns a path — NOT the base64
    // dataUrl (which would dump KBs of text into the model context).
    expect(r.json().path).toMatch(/\.png$/)
    expect(r.json().dataUrl).toBeUndefined()

    // /latest reflects the stored screenshot.
    const latest = await app.inject({ method: 'GET', url: '/api/v1/agent/screenshot/latest' })
    expect(latest.statusCode).toBe(200)
    expect(latest.json()).toMatchObject({ width: 2, height: 3 })
    expect(latest.json().path).toMatch(/\.png$/)
    expect(latest.json().dataUrl).toBeUndefined()

    sock.close()
    await delay(20)
    await app.close()
  })

  it('accepts the Studio host-bridged /ws/editor socket', async () => {
    const app = await buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const addr = app.server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    const { WebSocket } = await import('ws')
    const sock = new WebSocket(`ws://127.0.0.1:${port}/ws/editor`)
    await new Promise<void>((res, rej) => {
      sock.on('open', () => res())
      sock.on('error', rej)
    })
    sock.close()
    await delay(20)
    await app.close()
  })

  it('supports toggling screenshot capability on and off', async () => {
    const app = await buildApp()

    // 1. Initial state is disabled
    const cfg1 = await app.inject({ method: 'GET', url: '/api/v1/agent/screenshot/config' })
    expect(cfg1.statusCode).toBe(200)
    expect(cfg1.json()).toEqual({ enabled: false })

    const info1 = await app.inject({ method: 'GET', url: '/api/v1/agent/renderer/info' })
    expect(info1.statusCode).toBe(200)
    expect(info1.json().screenshot).toEqual({ enabled: false })

    const capDisabled = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/screenshot/capture',
      payload: { timeout: 1000 },
    })
    expect(capDisabled.statusCode).toBe(403)
    expect(capDisabled.json()).toEqual(expect.objectContaining({
      status: 'disabled',
      code: 'screenshot-disabled',
      enabled: false,
      error: expect.stringContaining('disabled'),
      nextAction: expect.stringContaining('Look at Default'),
    }))

    const latestDisabled = await app.inject({ method: 'GET', url: '/api/v1/agent/screenshot/latest' })
    expect(latestDisabled.statusCode).toBe(403)
    expect(latestDisabled.json()).toEqual({ enabled: false, error: 'screenshot capability is disabled' })

    // 2. Enable screenshot
    await enableScreenshot(app)

    const infoEnabled = await app.inject({ method: 'GET', url: '/api/v1/agent/renderer/info' })
    expect(infoEnabled.json().screenshot).toEqual({ enabled: true })

    // 3. Disable again
    const toggleOff = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/screenshot/config',
      payload: { enabled: false },
    })
    expect(toggleOff.statusCode).toBe(200)
    expect(toggleOff.json()).toEqual({ ok: true, enabled: false })

    await app.close()
  }, 20_000)
})
