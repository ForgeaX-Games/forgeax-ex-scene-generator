import type { FastifyInstance } from 'fastify'
import { createReadStream } from 'node:fs'
import { getObjectModel, listObjectModels, resolveObjectModelPath } from './service.js'

export async function registerObjectModelRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/models', async () => ({ items: listObjectModels() }))

  app.get<{ Params: { name: string } }>('/api/v1/models/:name', async (req, reply) => {
    const detail = getObjectModel(req.params.name)
    if (!detail) return reply.code(404).send({ error: 'model_not_found' })
    return detail
  })

  app.get<{ Params: { name: string } }>('/api/v1/models/:name/file', async (req, reply) => {
    const path = resolveObjectModelPath(req.params.name)
    if (!path) return reply.code(404).send({ error: 'model_file_not_found' })
    reply.header('Content-Type', 'model/gltf-binary')
    reply.header('Cache-Control', 'public, max-age=86400')
    return reply.send(createReadStream(path))
  })
}
