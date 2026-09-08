import type { FastifyInstance } from 'fastify'
import { createReadStream } from 'node:fs'
import { extname } from 'node:path'
import { getPbrMaterial, listPbrMaterials, resolvePbrMapPath } from './service.js'

function mimeFor(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.bmp':
      return 'image/bmp'
    default:
      return 'image/png'
  }
}

export async function registerMaterialsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/materials', async () => ({ items: listPbrMaterials() }))

  app.get<{ Params: { name: string } }>('/api/v1/materials/:name', async (req, reply) => {
    const detail = getPbrMaterial(req.params.name)
    if (!detail) return reply.code(404).send({ error: 'material_not_found' })
    return detail
  })

  app.get<{ Params: { name: string; slot: string } }>(
    '/api/v1/materials/:name/maps/:slot',
    async (req, reply) => {
      const path = resolvePbrMapPath(req.params.name, req.params.slot)
      if (!path) return reply.code(404).send({ error: 'map_not_found' })
      reply.header('Content-Type', mimeFor(path))
      reply.header('Cache-Control', 'public, max-age=86400')
      return reply.send(createReadStream(path))
    },
  )
}
