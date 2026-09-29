import type { FastifyInstance } from 'fastify'

import { applySceneSourceEdits } from '@forgeax/scene'
import { toPublicSceneDiagnostics, type AuthoringCommand } from '@forgeax/scene-authoring'
import { importPipelineGraph } from '@forgeax/node-runtime'
import { getProjectDir, getRuntimeForProject } from '../../runtime.js'
import { hashSceneSource, noteCompiledRevision } from '../../scene-script/agent/revisionState.js'
import { computeSourceProjectRevision, readSceneModule, resolveCanonicalEntryFile, writeSceneProjectTransaction } from '../../scene-script/persist/store.js'
import { captureAuthoringSourceSnapshot, recordAuthoringTransaction } from '../../scene-script/persist/transactionHistory.js'
import { ensureMutationAccess, extractCaller } from '../projects.js'
import { rejectedSceneScriptPayload, revisionConflictDiagnostic } from '../../scene-script/diagnostics.js'
import { currentRuntimeGraph, hasErrors, rollbackSourceSnapshot } from './helpers.js'
import { authoringCommandsToSourceEdits } from '../../scene-script/adapter/commandEdits.js'
import { runSceneProject } from '../../scene-script/run/runProject.js'

import { SCENE_SCRIPT_PREFIX, type ProjectParams, type SceneCommandBody } from './types.js'
import { notifySceneProjectChanged } from './changes.js'

