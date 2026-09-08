import type { FastifyInstance } from 'fastify'

import { parseSceneModule } from '@forgeax/scene-authoring'
import { getProjectDir } from '../../runtime.js'
import { getProjectSceneContractRegistry } from '../../scene-script/contracts/contracts.js'
import { readSceneModule } from '../../scene-script/persist/store.js'
import { queryResultLineage } from '../../scene-script/agent/lineage.js'

import { SCENE_SCRIPT_PREFIX, type ProjectParams, type SceneScriptQuery } from './types.js'

export function registerSceneScriptLensRoutes(app: FastifyInstance): void {
  const prefix = SCENE_SCRIPT_PREFIX
  app.get<{
    Params: ProjectParams
    Querystring: SceneScriptQuery & {
      statementId?: string
      entityId?: string
      sceneNodeId?: string
      path?: string
      bakedLayerId?: string
      runtimeNodeId?: string
    }
  }>(`${prefix}/lens`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: `project not found: ${req.params.projectId}` })
    const stored = await readSceneModule(projectDir, req.query.file)
    const lineageQuery = req.query.sceneNodeId ?? req.query.path ?? req.query.bakedLayerId ?? req.query.runtimeNodeId
    if (lineageQuery) {
      const matches = queryResultLineage(stored.state?.resultLineage ?? [], req.query)
      if (!matches.length) {
        return reply.code(404).send({ reason: `lineage not found: ${lineageQuery}` })
      }
      return {
        revision: stored.revision,
        query: {
          ...(req.query.sceneNodeId ? { sceneNodeId: req.query.sceneNodeId } : {}),
          ...(req.query.path ? { path: req.query.path } : {}),
          ...(req.query.bakedLayerId ? { bakedLayerId: req.query.bakedLayerId } : {}),
          ...(req.query.runtimeNodeId ? { runtimeNodeId: req.query.runtimeNodeId } : {}),
        },
        count: matches.length,
        lineage: matches,
        summary: {
          sceneNodeCount: matches.reduce((count, item) => count + item.summary.sceneNodeCount, 0),
          bakedLayerCount: matches.reduce((count, item) => count + item.summary.bakedLayerCount, 0),
          payload: 'reference-only',
        },
      }
    }
    const registry = await getProjectSceneContractRegistry(projectDir)
    const parsed = parseSceneModule(stored.source, {
      file: stored.file,
      registry,
    })
    const mappedStatementId = req.query.entityId
      ? stored.state?.sourceMap.find((item) => item.entityId === req.query.entityId)?.statementId
      : undefined
    const statementId = req.query.statementId ?? mappedStatementId
    const target = parsed.module.statements.find((item) => item.statementId === statementId)
    if (!target) return reply.code(404).send({ reason: `authoring entity not found: ${statementId ?? req.query.entityId ?? ''}` })
    const referencedBindings = new Set(
      Object.values(target.args)
        .filter((item) => item.kind === 'reference')
        .map((item) => item.kind === 'reference' ? item.binding : ''),
    )
    const upstream = parsed.module.statements.filter((item) => item.binding && referencedBindings.has(item.binding))
    const downstream = target.binding
      ? parsed.module.statements.filter((item) =>
          Object.values(item.args).some((arg) => arg.kind === 'reference' && arg.binding === target.binding),
        )
      : []
    const contract = registry.get(target.functionName)
    const { definition: _definition, ...publicContract } = contract ?? {}
    return {
      revision: stored.revision,
      file: stored.file,
      target,
      upstream,
      downstream,
      contract: contract ? publicContract : null,
      sealed: contract?.kind !== 'atomic',
      allowedAgentActions: contract?.capabilities?.agent ?? ['configure', 'connect', 'move', 'replace', 'remove'],
      diagnostics: parsed.diagnostics,
    }
  })

}
