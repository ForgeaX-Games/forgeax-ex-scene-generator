import type { FastifyInstance } from 'fastify'

import {
  applyAuthoringCommands,
  applyProjectAuthoringCommands,
  compiledOpsToKernelGraph,
  parseSceneModule,
  printSceneModule,
  toPublicSceneDiagnostics,
  type AuthoringCommand,
} from '@forgeax/scene-authoring'
import { importPipelineGraph } from '@forgeax/node-runtime'
import { getProjectDir, getRuntimeForProject } from '../../runtime.js'
import { hashSceneSource, noteCompiledRevision } from '../../scene-script/agent/revisionState.js'
import { importCompiledGraphIncrementally } from '../../scene-script/compile/runtimeImport.js'
import { getSceneContractRegistry } from '../../scene-script/contracts/contracts.js'
import { compileStoredSceneProject, resolveSceneImport } from '../../scene-script/compile/projectCompiler.js'
import {
  readAuthoringLayout,
  readSceneModule,
  resolveCanonicalEntryFile,
  writeSceneProjectTransaction,
} from '../../scene-script/persist/store.js'
import {
  captureAuthoringSourceSnapshot,
  recordAuthoringTransaction,
} from '../../scene-script/persist/transactionHistory.js'
import { ensureMutationAccess, extractCaller } from '../projects.js'
import {
  rejectedSceneScriptPayload,
  revisionConflictDiagnostic,
  runtimeImportDiagnostics,
} from '../../scene-script/diagnostics.js'
import {
  applyStoredLayout,
  currentRuntimeGraph,
  hasErrors,
  remapStatementLayout,
  requireResultCapture,
  rollbackSourceSnapshot,
} from './helpers.js'

import { SCENE_SCRIPT_PREFIX, type ProjectParams, type SceneCommandBody } from './types.js'

