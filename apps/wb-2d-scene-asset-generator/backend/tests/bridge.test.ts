import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { buildApp } from '../src/main.js'

let app: Awaited<ReturnType<typeof buildApp>>
let projectRoot: string
const MAIN = '/api/v1/projects/main'
beforeAll(async () => {
  projectRoot = mkdtempSync(join(tmpdir(), 'wb-asset2d-test-'))
  process.env.FORGEAX_PROJECT_ROOT = projectRoot
  app = await buildApp()
})
afterAll(async () => {
  await app.close()
  rmSync(projectRoot, { recursive: true, force: true })
})

describe('bridge REST', () => {
  it('GET /health → ok', async () => {
    const r = await app.inject({ method: 'GET', url: '/health' })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ status: 'ok' })
  })
  it('GET /api/v1/ops → includes common relu category', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/ops' })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toContainEqual(expect.objectContaining({
      id: 'relu',
      category: 'common/number',
      type: 'common',
    }))
  })

  it('GET /api/v1/ops → exposes migrated image battery metadata', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/ops' })
    expect(r.statusCode).toBe(200)
    const resize = (r.json() as Array<{
      id: string
      inputs: Array<{ name: string; type: string; access?: string }>
      outputs: Array<{ name: string; type: string; access?: string }>
    }>).find((op) => op.id === 'image_resize')

    expect(resize?.inputs.find((p) => p.name === 'image')).toMatchObject({
      type: 'image',
      access: 'item',
    })
    expect(resize?.outputs.find((p) => p.name === 'image')).toMatchObject({
      type: 'image',
      access: 'item',
    })
  })

  it('POST /api/v1/projects/:id/batch creates a node, GET /nodes returns it', async () => {
    const ops = [{ type: 'createNode', nodeId: 'n1', opId: 'relu', position: { x: 0, y: 0 }, params: { value: 5 } }]
    const post = await app.inject({ method: 'POST', url: `${MAIN}/batch`, payload: { ops } })
    expect(post.json().status).toBe('ok')
    const nodes = await app.inject({ method: 'GET', url: `${MAIN}/nodes` })
    expect(nodes.json().some((n: { id: string }) => n.id === 'n1')).toBe(true)
  })
})

describe('execute', () => {
  it('POST /api/v1/projects/:id/execute runs the pipeline and reports completed', async () => {
    await app.inject({ method: 'POST', url: `${MAIN}/batch`, payload: { ops: [
      { type: 'createNode', nodeId: 'e1', opId: 'relu', position: { x: 0, y: 0 }, params: { value: 7 } },
    ] } })
    const r = await app.inject({ method: 'POST', url: `${MAIN}/execute`, payload: {} })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ status: 'completed' })
  })
})

describe('ws', () => {
  it('forwards runtime events after subscribe', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' })
    const addr = app.server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    const { WebSocket } = await import('ws')
    const received: unknown[] = []
    const sock = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    await new Promise<void>((res) => sock.on('open', () => res()))
    sock.on('message', (d: Buffer) => received.push(JSON.parse(d.toString())))
    sock.send(JSON.stringify({ action: 'subscribe', channels: ['graph', 'execution'] }))
    await delay(50)
    // applyBatch emits no event to subscribers, but executeNode emits exec:* on
    // the execution channel — so trigger a run and observe a real forwarded event.
    await app.inject({ method: 'POST', url: `${MAIN}/batch`, payload: { ops: [
      { type: 'createNode', nodeId: 'wsN', opId: 'relu', position: { x: 0, y: 0 }, params: { value: 1 } },
    ] } })
    await app.inject({ method: 'POST', url: `${MAIN}/execute`, payload: {} })
    await delay(100)
    sock.close()
    expect(received.length).toBeGreaterThan(0)
    expect(received).toContainEqual(
      expect.objectContaining({
        event: 'runtime',
        payload: expect.objectContaining({ kind: 'exec:completed' }),
      }),
    )
  })
})
