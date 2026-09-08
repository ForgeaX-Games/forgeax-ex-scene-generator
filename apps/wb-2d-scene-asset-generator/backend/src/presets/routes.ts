import type { FastifyInstance } from 'fastify'
import { createPreset, deletePreset, listPresets } from './store.js'

interface CreateBody {
  title?: string
  text?: string
}

export async function registerPresetRoutes(app: FastifyInstance): Promise<void> {
  // List all text presets (built-in + user, user wins on id collision).
  app.get('/api/v1/presets', async () => {
    return { presets: listPresets() }
  })

  // Create a user preset (one new file under the workspace).
  app.post('/api/v1/presets', { bodyLimit: 2 * 1024 * 1024 }, async (req, reply) => {
    const body = (req.body ?? {}) as CreateBody
    const text = typeof body.text === 'string' ? body.text : ''
    if (!text.trim()) return reply.code(400).send({ error: 'missing text' })
    return createPreset({ text, ...(typeof body.title === 'string' ? { title: body.title } : {}) })
  })

  // Delete a user preset by id (built-in presets cannot be deleted).
  app.delete('/api/v1/presets/:id', async (req, reply) => {
    const params = req.params as { id?: string }
    const id = params.id?.trim()
    if (!id) return reply.code(400).send({ error: 'missing id' })
    const res = deletePreset(id)
    if (!res.ok) {
      const code = res.reason === 'preset not found' ? 404 : 409
      return reply.code(code).send({ error: res.reason })
    }
    return { ok: true }
  })
}
