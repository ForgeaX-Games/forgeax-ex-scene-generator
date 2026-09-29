import {
  createSceneDiagnostic,
  toPublicSceneDiagnostics,
  type SceneDiagnostic,
  type SceneDiagnosticTransaction,
  type ResultLineage,
  type SourceMapEntry,
} from '@forgeax/scene-authoring'
import type { ExecutionResult } from '@forgeax/node-runtime'

import { sourceEntryFor } from './agent/lineage.js'

export const NOT_APPLIED: SceneDiagnosticTransaction = { applied: false, rolledBack: false }

export function rejectedSceneScriptPayload(
  reason: string,
  diagnostics: readonly SceneDiagnostic[],
  options: {
    code?: string
    transaction?: SceneDiagnosticTransaction
    compatibility?: Record<string, unknown>
  } = {},
): Record<string, unknown> {
  const transaction = options.transaction ?? NOT_APPLIED
  return {
    status: 'rejected',
    reason,
    ...(options.code ? { code: options.code } : {}),
    ...(options.compatibility ?? {}),
    transaction,
    diagnostics: toPublicSceneDiagnostics(diagnostics, transaction),
  }
}

export function revisionConflictDiagnostic(expected: string, actual: string): SceneDiagnostic {
  return createSceneDiagnostic({
    code: 'scene-source-revision-conflict',
    phase: 'resolve',
    severity: 'error',
    title: 'Scene Script revision conflict',
    message: 'Scene Script changed since the edit lens was created.',
    expected: { revision: expected },
    actual: { revision: actual },
    transaction: NOT_APPLIED,
    retryable: true,
    escalation: 'none',
  })
}

export function runtimeImportDiagnostics(
  diagnostics: readonly { severity: string; message: string }[] | undefined,
): SceneDiagnostic[] {
  return (diagnostics ?? []).map((item) => createSceneDiagnostic({
    code: 'SCENE_RUNTIME_IMPORT',
    phase: 'compile',
    severity: item.severity === 'warn' ? 'warning' : 'error',
    title: 'Runtime Graph import rejected',
    message: item.message,
    transaction: { applied: false, rolledBack: true },
  }))
}

function repairAdviceForExecution(): { possibleCauses: string[]; howToFix: string[] } {
  return {
    possibleCauses: ['The first-batch Battery or project Generator rejected the values produced for this authored call.'],
    howToFix: ['Inspect this authored call and its immediate typed inputs, then execute the repaired revision once.'],
  }
}

/** Unwrap a DataTree / wire envelope down to the first payload leaf. */
export function readDataTreeLeaf(value: unknown): unknown {
  let current = value
  for (let depth = 0; depth < 8; depth += 1) {
    if (current == null) return undefined
    if (Array.isArray(current)) {
      if (current.length === 0) return undefined
      const head = current[0] as { items?: unknown[] } | unknown
      if (head && typeof head === 'object' && Array.isArray((head as { items?: unknown[] }).items)) {
        current = (head as { items: unknown[] }).items[0]
        continue
      }
      current = head
      continue
    }
    if (typeof current === 'object' && Array.isArray((current as { items?: unknown[] }).items)) {
      current = (current as { items: unknown[] }).items[0]
      continue
    }
    return current
  }
  return current
}

function readObjectList(value: unknown): Array<Record<string, unknown>> {
  const rows: Record<string, unknown>[] = []
  const visit = (item: unknown): void => {
    if (item == null) return
    if (Array.isArray(item)) {
      for (const inner of item) visit(inner)
      return
    }
    if (typeof item !== 'object') return
    const rec = item as { path?: unknown; items?: unknown[] }
    if (Array.isArray(rec.items) && (Array.isArray(rec.path) || 'path' in rec)) {
      for (const inner of rec.items) visit(inner)
      return
    }
    rows.push(item as Record<string, unknown>)
  }
  visit(value)
  return rows
}

