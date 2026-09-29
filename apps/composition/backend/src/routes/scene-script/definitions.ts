import type { FastifyInstance } from 'fastify'

import { SCENE_SCRIPT_PREFIX, type ProjectParams } from './types.js'

export function registerSceneScriptDefinitionRoutes(app: FastifyInstance): void {
  const prefix = SCENE_SCRIPT_PREFIX
  app.post<{
    Params: ProjectParams & { functionName: string }
  }>(`${prefix}/definitions/:functionName/instantiate`, async (_req, reply) => {
    return reply.code(410).send({
      status: 'rejected',
      code: 'scene-define-group-removed',
      reason: 'Native defineGroup instantiation is gone. Import another .scene.ts module instead.',
    })
  })
}
