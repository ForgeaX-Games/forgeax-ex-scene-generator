import type { FastifyInstance } from 'fastify'

import {
  applyAuthoringCommands,
  compiledOpsToKernelGraph,
  parseSceneModule,
  printSceneModule,
  stableEntityId,
} from '@forgeax/scene-authoring'
import { importPipelineGraph } from '@forgeax/node-runtime'
import { getProjectDir, getRuntimeForProject } from '../../runtime.js'
import { getProjectSceneContractRegistry, getSceneContractRegistry } from '../../scene-script/contracts/contracts.js'
import { compileStoredSceneProject } from '../../scene-script/compile/projectCompiler.js'
import {
  layoutKey,
  readAuthoringLayout,
  readSceneModule,
  writeSceneModule,
} from '../../scene-script/persist/store.js'
import {
  captureAuthoringSourceSnapshot,
  recordAuthoringTransaction,
} from '../../scene-script/persist/transactionHistory.js'
import { ensureMutationAccess } from '../projects.js'
import { rejectedSceneScriptPayload, runtimeImportDiagnostics } from '../../scene-script/diagnostics.js'
import {
  applyStoredLayout,
  hasErrors,
  rollbackSourceSnapshot,
  uniqueBinding,
} from './helpers.js'

import { SCENE_SCRIPT_PREFIX, type ProjectParams } from './types.js'

export function registerSceneScriptDefinitionRoutes(app: FastifyInstance): void {
  const prefix = SCENE_SCRIPT_PREFIX
  app.post<{
    Params: ProjectParams & { functionName: string }
    Body: { position?: { x?: number; y?: number } }
  }>(`${prefix}/definitions/:functionName/instantiate`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: `project not found: ${req.params.projectId}` })
    const access = await ensureMutationAccess(req, req.params.projectId)
    if (!access.ok) return reply.code(403).send(access)
    const stored = await readSceneModule(projectDir)
    if (!stored.source.trim()) {
      return reply.code(409).send({
        status: 'rejected',
        code: 'scene-script-not-canonical',
        reason: 'This project has no canonical Scene Script. Native Definition instantiation is unavailable.',
      })
    }
    const beforeSnapshot = await captureAuthoringSourceSnapshot(projectDir, stored.file)

    const registry = await getProjectSceneContractRegistry(projectDir)
    const contract = registry.get(req.params.functionName)
    if (!contract || (contract.kind !== 'group' && contract.kind !== 'template') || !contract.definitionId) {
      return reply.code(404).send({
        status: 'rejected',
        code: 'native-definition-not-found',
        reason: `Published native Definition not found: ${req.params.functionName}`,
      })
    }

    const parsed = parseSceneModule(stored.source, {
      file: stored.file,
      registry,
    })
    if (hasErrors(parsed.diagnostics)) {
      return reply.code(422).send(rejectedSceneScriptPayload(
        'Canonical Scene Script has structured diagnostics.',
        parsed.diagnostics,
      ))
    }
    const bindings = new Set(parsed.module.statements.flatMap((statement) => statement.binding ? [statement.binding] : []))
    const statementIds = new Set(parsed.module.statements.map((statement) => statement.statementId))
    let nonce = parsed.module.statements.length
    let statementId = stableEntityId(
      'stmt',
      `${req.params.projectId}:${stored.file}:${contract.functionName}:${nonce}`,
    )
    while (statementIds.has(statementId)) {
      nonce += 1
      statementId = stableEntityId(
        'stmt',
        `${req.params.projectId}:${stored.file}:${contract.functionName}:${nonce}`,
      )
    }
    const transformed = applyAuthoringCommands(
      parsed.module,
      [{
        type: 'addCall',
        functionName: contract.functionName,
        binding: uniqueBinding(contract.functionName, bindings),
        statementId,
      }],
      { actor: 'user', registry },
    )
    const source = printSceneModule(transformed.module)
    const projectCompile = await compileStoredSceneProject(projectDir, {
      entryFile: stored.file,
      entrySource: source,
      projectId: req.params.projectId,
      registry: await getSceneContractRegistry(),
    })
    const diagnostics = [...transformed.diagnostics, ...projectCompile.diagnostics]
    if (hasErrors(diagnostics)) {
      return reply.code(422).send(rejectedSceneScriptPayload(
        'Native Definition authoring transaction was rejected.',
        diagnostics,
      ))
    }
    const sourceEntry = projectCompile.compiled.sourceMap.find((entry) => entry.statementId === statementId)
    if (!sourceEntry) {
      return reply.code(422).send({
        status: 'rejected',
        reason: `Native Definition call '${statementId}' produced no public authoring entity.`,
      })
    }
    const position = {
      x: typeof req.body?.position?.x === 'number' ? req.body.position.x : 0,
      y: typeof req.body?.position?.y === 'number' ? req.body.position.y : 0,
    }
    const layout = {
      ...await readAuthoringLayout(projectDir),
      [layoutKey(sourceEntry.moduleId, sourceEntry.statementId)]: position,
    }
    const graph = applyStoredLayout(compiledOpsToKernelGraph(projectCompile.compiled.ops), layout, projectCompile.compiled.sourceMap)
    const imported = await importPipelineGraph(
      await getRuntimeForProject(req.params.projectId),
      { format: 'kernel-graph-v1', graph },
      {
        mode: 'replace',
        actor: 'scene-script:user',
        label: `Add native Definition ${contract.functionName}`,
      },
    )
    if (imported.status !== 'ok') {
      return reply.code(422).send(rejectedSceneScriptPayload(
        imported.reason ?? 'Runtime Graph import was rejected.',
        runtimeImportDiagnostics(imported.diagnostics),
        { transaction: { applied: false, rolledBack: true } },
      ))
    }
    const next = await writeSceneModule(
      projectDir,
      stored.file,
      source,
      projectCompile.compiled.sourceMap,
      imported.newHash,
      layout,
    )
    try {
      const afterSnapshot = await captureAuthoringSourceSnapshot(projectDir, stored.file)
      await recordAuthoringTransaction(
        projectDir,
        beforeSnapshot,
        afterSnapshot,
        `Add native Definition ${contract.functionName}`,
      )
    } catch (error) {
      await rollbackSourceSnapshot(
        req.params.projectId,
        projectDir,
        beforeSnapshot,
        'Rollback unrecorded native Definition transaction',
      )
      throw error
    }
    return {
      status: 'ok',
      entityId: sourceEntry.entityId,
      statementId,
      revision: next.revision,
      graphHash: imported.newHash,
      transaction: {
        applied: true,
        rolledBack: false,
        ...(imported.batchId ? { undoToken: imported.batchId } : {}),
      },
    }
  })

}