export function registerSceneScriptCommandRoutes(app: FastifyInstance): void {
  const prefix = SCENE_SCRIPT_PREFIX
  app.post<{ Params: ProjectParams; Body: SceneCommandBody }>(`${prefix}/commands`, { onResponse: notifySceneProjectChanged }, async (req, reply) => {
    if (!Array.isArray(req.body?.commands)
      || (typeof req.body.expectedRevision !== 'string' && typeof req.body.expectedProjectRevision !== 'string')) {
      return reply.code(400).send({ reason: 'commands and expectedProjectRevision are required' })
    }
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: `project not found: ${req.params.projectId}` })
    const access = await ensureMutationAccess(req, req.params.projectId)
    if (!access.ok) return reply.code(403).send(access)
    const stored = await readSceneModule(projectDir, req.body.file)
    const state = stored.state
    const entryFile = resolveCanonicalEntryFile(state?.modules, state?.entryFile, 'main.scene.ts')
    const beforeSnapshot = await captureAuthoringSourceSnapshot(projectDir, entryFile)
    const actualProjectRevision = await computeSourceProjectRevision(projectDir)
    const expectedProjectRevision = req.body.expectedProjectRevision ?? req.body.expectedRevision!
    const comparedActualRevision = req.body.expectedProjectRevision ? actualProjectRevision : stored.revision
    const conflictedModules = Object.entries(req.body.expectedModuleRevisions ?? {}).flatMap(([key, expected]) => {
      const match = Object.entries(state?.moduleRevisions ?? {}).find(
        ([file, item]) => file === key || item.moduleId === key,
      )
      return match && match[1].revision !== expected
        ? [{ file: match[0], moduleId: match[1].moduleId, expectedRevision: expected, actualRevision: match[1].revision }]
        : []
    })
    if (comparedActualRevision !== expectedProjectRevision || conflictedModules.length) {
      const diagnostic = revisionConflictDiagnostic(expectedProjectRevision, comparedActualRevision)
      const conflictStatements = req.body.commands
        .flatMap((command) => 'statementId' in command
          ? [command.statementId]
          : 'statementIds' in command ? command.statementIds : [])
      return reply.code(409).send(rejectedSceneScriptPayload(
        diagnostic.message,
        [diagnostic],
        {
          code: diagnostic.code,
          compatibility: {
            expectedRevision: expectedProjectRevision,
            actualRevision: comparedActualRevision,
            conflict: {
              expectedProjectRevision,
              actualProjectRevision: comparedActualRevision,
              modules: conflictedModules,
              statements: conflictStatements,
            },
          },
        },
      ))
    }
    const unsupported = req.body.commands.filter((command) => (
      command.type === 'wrapInGroup'
      || command.type === 'extractDefinition'
      || command.type === 'ungroup'
      || command.type === 'inlineDefinition'
      || command.type === 'editSealedInternal'
    ))
    if (unsupported.length > 0) {
      return reply.code(422).send(rejectedSceneScriptPayload(
        'Group compile commands are not part of Scene Script. Import another .scene.ts module instead.',
        [],
      ))
    }
    const file = req.body.file ?? stored.file
    const current = file === stored.file ? stored : await readSceneModule(projectDir, file)
    const edits = authoringCommandsToSourceEdits(req.body.commands as AuthoringCommand[])
    const written = applySceneSourceEdits(current.source, edits, file)
    if (hasErrors(written.diagnostics)) {
      return reply.code(422).send(rejectedSceneScriptPayload('Authoring transaction was rejected.', written.diagnostics))
    }
    const writes = [{ file, source: written.source }]
    const overrides = { [file]: written.source }
    const previousRuntimeGraph = await currentRuntimeGraph(req.params.projectId)
    const caller = extractCaller(req)
    let next
    try {
      next = await writeSceneProjectTransaction(
        projectDir,
        entryFile,
        writes,
        current.state?.sourceMap ?? [],
      )
      const ran = await runSceneProject({
        projectId: req.params.projectId,
        projectDir,
        runtime: await getRuntimeForProject(req.params.projectId),
        entryFile,
        sourceOverrides: overrides,
        actor: caller.kind === 'ai' ? 'scene-script:agent' : 'scene-script:user',
        label: req.body.label ?? 'Apply Scene Authoring Commands',
      })
      if (hasErrors(ran.diagnostics) && !ran.reusedLastGood) {
        await rollbackSourceSnapshot(
          req.params.projectId,
          projectDir,
          beforeSnapshot,
          'Rollback failed Scene Authoring transaction',
        )
        return reply.code(422).send(rejectedSceneScriptPayload('Authoring transaction was rejected.', ran.diagnostics))
      }
      const afterSnapshot = await captureAuthoringSourceSnapshot(projectDir, entryFile)
      await recordAuthoringTransaction(
        projectDir,
        beforeSnapshot,
        afterSnapshot,
        req.body.label ?? 'Apply Scene Authoring Commands',
      )
      await noteCompiledRevision(
        projectDir,
        req.params.projectId,
        next.projectRevision ?? next.sourceRevision,
        'apply-commands',
        hashSceneSource(overrides),
      )
      return {
        status: 'ok',
        revision: next.projectRevision,
        projectRevision: next.projectRevision,
        moduleRevisions: next.moduleRevisions,
        graphHash: ran.result.entryFile,
        sources: Object.fromEntries(writes.map((write) => [write.file, write.source])),
        sourceMap: ran.sourceMap,
        diagnostics: toPublicSceneDiagnostics(ran.diagnostics),
        applied: written.applied,
        incremental: { modules: {} },
        runtimeImpact: {
          changedOperationCount: ran.trace.length,
          invalidatedNodeCount: 0,
        },
        transaction: { applied: true, rolledBack: false },
      }
    } catch (error) {
      if (previousRuntimeGraph) {
        await importPipelineGraph(
          await getRuntimeForProject(req.params.projectId),
          { format: 'kernel-graph-v1', graph: previousRuntimeGraph },
          { mode: 'replace', actor: 'scene-script:rollback', label: 'Rollback failed Scene Authoring transaction' },
        )
      }
      await rollbackSourceSnapshot(
        req.params.projectId,
        projectDir,
        beforeSnapshot,
        'Rollback unrecorded Scene Authoring transaction',
      )
      throw error
    }
  })
}
