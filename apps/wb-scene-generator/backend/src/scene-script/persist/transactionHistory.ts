import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import {
  compiledOpsToKernelGraph,
  stableHash,
  type SourceMapEntry,
} from '@forgeax/scene-authoring'
import {
  getPipeline,
  importPipelineGraph,
  listGroups,
  type KernelGraphV1,
} from '@forgeax/node-runtime'

import { getRuntimeForProject } from '../../runtime.js'
import { getSceneContractRegistry } from '../contracts/contracts.js'
import { compileStoredSceneProject } from '../compile/projectCompiler.js'
import {
  allSceneFiles,
  layoutKey,
  readAuthoringLayout,
  readAuthoringState,
  readSceneModule,
  writeSceneProjectTransaction,
  type AuthoringLayout,
  type AuthoringState,
} from './store.js'

const HISTORY_LIMIT = 50

export interface AuthoringSourceSnapshot {
  entryFile: string
  modules: Record<string, string>
  layout: AuthoringLayout
}

export interface AuthoringTransactionEntry {
  id: string
  label: string
  createdAt: string
  before: AuthoringSourceSnapshot
  after: AuthoringSourceSnapshot
  beforeRevision: string
  afterRevision: string
}

interface AuthoringTransactionHistory {
  schemaVersion: 1
  cursor: number
  entries: AuthoringTransactionEntry[]
}

export interface AuthoringHistoryStatus {
  cursor: number
  length: number
  canUndo: boolean
  canRedo: boolean
}

function historyFile(projectDir: string): string {
  return resolve(projectDir, 'state', 'authoring-history.json')
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temporary, contents, 'utf8')
  await rename(temporary, path)
}

async function readHistory(projectDir: string): Promise<AuthoringTransactionHistory> {
  try {
    const value = JSON.parse(await readFile(historyFile(projectDir), 'utf8')) as AuthoringTransactionHistory
    if (value.schemaVersion === 1 && Array.isArray(value.entries) && Number.isInteger(value.cursor)) return value
  } catch {
    // A project without history starts at an empty cursor.
  }
  return { schemaVersion: 1, cursor: 0, entries: [] }
}

async function writeHistory(projectDir: string, history: AuthoringTransactionHistory): Promise<void> {
  await atomicWrite(historyFile(projectDir), `${JSON.stringify(history, null, 2)}\n`)
}

function sortedRecord<T>(value: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))
}

export function authoringSnapshotRevision(snapshot: AuthoringSourceSnapshot): string {
  return stableHash(JSON.stringify({
    entryFile: snapshot.entryFile,
    modules: sortedRecord(snapshot.modules),
    layout: sortedRecord(snapshot.layout),
  }))
}

export async function captureAuthoringSourceSnapshot(
  projectDir: string,
  entryFile = 'main.scene.ts',
): Promise<AuthoringSourceSnapshot> {
  const modules = Object.fromEntries(await Promise.all((await allSceneFiles(projectDir)).map(async (file) => [
    file,
    (await readSceneModule(projectDir, file)).source,
  ])))
  return {
    entryFile,
    modules: sortedRecord(modules),
    layout: sortedRecord(await readAuthoringLayout(projectDir)),
  }
}

export async function getAuthoringHistoryStatus(projectDir: string): Promise<AuthoringHistoryStatus> {
  const history = await readHistory(projectDir)
  return {
    cursor: history.cursor,
    length: history.entries.length,
    canUndo: history.cursor > 0,
    canRedo: history.cursor < history.entries.length,
  }
}

export async function recordAuthoringTransaction(
  projectDir: string,
  before: AuthoringSourceSnapshot,
  after: AuthoringSourceSnapshot,
  label: string,
): Promise<AuthoringHistoryStatus> {
  const beforeRevision = authoringSnapshotRevision(before)
  const afterRevision = authoringSnapshotRevision(after)
  const history = await readHistory(projectDir)
  if (beforeRevision === afterRevision) return getAuthoringHistoryStatus(projectDir)
  const entry: AuthoringTransactionEntry = {
    id: stableHash(`${beforeRevision}\0${afterRevision}\0${Date.now()}`),
    label,
    createdAt: new Date().toISOString(),
    before,
    after,
    beforeRevision,
    afterRevision,
  }
  const branched = history.entries.slice(0, history.cursor)
  branched.push(entry)
  const entries = branched.slice(-HISTORY_LIMIT)
  const next = { schemaVersion: 1 as const, cursor: entries.length, entries }
  await writeHistory(projectDir, next)
  return getAuthoringHistoryStatus(projectDir)
}

function applyStoredLayout(
  graph: KernelGraphV1,
  layout: AuthoringLayout,
  sourceMap: SourceMapEntry[],
): KernelGraphV1 {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : Object.values(graph.nodes)
  const groups = graph.groups
    ? (Array.isArray(graph.groups) ? graph.groups : Object.values(graph.groups))
    : []
  for (const item of [...nodes, ...groups]) {
    const mapped = sourceMap.find((entry) =>
      entry.entityId === item.id || entry.runtimeNodeIds.includes(item.id))
    const position = mapped ? layout[layoutKey(mapped.moduleId, mapped.statementId)] : layout[item.id]
    if (position) item.position = { ...position }
  }
  return graph
}

function runtimeGraph(projectId: string): Promise<KernelGraphV1 | undefined> {
  return getRuntimeForProject(projectId).then((runtime) => {
    const pipeline = getPipeline(runtime)
    if (!pipeline) return undefined
    const groups = listGroups(runtime)
    return {
      nodes: pipeline.nodes,
      edges: pipeline.edges,
      ...(groups.length ? { groups } : {}),
      ...(pipeline.metadata ? { metadata: pipeline.metadata } : {}),
    }
  })
}

