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
  return failures.slice(0, 3).map((failure) => {
    const source = failure.nodeId ? sourceEntryFor(sourceMap, failure.nodeId) : undefined
    const sceneNodeIds = [...new Set(lineage
      .filter((entry) =>
        (failure.nodeId && entry.runtime.nodeId === failure.nodeId)
        || (source && entry.authoring.statementId === source.statementId))
      .flatMap((entry) => entry.sceneNodes.map((node) => node.id)))]
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
      possibleCauses: source
        ? ['The Battery or project Generator rejected the values produced for this authored call.']
        : ['Execution failed before a canonical source-map entry could be resolved.'],
      howToFix: source
        ? ['Inspect this authored call and its immediate typed inputs, then execute the repaired revision once.']
        : ['Recompile the canonical project, then retry once; escalate if the runtime failure remains unmapped.'],
      retryable: Boolean(source),
    })
  })
}
