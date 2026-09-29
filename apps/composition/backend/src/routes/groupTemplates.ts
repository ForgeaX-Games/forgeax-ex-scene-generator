import type { FastifyInstance } from 'fastify'

const GONE = {
  status: 'rejected',
  reason: 'Group templates are not a Scene Script authoring door. Write and import .scene.ts modules.',
}

export async function registerGroupTemplateRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/group-templates', async () => [])
  app.get('/api/v1/group-templates/categories', async () => [])
  app.get('/api/v1/group-templates/template-categories', async () => [])
  app.get('/api/v1/group-templates/:id', async (_req, reply) => reply.code(410).send(GONE))
  app.get('/api/v1/group-templates/:id/docs', async (_req, reply) => reply.code(410).send(GONE))
  for (const url of [
    '/api/v1/group-templates/save',
    '/api/v1/group-templates/save-user',
    '/api/v1/group-templates/legacy/instantiate',
    '/api/v1/group-templates/:id/instantiate',
  ]) {
    app.post(url, async (_req, reply) => reply.code(410).send(GONE))
  }
  app.delete('/api/v1/group-templates/user/:id', async (_req, reply) => reply.code(410).send(GONE))
  app.delete('/api/v1/group-templates/groups/:id', async (_req, reply) => reply.code(410).send(GONE))
}
