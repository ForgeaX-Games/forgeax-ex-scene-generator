import type { FastifyInstance } from 'fastify'
import { exportProjectPack, type PackExportOptions } from './service.js'
import { resolvePackSchemaVersion } from './inputs.js'

export async function registerPackExportRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/pack-export/cook', async (req, reply) => {
    const body = (req.body ?? {}) as PackExportOptions
    try {
      return await exportProjectPack({ ...body, schemaVersion: resolvePackSchemaVersion(body.schemaVersion) })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.code(400).send({ error: message })
    }
  })

  app.post<{ Params: { projectId: string } }>(
    '/api/v1/projects/:projectId/pack-export/cook',
    async (req, reply) => {
      const body = (req.body ?? {}) as PackExportOptions
      try {
        return await exportProjectPack({ ...body, schemaVersion: resolvePackSchemaVersion(body.schemaVersion), projectId: req.params.projectId })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return reply.code(400).send({ error: message })
      }
    },
  )
}
