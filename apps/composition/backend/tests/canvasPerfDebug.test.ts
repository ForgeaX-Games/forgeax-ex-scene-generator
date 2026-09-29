import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { registerCanvasPerfDebugRoutes } from '../src/routes/canvasPerfDebug.js'

describe('canvas perf debug', () => {
  let app: FastifyInstance
  const prev = process.env.FORGEAX_CANVAS_PERF_DEBUG

  beforeEach(async () => {
    process.env.FORGEAX_CANVAS_PERF_DEBUG = '1'
    app = Fastify({ logger: false })
    await registerCanvasPerfDebugRoutes(app)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
    if (prev === undefined) delete process.env.FORGEAX_CANVAS_PERF_DEBUG
    else process.env.FORGEAX_CANVAS_PERF_DEBUG = prev
  })

  it('accepts viewport phase markers', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/debug/canvas/viewport',
      payload: { phase: 'start', zoom: 1, x: 0, y: 0 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('rejects invalid phase', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/debug/canvas/viewport',
      payload: { phase: 'zoom' },
    })
    expect(res.statusCode).toBe(400)
  })
})
