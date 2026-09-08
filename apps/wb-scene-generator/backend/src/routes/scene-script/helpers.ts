import {
  artifactHash,
  createSceneDiagnostic,
  type SceneDiagnostic,
} from '@forgeax/scene-authoring'
import {
  createRuntime,
  executeNode,
  getPipeline,
  importPipelineGraph,
  listGroups,
  type KernelGraphV1,
} from '@forgeax/node-runtime'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { getRuntimeForProject } from '../../runtime.js'
import { layoutKey, readSceneModule } from '../../scene-script/persist/store.js'
import {
  captureAuthoringSourceSnapshot,
  restoreAuthoringSourceSnapshot,
  type AuthoringSourceSnapshot,
} from '../../scene-script/persist/transactionHistory.js'

export async function canonicalSnapshot(projectDir: string): Promise<AuthoringSourceSnapshot | null> {
  const stored = await readSceneModule(projectDir)
  if (!stored.source.trim() || !stored.state) return null
  return captureAuthoringSourceSnapshot(projectDir, stored.file)
}

export async function rollbackSourceSnapshot(
  projectId: string,
  projectDir: string,
  snapshot: AuthoringSourceSnapshot | null,
  label: string,
): Promise<void> {
  if (!snapshot) return
  await restoreAuthoringSourceSnapshot(projectId, projectDir, snapshot, {
    actor: 'scene-script:rollback',
    label,
  })
}

export function uniqueBinding(functionName: string, existing: Set<string>): string {
  const normalized = functionName.replace(/[^A-Za-z0-9_$]/g, '') || 'definition'
  const base = /^[A-Za-z_$]/.test(normalized) ? normalized : `definition${normalized}`
  if (!existing.has(base)) return base
  let suffix = 2
  while (existing.has(`${base}${suffix}`)) suffix += 1
  return `${base}${suffix}`
}

export function hasErrors(diagnostics: readonly SceneDiagnostic[]): boolean {
  return diagnostics.some((item) => item.severity === 'error')
}

export function requireResultCapture(
  diagnostics: readonly SceneDiagnostic[],
  resultEntityIds: readonly string[],
  resultCaptures?: ReadonlyArray<{ kind: string; entityId: string }>,
): SceneDiagnostic[] {
  const next = [...diagnostics]
  if (!hasErrors(diagnostics) && resultEntityIds.length === 0) {
    next.push(createSceneDiagnostic({
      code: 'SCENE_RESULT_CAPTURE_REQUIRED',
      phase: 'compile',
      severity: 'error',
      message: 'Canonical Scene Script projects must declare one sceneOutput({ scene }) capture.',
      expected: 'One sceneOutput capture in the canonical entry project.',
      actual: 'No compiled resultEntityIds.',
      operation: 'sceneOutput',
      fixes: [{
        fixId: 'add-scene-output-capture',
        title: 'Capture the final scene',
        edits: [],
      }],
      howToFix: [
        'Add sceneOutput({ scene: finalScene.scene }) once to the canonical project.',
      ],
    }))
  }
  if (!resultCaptures || hasErrors(next)) return next
  const sceneOutputs = resultCaptures.filter((c) => c.kind === 'sceneOutput')
  if (sceneOutputs.length !== 1) {
    next.push(createSceneDiagnostic({
      code: 'SCENE_RESULT_CAPTURE_BLOCKOUT',
      phase: 'compile',
      severity: 'error',
      message: 'Canonical projects must declare exactly one sceneOutput capture.',
      expected: 'Exactly one sceneOutput({ scene }).',
      actual: `sceneOutput count=${sceneOutputs.length}`,
      operation: 'sceneOutput',
      howToFix: ['Keep a single sceneOutput sink for the canonical Scene Script project.'],
    }))
  }
  return next
}

export function applyStoredLayout(
  graph: KernelGraphV1,
  layout: Record<string, { x: number; y: number }> | undefined,
  sourceMap?: Array<{ moduleId: string; statementId: string; entityId: string; runtimeNodeIds: string[] }>,
): KernelGraphV1 {
  if (!layout) return graph
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : Object.values(graph.nodes)
  const groups = graph.groups
    ? (Array.isArray(graph.groups) ? graph.groups : Object.values(graph.groups))
    : []
  for (const node of nodes) {
    const mapped = sourceMap?.find((entry) => entry.entityId === node.id || entry.runtimeNodeIds.includes(node.id))
    const position = (mapped ? layout[layoutKey(mapped.moduleId, mapped.statementId)] : undefined) ?? layout[node.id]
    if (position) node.position = { ...position }
  }
  for (const group of groups) {
    const mapped = sourceMap?.find((entry) => entry.entityId === group.id || entry.runtimeNodeIds.includes(group.id))
    const position = (mapped ? layout[layoutKey(mapped.moduleId, mapped.statementId)] : undefined) ?? layout[group.id]
    if (position) group.position = { ...position }
  }
  return graph
}

export function remapStatementLayout(
  layout: Record<string, { x: number; y: number }>,
  before: Array<{ moduleId: string; statementId: string }>,
  after: Array<{ moduleId: string; statementId: string }>,
): Record<string, { x: number; y: number }> {
  const result = { ...layout }
  for (const next of after) {
    const previous = before.find((item) => item.statementId === next.statementId)
    if (!previous) continue
    const position = layout[layoutKey(previous.moduleId, previous.statementId)]
    if (!position) continue
    delete result[layoutKey(previous.moduleId, previous.statementId)]
    result[layoutKey(next.moduleId, next.statementId)] = position
  }
  return result
}

export async function currentRuntimeGraph(projectId: string): Promise<KernelGraphV1 | undefined> {
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

export async function executeLiftCandidate(projectId: string, graph: KernelGraphV1): Promise<{ resultHash: string }> {
  const sourceRuntime = await getRuntimeForProject(projectId)
  const scratch = await mkdtemp(resolve(tmpdir(), 'forgeax-scene-lift-'))
  const runtime = createRuntime({
    projectRoot: scratch,
    pipelineId: `lift-${projectId}`,
    pluginId: sourceRuntime.config.pluginId,
    registry: sourceRuntime.registry,
    ...(sourceRuntime.config.gameRoot ? { gameRoot: sourceRuntime.config.gameRoot } : {}),
    ...(sourceRuntime.config.createExecutionContext
      ? { createExecutionContext: sourceRuntime.config.createExecutionContext }
      : {}),
    layout: {
      assetsDir: sourceRuntime.config.layout?.assetsDir
        ?? resolve(sourceRuntime.config.projectRoot, 'assets'),
    },
  })
  try {
    const imported = await importPipelineGraph(runtime, { format: 'kernel-graph-v1', graph }, {
      mode: 'replace',
      actor: 'scene-lift:verify',
    })
    if (imported.status !== 'ok') return { resultHash: artifactHash({ status: 'import-rejected', reason: imported.reason }) }
    const result = await (await executeNode(runtime, {})).done
    const outputs = Object.values(result.outputs ?? {}).flatMap((ports) =>
      Object.entries(ports).map(([port, value]) => ({ port, valueHash: artifactHash(value) })))
      .sort((left, right) => left.port.localeCompare(right.port) || left.valueHash.localeCompare(right.valueHash))
    return { resultHash: artifactHash({ status: result.status, outputs }) }
  } finally {
    runtime.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
}
