import type { FastifyInstance } from 'fastify'

import { isScreenshotEnabled, latestScreenshotRecord, screenshotCaptureProjectId } from '../../agent/routes.js'
import { rendererSyncStatus } from '../../agent/rendererStatus.js'
import { getProjectDir } from '../../runtime.js'
import {
  readSceneRevisionState,
  revisionStateSummary,
} from '../../scene-script/agent/revisionState.js'
import { SCENE_SCRIPT_PREFIX, type ProjectParams } from './types.js'

export async function inspectSceneCompletion(projectId: string, projectDir: string): Promise<{
  ok: boolean
  reasons: string[]
  evidence: Record<string, unknown>
  nextAction: string
}> {
  const state = await readSceneRevisionState(projectDir, projectId)
  const sync = rendererSyncStatus(projectId)
  const screenshot = latestScreenshotRecord()
  const alignedRevision = Boolean(
    state.sourceRevision
    && state.artifactRevision === state.sourceRevision
    && state.executedRevision === state.sourceRevision,
  )
  const visibleLayerCount = sync.voxelLayers + sync.gridLayers + sync.meshLayers
  const screenshotForCurrentResult = Boolean(
    screenshot
    && screenshotCaptureProjectId(screenshot.captureId) === projectId
    && Number.isFinite(Date.parse(screenshot.capturedAt))
    && Date.parse(screenshot.capturedAt) >= Date.parse(state.updatedAt),
  )
  const reasons: string[] = []
  if (!state.sourceRevision) reasons.push('source-revision-missing')
  if (state.compileOk !== true || state.artifactRevision !== state.sourceRevision) {
    reasons.push('compiled-artifact-missing-or-stale')
  }
  if (!alignedRevision) reasons.push('execution-revision-mismatch')
  if (!state.executionId) reasons.push('execution-id-missing')
  if (state.executionOk !== true) reasons.push('execution-failed-or-missing')
  if (state.verificationOk !== true) reasons.push('semantic-verification-failed-or-missing')
  if (!sync.aligned) reasons.push(...sync.staleReasons.map((reason) => `renderer-${reason}`))
  if (sync.viewingProjectId !== projectId) reasons.push('renderer-project-mismatch')
  if (visibleLayerCount <= 0) reasons.push('renderer-no-visible-output')

  const uniqueReasons = [...new Set(reasons)]
  const ok = uniqueReasons.length === 0

  return {
    ok,
    reasons: uniqueReasons,
    evidence: {
      revisionState: revisionStateSummary(state),
      renderer: sync,
      screenshot: isScreenshotEnabled() && screenshot
        ? {
            captureId: screenshot.captureId,
            capturedAt: screenshot.capturedAt,
            width: screenshot.width,
            height: screenshot.height,
            current: screenshotForCurrentResult,
          }
        : null,
    },
    nextAction: !ok
      ? revisionStateSummary(state).nextAction as string
      : 'Look at Default (perspective and top). verification.ok is not visual acceptance. Compare the visible scene to the brief before treating the work as done.',
  }
}

export function registerSceneScriptCompletionRoutes(app: FastifyInstance): void {
  app.get<{ Params: ProjectParams }>(`${SCENE_SCRIPT_PREFIX}/completion`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: `project not found: ${req.params.projectId}` })
    const result = await inspectSceneCompletion(req.params.projectId, projectDir)
    return reply.send({
      ...result,
      deprecated: 'Use this as revision readiness evidence; no completion receipt is issued.',
    })
  })
}
