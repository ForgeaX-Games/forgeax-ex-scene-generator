import type {
  SceneDiagnostic,
  SceneDiagnosticEscalation,
  SceneDiagnosticPhase,
  SceneDiagnosticTransaction,
} from '../model/types.js'

export interface SceneDiagnosticPolicy {
  retryable: boolean
  escalation: SceneDiagnosticEscalation
}

/** One explicit policy table shared by every Scene Script diagnostic producer. */
export const SCENE_DIAGNOSTIC_POLICIES: Readonly<Record<SceneDiagnosticPhase, SceneDiagnosticPolicy>> = {
  parse: { retryable: true, escalation: 'compiler' },
  type: { retryable: true, escalation: 'compiler' },
  resolve: { retryable: true, escalation: 'compiler' },
  compile: { retryable: true, escalation: 'compiler' },
  execute: { retryable: false, escalation: 'battery' },
  verify: { retryable: false, escalation: 'none' },
  platform: { retryable: true, escalation: 'platform' },
  capability: { retryable: false, escalation: 'none' },
}

function titleFromCode(code: string): string {
  return code
    .replace(/^SCENE_/, '')
    .replace(/^SCN-/, '')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/^\w/, (letter) => letter.toUpperCase())
}

function boundedValue(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') {
    return value.length <= 1_024 ? value : `${value.slice(0, 1_024)}… [truncated ${value.length - 1_024} chars]`
  }
  if (typeof value === 'undefined') return undefined
  if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') return String(value)
  if (depth >= 3) return '[omitted: nested payload]'
  if (Array.isArray(value)) {
    const result = value.slice(0, 20).map((item) => boundedValue(item, depth + 1))
    if (value.length > 20) result.push(`[omitted: ${value.length - 20} items]`)
    return result
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !['stack', 'runtimeGraph', 'dataTree', 'voxels', 'voxelData'].includes(key))
    .slice(0, 20)
    .map(([key, item]) => [key, boundedValue(item, depth + 1)])
  return Object.fromEntries(entries)
}

function formatDiagnosticWhere(diagnostic: SceneDiagnostic): string | undefined {
  const source = diagnostic.source
  if (!source?.file) return source?.statementId ?? diagnostic.statementId
  const loc = source.line ? `${source.file}:${source.line}` : source.file
  const statement = source.statementId ?? diagnostic.statementId
  return statement ? `${loc} (${statement})` : loc
}

/**
 * Same natural-language projection for humans and agents.
 * Structure follows SimpleCAD `format_llm_error`; stack and graph dumps stay out.
 */
export function formatSceneDiagnosticRepairSlip(diagnostic: SceneDiagnostic): string {
  const lines = [`Operation: ${diagnostic.operation ?? diagnostic.title ?? diagnostic.code}`]
  if (diagnostic.signature) lines.push(`Signature: ${diagnostic.signature}`)
  if (diagnostic.documentationHint) lines.push(`Documentation: ${diagnostic.documentationHint}`)
  lines.push(`What happened: ${diagnostic.message}`)
  lines.push(`Phase: ${diagnostic.phase}`)
  const where = formatDiagnosticWhere(diagnostic)
  if (where) lines.push(`Where: ${where}`)
  if (diagnostic.graph?.authoringNodeId) lines.push(`Graph: ${diagnostic.graph.authoringNodeId}`)
  lines.push('Possible causes:')
  const causes = diagnostic.possibleCauses?.filter((item) => item.trim().length > 0) ?? []
  if (causes.length === 0) lines.push('- Inspect the structured fields on this diagnostic.')
  else for (const item of causes) lines.push(`- ${item}`)
  lines.push('How to fix:')
  const how = diagnostic.howToFix?.filter((item) => item.trim().length > 0) ?? []
  const titled = diagnostic.fixes?.map((item) => item.title).filter((item) => item.trim().length > 0) ?? []
  const combined = how.length > 0 ? how : titled
  if (combined.length === 0) {
    lines.push('- No automatic edit is offered; use What happened and the code to repair.')
  } else {
    for (const item of combined.slice(0, 5)) lines.push(`- ${item}`)
  }
  if (diagnostic.fixes && diagnostic.fixes.length > 0) {
    const codeExamples = diagnostic.fixes
      .flatMap((fix) => fix.edits)
      .filter((edit): edit is { type: 'ReplaceSource'; file: string; start: number; end: number; text: string } => edit.type === 'ReplaceSource' && typeof edit.text === 'string' && edit.text.trim().length > 0)
      .map((edit) => edit.text)
    if (codeExamples.length > 0) {
      lines.push('Code fix example:')
      for (const ex of codeExamples.slice(0, 2)) {
        lines.push(`\`\`\`ts\n${ex.trim()}\n\`\`\``)
      }
    }
  }
  lines.push(`Technical details: ${diagnostic.code}`)
  return lines.join('\n')
}

