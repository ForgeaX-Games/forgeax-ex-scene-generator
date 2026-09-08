import { describe, it, expect } from 'vitest'
import { setTimeout as delay } from 'node:timers/promises'
import { getScreenshotService } from '@forgeax/editor-host/backend'
import { buildApp } from '../src/main.js'

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
  it('store 404/ok=false for an unknown captureId', async () => {
    const app = await buildApp()
    const r = await app.inject({ method: 'POST', url: '/api/v1/agent/screenshot/store',
      payload: { captureId: 'nope', dataUrl: 'data:image/png;base64,AA==', width: 1, height: 1 } })
    expect(r.json()).toMatchObject({ ok: false })
    await app.close()
  })

  it('capture times out (504) when no renderer is connected', async () => {
    const app = await buildApp()
    const r = await app.inject({ method: 'POST', url: '/api/v1/agent/screenshot/capture', payload: { timeout: 50 } })
    expect(r.statusCode).toBe(504)
    await app.close()
  })

  it('capture resolves 200 when a real WS client stores the broadcast captureId', async () => {
    const app = await buildApp()
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
})
