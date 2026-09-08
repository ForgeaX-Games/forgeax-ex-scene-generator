import type { FastifyInstance } from 'fastify'

import {
  SCENE_WORKFLOW_LIMITS,
  sceneSemanticAddress,
  type SceneTargetCandidate,
  type SceneTargetQuery,
} from '@forgeax/scene-authoring'

import { getProjectDir } from '../../runtime.js'
import { projectContext, rankCandidate } from './helpers.js'
import { SCENE_AGENT_PREFIX, type ProjectParams } from './types.js'

export function registerSceneAgentLocateRoutes(app: FastifyInstance): void {
  const prefix = SCENE_AGENT_PREFIX

  app.post<{ Params: ProjectParams; Body: SceneTargetQuery }>(`${prefix}/locate`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: 'project not found' })
    const { entry, project } = await projectContext(req.params.projectId, projectDir)
    const sourceMap = entry.state?.sourceMap ?? project.compiled.sourceMap
    const lineage = entry.state?.resultLineage ?? []
    const candidates: SceneTargetCandidate[] = sourceMap.flatMap((item) => {
      const ranked = rankCandidate(item, req.body ?? {}, lineage)
      return ranked ? [{
        authoringId: item.entityId,
        statementId: item.statementId,
        semanticAddress: sceneSemanticAddress(item.moduleId, item.statementId),
        moduleId: item.moduleId,
        file: item.file,
        confidence: ranked.confidence,
        evidence: ranked.evidence,
        source: item.source,
      }] : []
    }).sort((left, right) =>
      right.confidence - left.confidence
      || left.semanticAddress.localeCompare(right.semanticAddress))
      .slice(0, SCENE_WORKFLOW_LIMITS.maxCandidates)
    const close = candidates.length > 1 && candidates[0]!.confidence - candidates[1]!.confidence < .08
    const weak = !candidates.length || candidates[0]!.confidence < .72
    return {
      query: req.body ?? {},
      candidates,
      requiresClarification: close || weak,
      ...((close || weak) ? {
        clarificationReason: close
          ? 'Multiple candidates have comparable evidence; select one stable semantic address.'
          : 'No candidate has sufficient evidence; provide a UI selection, stable id, scene node/path, or semantic address.',
      } : {}),
      bounded: true,
    }
  })
}
