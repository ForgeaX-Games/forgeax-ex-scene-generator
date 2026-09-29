import {
  createSceneDiagnostic,
  type SceneDiagnostic,
} from '@forgeax/scene-authoring'
import {
  getPipeline,
  listGroups,
  type KernelGraphV1,
} from '@forgeax/node-runtime'

import { getRuntimeForProject } from '../../runtime.js'
import { uniqueSceneBinding } from '../../scene-script/adapter/writeLanes.js'
import { layoutKey, layoutPositionFor, readSceneModule } from '../../scene-script/persist/store.js'
import {
  captureAuthoringSourceSnapshot,
  restoreAuthoringSourceSnapshot,
  type AuthoringSourceSnapshot,
} from '../../scene-script/persist/transactionHistory.js'

export async function canonicalSnapshot(projectDir: string): Promise<AuthoringSourceSnapshot | null> {
  const stored = await readSceneModule(projectDir)
  if (!stored.source.trim()) return null
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
  return uniqueSceneBinding(functionName, existing)
}

export function hasErrors(diagnostics: readonly SceneDiagnostic[]): boolean {
  return diagnostics.some((item) => item.severity === 'error')
}

export function requireResultCapture(
  diagnostics: readonly SceneDiagnostic[],
  _resultEntityIds: readonly string[],
  resultCaptures?: ReadonlyArray<{ kind: string; entityId: string }>,
): SceneDiagnostic[] {
  const next = [...diagnostics]
  if (!resultCaptures || hasErrors(next)) return next
  const sceneOutputs = resultCaptures.filter((c) => c.kind === 'sceneOutput')
  if (sceneOutputs.length > 1) {
    next.push(createSceneDiagnostic({
      code: 'SCENE_RESULT_CAPTURE_BLOCKOUT',
      phase: 'compile',
      severity: 'error',
      message: 'Canonical projects may declare at most one sceneOutput capture.',
      expected: 'Zero or one sceneOutput({ scene }). Geometry-only scripts need none.',
      actual: `sceneOutput count=${sceneOutputs.length}`,
      operation: 'sceneOutput',
      howToFix: ['Keep a single sceneOutput sink, or omit it when previewing Geometry such as BasePlane.'],
    }))
  }
  return next
}

export function applyStoredLayout(
  graph: KernelGraphV1,
  layout: Record<string, { x: number; y: number }> | undefined,
  sourceMap?: Array<{ moduleId: string; statementId: string; entityId: string; runtimeNodeIds: string[]; argument?: string }>,
): KernelGraphV1 {
  if (!layout) return graph
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : Object.values(graph.nodes)
  const groups = graph.groups
    ? (Array.isArray(graph.groups) ? graph.groups : Object.values(graph.groups))
    : []
  for (const node of nodes) {
    const mapped = sourceMap?.find((entry) => entry.entityId === node.id)
      ?? sourceMap?.find((entry) => entry.runtimeNodeIds.includes(node.id))
    const position = layoutPositionFor(mapped, layout, node.id)
    if (position) node.position = { ...position }
  }
  for (const group of groups) {
    const mapped = sourceMap?.find((entry) => entry.entityId === group.id)
      ?? sourceMap?.find((entry) => entry.runtimeNodeIds.includes(group.id))
    const position = layoutPositionFor(mapped, layout, group.id)
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

