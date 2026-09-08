import type { FastifyInstance } from 'fastify'
import { executeNode, type ExecuteNodeRequest } from '@forgeax/node-runtime'
import { getRuntimeForProject } from '../runtime.js'
import { ensureMutationAccess } from './projects.js'
import { EXECUTE_BODY_LIMIT } from './body-limits.js'
import { summarizeExecutionResult } from '../execution-summary.js'
import { withTimeout, executeTimeoutMs, TimeoutError } from '../services/timeout.js'

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

// `model.apply` has raced `handle.done` against `executeTimeoutMs()` since the
// "卡死治理" work (see services/timeout.ts) — a pathological CSG/gear/architecture
// bake can spin the synchronous OCCT WASM path for a very long time. These two
// routes awaited `handle.done` directly with NO such guard: a stuck execution
// here just hangs the HTTP response until the calling agent's own turn/host
// timeout gives up, which looks exactly like "the conversation suddenly cut
// off". Wrap both the same way model.apply does, and surface a clean, bounded
// timeout error instead of a silent hang.
export async function runWithTimeout(
  label: string,
  handleDone: Promise<unknown>,
): Promise<unknown> {
  const started = Date.now()
  try {
    return await withTimeout(handleDone, executeTimeoutMs(), label)
  } catch (e) {
    if (e instanceof TimeoutError) {
      return {
        executionId: '',
        status: 'timeout',
        error: { message: e.message },
        durationMs: Date.now() - started,
      }
    }
    throw e
  }
}

export async function registerExecuteRoutes(app: FastifyInstance): Promise<void> {
  const prefix = '/api/v1/projects/:projectId'

  app.post<{ Params: ProjectParams }>(`${prefix}/execute`, {
    bodyLimit: EXECUTE_BODY_LIMIT,
    schema: {
      body: {
        type: 'object',
        properties: { nodeId: { type: 'string' }, quietErrors: { type: 'boolean' } },
        additionalProperties: true,
      },
    },
  }, async (req, reply) => {
    const { projectId } = req.params
    const access = await ensureMutationAccess(req, projectId)
    if (!access.ok) return reply.code(403).send({ reason: access.reason, code: access.code, projectId: access.projectId })
    const handle = await executeNode(await getRuntimeForProject(projectId), parseExecuteBody(req.body))
    return runWithTimeout('pipeline.execute', handle.done)
  })

  app.post<{ Params: ProjectParams }>(`${prefix}/execute/summary`, {
    bodyLimit: EXECUTE_BODY_LIMIT,
    schema: {
      body: {
        type: 'object',
        properties: { nodeId: { type: 'string' }, quietErrors: { type: 'boolean' } },
        additionalProperties: true,
      },
    },
  }, async (req, reply) => {
    const { projectId } = req.params
    const access = await ensureMutationAccess(req, projectId)
    if (!access.ok) return reply.code(403).send({ reason: access.reason, code: access.code, projectId: access.projectId })
    const handle = await executeNode(await getRuntimeForProject(projectId), parseExecuteBody(req.body))
    const full = await runWithTimeout('pipeline.execute.summary', handle.done)
    return summarizeExecutionResult(full)
  })
}
