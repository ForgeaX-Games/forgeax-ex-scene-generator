import type { FastifyInstance } from 'fastify'

import {
  DraftPreviewRequestError,
  sceneScriptDraftPreviews,
  type DraftPreviewFile,
} from '../../scene-script/draft/runtime.js'
import { ensureMutationAccess } from '../projects.js'
import { broadcastToClients } from '../ws.js'
import { SCENE_SCRIPT_PREFIX, type ProjectParams } from './types.js'

interface DraftPreviewBody {
  draftId?: string
  generation?: number
  files?: DraftPreviewFile[]
  entryFile?: string
  expectedProjectRevision?: string
  execute?: boolean
}

/**
 * Compile and optionally execute an isolated draft without mutating canonical
 * source, Runtime Graph, or transaction history.
 */
export function registerSceneScriptDraftPreviewRoutes(app: FastifyInstance): void {
  app.post<{ Params: ProjectParams; Body: DraftPreviewBody }>(
    `${SCENE_SCRIPT_PREFIX}/draft`,
    async (req, reply) => {
      const body = req.body
      if (typeof body?.draftId !== 'string'
        || !Array.isArray(body.files)
        || typeof body.entryFile !== 'string'
        || typeof body.expectedProjectRevision !== 'string'
        || typeof body.execute !== 'boolean') {
        return reply.code(400).send({
          status: 'rejected',
          code: 'draft-preview-invalid-request',
          reason: 'draftId, files, entryFile, expectedProjectRevision, and execute are required',
        })
      }
      const access = await ensureMutationAccess(req, req.params.projectId)
      if (!access.ok) return reply.code(403).send(access)
      try {
        const result = await sceneScriptDraftPreviews.preview({
          projectId: req.params.projectId,
          draftId: body.draftId,
          generation: body.generation,
          files: body.files,
          entryFile: body.entryFile,
          expectedProjectRevision: body.expectedProjectRevision,
          execute: body.execute,
        })
        const valid = result.status === 'compiled' || result.status === 'ok'
        const visible = result.status === 'ok'
        const previewRevision = valid ? result.previewRevision : result.retainedPreviewRevision
        const payload = {
          valid,
          status: valid ? 'visible' as const : 'failed' as const,
          phase: result.status,
          draftId: body.draftId,
          generation: result.generation,
          projectId: req.params.projectId,
          projectRevision: body.expectedProjectRevision,
          previewRevision: previewRevision ?? null,
          diagnostics: result.diagnostics,
          sync: {
            projectRevision: body.expectedProjectRevision,
            previewRevision: previewRevision ?? null,
            aligned: visible,
            ...(
              result.status === 'ok'
                ? {
                    executionId: result.execution.executionId,
                    executionStatus: result.execution.status,
                  }
                : {}
            ),
            staleReasons: result.status === 'stale' ? ['superseded-generation'] : [],
          },
          ...(!valid && result.retainedPreviewRevision
            ? {
                lastGood: {
                  draftId: body.draftId,
                  previewRevision: result.retainedPreviewRevision,
                  projectRevision: body.expectedProjectRevision,
                },
              }
            : {}),
        }
        broadcastToClients({
          event: 'scene-script:draft',
          payload: result.status === 'ok'
            ? { ...payload, render: result.render }
            : payload,
        })
        return reply.code(result.status === 'stale' ? 409 : 200).send(payload)
      } catch (error) {
        if (error instanceof DraftPreviewRequestError) {
          return reply.code(error.statusCode).send({
            status: 'rejected',
            code: error.code,
            reason: error.message,
            diagnostics: error.diagnostics,
          })
        }
        throw error
      }
    },
  )

  app.delete<{ Params: ProjectParams; Querystring: { draftId?: string } }>(
    `${SCENE_SCRIPT_PREFIX}/draft`,
    async (req, reply) => {
      if (typeof req.query.draftId !== 'string' || !req.query.draftId) {
        return reply.code(400).send({ reason: 'draftId is required' })
      }
      const access = await ensureMutationAccess(req, req.params.projectId)
      if (!access.ok) return reply.code(403).send(access)
      await sceneScriptDraftPreviews.cleanup(req.params.projectId, req.query.draftId)
      return reply.code(204).send()
    },
  )
}

/** Call after a canonical commit succeeds to invalidate every draft for it. */
export async function invalidateSceneScriptDraftPreviews(projectId: string): Promise<number> {
  return sceneScriptDraftPreviews.invalidateProject(projectId)
}