/** Metrics-only SCENE_GRID_STRETCH (ratio ≈ 1) is not a warning. */
export function isActualGridStretch(item: Record<string, unknown>): boolean {
  if (item.anisotropic === false) return false
  if (item.anisotropic === true) return true
  if (typeof item.stretchRatio === 'number') return Math.abs(item.stretchRatio - 1) > 1e-3
  const columns = Number(item.columns)
  const rows = Number(item.rows)
  const planeWidth = Number(item.planeWidth)
  const planeHeight = Number(item.planeHeight)
  if ([columns, rows, planeWidth, planeHeight].every((n) => Number.isFinite(n) && n > 0)) {
    return Math.abs((planeWidth / columns) / (planeHeight / rows) - 1) > 1e-3
  }
  return false
}

const GRID_STRETCH_FIX: Record<string, { possibleCauses: string[]; howToFix: string[] }> = {
  SCENE_GRID_STRETCH: {
    possibleCauses: [
      'The height Grid rows/cols do not match the Geometry plane aspect, so cells were stretched to cover the plane.',
    ],
    howToFix: [
      'Keep the stretch if the field should cover the whole plane, or recreate the grid with columns/rows closer to the plane aspect.',
    ],
  },
}

function diagnosticSource(
  sourceMap: readonly SourceMapEntry[],
  nodeId: string,
): Pick<SceneDiagnostic, 'source' | 'statementId' | 'graph' | 'operation'> {
  const source = sourceEntryFor(sourceMap, nodeId)
  if (!source) return { graph: { runtimeNodeIds: [nodeId] }, operation: 'execute' }
  return {
    source: source.source,
    statementId: source.statementId,
    operation: source.definitionId ?? 'execute',
    graph: {
      authoringNodeId: source.statementId,
      runtimeNodeIds: [nodeId],
      runtimeEdgeIds: source.runtimeEdgeIds,
    },
  }
}

/** Soft runtime smells from first-batch host outputs (grid stretch). */
export function executionOutputDiagnostics(
  result: ExecutionResult,
  sourceMap: readonly SourceMapEntry[],
): SceneDiagnostic[] {
  const failed = new Set(
    (result.failures ?? (result.error ? [result.error] : []))
      .map((item) => item.nodeId)
      .filter((id): id is string => Boolean(id)),
  )
  const diagnostics: SceneDiagnostic[] = []

  for (const [nodeId, ports] of Object.entries(result.outputs ?? {})) {
    if (failed.has(nodeId)) continue
    const loc = diagnosticSource(sourceMap, nodeId)

    const geometry = readDataTreeLeaf(ports.geometry)
    const heightfield = readDataTreeLeaf(ports.heightfield)
    const stretch = (geometry && typeof geometry === 'object'
      ? (geometry as { stretch?: unknown }).stretch
      : undefined)
      ?? (heightfield && typeof heightfield === 'object'
        ? (heightfield as { stretch?: unknown }).stretch
        : undefined)
    const gridWarnings = [...readObjectList(ports.warnings), ...readObjectList(stretch)]
      .filter((item) => typeof item.code === 'string' && String(item.code).startsWith('SCENE_GRID_') && isActualGridStretch(item))
    for (const item of gridWarnings) {
      const code = String(item.code)
      const advice = GRID_STRETCH_FIX[code] ?? {
        possibleCauses: ['The height Grid was stretched to cover the Geometry plane.'],
        howToFix: [
          'Read the stretch metrics in this warning. Recreate the grid with matching aspect if isotropic cells are required.',
        ],
      }
      diagnostics.push(createSceneDiagnostic({
        code,
        phase: 'execute',
        severity: 'warning',
        message: typeof item.message === 'string' && item.message.trim()
          ? item.message
          : `Height grid stretched onto the Geometry plane (${item.columns}×${item.rows} → ${item.planeWidth}×${item.planeHeight} m).`,
        ...loc,
        expected: 'A valued Grid covering the Geometry plane. Row/col mismatch is allowed.',
        actual: item,
        possibleCauses: advice.possibleCauses,
        howToFix: advice.howToFix,
        retryable: true,
      }))
    }

  }
  return diagnostics
}

