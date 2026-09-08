import type { FastifyInstance } from 'fastify'

import { getProjectDir } from '../../runtime.js'
import { readWorkGraph, readWorkNodes } from '../../scene-script/agent/workflowStore.js'
import {
  readSceneRevisionState,
  revisionStateSummary,
} from '../../scene-script/agent/revisionState.js'
import { projectContext } from './helpers.js'
import { SCENE_AGENT_PREFIX, type ProjectParams } from './types.js'

export function registerSceneAgentWorkGraphRoutes(app: FastifyInstance): void {
  const prefix = SCENE_AGENT_PREFIX

  app.get<{ Params: ProjectParams }>(`${prefix}/work-graph`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: 'project not found' })
    return readWorkGraph(projectDir, req.params.projectId)
  })

  app.get<{ Params: ProjectParams }>(`${prefix}/resume`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: 'project not found' })
    const { entry } = await projectContext(req.params.projectId, projectDir)
    const nodes = await readWorkNodes(projectDir)
    const current = nodes.find((node) => !['accepted', 'reverted', 'failed'].includes(node.status))
    const checkpoint = current?.checkpoint ?? null
    const revisionState = revisionStateSummary(
      await readSceneRevisionState(projectDir, req.params.projectId),
    )
    return {
      projectSummary: {
        projectId: req.params.projectId,
        projectRevision: entry.state?.projectRevision ?? entry.revision,
        modules: entry.state?.modules ?? [entry.file],
      },
      checkpoint,
      currentWorkOrder: current ? current.artifacts.workOrder : null,
      revisionState,
      nextAction: revisionState.nextAction,
      health: { canonical: Boolean(entry.source.trim()), diagnostics: current?.diagnostics.slice(0, 3) ?? [] },
      payload: 'bounded-resume-context',
      note: checkpoint
        ? 'Continue the open Edit Lens transaction.'
        : 'No local edit transaction is open; continue from the current project revision.',
    }
  })
}
