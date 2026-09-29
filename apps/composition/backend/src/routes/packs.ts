import type { FastifyInstance } from 'fastify'

import { listPacks } from '../packs/registry.js'

export async function registerPackRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/packs', async () => ({ packs: await listPacks() }))
}
