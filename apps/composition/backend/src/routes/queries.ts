import type { FastifyInstance } from 'fastify'
import { registerProjectPipelineRoutes } from './projectPipeline.js'
import { getPipeline } from '@forgeax/node-runtime'
import { getProjectRegistry, getRuntimeForProject } from '../runtime.js'
import { getBatteryCategories } from './batteryCategories.js'
import { logOutputFetch, logPersistBatch } from '../lib/persistTrace.js'
import { pipelineHashOnly, summarizePipeline } from '../pipeline-summary.js'
import { handleAuthoringRuntimeBatch } from '../scene-script/adapter/runtimeBatchAdapter.js'

export async function registerQueryRoutes(app: FastifyInstance): Promise<void> {
  await registerProjectPipelineRoutes(app, {
    getProjectRegistry,
    getRuntimeForProject,
    getBatteryCategories: async () =>
      (await getBatteryCategories()) as unknown as Map<string, Record<string, unknown>>,
    logOutputFetch,
    handleApplyBatch: handleAuthoringRuntimeBatch,
    logPersistBatch: (ops, result, meta) => {
      logPersistBatch(
        ops as never,
        result as never,
        meta as { actor?: string; label?: string; batchId?: string; durationMs: number },
      )
    },
  })

  app.get<{
    Params: { projectId: string }
    Querystring: { mode?: string; groupId?: string; nodeIds?: string; nameContains?: string; opIdIn?: string }
  }>(
    '/api/v1/projects/:projectId/pipeline/summary',
    async (req, reply) => {
      const { projectId } = req.params
      const reg = await getProjectRegistry()
      if (!reg.getProject(projectId)) return reply.code(404).send({ reason: `project not found: ${projectId}` })
      const snap = getPipeline(await getRuntimeForProject(projectId))
      if (req.query.mode === 'hash') return pipelineHashOnly(snap)
      const nodeIds = req.query.nodeIds?.split(',').map((s) => s.trim()).filter(Boolean)
      const opIdIn = req.query.opIdIn?.split(',').map((s) => s.trim()).filter(Boolean)
      return summarizePipeline(snap, {
        ...(req.query.groupId ? { groupId: req.query.groupId } : {}),
        ...(nodeIds?.length ? { nodeIds } : {}),
        ...(req.query.nameContains ? { nameContains: req.query.nameContains } : {}),
        ...(opIdIn?.length ? { opIdIn } : {}),
      })
    },
  )
}
