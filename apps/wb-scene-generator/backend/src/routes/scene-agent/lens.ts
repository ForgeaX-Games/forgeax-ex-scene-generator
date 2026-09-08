import type { FastifyInstance } from 'fastify'

import {
  boundedUnique,
  SCENE_WORKFLOW_LIMITS,
  type SceneEditLens,
} from '@forgeax/scene-authoring'

import { getProjectDir } from '../../runtime.js'
import { readSceneModule } from '../../scene-script/persist/store.js'
import { readWorkNodes } from '../../scene-script/agent/workflowStore.js'
import { allReferences, projectContext, sourceLine } from './helpers.js'
import { SCENE_AGENT_PREFIX, type ProjectParams } from './types.js'

export function registerSceneAgentLensRoutes(app: FastifyInstance): void {
  const prefix = SCENE_AGENT_PREFIX

  app.post<{
    Params: ProjectParams
    Body: { targetIds: string[]; radius?: number; concerns?: string[]; expansionReason?: string }
  }>(`${prefix}/lens`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: 'project not found' })
    const targetIds = boundedUnique(req.body?.targetIds ?? [], SCENE_WORKFLOW_LIMITS.maxTargets)
    if (!targetIds.length) return reply.code(400).send({ reason: 'targetIds are required' })
    const depth = Math.min(Math.max(1, req.body.radius ?? 1), SCENE_WORKFLOW_LIMITS.maxLensExpansions)
    if (depth > 1 && !req.body.expansionReason) {
      return reply.code(400).send({ reason: 'Lens expansion requires compiler, impact, or verifier evidence.' })
    }
    const { entry, project } = await projectContext(req.params.projectId, projectDir)
    const sourceMap = entry.state?.sourceMap ?? project.compiled.sourceMap
    const selected = sourceMap.filter((item) =>
      targetIds.some((id) => id === item.entityId || id === item.statementId))
    if (!selected.length) return reply.code(404).send({ reason: 'targets not found' })
    const sourceByFile = Object.fromEntries(await Promise.all(
      [...new Set(selected.map((item) => item.file))].map(async (file) => [file, (await readSceneModule(projectDir, file)).source]),
    ))
    const modules = project.modules
    const statementById = new Map(Object.values(modules).flatMap((module) =>
      module.statements.map((statement) => [statement.statementId, { module, statement }] as const)))
    const targetStatements = selected.flatMap((item) => {
      const value = statementById.get(item.statementId)
      return value ? [value] : []
    })
    const dependencyBindings = new Set(targetStatements.flatMap(({ statement }) =>
      Object.values(statement.args).flatMap(allReferences)))
    const targetBindings = new Set(targetStatements.flatMap(({ statement }) => statement.binding ? [statement.binding] : []))
    const summarize = (relation: 'dependency' | 'consumer') => Object.values(modules).flatMap((module) =>
      module.statements.flatMap((statement) => {
        const refs = Object.values(statement.args).flatMap(allReferences)
        const match = relation === 'dependency'
          ? Boolean(statement.binding && dependencyBindings.has(statement.binding))
          : refs.some((binding) => targetBindings.has(binding))
        return match ? [{
          moduleId: module.moduleId,
          file: module.file,
          statementId: statement.statementId,
          functionName: statement.functionName,
          binding: statement.binding,
          relation,
        }] : []
      })).slice(0, SCENE_WORKFLOW_LIMITS.maxTargets * depth)
    const recent = (await readWorkNodes(projectDir))
      .filter((node) => node.targetIds.some((id) => targetIds.includes(id)))
      .slice(0, 10)
      .map((node) => ({
        transactionId: node.id,
        changedAt: node.updatedAt,
        moduleIds: node.scope,
        targetIds: node.targetIds,
        status: node.status,
      }))
    const spatialReferences = (entry.state?.resultLineage ?? []).filter((item) =>
      selected.some((target) => target.entityId === item.authoring.entityId))
      .flatMap((item) => item.sceneNodes.map((node) => ({ sceneNodeId: node.id, path: node.path })))
    const lens: SceneEditLens = {
      targetIds: selected.map((item) => item.entityId),
      sourceRanges: selected.map((item) => item.source),
      targetSources: selected.map((item) => ({
        moduleId: item.moduleId,
        file: item.file,
        statementId: item.statementId,
        source: sourceLine(sourceByFile[item.file] ?? '', item.source.start, item.source.end),
      })),
      owningModules: boundedUnique(selected.map((item) => item.moduleId), SCENE_WORKFLOW_LIMITS.maxTargets)
        .map((moduleId) => ({
          moduleId,
          file: modules[moduleId]?.file ?? selected.find((item) => item.moduleId === moduleId)!.file,
          relation: 'module',
        })),
      directDependencies: summarize('dependency'),
      directConsumers: summarize('consumer'),
      spatialNeighborhood: {
        references: spatialReferences.slice(0, SCENE_WORKFLOW_LIMITS.maxTargets),
        count: spatialReferences.length,
        truncated: spatialReferences.length > SCENE_WORKFLOW_LIMITS.maxTargets,
        payload: 'summary-only',
      },
      invariants: [
        { id: 'project-ast-integrity', description: 'Project AST must remain valid.', frozen: true, scope: 'global' },
        { id: 'stable-id-unique', description: 'Stable authoring ids must remain unique.', frozen: true, scope: 'global' },
        { id: 'import-dag', description: 'Scene module imports must remain acyclic and resolvable.', frozen: true, scope: 'global' },
        { id: 'acceptance-frozen', description: 'Frozen acceptance standards cannot be weakened by the verifier.', frozen: true, scope: 'global' },
      ],
      recentRelevantChanges: recent,
      allowedWriteScope: boundedUnique(selected.map((item) => item.moduleId), SCENE_WORKFLOW_LIMITS.maxTargets),
      expansion: { depth, ...(req.body.expansionReason ? { reason: req.body.expansionReason } : {}), maxDepth: SCENE_WORKFLOW_LIMITS.maxLensExpansions },
      payload: 'bounded-no-runtime-graph',
    }
    return lens
  })

}
