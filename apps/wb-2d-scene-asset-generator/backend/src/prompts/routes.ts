import type { FastifyInstance } from 'fastify'
import { createPrompt, deletePrompt, listPrompts } from './store.js'

interface CreateBody {
  name?: string
  tag?: string
  template?: string
}

export async function registerPromptRoutes(app: FastifyInstance): Promise<void> {
  // List all prompts (built-in + user, user wins on id collision).
  app.get('/api/v1/prompts', async () => {
    return { prompts: listPrompts() }
  })

  // Create a user prompt (one new file under the workspace). The server parses
  // the `[placeholder]` names out of the template and stores them as `vars`.
  app.post('/api/v1/prompts', { bodyLimit: 2 * 1024 * 1024 }, async (req, reply) => {
    const body = (req.body ?? {}) as CreateBody
    const template = typeof body.template === 'string' ? body.template : ''
    if (!template.trim()) return reply.code(400).send({ error: 'missing template' })
    return createPrompt({
      template,
      ...(typeof body.name === 'string' ? { name: body.name } : {}),
      ...(typeof body.tag === 'string' ? { tag: body.tag } : {}),
    })
  })

  // Delete a user prompt by id (built-in prompts cannot be deleted).
  app.delete('/api/v1/prompts/:id', async (req, reply) => {
    const params = req.params as { id?: string }
    const id = params.id?.trim()
    if (!id) return reply.code(400).send({ error: 'missing id' })
    const res = deletePrompt(id)
    if (!res.ok) {
      const code = res.reason === 'prompt not found' ? 404 : 409
      return reply.code(code).send({ error: res.reason })
    }
    return { ok: true }
  })
}
