import type { FastifyInstance } from 'fastify'
import { executeNode, type ExecuteNodeRequest } from '@forgeax/node-runtime'
import { getRuntimeForProject } from '../runtime.js'
import { ensureMutationAccess } from './projects.js'
import { summarizeExecutionResult } from '../execution-summary.js'

interface ProjectParams {
  projectId: string
}

function parseExecuteBody(body: unknown): ExecuteNodeRequest {
  const b = (body ?? {}) as { nodeId?: string; quietErrors?: boolean }
  return {
    ...(b.nodeId ? { nodeId: b.nodeId } : {}),
    ...(b.quietErrors ? { quietErrors: true } : {}),
  }
}

export async function registerExecuteRoutes(app: FastifyInstance): Promise<void> {
  const prefix = '/api/v1/projects/:projectId'

  app.post<{ Params: ProjectParams }>(`${prefix}/execute`, async (req, reply) => {
    const { projectId } = req.params
    const access = await ensureMutationAccess(req, projectId)
    if (!access.ok) return reply.code(403).send({ reason: access.reason, code: access.code, projectId: access.projectId })
    const handle = await executeNode(await getRuntimeForProject(projectId), parseExecuteBody(req.body))
    return handle.done
  })

  app.post<{ Params: ProjectParams }>(`${prefix}/execute/summary`, async (req, reply) => {
    const { projectId } = req.params
    const access = await ensureMutationAccess(req, projectId)
    if (!access.ok) return reply.code(403).send({ reason: access.reason, code: access.code, projectId: access.projectId })
    const handle = await executeNode(await getRuntimeForProject(projectId), parseExecuteBody(req.body))
    const full = await handle.done
    return summarizeExecutionResult(full)
  })
}
