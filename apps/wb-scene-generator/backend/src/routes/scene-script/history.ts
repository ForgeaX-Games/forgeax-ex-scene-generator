import type { FastifyInstance } from 'fastify'

import { getProjectDir } from '../../runtime.js'
import { ensureMutationAccess } from '../projects.js'
import { applyAuthoringHistory } from '../../scene-script/persist/transactionHistory.js'

import { SCENE_SCRIPT_PREFIX, type ProjectParams } from './types.js'

export function registerSceneScriptHistoryRoutes(app: FastifyInstance): void {
  const prefix = SCENE_SCRIPT_PREFIX
  app.post<{
    Params: ProjectParams
    Body: { expectedProjectRevision?: string }
  }>(`${prefix}/undo`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: `project not found: ${req.params.projectId}` })
    const access = await ensureMutationAccess(req, req.params.projectId)
    if (!access.ok) return reply.code(403).send(access)
    if (typeof req.body?.expectedProjectRevision !== 'string') {
      return reply.code(400).send({ reason: 'expectedProjectRevision is required' })
    }
    try {
      return await applyAuthoringHistory(
        req.params.projectId,
        projectDir,
        'undo',
        req.body.expectedProjectRevision,
      )
    } catch (error) {
      const item = error as Error & { code?: string; actualRevision?: string }
      const status = item.code === 'SCENE_REVISION_CONFLICT' || item.code === 'SCENE_HISTORY_DIVERGED'
        ? 409
        : item.code === 'SCENE_UNDO_EMPTY' ? 409 : 422
      return reply.code(status).send({
        status: 'rejected',
        code: item.code,
        reason: item.message,
        transaction: { applied: false, rolledBack: true },
        ...(item.actualRevision ? { actualProjectRevision: item.actualRevision } : {}),
      })
    }
  })

  app.post<{
    Params: ProjectParams
    Body: { expectedProjectRevision?: string }
  }>(`${prefix}/redo`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: `project not found: ${req.params.projectId}` })
    const access = await ensureMutationAccess(req, req.params.projectId)
    if (!access.ok) return reply.code(403).send(access)
    if (typeof req.body?.expectedProjectRevision !== 'string') {
      return reply.code(400).send({ reason: 'expectedProjectRevision is required' })
    }
    try {
      return await applyAuthoringHistory(
        req.params.projectId,
        projectDir,
        'redo',
        req.body.expectedProjectRevision,
      )
    } catch (error) {
      const item = error as Error & { code?: string; actualRevision?: string }
      const status = item.code === 'SCENE_REVISION_CONFLICT' || item.code === 'SCENE_HISTORY_DIVERGED'
        ? 409
        : item.code === 'SCENE_REDO_EMPTY' ? 409 : 422
      return reply.code(status).send({
        status: 'rejected',
        code: item.code,
        reason: item.message,
        transaction: { applied: false, rolledBack: true },
        ...(item.actualRevision ? { actualProjectRevision: item.actualRevision } : {}),
      })
    }
  })

}
