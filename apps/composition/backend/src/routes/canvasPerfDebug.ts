import type { FastifyInstance } from 'fastify'
import {
  isCanvasPerfDebugEnabled,
  logHttpRequest,
  markViewportEvent,
} from '../lib/canvasPerfDebug.js'

declare module 'fastify' {
  interface FastifyRequest {
    _canvasPerfStart?: number
  }
}

function payloadByteLength(payload: unknown): number {
  if (payload === undefined || payload === null) return 0
  if (typeof payload === 'string') return Buffer.byteLength(payload, 'utf8')
  if (Buffer.isBuffer(payload)) return payload.length
  if (payload instanceof Uint8Array) return payload.byteLength
  try {
    return Buffer.byteLength(JSON.stringify(payload), 'utf8')
  } catch {
    return 0
  }
}

export async function registerCanvasPerfDebugRoutes(app: FastifyInstance): Promise<void> {
  if (!isCanvasPerfDebugEnabled()) return

  app.addHook('onRequest', (req, _reply, done) => {
    req._canvasPerfStart = performance.now()
    done()
  })

  app.addHook('onSend', (req, reply, payload, done) => {
    const start = req._canvasPerfStart
    if (start === undefined) {
      done()
      return
    }
    const ms = performance.now() - start
    const url = req.url
    // Skip the viewport marker itself to avoid noise.
    if (!url.includes('/api/v1/debug/canvas/viewport')) {
      logHttpRequest(req.method, url, reply.statusCode, ms, payloadByteLength(payload))
    }
    done()
  })

  app.post<{
    Body: {
      phase?: 'start' | 'move' | 'end'
      zoom?: number
      x?: number
      y?: number
      t?: number
    }
  }>('/api/v1/debug/canvas/viewport', async (req, reply) => {
    const body = req.body ?? {}
    const phase = body.phase
    if (phase !== 'start' && phase !== 'move' && phase !== 'end') {
      return reply.code(400).send({ error: 'phase must be start | move | end' })
    }
    markViewportEvent({
      phase,
      zoom: typeof body.zoom === 'number' ? body.zoom : undefined,
      x: typeof body.x === 'number' ? body.x : undefined,
      y: typeof body.y === 'number' ? body.y : undefined,
      clientT: typeof body.t === 'number' ? body.t : undefined,
    })
    return { ok: true }
  })
}
