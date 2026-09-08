import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { readAuthoringState } from '../persist/store.js'

export type CommitKind = 'scaffold' | 'direct-put' | 'commit-project' | 'edit-lens'

/**
 * Small, revision-centric projection for agents.
 *
 * Authoring AST, Source Map, Edit Lens transactions, diagnostics, and semantic
 * diffs remain owned by @forgeax/scene-authoring. This sidecar only aligns the
 * latest canonical source with compilation, execution, and last-good output.
 */
export interface SceneRevisionState {
  projectId: string
  sourceRevision: string | null
  artifactRevision: string | null
  executedRevision: string | null
  executionId: string | null
  lastGoodRevision: string | null
  lastGoodExecutionId: string | null
  lastCommitKind: CommitKind | null
  lastSourceHash: string | null
  compileOk: boolean | null
  executionOk: boolean | null
  verificationOk: boolean | null
  updatedAt: string
}

function stateFile(projectDir: string): string {
  return resolve(projectDir, 'artifacts', 'scene-authoring', 'revision-state.json')
}

function emptyState(projectId: string): SceneRevisionState {
  return {
    projectId,
    sourceRevision: null,
    artifactRevision: null,
    executedRevision: null,
    executionId: null,
    lastGoodRevision: null,
    lastGoodExecutionId: null,
    lastCommitKind: null,
    lastSourceHash: null,
    compileOk: null,
    executionOk: null,
    verificationOk: null,
    updatedAt: new Date().toISOString(),
  }
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

export async function readSceneRevisionState(
  projectDir: string,
  projectId: string,
): Promise<SceneRevisionState> {
  try {
    const stored = JSON.parse(await readFile(stateFile(projectDir), 'utf8')) as Partial<SceneRevisionState>
    const state = {
      ...emptyState(projectId),
      ...stored,
      projectId,
    }
    const authoring = await readAuthoringState(projectDir)
    const canonicalRevision = authoring?.projectRevision ?? authoring?.sourceRevision ?? null
    if (canonicalRevision && canonicalRevision !== state.sourceRevision) {
      return {
        ...state,
        sourceRevision: canonicalRevision,
        artifactRevision: canonicalRevision,
        compileOk: true,
        executionOk: null,
        verificationOk: null,
        updatedAt: authoring?.updatedAt ?? state.updatedAt,
      }
    }
    return state
  } catch {
    const authoring = await readAuthoringState(projectDir)
    const revision = authoring?.projectRevision ?? authoring?.sourceRevision ?? null
    return {
      ...emptyState(projectId),
      sourceRevision: revision,
      artifactRevision: revision,
      compileOk: revision ? true : null,
      updatedAt: authoring?.updatedAt ?? new Date().toISOString(),
    }
  }
}

export async function writeSceneRevisionState(
  projectDir: string,
  state: SceneRevisionState,
): Promise<SceneRevisionState> {
  const next = { ...state, updatedAt: new Date().toISOString() }
  await atomicJson(stateFile(projectDir), next)
  return next
}

export function hashSceneSource(source: string | Record<string, string>): string {
  const payload = typeof source === 'string'
    ? source
    : Object.entries(source).sort(([left], [right]) => left.localeCompare(right))
      .map(([file, text]) => `${file}\0${text}`)
      .join('\n')
  return createHash('sha256').update(payload).digest('hex')
}

export async function noteCompiledRevision(
  projectDir: string,
  projectId: string,
  revision: string,
  kind: CommitKind,
  sourceHash: string,
): Promise<SceneRevisionState> {
  const state = await readSceneRevisionState(projectDir, projectId)
  return writeSceneRevisionState(projectDir, {
    ...state,
    sourceRevision: revision,
    artifactRevision: revision,
    lastCommitKind: kind,
    lastSourceHash: sourceHash,
    compileOk: true,
    executionOk: null,
    verificationOk: null,
  })
}

export async function noteExecutedRevision(
  projectDir: string,
  projectId: string,
  revision: string,
  executionId: string | undefined,
  executionOk: boolean,
  verificationOk?: boolean,
): Promise<SceneRevisionState> {
  const state = await readSceneRevisionState(projectDir, projectId)
  const accepted = executionOk && verificationOk === true
  return writeSceneRevisionState(projectDir, {
    ...state,
    executedRevision: revision,
    executionId: executionId ?? state.executionId,
    executionOk,
    verificationOk: typeof verificationOk === 'boolean' ? verificationOk : null,
    ...(accepted
      ? {
          lastGoodRevision: revision,
          lastGoodExecutionId: executionId ?? state.lastGoodExecutionId,
        }
      : {}),
  })
}

export function revisionStateSummary(state: SceneRevisionState): Record<string, unknown> {
  const aligned = Boolean(
    state.sourceRevision
    && state.artifactRevision === state.sourceRevision
    && state.executedRevision === state.sourceRevision,
  )
  return {
    sourceRevision: state.sourceRevision,
    artifactRevision: state.artifactRevision,
    executedRevision: state.executedRevision,
    executionId: state.executionId,
    lastGoodRevision: state.lastGoodRevision,
    lastCommitKind: state.lastCommitKind,
    compileOk: state.compileOk,
    executionOk: state.executionOk,
    verificationOk: state.verificationOk,
    evidenceAligned: aligned,
    nextAction: state.compileOk !== true
      ? 'Repair the current source using SceneDiagnostic.'
      : state.executionOk !== true
        ? 'Run the compiled revision and inspect execute diagnostics.'
        : state.verificationOk !== true
          ? 'Revise the scene semantics using verify diagnostics and local evidence.'
          : 'Inspect the rendered result or continue the design.',
  }
}