export function registerSceneScriptCommandRoutes(app: FastifyInstance): void {
  const prefix = SCENE_SCRIPT_PREFIX
  app.post<{ Params: ProjectParams; Body: SceneCommandBody }>(`${prefix}/commands`, async (req, reply) => {
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
    const actualProjectRevision = state?.projectRevision ?? state?.sourceRevision ?? stored.revision
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
    const baseRegistry = await getSceneContractRegistry()
    const entry = entryFile === stored.file ? stored : await readSceneModule(projectDir, entryFile)
    const currentProject = await compileStoredSceneProject(projectDir, {
      entryFile,
      entrySource: entry.source,
      projectId: req.params.projectId,
      registry: baseRegistry,
    })
    if (hasErrors(currentProject.diagnostics)) {
      return reply.code(422).send(rejectedSceneScriptPayload(
        'Current Scene Script project has structured diagnostics.',
        currentProject.diagnostics,
      ))
    }
    const caller = extractCaller(req)
    const moduleByFile = new Map(Object.values(currentProject.modules).map((module) => [module.file, module]))
    const sourceMap = state?.sourceMap ?? currentProject.compiled.sourceMap
    const routedCommands: AuthoringCommand[] = []
    for (const command of req.body.commands) {
      const statementId = 'statementId' in command ? command.statementId : undefined
      const mapped = statementId ? sourceMap.find((item) =>
        item.statementId === statementId
        || item.entityId === statementId
        || item.runtimeNodeIds.includes(statementId)) : undefined
      const mappedSelectionOwner = 'statementIds' in command
        ? sourceMap.find((item) => command.statementIds.some((id) =>
            item.statementId === id || item.entityId === id || item.runtimeNodeIds.includes(id)))
        : undefined
      const module = (command.moduleId ? currentProject.modules[command.moduleId] : undefined)
        ?? (command.file ? moduleByFile.get(command.file) : undefined)
        ?? (mapped ? currentProject.modules[mapped.moduleId] : undefined)
        ?? (mappedSelectionOwner ? currentProject.modules[mappedSelectionOwner.moduleId] : undefined)
        ?? (command.moduleId === state?.moduleRevisions?.[stored.file]?.moduleId
          ? moduleByFile.get(stored.file)
          : undefined)
        ?? (!statementId ? moduleByFile.get(req.body.file ?? stored.file) : undefined)
      if (!module) {
        return reply.code(422).send(rejectedSceneScriptPayload(
          `Authoring command target '${statementId ?? command.file ?? command.moduleId ?? ''}' has no owning module.`,
          [{
            code: 'SCENE_COMMAND_MODULE_NOT_FOUND',
            phase: 'resolve',
            severity: 'error',
            message: `No owning Scene Script module was found for '${statementId ?? ''}'.`,
            statementId,
          }],
        ))
      }
      const mappedSelection = 'statementIds' in command
        ? command.statementIds.map((id) => sourceMap.find((item) =>
            item.statementId === id || item.entityId === id || item.runtimeNodeIds.includes(id))?.statementId ?? id)
        : undefined
      routedCommands.push({
        ...command,
        ...('statementId' in command && mapped ? { statementId: mapped.statementId } : {}),
        ...(mappedSelection ? { statementIds: mappedSelection } : {}),
        moduleId: module.moduleId,
      } as AuthoringCommand)
    }
    const fileToModuleId = new Map(Object.values(currentProject.modules).map((module) => [module.file, module.moduleId]))
    const transformed = applyProjectAuthoringCommands(
      { entryModuleId: currentProject.compiled.module.moduleId, modules: currentProject.modules },
      routedCommands,
      {
        actor: caller.kind === 'ai' ? 'agent' : 'user',
        registry: currentProject.registry,
        resolveImport: (fromModuleId, specifier) => {
          const fromFile = currentProject.modules[fromModuleId]?.file ?? fromModuleId
          return fileToModuleId.get(resolveSceneImport(fromFile, specifier)) ?? specifier
        },
      },
    )
    if (transformed.confirmations.length > 0) {
      return reply.code(409).send({
        status: 'confirmation-required',
        code: 'scene-authoring-confirmation-required',
        confirmations: transformed.confirmations,
        transaction: { applied: false, rolledBack: true },
      })
    }
    const writes = transformed.changedModuleIds.map((moduleId) => ({
      file: transformed.project.modules[moduleId].file,
      source: printSceneModule(transformed.project.modules[moduleId]),
    }))
    const overrides = Object.fromEntries(writes.map((write) => [write.file, write.source]))
    const projectCompile = await compileStoredSceneProject(projectDir, {
      entryFile,
      entrySource: overrides[entryFile] ?? entry.source,
      sourceOverrides: overrides,
      projectId: req.params.projectId,
      registry: baseRegistry,
    })
    const compiled = projectCompile.compiled
    const diagnostics = requireResultCapture(
      [...transformed.diagnostics, ...projectCompile.diagnostics],
      compiled.resultEntityIds,
      compiled.resultCaptures,
    )
    if (hasErrors(diagnostics)) {
      return reply.code(422).send(rejectedSceneScriptPayload(
        'Authoring transaction was rejected.',
        diagnostics,
        { compatibility: { appliedBeforeValidation: transformed.applied } },
      ))
    }
    const currentLayout = await readAuthoringLayout(projectDir)
    const remappedLayout = remapStatementLayout(
      currentLayout,
      sourceMap,
      compiled.sourceMap,
    )
    const previousRuntimeGraph = applyStoredLayout(
      compiledOpsToKernelGraph(currentProject.compiled.ops),
      currentLayout,
      currentProject.compiled.sourceMap,
    )
    const imported = await importCompiledGraphIncrementally(
      await getRuntimeForProject(req.params.projectId),
      applyStoredLayout(
        compiledOpsToKernelGraph(compiled.ops),
        remappedLayout,
        compiled.sourceMap,
      ),
      {
        actor: caller.kind === 'ai' ? 'scene-script:agent' : 'scene-script:user',
        label: req.body.label ?? 'Apply Scene Authoring Commands',
      },
    )
    if (imported.status !== 'ok') {
      return reply.code(422).send(rejectedSceneScriptPayload(
        imported.reason ?? 'Runtime Graph import was rejected.',
        runtimeImportDiagnostics(imported.diagnostics),
        { transaction: { applied: false, rolledBack: true } },
      ))
    }
    const dependencyGraph = Object.fromEntries(Object.entries(projectCompile.incremental.modules).map(
      ([moduleId, item]) => [moduleId, {
        dependencies: item.dependencies,
        dependents: item.dependents,
        publicSignatureHash: item.publicSignatureHash,
        semanticHash: item.semanticHash,
      }],
    ))
    let next
    try {
      next = await writeSceneProjectTransaction(
        projectDir,
        entryFile,
        writes,
        compiled.sourceMap,
        imported.newHash,
        dependencyGraph,
        remappedLayout,
      )
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
        'edit-lens',
        hashSceneSource(overrides),
      )
    } catch (error) {
      await importPipelineGraph(
        await getRuntimeForProject(req.params.projectId),
        { format: 'kernel-graph-v1', graph: previousRuntimeGraph },
        { mode: 'replace', actor: 'scene-script:rollback', label: 'Rollback failed Scene Authoring transaction' },
      )
      await rollbackSourceSnapshot(
        req.params.projectId,
        projectDir,
        beforeSnapshot,
        'Rollback unrecorded Scene Authoring transaction',
      )
      throw error
    }
    return {
      status: 'ok',
      revision: next.projectRevision,
      projectRevision: next.projectRevision,
      moduleRevisions: next.moduleRevisions,
      graphHash: imported.newHash,
      sources: Object.fromEntries(writes.map((write) => [write.file, write.source])),
      sourceMap: compiled.sourceMap,
      diagnostics: toPublicSceneDiagnostics(diagnostics),
      applied: transformed.applied,
      incremental: projectCompile.incremental,
      runtimeImpact: {
        changedOperationCount: imported.changedOperationCount,
        invalidatedNodeCount: imported.invalidatedNodeCount ?? 0,
      },
      transaction: {
        applied: true,
        rolledBack: false,
        ...(imported.batchId ? { undoToken: imported.batchId } : {}),
      },
    }
  })

}
