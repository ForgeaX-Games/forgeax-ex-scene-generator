// Batch mutations are registered via registerProjectPipelineRoutes in queries.ts.

import type { FastifyInstance } from 'fastify'

export async function registerMutationRoutes(_app: FastifyInstance): Promise<void> {
  // no-op — project-scoped POST /api/v1/projects/:projectId/batch
}
