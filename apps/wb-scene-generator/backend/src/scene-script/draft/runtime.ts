import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import {
  compiledOpsToKernelGraph,
  stableHash,
  toPublicSceneDiagnostics,
  type SceneDiagnostic,
  type SourceMapEntry,
} from '@forgeax/scene-authoring'
import {
  createRuntime,
  executeNode,
  importPipelineGraph,
  type ExecutionResult,
  type OpRegistry,
  type Runtime,
} from '@forgeax/node-runtime'

import {
  getProjectDir,
  getProjectOpOverlay,
  getRuntimeForProject,
  releaseProjectOpOverlay,
} from '../../runtime.js'
import { getSceneContractRegistry } from '../contracts/contracts.js'
import { compileStoredSceneProject } from '../compile/projectCompiler.js'
import { executionResultDiagnostics, revisionConflictDiagnostic, runtimeImportDiagnostics } from '../diagnostics.js'
import { isAllowedSceneSourcePath, readAuthoringState, readSceneModule } from '../persist/store.js'

export interface DraftPreviewFile {
  file: string
  source: string
}

export interface DraftPreviewRequest {
  projectId: string
  draftId: string
  generation?: number
  files: DraftPreviewFile[]
  entryFile: string
  expectedProjectRevision: string
  execute: boolean
}

export interface DraftCompilation {
  diagnostics: SceneDiagnostic[]
  sourceMap: SourceMapEntry[]
  graph: ReturnType<typeof compiledOpsToKernelGraph>
  entityCount: number
  operationCount: number
  runtimeRegistry: OpRegistry
  runtimeKey: string
}

export interface DraftCandidate {
  execute(): Promise<{ result: ExecutionResult; diagnostics: SceneDiagnostic[] }>
  dispose(): Promise<void>
}

export interface DraftPreviewDependencies {
  currentProjectRevision(projectId: string): Promise<string | null>
  compile(request: DraftPreviewRequest, generation: number): Promise<DraftCompilation>
  createCandidate(request: DraftPreviewRequest, compilation: DraftCompilation): Promise<DraftCandidate>
}

interface DraftSlot {
  generation: number
  lastGood?: {
    previewRevision: string
    runtime: DraftCandidate
  }
}

export type DraftPreviewResult =
  | {
      status: 'compiled'
      generation: number
      previewRevision: string
      diagnostics: SceneDiagnostic[]
      sourceMap: SourceMapEntry[]
      entityCount: number
      operationCount: number
      executed: false
    }
  | {
      status: 'ok'
      generation: number
      previewRevision: string
      diagnostics: SceneDiagnostic[]
      sourceMap: SourceMapEntry[]
      entityCount: number
      operationCount: number
      executed: true
      execution: ExecutionResult
      render: {
        graph: ReturnType<typeof compiledOpsToKernelGraph>
        outputs: ExecutionResult['outputs']
        ops: ReturnType<OpRegistry['list']>
      }
    }
  | {
      status: 'rejected' | 'stale'
      generation: number
      diagnostics: SceneDiagnostic[]
      retainedPreviewRevision?: string
      currentGeneration?: number
    }

export class DraftPreviewRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
    readonly diagnostics: SceneDiagnostic[] = [],
  ) {
    super(message)
  }
}

function keyFor(projectId: string, draftId: string): string {
  return `${projectId}\0${draftId}`
}

function normalizeRequest(request: DraftPreviewRequest): DraftPreviewRequest {
  if (!request.projectId || !request.draftId) {
    throw new DraftPreviewRequestError('projectId and draftId are required', 400, 'draft-preview-invalid-request')
  }
  if (request.generation !== undefined
    && (!Number.isSafeInteger(request.generation) || request.generation < 1)) {
    throw new DraftPreviewRequestError('generation must be a positive integer', 400, 'draft-preview-invalid-generation')
  }
  if (!request.entryFile || !isAllowedSceneSourcePath(request.entryFile)) {
    throw new DraftPreviewRequestError('entryFile must be an allowed Scene Script path', 400, 'draft-preview-invalid-entry')
  }
  if (!request.expectedProjectRevision) {
    throw new DraftPreviewRequestError('expectedProjectRevision is required', 400, 'draft-preview-revision-required')
  }
  if (!Array.isArray(request.files) || request.files.length === 0) {
    throw new DraftPreviewRequestError('files must contain at least one { file, source } entry', 400, 'draft-preview-files-required')
  }
  const files = new Map<string, string>()
  for (const item of request.files) {
    const file = item?.file?.replace(/\\/g, '/').replace(/^\/+/, '')
    if (!file || !isAllowedSceneSourcePath(file) || typeof item.source !== 'string') {
      throw new DraftPreviewRequestError('files must contain valid { file, source } entries', 400, 'draft-preview-invalid-file')
    }
    files.set(file, item.source)
  }
  return { ...request, files: [...files].map(([file, source]) => ({ file, source })) }
}

