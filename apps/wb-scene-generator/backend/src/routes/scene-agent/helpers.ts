import type { FastifyRequest } from 'fastify'

import {
  boundedUnique,
  compiledOpsToKernelGraph,
  parseSceneSemanticAddress,
  SCENE_WORKFLOW_LIMITS,
  stableArtifactStringify,
  type SceneSemanticExpectation,
  type SceneSemanticDiff,
  type SceneTargetQuery,
  type SourceMapEntry,
} from '@forgeax/scene-authoring'
import { getPipeline, importPipelineGraph, listGroups, type KernelGraphV1 } from '@forgeax/node-runtime'

import { getRuntimeForProject } from '../../runtime.js'
import { getSceneContractRegistry } from '../../scene-script/contracts/contracts.js'
import { compileStoredSceneProject } from '../../scene-script/compile/projectCompiler.js'
import {
  readAuthoringLayout,
  readSceneModule,
  writeSceneProjectTransaction,
} from '../../scene-script/persist/store.js'
import { type StoredSceneTransaction } from '../../scene-script/agent/workflowStore.js'

export function now(): string {
  return new Date().toISOString()
}

export function transactionId(): string {
  return `scene-edit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function hasErrors(diagnostics: Array<{ severity: string }>): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error')
}

export function sourceLine(source: string, start: number, end: number): string {
  return source.slice(start, end).slice(0, SCENE_WORKFLOW_LIMITS.maxStringLength)
}

export function allReferences(expression: unknown): string[] {
  if (!expression || typeof expression !== 'object') return []
  if ((expression as { kind?: string }).kind === 'reference') {
    const binding = (expression as { binding?: unknown }).binding
    return typeof binding === 'string' ? [binding] : []
  }
  if ((expression as { kind?: string }).kind === 'array') {
    return ((expression as { items?: unknown[] }).items ?? []).flatMap(allReferences)
  }
  if ((expression as { kind?: string }).kind === 'object') {
    return Object.values((expression as { properties?: Record<string, unknown> }).properties ?? {}).flatMap(allReferences)
  }
  return []
}

export function copyCallerHeaders(req: FastifyRequest): Record<string, string> {
  const names = ['x-forgeax-caller-kind', 'x-forgeax-caller-agent-id', 'x-forgeax-caller-session-id']
  return Object.fromEntries(names.flatMap((name) => {
    const value = req.headers[name]
    return typeof value === 'string' ? [[name, value]] : []
  }))
}

export async function currentGraph(projectId: string): Promise<KernelGraphV1 | undefined> {
  const runtime = await getRuntimeForProject(projectId)
  const pipeline = getPipeline(runtime)
  if (!pipeline) return undefined
  const groups = listGroups(runtime)
  return {
    nodes: pipeline.nodes,
    edges: pipeline.edges,
    ...(groups.length ? { groups } : {}),
    ...(pipeline.metadata ? { metadata: pipeline.metadata } : {}),
  }
}

export function rankCandidate(
  entry: SourceMapEntry,
  query: SceneTargetQuery,
  lineage: Array<{
    authoring: { statementId: string; entityId: string }
    sceneNodes: Array<{ id: string; path: string }>
  }>,
): { confidence: number; evidence: string[] } | null {
  const evidence: Array<{ score: number; text: string }> = []
  const selection = query.selection
  if (selection?.authoringIds?.some((id) => id === entry.entityId || id === entry.statementId)) {
    evidence.push({ score: 1, text: 'ui-selection:authoring' })
  }
  if (selection?.runtimeNodeIds?.some((id) => entry.runtimeNodeIds.includes(id))) {
    evidence.push({ score: .99, text: 'ui-selection:runtime-source-map' })
  }
  if (selection?.sourceRanges?.some((range) =>
    range.file === entry.file && range.start <= entry.source.end && range.end >= entry.source.start)) {
    evidence.push({ score: .99, text: 'ui-selection:source-range' })
  }
  if (query.authoringId && (query.authoringId === entry.entityId || query.authoringId === entry.statementId)) {
    evidence.push({ score: .98, text: 'stable-authoring-id' })
  }
  const semantic = query.semanticAddress ? parseSceneSemanticAddress(query.semanticAddress) : null
  if (semantic?.moduleId === entry.moduleId && semantic.statementId === entry.statementId) {
    evidence.push({ score: .98, text: 'stable-semantic-address' })
  }
  const related = lineage.filter((item) =>
    item.authoring.entityId === entry.entityId || item.authoring.statementId === entry.statementId)
  const sceneNodeIds = boundedUnique([
    ...(query.sceneNodeId ? [query.sceneNodeId] : []),
    ...(selection?.sceneNodeIds ?? []),
  ], SCENE_WORKFLOW_LIMITS.maxTargets)
  if (sceneNodeIds.some((id) => related.some((item) => item.sceneNodes.some((node) => node.id === id)))) {
    evidence.push({ score: .95, text: 'scene-node-lineage' })
  }
  const paths = boundedUnique([...(query.path ? [query.path] : []), ...(selection?.paths ?? [])], SCENE_WORKFLOW_LIMITS.maxTargets)
  if (paths.some((path) => related.some((item) => item.sceneNodes.some((node) => node.path === path)))) {
    evidence.push({ score: .94, text: 'scene-path-lineage' })
  }
  const selectionAddresses = selection?.semanticAddresses ?? []
  if (selectionAddresses.some((address) => {
    const parsed = parseSceneSemanticAddress(address)
    return parsed?.moduleId === entry.moduleId && parsed.statementId === entry.statementId
  })) evidence.push({ score: .98, text: 'ui-selection:semantic-address' })
  const text = query.query?.trim().toLowerCase()
  if (text && [entry.statementId, entry.entityId, entry.moduleId, entry.file]
    .some((value) => value.toLowerCase().includes(text))) {
    evidence.push({ score: .62, text: 'query-metadata-match' })
  }
  if (!evidence.length) return null
  evidence.sort((left, right) => right.score - left.score || left.text.localeCompare(right.text))
  return {
    confidence: Math.min(1, evidence[0]!.score + Math.max(0, evidence.length - 1) * .005),
    evidence: evidence.map((item) => item.text).slice(0, SCENE_WORKFLOW_LIMITS.maxEvidence),
  }
}

export function statementDigest(statement: unknown): string {
  return stableArtifactStringify(statement)
}

export function semanticDiff(
  id: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  invalidatedModules: string[],
  allModuleIds: string[],
  expected: SceneSemanticExpectation[],
): SceneSemanticDiff {
  const created = Object.keys(after).filter((key) => !(key in before)).sort()
  const removed = Object.keys(before).filter((key) => !(key in after)).sort()
  const updated = Object.keys(after).filter((key) => key in before && statementDigest(after[key]) !== statementDigest(before[key])).sort()
  const directlyChanged = boundedUnique([...created, ...removed, ...updated], SCENE_WORKFLOW_LIMITS.maxTargets * 4)
  const recompiled = boundedUnique(invalidatedModules, SCENE_WORKFLOW_LIMITS.maxTargets * 4)
  const reexecuted = [...recompiled]
  const revalidated = [...recompiled]
  const unchanged = allModuleIds.filter((moduleId) => !recompiled.includes(moduleId)).sort()
  const actual = new Map<string, SceneSemanticExpectation['change']>([
    ...created.map((entityId) => [entityId, 'created'] as const),
    ...updated.map((entityId) => [entityId, 'updated'] as const),
    ...removed.map((entityId) => [entityId, 'removed'] as const),
  ])
  return {
    transactionId: id,
    directlyChanged,
    recompiled,
    reexecuted,
    revalidated,
    unchanged,
    created,
    updated,
    removed,
    expectedDeltaMatches: expected.every((item) =>
      item.change === 'unchanged' ? !actual.has(item.entityId) : actual.get(item.entityId) === item.change),
    payload: 'semantic-summary',
  }
}

export async function restoreTransaction(
  projectId: string,
  projectDir: string,
  stored: StoredSceneTransaction,
): Promise<void> {
  const entry = await readSceneModule(projectDir)
  const registry = await getSceneContractRegistry()
  const compile = await compileStoredSceneProject(projectDir, {
    entryFile: entry.file,
    entrySource: stored.beforeSources[entry.file] ?? entry.source,
    sourceOverrides: stored.beforeSources,
    projectId,
    registry,
  })
  if (hasErrors(compile.diagnostics)) throw new Error('rollback source no longer compiles')
  const layout = await readAuthoringLayout(projectDir)
  const imported = await importPipelineGraph(
    await getRuntimeForProject(projectId),
    { format: 'kernel-graph-v1', graph: compiledOpsToKernelGraph(compile.compiled.ops) },
    { mode: 'replace', actor: 'scene-script:rollback', label: `Revert ${stored.transaction.transactionId}` },
  )
  if (imported.status !== 'ok') throw new Error(imported.reason ?? 'rollback runtime import failed')
  await writeSceneProjectTransaction(
    projectDir,
    entry.file,
    Object.entries(stored.beforeSources).map(([file, source]) => ({ file, source })),
    compile.compiled.sourceMap,
    imported.newHash,
    Object.fromEntries(Object.entries(compile.incremental.modules).map(([moduleId, item]) => [moduleId, {
      dependencies: item.dependencies,
      dependents: item.dependents,
      publicSignatureHash: item.publicSignatureHash,
      semanticHash: item.semanticHash,
    }])),
    layout,
  )
}

export async function projectContext(projectId: string, projectDir: string) {
  const entry = await readSceneModule(projectDir)
  const baseRegistry = await getSceneContractRegistry()
  const project = await compileStoredSceneProject(projectDir, {
    entryFile: entry.file,
    entrySource: entry.source,
    projectId,
    registry: baseRegistry,
  })
  return { entry, registry: project.registry, project }
}
