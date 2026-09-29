import type { FastifyInstance } from 'fastify'

import { inspectSceneSource } from '@forgeax/scene'
import { getProjectDir } from '../../runtime.js'
import { getProjectSceneContractRegistry } from '../../scene-script/contracts/contracts.js'
import { readSceneModule } from '../../scene-script/persist/store.js'
import { queryResultLineage } from '../../scene-script/agent/lineage.js'
import { extractGeneratorSymbols } from '../../scene-script/generator/symbols.js'

import { SCENE_SCRIPT_PREFIX, type ProjectParams, type SceneScriptQuery } from './types.js'

export function registerSceneScriptLensRoutes(app: FastifyInstance): void {
  const prefix = SCENE_SCRIPT_PREFIX
  app.get<{
    Params: ProjectParams
    Querystring: SceneScriptQuery & {
      statementId?: string
      entityId?: string
      symbol?: string
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

    if (
      stored.file.endsWith('.generator.ts')
      || stored.file.endsWith('.generator-lib.ts')
      || Boolean(req.query.symbol)
    ) {
      const { symbols, target } = extractGeneratorSymbols(stored.source, req.query.symbol)
      return {
        revision: stored.revision,
        file: stored.file,
        kind: 'generator-module',
        target: target ?? null,
        symbols: symbols.map((s) => ({
          name: s.name,
          kind: s.kind,
          signature: s.signature,
          span: s.span,
        })),
        diagnostics: [],
      }
    }

    const registry = await getProjectSceneContractRegistry(projectDir)
    const sites = inspectSceneSource(stored.source, stored.file)
    const mappedStatementId = req.query.entityId
      ? stored.state?.sourceMap.find((item) => item.entityId === req.query.entityId)?.statementId
      : undefined
    const statementId = req.query.statementId ?? mappedStatementId
    const target = sites.find((item) => item.id === statementId)
    if (!target) return reply.code(404).send({ reason: `authoring entity not found: ${statementId ?? req.query.entityId ?? ''}` })
    if (target.kind !== 'call') {
      return reply.code(422).send({ reason: `authoring entity is not a callable scene statement: ${statementId ?? req.query.entityId ?? ''}` })
    }
    const referenced = new Set(
      Object.values(target.args).flatMap((arg) => arg.binding ? [arg.binding] : []),
    )
    const upstream = sites.filter((item) => item.binding && referenced.has(item.binding))
    const downstream = target.binding
      ? sites.filter((item) => item.kind === 'call' && Object.values(item.args).some((arg) => arg.binding === target.binding))
      : []
    const contract = target.functionName ? registry.get(target.functionName) : undefined
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
      diagnostics: [],
    }
  })
}
