import { parseSceneModule, printSceneModule, compiledOpsToKernelGraph, toPublicSceneDiagnostics } from '@forgeax/scene-authoring'
import { importPipelineGraph } from '@forgeax/node-runtime'

import { getRuntimeForProject } from '../../runtime.js'
import { getSceneContractRegistry } from '../contracts/contracts.js'
import { compileStoredSceneProject } from '../compile/projectCompiler.js'
import { importCompiledGraphIncrementally } from '../compile/runtimeImport.js'
import {
  isAllowedSceneSourcePath,
  readAuthoringLayout,
  readAuthoringState,
  readSceneModule,
  writeSceneProjectTransaction,
  type SceneModuleWrite,
} from '../persist/store.js'
import {
  captureAuthoringSourceSnapshot,
  recordAuthoringTransaction,
} from '../persist/transactionHistory.js'
import {
  rejectedSceneScriptPayload,
  revisionConflictDiagnostic,
  runtimeImportDiagnostics,
} from '../diagnostics.js'
import {
  applyStoredLayout,
  canonicalSnapshot,
  currentRuntimeGraph,
  hasErrors,
  requireResultCapture,
  rollbackSourceSnapshot,
} from '../../routes/scene-script/helpers.js'
import { hashSceneSource, noteCompiledRevision } from '../agent/revisionState.js'
import { sceneScriptDraftPreviews } from '../draft/runtime.js'

export interface CommitProjectInput {
  projectId: string
  projectDir: string
  files: SceneModuleWrite[]
  entryFile?: string
  expectedRevision?: string
  expectedProjectRevision?: string
  canonicalize?: boolean
  label?: string
  actor: 'scene-script:agent' | 'scene-script:user'
  kind: 'scaffold' | 'direct-put' | 'commit-project'
}

export type CommitProjectResult =
  | {
      ok: true
      status: 'ok'
      revision: string
      projectRevision: string
      graphHash: string
      diagnostics: unknown[]
      transaction: { applied: true; rolledBack: false; undoToken?: string }
      sourceMap: unknown
      canonicalSource?: string
      files: string[]
      entityCount: number
      operationCount: number
      sourceHash: string
      incremental: unknown
      runtimeImpact: { changedOperationCount: number; invalidatedNodeCount: number }
    }
  | {
      ok: false
      statusCode: number
      payload: Record<string, unknown>
    }

function uniqueWrites(files: readonly SceneModuleWrite[]): SceneModuleWrite[] {
  const unique = new Map<string, string>()
  for (const file of files) {
    const path = file.file.replace(/\\/g, '/').replace(/^\/+/, '')
    if (!isAllowedSceneSourcePath(path)) {
      throw new Error(`invalid Scene Script path: ${file.file}`)
    }
    unique.set(path, file.source)
  }
  return [...unique].map(([file, source]) => ({ file, source }))
}

