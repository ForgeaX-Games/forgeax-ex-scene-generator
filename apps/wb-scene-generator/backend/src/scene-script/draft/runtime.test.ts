import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { compiledOpsToKernelGraph, createSceneDiagnostic } from '@forgeax/scene-authoring'
import { OpRegistry, type ExecutionResult } from '@forgeax/node-runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  DraftPreviewManager,
  type DraftCandidate,
  type DraftCompilation,
  type DraftPreviewDependencies,
  type DraftPreviewRequest,
} from './runtime.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function execution(status: ExecutionResult['status'] = 'completed'): ExecutionResult {
  return {
    executionId: `execution-${status}`,
    status,
    outputs: {},
    durationMs: 1,
    ...(status === 'error' ? { error: { message: 'draft execution failed' } } : {}),
  }
}

function compilation(
  generation: number,
  diagnostics: DraftCompilation['diagnostics'] = [],
): DraftCompilation {
  return {
    diagnostics,
    sourceMap: [],
    graph: compiledOpsToKernelGraph([]),
    entityCount: 0,
    operationCount: 0,
    runtimeRegistry: new OpRegistry(),
    runtimeKey: `draft-runtime-${generation}`,
  }
}

function request(overrides: Partial<DraftPreviewRequest> = {}): DraftPreviewRequest {
  return {
    projectId: 'project-a',
    draftId: 'draft-a',
    files: [
      { file: 'main.scene.ts', source: 'import { helper } from "./helper.scene.ts"\nhelper({})' },
      { file: 'helper.scene.ts', source: 'export const helper = defineGroup({})' },
    ],
    entryFile: 'main.scene.ts',
    expectedProjectRevision: 'canonical-r1',
    execute: true,
    ...overrides,
  }
}

function candidate(result: ExecutionResult, disposed: ReturnType<typeof vi.fn>): DraftCandidate {
  return {
    execute: async () => ({
      result,
      diagnostics: result.status === 'completed'
        ? []
        : [createSceneDiagnostic({
            code: 'SCENE_EXECUTE_RUNTIME',
            phase: 'execute',
            severity: 'error',
            message: 'draft execution failed',
          })],
    }),
    dispose: async () => {
      disposed()
    },
  }
}

function dependencies(overrides: Partial<DraftPreviewDependencies> = {}): DraftPreviewDependencies {
  return {
    currentProjectRevision: async () => 'canonical-r1',
    compile: async (_request, generation) => compilation(generation),
    createCandidate: async () => candidate(execution(), vi.fn()),
    ...overrides,
  }
}

describe('DraftPreviewManager', () => {
  it('compiles all source overrides without changing canonical source or history', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'scene-draft-canonical-'))
    temporaryDirectories.push(projectDir)
    const canonicalFile = join(projectDir, 'main.scene.ts')
    const historyFile = join(projectDir, 'history.jsonl')
    await writeFile(canonicalFile, 'canonical source')
    await writeFile(historyFile, '{"canonical":true}\n')
    const compile = vi.fn(async (input: DraftPreviewRequest, generation: number) => {
      expect(Object.fromEntries(input.files.map((item) => [item.file, item.source]))).toEqual({
        'main.scene.ts': expect.stringContaining('./helper.scene.ts'),
        'helper.scene.ts': expect.stringContaining('defineGroup'),
      })
      return compilation(generation)
    })
    const manager = new DraftPreviewManager(dependencies({ compile }))

    const result = await manager.preview(request({ execute: false }))

    expect(result.status).toBe('compiled')
    expect(compile).toHaveBeenCalledOnce()
    expect(await readFile(canonicalFile, 'utf8')).toBe('canonical source')
    expect(await readFile(historyFile, 'utf8')).toBe('{"canonical":true}\n')
  })

  it('returns bounded compile diagnostics and does not create a runtime', async () => {
    const diagnostics = Array.from({ length: 5 }, (_, index) => createSceneDiagnostic({
      code: `SCENE_TEST_${index}`,
      phase: 'compile',
      severity: 'error',
      message: `compile error ${index}`,
    }))
    const createCandidate = vi.fn()
    const manager = new DraftPreviewManager(dependencies({
      compile: async (_input, generation) => compilation(generation, diagnostics),
      createCandidate,
    }))

    const result = await manager.preview(request())

    expect(result.status).toBe('rejected')
    expect(result.diagnostics).toHaveLength(3)
    expect(createCandidate).not.toHaveBeenCalled()
  })

  it('retains last-good preview after a later compile or execution failure', async () => {
    const firstDisposed = vi.fn()
    const failedDisposed = vi.fn()
    let attempt = 0
    const manager = new DraftPreviewManager(dependencies({
      compile: async (_input, generation) => {
        attempt += 1
        return compilation(
          generation,
          attempt === 2
            ? [createSceneDiagnostic({
                code: 'SCENE_COMPILE_TEST',
                phase: 'compile',
                severity: 'error',
                message: 'compile failed',
              })]
            : [],
        )
      },
      createCandidate: async () => attempt === 1
        ? candidate(execution(), firstDisposed)
        : candidate(execution('error'), failedDisposed),
    }))

    const good = await manager.preview(request())
    expect(good.status).toBe('ok')
    const goodRevision = good.status === 'ok' ? good.previewRevision : ''

    const compileFailure = await manager.preview(request({
      files: [{ file: 'main.scene.ts', source: 'broken compile' }],
    }))
    expect(compileFailure).toMatchObject({
      status: 'rejected',
      retainedPreviewRevision: goodRevision,
    })

    const executeFailure = await manager.preview(request({
      files: [{ file: 'main.scene.ts', source: 'valid but runtime fails' }],
    }))
    expect(executeFailure).toMatchObject({
      status: 'rejected',
      retainedPreviewRevision: goodRevision,
    })
    expect(manager.lastGoodRevision('project-a', 'draft-a')).toBe(goodRevision)
    expect(firstDisposed).not.toHaveBeenCalled()
    expect(failedDisposed).toHaveBeenCalledOnce()

    await manager.cleanup('project-a', 'draft-a')
    expect(firstDisposed).toHaveBeenCalledOnce()
  })

  it('discards an older generation that finishes after the latest request', async () => {
    let releaseFirst!: (value: DraftCompilation) => void
    let markFirstStarted!: () => void
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve
    })
    const firstCompile = new Promise<DraftCompilation>((resolve) => {
      releaseFirst = resolve
    })
    const manager = new DraftPreviewManager(dependencies({
      compile: async (_input, generation) => {
        if (generation === 1) {
          markFirstStarted()
          return firstCompile
        }
        return compilation(generation)
      },
    }))

    const older = manager.preview(request({
      files: [{ file: 'main.scene.ts', source: 'older' }],
    }))
    await firstStarted
    const latest = await manager.preview(request({
      files: [{ file: 'main.scene.ts', source: 'latest' }],
    }))
    releaseFirst(compilation(1))
    const stale = await older

    expect(latest.status).toBe('ok')
    expect(stale).toMatchObject({
      status: 'stale',
      generation: 1,
      currentGeneration: 2,
      retainedPreviewRevision: latest.status === 'ok' ? latest.previewRevision : undefined,
    })
    expect(manager.lastGoodRevision('project-a', 'draft-a')).toBe(
      latest.status === 'ok' ? latest.previewRevision : undefined,
    )
  })
})