function previewRevisionFor(request: DraftPreviewRequest): string {
  return stableHash(JSON.stringify({
    projectRevision: request.expectedProjectRevision,
    entryFile: request.entryFile,
    files: [...request.files].sort((left, right) => left.file.localeCompare(right.file)),
  }))
}

function hasErrors(diagnostics: readonly SceneDiagnostic[]): boolean {
  return diagnostics.some((item) => item.severity === 'error')
}

/**
 * Coordinates draft compiles and scratch executions without touching canonical
 * source, the canonical Runtime Graph, or authoring transaction history.
 */
export class DraftPreviewManager {
  private readonly slots = new Map<string, DraftSlot>()

  constructor(private readonly dependencies: DraftPreviewDependencies = defaultDependencies) {}

  async preview(rawRequest: DraftPreviewRequest): Promise<DraftPreviewResult> {
    const request = normalizeRequest(rawRequest)
    const actualRevision = await this.dependencies.currentProjectRevision(request.projectId)
    if (!actualRevision) {
      throw new DraftPreviewRequestError(
        `project not found: ${request.projectId}`,
        404,
        'draft-preview-project-not-found',
      )
    }
    if (actualRevision !== request.expectedProjectRevision) {
      const diagnostic = revisionConflictDiagnostic(request.expectedProjectRevision, actualRevision)
      throw new DraftPreviewRequestError(
        'Scene project revision changed since the draft was created.',
        409,
        'scene-project-revision-conflict',
        toPublicSceneDiagnostics([diagnostic]),
      )
    }

    const key = keyFor(request.projectId, request.draftId)
    const slot = this.slots.get(key) ?? { generation: 0 }
    const generation = request.generation ?? slot.generation + 1
    if (generation <= slot.generation) {
      return this.staleResult(slot, generation, [])
    }
    slot.generation = generation
    this.slots.set(key, slot)
    const compilation = await this.dependencies.compile(request, generation)
    const diagnostics = toPublicSceneDiagnostics(compilation.diagnostics)
    if (generation !== slot.generation) {
      releaseProjectOpOverlay(compilation.runtimeKey)
      return this.staleResult(slot, generation, diagnostics)
    }
    if (hasErrors(compilation.diagnostics)) {
      releaseProjectOpOverlay(compilation.runtimeKey)
      return {
        status: 'rejected',
        generation,
        diagnostics,
        ...(slot.lastGood ? { retainedPreviewRevision: slot.lastGood.previewRevision } : {}),
      }
    }

    const previewRevision = previewRevisionFor(request)
    if (!request.execute) {
      releaseProjectOpOverlay(compilation.runtimeKey)
      return {
        status: 'compiled',
        generation,
        previewRevision,
        diagnostics,
        sourceMap: compilation.sourceMap,
        entityCount: compilation.entityCount,
        operationCount: compilation.operationCount,
        executed: false,
      }
    }

    let candidate: DraftCandidate
    try {
      candidate = await this.dependencies.createCandidate(request, compilation)
    } catch (error) {
      releaseProjectOpOverlay(compilation.runtimeKey)
      const diagnostic = runtimeImportDiagnostics([{
        severity: 'error',
        message: error instanceof Error ? error.message : String(error),
      }])
      return {
        status: 'rejected',
        generation,
        diagnostics: toPublicSceneDiagnostics(diagnostic),
        ...(slot.lastGood ? { retainedPreviewRevision: slot.lastGood.previewRevision } : {}),
      }
    }
    let execution: Awaited<ReturnType<DraftCandidate['execute']>>
    try {
      execution = await candidate.execute()
    } catch (error) {
      await candidate.dispose()
      return {
        status: 'rejected',
        generation,
        diagnostics: toPublicSceneDiagnostics(runtimeImportDiagnostics([{
          severity: 'error',
          message: error instanceof Error ? error.message : String(error),
        }])),
        ...(slot.lastGood ? { retainedPreviewRevision: slot.lastGood.previewRevision } : {}),
      }
    }
    if (generation !== slot.generation) {
      await candidate.dispose()
      releaseProjectOpOverlay(compilation.runtimeKey)
      return this.staleResult(slot, generation, toPublicSceneDiagnostics(execution.diagnostics))
    }
    if (execution.result.status !== 'completed' || hasErrors(execution.diagnostics)) {
      await candidate.dispose()
      releaseProjectOpOverlay(compilation.runtimeKey)
      return {
        status: 'rejected',
        generation,
        diagnostics: toPublicSceneDiagnostics(execution.diagnostics),
        ...(slot.lastGood ? { retainedPreviewRevision: slot.lastGood.previewRevision } : {}),
      }
    }

    const previous = slot.lastGood
    slot.lastGood = { previewRevision, runtime: candidate }
    if (previous) await previous.runtime.dispose()
    return {
      status: 'ok',
      generation,
      previewRevision,
      diagnostics: toPublicSceneDiagnostics([...compilation.diagnostics, ...execution.diagnostics]),
      sourceMap: compilation.sourceMap,
      entityCount: compilation.entityCount,
      operationCount: compilation.operationCount,
      executed: true,
      execution: execution.result,
      render: {
        graph: compilation.graph,
        outputs: execution.result.outputs,
        ops: compilation.runtimeRegistry.list(),
      },
    }
  }

