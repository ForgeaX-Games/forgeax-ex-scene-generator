import type { FastifyInstance } from 'fastify'

import {
  boundedUnique,
  commandModuleIds,
  commandTargetIds,
  requiresHumanGate,
  SCENE_WORKFLOW_LIMITS,
  type AuthoringCommand,
  type SceneEditPrecondition,
  type SceneEditTransaction,
  type SceneSemanticExpectation,
} from '@forgeax/scene-authoring'

import { getProjectDir } from '../../runtime.js'
import { readSceneModule } from '../../scene-script/persist/store.js'
import {
  newWorkNode,
  writeStoredTransaction,
  writeWorkNodeArtifacts,
  type StoredSceneTransaction,
} from '../../scene-script/agent/workflowStore.js'
import { now, projectContext, transactionId } from './helpers.js'
import { SCENE_AGENT_PREFIX, type ProjectParams } from './types.js'

export function registerSceneAgentProposeRoutes(app: FastifyInstance): void {
  const prefix = SCENE_AGENT_PREFIX

  app.post<{
    Params: ProjectParams
    Body: {
      intent: string
      targetIds: string[]
      writableModuleIds?: string[]
      preconditions?: SceneEditPrecondition[]
      commands: AuthoringCommand[]
      expectedSemanticDelta?: SceneSemanticExpectation[]
      verificationProfile?: 'local' | 'global'
    }
  }>(`${prefix}/propose`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: 'project not found' })
    const commands = req.body?.commands ?? []
    if (!Array.isArray(commands) || commands.length > SCENE_WORKFLOW_LIMITS.maxCommands) {
      return reply.code(413).send({ reason: `commands must contain at most ${SCENE_WORKFLOW_LIMITS.maxCommands} items` })
    }
    const targets = boundedUnique(req.body?.targetIds ?? commands.flatMap(commandTargetIds), SCENE_WORKFLOW_LIMITS.maxTargets)
    const { entry } = await projectContext(req.params.projectId, projectDir)
    const sourceMap = entry.state?.sourceMap ?? []
    const inferredModules = boundedUnique([
      ...commands.flatMap(commandModuleIds),
      ...sourceMap.filter((item) => targets.includes(item.entityId) || targets.includes(item.statementId)).map((item) => item.moduleId),
    ], SCENE_WORKFLOW_LIMITS.maxTargets)
    const writableModuleIds = boundedUnique(req.body?.writableModuleIds ?? inferredModules, SCENE_WORKFLOW_LIMITS.maxTargets)
    const id = transactionId()
    const reasons = requiresHumanGate(commands, req.body?.intent ?? '')
    const transaction: SceneEditTransaction = {
      transactionId: id,
      workNodeId: id,
      intent: (req.body?.intent ?? '').slice(0, SCENE_WORKFLOW_LIMITS.maxStringLength),
      baseProjectRevision: entry.state?.projectRevision ?? entry.state?.sourceRevision ?? entry.revision,
      baseModuleRevisions: Object.fromEntries(Object.values(entry.state?.moduleRevisions ?? {})
        .map((item) => [item.moduleId, item.revision])),
      targetIds: targets,
      writableModuleIds,
      preconditions: (req.body?.preconditions ?? []).slice(0, SCENE_WORKFLOW_LIMITS.maxCommands),
      astCommands: commands,
      expectedSemanticDelta: (req.body?.expectedSemanticDelta ?? []).slice(0, SCENE_WORKFLOW_LIMITS.maxCommands),
      verificationProfile: req.body?.verificationProfile ?? 'local',
      humanGate: { required: reasons.length > 0, reasons },
    }
    const beforeSources = Object.fromEntries(await Promise.all((entry.state?.modules ?? [entry.file])
      .map(async (file) => [file, (await readSceneModule(projectDir, file)).source])))
    const stored: StoredSceneTransaction = {
      transaction,
      status: transaction.humanGate?.required ? 'blocked' : 'planned',
      beforeSources,
      retries: 0,
      createdAt: now(),
      updatedAt: now(),
    }
    const node = newWorkNode(id, targets, writableModuleIds, transaction.humanGate)
    await Promise.all([
      writeStoredTransaction(projectDir, stored),
      writeWorkNodeArtifacts(projectDir, node, {
        workOrder: transaction,
        result: { status: node.status },
        astPatch: { commands },
        semanticDiff: null,
        verification: null,
        progress: { at: now(), event: 'proposed' },
        checkpoint: { id: `checkpoint-${id}-proposed`, projectRevision: transaction.baseProjectRevision, createdAt: now() },
      }),
    ])
    return transaction
  })

}