export async function commitSceneProjectFiles(input: CommitProjectInput): Promise<CommitProjectResult> {
  const writes = uniqueWrites(input.files)
  if (writes.length === 0) {
    return {
      ok: false,
      statusCode: 400,
      payload: { status: 'rejected', reason: 'files must contain at least one Scene Script source' },
    }
  }

  const storedEntry = await readSceneModule(input.projectDir, input.entryFile)
  const entryFile = input.entryFile
    ?? (writes.some((item) => item.file === storedEntry.file) ? storedEntry.file : writes[0]!.file)

  if (input.expectedRevision && writes.length === 1) {
    const current = await readSceneModule(input.projectDir, writes[0]!.file)
    if (input.expectedRevision !== current.revision) {
      const diagnostic = revisionConflictDiagnostic(input.expectedRevision, current.revision)
      return {
        ok: false,
        statusCode: 409,
        payload: rejectedSceneScriptPayload(diagnostic.message, [diagnostic], {
          code: diagnostic.code,
          compatibility: {
            expectedRevision: input.expectedRevision,
            actualRevision: current.revision,
          },
        }),
      }
    }
  }

  const authoring = await readAuthoringState(input.projectDir)
  if (input.expectedProjectRevision && authoring?.projectRevision
    && input.expectedProjectRevision !== authoring.projectRevision) {
    const diagnostic = revisionConflictDiagnostic(input.expectedProjectRevision, authoring.projectRevision)
    return {
      ok: false,
      statusCode: 409,
      payload: rejectedSceneScriptPayload(
        'Scene project revision changed since the last read.',
        [diagnostic],
        {
          code: 'scene-project-revision-conflict',
          compatibility: {
            expectedProjectRevision: input.expectedProjectRevision,
            actualProjectRevision: authoring.projectRevision,
          },
        },
      ),
    }
  }

  const beforeSnapshot = await canonicalSnapshot(input.projectDir)
  const registry = await getSceneContractRegistry()
  const canonicalWrites: SceneModuleWrite[] = []
  for (const write of writes) {
    const parsed = parseSceneModule(write.source, { file: write.file, registry })
    const canonical = input.canonicalize === false || hasErrors(parsed.diagnostics)
      ? write.source
      : printSceneModule(parsed.module)
    canonicalWrites.push({ file: write.file, source: canonical })
  }
  const overrides = Object.fromEntries(canonicalWrites.map((item) => [item.file, item.source]))
  const entrySource = overrides[entryFile] ?? storedEntry.source
  const projectCompile = await compileStoredSceneProject(input.projectDir, {
    entryFile,
    entrySource,
    sourceOverrides: overrides,
    projectId: input.projectId,
    registry,
  })
  const compiled = projectCompile.compiled
  const diagnostics = requireResultCapture(
    projectCompile.diagnostics,
    compiled.resultEntityIds,
    compiled.resultCaptures,
  )
  if (hasErrors(diagnostics)) {
    return {
      ok: false,
      statusCode: 422,
      payload: rejectedSceneScriptPayload('Scene Script has structured diagnostics.', diagnostics),
    }
  }

  const currentLayout = await readAuthoringLayout(input.projectDir)
  const runtimeGraph = applyStoredLayout(
    compiledOpsToKernelGraph(compiled.ops),
    currentLayout,
    compiled.sourceMap,
  )
  const previousRuntimeGraph = await currentRuntimeGraph(input.projectId)
  const imported = await importCompiledGraphIncrementally(
    await getRuntimeForProject(input.projectId),
    runtimeGraph,
    {
      actor: input.actor,
      label: input.label ?? 'Commit Scene Script project',
    },
  )
  if (imported.status !== 'ok') {
    return {
      ok: false,
      statusCode: 422,
      payload: rejectedSceneScriptPayload(
        imported.reason ?? 'Runtime Graph import was rejected.',
        [...diagnostics, ...runtimeImportDiagnostics(imported.diagnostics)],
        { transaction: { applied: false, rolledBack: true } },
      ),
    }
  }

  const dependencyGraph = Object.fromEntries(Object.entries(projectCompile.incremental.modules).map(
    ([moduleId, item]) => [moduleId, {
      dependencies: item.dependencies,
      dependents: item.dependents,
      publicSignatureHash: item.publicSignatureHash,
      semanticHash: item.semanticHash,
    }],
  ))
  try {
    const graphHash = imported.newHash
    if (!graphHash) {
      throw new Error('Runtime Graph import succeeded without returning a graph hash.')
    }
    const state = await writeSceneProjectTransaction(
      input.projectDir,
      entryFile,
      canonicalWrites,
      compiled.sourceMap,
      graphHash,
      dependencyGraph,
      currentLayout,
    )
    if (beforeSnapshot) {
      const afterSnapshot = await captureAuthoringSourceSnapshot(input.projectDir, beforeSnapshot.entryFile)
      await recordAuthoringTransaction(
        input.projectDir,
        beforeSnapshot,
        afterSnapshot,
        input.label ?? 'Commit Scene Script project',
      )
    }
    const projectRevision = state.projectRevision ?? state.sourceRevision
    const primary = await readSceneModule(input.projectDir, canonicalWrites[0]!.file)
    const revision = input.kind === 'direct-put' ? primary.revision : projectRevision
    await noteCompiledRevision(
      input.projectDir,
      input.projectId,
      projectRevision,
      input.kind,
      hashSceneSource(overrides),
    )
    await sceneScriptDraftPreviews.invalidateProject(input.projectId).catch(() => 0)
    const entryWrite = canonicalWrites.find((item) => item.file === entryFile)
    return {
      ok: true,
      status: 'ok',
      revision,
      projectRevision,
      graphHash,
      diagnostics: toPublicSceneDiagnostics(diagnostics),
      transaction: {
        applied: true,
        rolledBack: false,
        ...(imported.batchId ? { undoToken: imported.batchId } : {}),
      },
      sourceMap: compiled.sourceMap,
      ...(entryWrite ? { canonicalSource: entryWrite.source } : {}),
      files: canonicalWrites.map((item) => item.file),
      entityCount: compiled.entityIds.length,
      operationCount: compiled.ops.length,
      sourceHash: hashSceneSource(overrides),
      incremental: projectCompile.incremental,
      runtimeImpact: {
        changedOperationCount: imported.changedOperationCount,
        invalidatedNodeCount: imported.invalidatedNodeCount ?? 0,
      },
    }
  } catch (error) {
    if (previousRuntimeGraph) {
      await importPipelineGraph(
        await getRuntimeForProject(input.projectId),
        { format: 'kernel-graph-v1', graph: previousRuntimeGraph },
        { mode: 'replace', actor: 'scene-script:rollback', label: 'Rollback failed Scene Script transaction' },
      )
    }
    await rollbackSourceSnapshot(
      input.projectId,
      input.projectDir,
      beforeSnapshot,
      'Rollback unrecorded Scene Script transaction',
    )
    throw error
  }
}