export function createSceneDiagnostic(
  input: Omit<SceneDiagnostic, 'title' | 'retryable' | 'escalation'> &
    Partial<Pick<SceneDiagnostic, 'title' | 'retryable' | 'escalation'>>,
): SceneDiagnostic {
  const policy = SCENE_DIAGNOSTIC_POLICIES[input.phase]
  const statementId = input.source?.statementId ?? input.statementId
  const diagnostic: SceneDiagnostic = {
    ...input,
    title: input.title ?? titleFromCode(input.code),
    ...(input.source && statementId ? { source: { ...input.source, statementId } } : {}),
    ...(statementId
      ? {
          statementId,
          graph: { authoringNodeId: statementId, ...input.graph },
        }
      : {}),
    ...(input.expected !== undefined ? { expected: boundedValue(input.expected) } : {}),
    ...(input.actual !== undefined ? { actual: boundedValue(input.actual) } : {}),
    ...(input.fixes ? { fixes: input.fixes.slice(0, 3) } : {}),
    retryable: input.retryable ?? policy.retryable,
    escalation: input.escalation ?? policy.escalation,
  }
  return {
    ...diagnostic,
    repairSlip: formatSceneDiagnosticRepairSlip(diagnostic),
  }
}

export function normalizeSceneDiagnostic(
  diagnostic: SceneDiagnostic,
  transaction?: SceneDiagnosticTransaction,
): SceneDiagnostic {
  return createSceneDiagnostic({
    ...diagnostic,
    ...(transaction ? { transaction } : {}),
  })
}

/** Errors take this many slots so Sino can repair the first failure without drowning. */
export const PUBLIC_ERROR_DIAGNOSTIC_BUDGET = 3
/** Warnings keep their own budget so a successful commit still surfaces design smells. */
export const PUBLIC_WARNING_DIAGNOSTIC_BUDGET = 5

/**
 * Agent-facing diagnostics: errors first (primary + related), then warnings.
 * Each diagnostic still carries a full repairSlip (What / Where / Why / How to fix).
 */
export function toPublicSceneDiagnostics(
  diagnostics: readonly SceneDiagnostic[],
  transaction?: SceneDiagnosticTransaction,
): SceneDiagnostic[] {
  if (diagnostics.length === 0) return []
  const errors = diagnostics.filter((item) => item.severity === 'error')
  const warnings = diagnostics.filter((item) => item.severity !== 'error')
  const primary = errors[0]
  const relatedErrors = (primary ? errors.slice(1) : errors).slice(0, Math.max(0, PUBLIC_ERROR_DIAGNOSTIC_BUDGET - (primary ? 1 : 0)))
  const ordered = [
    ...(primary ? [primary] : []),
    ...relatedErrors,
    ...warnings.slice(0, PUBLIC_WARNING_DIAGNOSTIC_BUDGET),
  ]
  return ordered.map((item) => normalizeSceneDiagnostic(item, transaction))
}