  async cleanup(projectId: string, draftId: string): Promise<boolean> {
    const key = keyFor(projectId, draftId)
    const slot = this.slots.get(key)
    if (!slot) return false
    slot.generation += 1
    this.slots.delete(key)
    if (slot.lastGood) await slot.lastGood.runtime.dispose()
    return true
  }

  async invalidateProject(projectId: string): Promise<number> {
    const keys = [...this.slots.keys()].filter((key) => key.startsWith(`${projectId}\0`))
    await Promise.all(keys.map(async (key) => {
      const draftId = key.slice(projectId.length + 1)
      await this.cleanup(projectId, draftId)
    }))
    return keys.length
  }

  lastGoodRevision(projectId: string, draftId: string): string | undefined {
    return this.slots.get(keyFor(projectId, draftId))?.lastGood?.previewRevision
  }

  private staleResult(slot: DraftSlot, generation: number, diagnostics: SceneDiagnostic[]): DraftPreviewResult {
    return {
      status: 'stale',
      generation,
      currentGeneration: slot.generation,
      diagnostics,
      ...(slot.lastGood ? { retainedPreviewRevision: slot.lastGood.previewRevision } : {}),
    }
  }
}

async function createScratchCandidate(
  request: DraftPreviewRequest,
  compilation: DraftCompilation,
): Promise<DraftCandidate> {
  const canonicalRuntime = await getRuntimeForProject(request.projectId)
  const scratch = await mkdtemp(resolve(tmpdir(), 'forgeax-scene-draft-'))
  const runtime: Runtime = createRuntime({
    projectRoot: scratch,
    pipelineId: compilation.runtimeKey,
    pluginId: canonicalRuntime.config.pluginId,
    registry: compilation.runtimeRegistry,
    ...(canonicalRuntime.config.gameRoot ? { gameRoot: canonicalRuntime.config.gameRoot } : {}),
    ...(canonicalRuntime.config.createExecutionContext
      ? { createExecutionContext: canonicalRuntime.config.createExecutionContext }
      : {}),
    layout: {
      assetsDir: canonicalRuntime.config.layout?.assetsDir
        ?? resolve(canonicalRuntime.config.projectRoot, 'assets'),
    },
  })
  const imported = await importPipelineGraph(
    runtime,
    { format: 'kernel-graph-v1', graph: compilation.graph },
    { mode: 'replace', actor: 'scene-script:draft-preview', label: `Preview draft ${request.draftId}` },
  )
  if (imported.status !== 'ok') {
    runtime.dispose()
    await rm(scratch, { recursive: true, force: true })
    throw new Error(imported.reason ?? 'Draft Runtime Graph import was rejected.')
  }
  return {
    async execute() {
      const result = await (await executeNode(runtime, {})).done
      return {
        result,
        diagnostics: executionResultDiagnostics(result, compilation.sourceMap),
      }
    },
    async dispose() {
      runtime.dispose()
      releaseProjectOpOverlay(compilation.runtimeKey)
      await rm(scratch, { recursive: true, force: true })
    },
  }
}

const defaultDependencies: DraftPreviewDependencies = {
  async currentProjectRevision(projectId) {
    const projectDir = await getProjectDir(projectId)
    if (!projectDir) return null
    const [state, stored] = await Promise.all([
      readAuthoringState(projectDir),
      readSceneModule(projectDir),
    ])
    return state?.projectRevision ?? state?.sourceRevision ?? stored.revision
  },
  async compile(request, generation) {
    const projectDir = await getProjectDir(request.projectId)
    if (!projectDir) {
      throw new DraftPreviewRequestError(
        `project not found: ${request.projectId}`,
        404,
        'draft-preview-project-not-found',
      )
    }
    await getRuntimeForProject(request.projectId)
    const runtimeKey = `${request.projectId}:draft:${request.draftId}:${generation}`
    const sourceOverrides = Object.fromEntries(request.files.map((item) => [item.file, item.source]))
    const entrySource = sourceOverrides[request.entryFile]
      ?? (await readSceneModule(projectDir, request.entryFile)).source
    const project = await compileStoredSceneProject(projectDir, {
      entryFile: request.entryFile,
      entrySource,
      sourceOverrides,
      projectId: runtimeKey,
      registry: await getSceneContractRegistry(),
    })
    return {
      diagnostics: project.diagnostics,
      sourceMap: project.compiled.sourceMap,
      graph: compiledOpsToKernelGraph(project.compiled.ops),
      entityCount: project.compiled.entityIds.length,
      operationCount: project.compiled.ops.length,
      runtimeRegistry: getProjectOpOverlay(runtimeKey),
      runtimeKey,
    }
  },
  createCandidate: createScratchCandidate,
}

export const sceneScriptDraftPreviews = new DraftPreviewManager()
