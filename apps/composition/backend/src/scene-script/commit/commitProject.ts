import { toPublicSceneDiagnostics } from '@forgeax/scene-authoring'
import { importPipelineGraph } from '@forgeax/node-runtime'

import { getRuntimeForProject } from '../../runtime.js'
import {
  allSceneFiles,
  computeSourceProjectRevision,
  isAllowedSceneSourcePath,
  readAuthoringLayout,
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
} from '../diagnostics.js'
import {
  canonicalSnapshot,
  currentRuntimeGraph,
  hasErrors,
  requireResultCapture,
  rollbackSourceSnapshot,
} from '../../routes/scene-script/helpers.js'
import { hashSceneSource, noteCompiledRevision } from '../agent/revisionState.js'
import { sceneScriptDraftPreviews } from '../draft/runtime.js'
import { extractGeneratorSymbols } from '../generator/symbols.js'
import { collectImportSpecifiers, resolveProjectImport } from '@forgeax/scene'
import { runSceneProject, sceneResultCaptures } from '../run/runProject.js'

export interface SceneModulePatch {
  file: string
  targetSymbol?: string
  span?: { start: number; end: number }
  replaceSource: string
}

export interface CommitProjectInput {
  projectId: string
  projectDir: string
  files: SceneModuleWrite[]
  patches?: SceneModulePatch[]
  entryFile?: string
  expectedRevision?: string
  expectedProjectRevision?: string
  canonicalize?: boolean
  label?: string
  actor: 'scene-script:agent' | 'scene-script:user'
  kind: 'direct-put' | 'commit-project'
  clean?: boolean
  deleteFiles?: string[]
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

function incrementalFromFiles(files: Record<string, string>): Record<string, {
  dependencies: string[]
  dependents: string[]
  publicSignatureHash: string
  semanticHash: string
}> {
  const deps = new Map<string, string[]>()
  for (const [file, source] of Object.entries(files)) {
    const next = collectImportSpecifiers(source)
      .filter((specifier) => specifier.startsWith('./') || specifier.startsWith('../'))
      .map((specifier) => resolveProjectImport(file, specifier))
    deps.set(file, next)
  }
  const dependents = new Map<string, string[]>()
  for (const [file, list] of deps) {
    for (const dep of list) {
      dependents.set(dep, [...(dependents.get(dep) ?? []), file])
    }
  }
  return Object.fromEntries([...deps].map(([file, dependencies]) => [file, {
    dependencies,
    dependents: dependents.get(file) ?? [],
    publicSignatureHash: hashSceneSource({ [file]: files[file] ?? '' }),
    semanticHash: hashSceneSource({ [file]: files[file] ?? '' }),
  }]))
}

export async function commitSceneProjectFiles(input: CommitProjectInput): Promise<CommitProjectResult> {
  const writes = [...uniqueWrites(input.files ?? [])]
  if (Array.isArray(input.patches) && input.patches.length > 0) {
    for (const patch of input.patches) {
      if (!patch || typeof patch.file !== 'string' || typeof patch.replaceSource !== 'string') continue
      const targetFile = patch.file.replace(/\\/g, '/').replace(/^\/+/, '')
      const existingWriteIdx = writes.findIndex((w) => w.file === targetFile)
      let baseSource: string
      if (existingWriteIdx >= 0) {
        baseSource = writes[existingWriteIdx]!.source
      } else {
        const stored = await readSceneModule(input.projectDir, targetFile)
        baseSource = stored.source
      }

      let start = patch.span?.start
      let end = patch.span?.end
      if ((start === undefined || end === undefined) && patch.targetSymbol) {
        const { target } = extractGeneratorSymbols(baseSource, patch.targetSymbol)
        if (target) {
          start = target.span.start
          end = target.span.end
        }
      }

      let patchedSource: string
      if (typeof start === 'number' && typeof end === 'number' && start >= 0 && end >= start && end <= baseSource.length) {
        patchedSource = baseSource.slice(0, start) + patch.replaceSource + baseSource.slice(end)
      } else {
        patchedSource = patch.replaceSource
      }

      if (existingWriteIdx >= 0) {
        writes[existingWriteIdx] = { file: targetFile, source: patchedSource }
      } else {
        writes.push({ file: targetFile, source: patchedSource })
      }
    }
  }

  if (writes.length === 0) {
    return {
      ok: false,
      statusCode: 400,
      payload: { status: 'rejected', reason: 'files or patches must contain at least one Scene Script source' },
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

  const actualProjectRevision = await computeSourceProjectRevision(input.projectDir)
  if (input.expectedProjectRevision && input.expectedProjectRevision !== actualProjectRevision) {
    const diagnostic = revisionConflictDiagnostic(input.expectedProjectRevision, actualProjectRevision)
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
            actualProjectRevision,
          },
        },
      ),
    }
  }

  const beforeSnapshot = await canonicalSnapshot(input.projectDir)
  const overrides = Object.fromEntries(writes.map((item) => [item.file, item.source]))
  const previousRuntimeGraph = await currentRuntimeGraph(input.projectId)
  const runtime = await getRuntimeForProject(input.projectId)
  const ran = await runSceneProject({
    projectId: input.projectId,
    projectDir: input.projectDir,
    runtime,
    entryFile,
    sourceOverrides: overrides,
    actor: input.actor,
    label: input.label ?? 'Commit Scene Script project',
  })
  const diagnostics = requireResultCapture(
    ran.diagnostics,
    ran.trace.map((item) => item.id),
    sceneResultCaptures(ran.trace),
  )
  if (hasErrors(diagnostics) && !ran.reusedLastGood) {
    return {
      ok: false,
      statusCode: 422,
      payload: rejectedSceneScriptPayload('Scene Script has structured diagnostics.', diagnostics),
    }
  }
  if (hasErrors(diagnostics)) {
    return {
      ok: false,
      statusCode: 422,
      payload: rejectedSceneScriptPayload('Scene Script has structured diagnostics.', diagnostics),
    }
  }

  const currentLayout = await readAuthoringLayout(input.projectDir)
  const dependencyGraph = incrementalFromFiles({
    ...Object.fromEntries(await Promise.all((await allSceneFiles(input.projectDir)).map(async (file) => [
      file,
      overrides[file] ?? (await readSceneModule(input.projectDir, file)).source,
    ]))),
    ...overrides,
  })
  try {
    const graphHash = ran.result.entryFile + ':' + ran.trace.length
    const deleteFiles = [...(input.deleteFiles ?? [])]
    if (input.clean === true) {
      const existing = await allSceneFiles(input.projectDir)
      const writing = new Set(writes.map((w) => w.file))
      for (const f of existing) {
        if (!writing.has(f)) deleteFiles.push(f)
      }
    }
    const state = await writeSceneProjectTransaction(
      input.projectDir,
      entryFile,
      writes,
      ran.sourceMap,
      graphHash,
      dependencyGraph,
      currentLayout,
      deleteFiles,
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
    const primary = await readSceneModule(input.projectDir, writes[0]!.file)
    const revision = input.kind === 'direct-put' ? primary.revision : projectRevision
    await noteCompiledRevision(
      input.projectDir,
      input.projectId,
      projectRevision,
      input.kind,
      hashSceneSource(overrides),
    )
    await sceneScriptDraftPreviews.invalidateProject(input.projectId).catch(() => 0)
    const entryWrite = writes.find((item) => item.file === entryFile)
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
      },
      sourceMap: ran.sourceMap,
      ...(entryWrite ? { canonicalSource: entryWrite.source } : {}),
      files: writes.map((item) => item.file),
      entityCount: ran.trace.length,
      operationCount: ran.trace.length,
      sourceHash: hashSceneSource(overrides),
      incremental: { modules: dependencyGraph },
      runtimeImpact: {
        changedOperationCount: ran.trace.length,
        invalidatedNodeCount: 0,
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