/** Project bounded runtime failures back onto canonical Scene Script calls. */
export function executionResultDiagnostics(
  result: ExecutionResult,
  sourceMap: readonly SourceMapEntry[],
  lineage: readonly ResultLineage[] = [],
): SceneDiagnostic[] {
  const failures = result.failures?.length
    ? result.failures
    : result.error
      ? [result.error]
      : []
  return failures.map((failure) => {
    const source = failure.nodeId ? sourceEntryFor(sourceMap, failure.nodeId) : undefined
    const sceneNodeIds = [...new Set(lineage
      .filter((entry) =>
        (failure.nodeId && entry.runtime.nodeId === failure.nodeId)
        || (source && entry.authoring.statementId === source.statementId))
      .flatMap((entry) => entry.sceneNodes.map((node) => node.id)))]
    const advice = source
      ? repairAdviceForExecution()
      : {
          possibleCauses: ['Execution failed before a canonical source-map entry could be resolved.'],
          howToFix: ['Recompile the canonical project, then retry once; escalate if the runtime failure remains unmapped.'],
        }
    return createSceneDiagnostic({
      code: source ? 'SCENE_EXECUTE_NODE' : 'SCENE_EXECUTE_RUNTIME',
      phase: 'execute',
      severity: 'error',
      message: failure.message,
      operation: source?.definitionId ?? 'execute',
      ...(source
        ? {
            source: source.source,
            statementId: source.statementId,
            graph: {
              authoringNodeId: source.statementId,
              runtimeNodeIds: failure.nodeId ? [failure.nodeId] : source.runtimeNodeIds,
              runtimeEdgeIds: source.runtimeEdgeIds,
              ...(sceneNodeIds.length ? { sceneNodeIds } : {}),
            },
          }
        : failure.nodeId
          ? { graph: { runtimeNodeIds: [failure.nodeId] } }
          : {}),
      possibleCauses: advice.possibleCauses,
      howToFix: advice.howToFix,
      retryable: Boolean(source),
    })
  })
}

function diagnosticKey(item: SceneDiagnostic): string {
  return [
    item.code,
    item.statementId ?? item.graph?.authoringNodeId ?? '',
    item.graph?.runtimeNodeIds?.[0] ?? '',
    item.message,
  ].join('\0')
}

function coversNode(item: SceneDiagnostic, nodeId: string | undefined): boolean {
  if (!nodeId) return false
  return item.statementId === nodeId
    || item.graph?.authoringNodeId === nodeId
    || (item.graph?.runtimeNodeIds ?? []).includes(nodeId)
}

/** Host errors/warnings + execute failures + runtime output smells. Do not drop errors. */
export function collectSceneExecutionDiagnostics(
  result: ExecutionResult,
  sourceMap: readonly SourceMapEntry[],
  lineage: readonly ResultLineage[] = [],
  compileDiagnostics: readonly SceneDiagnostic[] = [],
): SceneDiagnostic[] {
  const seen = new Set<string>()
  const out: SceneDiagnostic[] = []
  const push = (item: SceneDiagnostic): void => {
    const key = diagnosticKey(item)
    if (seen.has(key)) return
    seen.add(key)
    out.push(item)
  }
  for (const item of compileDiagnostics) push(item)
  for (const item of executionResultDiagnostics(result, sourceMap, lineage)) {
    const nodeId = item.graph?.runtimeNodeIds?.[0] ?? item.statementId
    if (compileDiagnostics.some((existing) => coversNode(existing, nodeId))) continue
    push(item)
  }
  for (const item of executionOutputDiagnostics(result, sourceMap)) push(item)
  return out
}