export async function restoreAuthoringSourceSnapshot(
  projectId: string,
  projectDir: string,
  snapshot: AuthoringSourceSnapshot,
  options: { actor: string; label: string },
): Promise<{ state: AuthoringState; graphHash?: string; sourceMap: SourceMapEntry[] }> {
  const entrySource = snapshot.modules[snapshot.entryFile]
  if (entrySource === undefined) throw new Error(`History snapshot is missing entry module '${snapshot.entryFile}'.`)
  const registry = await getSceneContractRegistry()
  const compiled = await compileStoredSceneProject(projectDir, {
    entryFile: snapshot.entryFile,
    entrySource,
    sourceOverrides: snapshot.modules,
    projectId,
    registry,
  })
  const errors = compiled.diagnostics.filter((item) => item.severity === 'error')
  if (errors.length) throw new Error(`History snapshot no longer compiles: ${errors.map((item) => item.message).join('; ')}`)

  const previousGraph = await runtimeGraph(projectId)
  const graph = applyStoredLayout(
    compiledOpsToKernelGraph(compiled.compiled.ops),
    snapshot.layout,
    compiled.compiled.sourceMap,
  )
  const imported = await importPipelineGraph(
    await getRuntimeForProject(projectId),
    { format: 'kernel-graph-v1', graph },
    { mode: 'replace', actor: options.actor, label: options.label },
  )
  if (imported.status !== 'ok') throw new Error(imported.reason ?? 'Runtime Graph restore was rejected.')

  const dependencyGraph = Object.fromEntries(Object.entries(compiled.incremental.modules).map(
    ([moduleId, item]) => [moduleId, {
      dependencies: item.dependencies,
      dependents: item.dependents,
      publicSignatureHash: item.publicSignatureHash,
      semanticHash: item.semanticHash,
    }],
  ))
  const currentFiles = await allSceneFiles(projectDir)
  try {
    const state = await writeSceneProjectTransaction(
      projectDir,
      snapshot.entryFile,
      Object.entries(snapshot.modules).map(([file, source]) => ({ file, source })),
      compiled.compiled.sourceMap,
      imported.newHash,
      dependencyGraph,
      snapshot.layout,
      currentFiles.filter((file) => !(file in snapshot.modules)),
    )
    return { state, graphHash: imported.newHash, sourceMap: compiled.compiled.sourceMap }
  } catch (error) {
    if (previousGraph) {
      await importPipelineGraph(
        await getRuntimeForProject(projectId),
        { format: 'kernel-graph-v1', graph: previousGraph },
        { mode: 'replace', actor: 'scene-script:rollback', label: `Rollback ${options.label}` },
      )
    }
    throw error
  }
}

export async function applyAuthoringHistory(
  projectId: string,
  projectDir: string,
  direction: 'undo' | 'redo',
  expectedProjectRevision: string,
): Promise<{
  status: 'ok'
  direction: 'undo' | 'redo'
  projectRevision: string
  graphHash?: string
  sourceMap: SourceMapEntry[]
  history: AuthoringHistoryStatus
}> {
  const state = await readAuthoringState(projectDir)
  const actualRevision = state?.projectRevision ?? state?.sourceRevision
  if (!actualRevision || actualRevision !== expectedProjectRevision) {
    const error = new Error(`Scene Project revision conflict: expected '${expectedProjectRevision}', actual '${actualRevision ?? 'none'}'.`)
    Object.assign(error, { code: 'SCENE_REVISION_CONFLICT', actualRevision })
    throw error
  }
  const history = await readHistory(projectDir)
  const index = direction === 'undo' ? history.cursor - 1 : history.cursor
  const entry = history.entries[index]
  if (!entry) {
    const error = new Error(`Nothing to ${direction}.`)
    Object.assign(error, { code: `SCENE_${direction.toUpperCase()}_EMPTY` })
    throw error
  }
  const current = await captureAuthoringSourceSnapshot(projectDir, entry.after.entryFile)
  const expectedSnapshotRevision = direction === 'undo' ? entry.afterRevision : entry.beforeRevision
  if (authoringSnapshotRevision(current) !== expectedSnapshotRevision) {
    const error = new Error('Scene Project sources changed outside the recorded authoring transaction history.')
    Object.assign(error, { code: 'SCENE_HISTORY_DIVERGED' })
    throw error
  }
  const target = direction === 'undo' ? entry.before : entry.after
  const restored = await restoreAuthoringSourceSnapshot(projectId, projectDir, target, {
    actor: `scene-script:${direction}`,
    label: `${direction === 'undo' ? 'Undo' : 'Redo'} ${entry.label}`,
  })
  const nextHistory = { ...history, cursor: direction === 'undo' ? history.cursor - 1 : history.cursor + 1 }
  try {
    await writeHistory(projectDir, nextHistory)
  } catch (error) {
    await restoreAuthoringSourceSnapshot(projectId, projectDir, current, {
      actor: 'scene-script:rollback',
      label: `Rollback failed ${direction} history cursor`,
    })
    throw error
  }
  return {
    status: 'ok',
    direction,
    projectRevision: restored.state.projectRevision ?? restored.state.sourceRevision,
    ...(restored.graphHash ? { graphHash: restored.graphHash } : {}),
    sourceMap: restored.sourceMap,
    history: {
      cursor: nextHistory.cursor,
      length: nextHistory.entries.length,
      canUndo: nextHistory.cursor > 0,
      canRedo: nextHistory.cursor < nextHistory.entries.length,
    },
  }
}
