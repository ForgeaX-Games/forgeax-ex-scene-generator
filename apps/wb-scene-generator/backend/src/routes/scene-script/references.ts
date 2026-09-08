import type { FastifyInstance } from 'fastify'

import { COASTAL_REFERENCE_TOPICS, loadCoastalReference } from '../../scene-script/references/coastalCatalog.js'
import { SCENE_SCRIPT_PREFIX, type ProjectParams } from './types.js'

export function registerSceneScriptReferenceRoutes(app: FastifyInstance): void {
  const handler = async (req: { query?: { topic?: string } }, reply: { code: (status: number) => { send: (payload: unknown) => unknown } }) => {
    const topic = req.query?.topic
    if (typeof topic !== 'string' || !topic.trim()) {
      return reply.code(400).send({
        reason: 'topic is required',
        topics: COASTAL_REFERENCE_TOPICS,
      })
    }
    const payload = await loadCoastalReference(topic.trim())
    if (payload.status === 'rejected') return reply.code(400).send(payload)
    return payload
  }

  app.get<{ Querystring: { topic?: string } }>('/api/v1/scene-script/references', handler)
  app.get<{ Params: ProjectParams; Querystring: { topic?: string } }>(
    `${SCENE_SCRIPT_PREFIX}/references`,
    handler,
  )
}
