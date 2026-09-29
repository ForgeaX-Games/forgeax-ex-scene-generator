import type { FastifyReply, FastifyRequest } from 'fastify'
import { broadcastToClients } from '../ws.js'
import type { ProjectParams } from './types.js'

/** Publish only after the source transaction and its successful response complete. */
export async function notifySceneProjectChanged(
  request: FastifyRequest<{ Params: ProjectParams }>,
  reply: FastifyReply,
): Promise<void> {
  if (reply.statusCode < 200 || reply.statusCode >= 300) return
  broadcastToClients({
    event: 'scene:project-changed',
    payload: { projectId: request.params.projectId },
  })
}
