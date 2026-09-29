import type { FastifyInstance } from 'fastify'
import { exportProjectSceneToGlb, type ExportSceneGlbOptions } from './glbService.js'

export async function registerGlbExportRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/export/glb', async (req, reply) => {
    const body = (req.body ?? {}) as ExportSceneGlbOptions
    try {
      return await exportProjectSceneToGlb(body)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.code(400).send({ error: message })
    }
  })

  app.post<{ Params: { projectId: string } }>(
    '/api/v1/projects/:projectId/export/glb',
    async (req, reply) => {
      const body = (req.body ?? {}) as ExportSceneGlbOptions
      try {
        return await exportProjectSceneToGlb({ ...body, projectId: req.params.projectId })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return reply.code(400).send({ error: message })
      }
    },
  )
}
