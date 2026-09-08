import type { AuthoringCommand } from '../commands/index.js'
import type { SceneDiagnostic, SceneExpression, SourceRange } from '../model/types.js'

export const SCENE_WORKFLOW_VERSION = 1
export const SCENE_WORKFLOW_LIMITS = {
  maxTargets: 32,
  maxCandidates: 12,
  maxCommands: 64,
  maxEvidence: 8,
  maxStringLength: 2_048,
  maxRetries: 2,
  maxLensExpansions: 3,
} as const

export type SceneWorkNodeKind =
  | 'target-resolver'
  | 'edit-lens'
  | 'module-editor-agent'
  | 'incremental-compile'
  | 'verifier'
  | 'critic'
  | 'human-gate'
  | 'platform-recovery'
  | 'checkpoint'

export type SceneWorkNodeStatus =
  | 'planned'
  | 'running'
  | 'blocked'
  | 'failed'
  | 'preview'
  | 'verified'
  | 'accepted'
  | 'reverted'

export interface SceneSelectionReference {
  authoringIds?: string[]
  runtimeNodeIds?: string[]
  sceneNodeIds?: string[]
  paths?: string[]
  semanticAddresses?: string[]
  sourceRanges?: SourceRange[]
}

export interface SceneTargetQuery {
  query?: string
  selection?: SceneSelectionReference
  authoringId?: string
  sceneNodeId?: string
  path?: string
  semanticAddress?: string
}

export interface SceneTargetCandidate {
  authoringId: string
  statementId: string
  semanticAddress: string
  moduleId: string
  file: string
  confidence: number
  evidence: string[]
  source: SourceRange
}

export interface SceneTargetResolution {
  query: SceneTargetQuery
  candidates: SceneTargetCandidate[]
  requiresClarification: boolean
  clarificationReason?: string
  bounded: true
}

export interface SceneInterfaceSummary {
  moduleId: string
  file: string
  statementId?: string
  functionName?: string
  binding?: string
  relation: 'dependency' | 'consumer' | 'module'
}

export interface SceneInvariant {
  id: string
  description: string
  frozen: boolean
  scope: 'local' | 'global'
}

export interface SceneChangeRecord {
  transactionId: string
  changedAt: string
  moduleIds: string[]
  targetIds: string[]
  status: SceneWorkNodeStatus
}

export interface SceneSpatialNeighborhoodSummary {
  references: Array<{ sceneNodeId?: string; path?: string }>
  count: number
  truncated: boolean
  payload: 'summary-only'
}

export interface SceneEditLens {
  targetIds: string[]
  sourceRanges: SourceRange[]
  targetSources: Array<{ moduleId: string; file: string; statementId: string; source: string }>
  owningModules: SceneInterfaceSummary[]
  directDependencies: SceneInterfaceSummary[]
  directConsumers: SceneInterfaceSummary[]
  spatialNeighborhood?: SceneSpatialNeighborhoodSummary
  invariants: SceneInvariant[]
  recentRelevantChanges: SceneChangeRecord[]
  allowedWriteScope: string[]
  expansion: { depth: number; reason?: string; maxDepth: number }
  payload: 'bounded-no-runtime-graph'
}

export type SceneEditPrecondition =
  | { kind: 'target-exists'; targetId: string }
  | { kind: 'module-signature'; moduleId: string; hash: string }
  | { kind: 'argument-equals'; statementId: string; argument: string; value: SceneExpression }

export interface SceneSemanticExpectation {
  entityId: string
  change: 'created' | 'updated' | 'removed' | 'unchanged'
}

export interface SceneEditTransaction {
  transactionId: string
  workNodeId: string
  intent: string
  baseProjectRevision: string
  baseModuleRevisions: Record<string, string>
  targetIds: string[]
  writableModuleIds: string[]
  preconditions: SceneEditPrecondition[]
  astCommands: AuthoringCommand[]
  expectedSemanticDelta: SceneSemanticExpectation[]
  verificationProfile: 'local' | 'global'
  humanGate?: { required: boolean; reasons: string[]; approvedAt?: string }
}

export interface SceneSemanticDiff {
  transactionId: string
  directlyChanged: string[]
  recompiled: string[]
  reexecuted: string[]
  revalidated: string[]
  unchanged: string[]
  created: string[]
  updated: string[]
  removed: string[]
  expectedDeltaMatches: boolean
  payload: 'semantic-summary'
}

export interface SceneVerification {
  transactionId: string
  profile: 'local' | 'global'
  ok: boolean
  diagnostics: SceneDiagnostic[]
  frozenStandardsPreserved: true
  critic: {
    readOnly: true
    verdict: 'approve' | 'request-changes'
    findings: string[]
  }
}

export interface SceneWorkArtifactRefs {
  workOrder: string
  result: string
  astPatch: string
  semanticDiff: string
  verification: string
  progress: string
  checkpoint: string
}

export interface SceneWorkCheckpoint {
  id: string
  projectRevision: string
  createdAt: string
}

export interface SceneWorkNode {
  id: string
  kind: SceneWorkNodeKind
  status: SceneWorkNodeStatus
  targetIds: string[]
  scope: string[]
  artifacts: SceneWorkArtifactRefs
  diagnostics: SceneDiagnostic[]
  checkpoint?: SceneWorkCheckpoint
  humanGate?: SceneEditTransaction['humanGate']
  budget: {
    maxCommands: number
    maxTargets: number
    retries: number
    maxRetries: number
    stopped: boolean
    circuitOpen: boolean
  }
  updatedAt: string
}

export interface SceneWorkGraph {
  version: typeof SCENE_WORKFLOW_VERSION
  projectId: string
  nodes: SceneWorkNode[]
  activeTransactionId?: string
  payload: 'bounded-work-overlay'
}

/** Stable semantic address. Deliberately encodes stable authoring identity, never a file path or runtime id. */
export function sceneSemanticAddress(moduleId: string, statementId: string): string {
  return `scene://authoring/${encodeURIComponent(moduleId)}#${encodeURIComponent(statementId)}`
}

export function parseSceneSemanticAddress(address: string): { moduleId: string; statementId: string } | null {
  const match = /^scene:\/\/authoring\/([^#]+)#(.+)$/u.exec(address)
  if (!match) return null
  try {
    return { moduleId: decodeURIComponent(match[1]!), statementId: decodeURIComponent(match[2]!) }
  } catch {
    return null
  }
}

export function commandTargetIds(command: AuthoringCommand): string[] {
  if ('statementIds' in command) return command.statementIds
  if ('statementId' in command && command.statementId) return [command.statementId]
  return []
}

export function commandModuleIds(command: AuthoringCommand): string[] {
  return [
    ...('moduleId' in command && command.moduleId ? [command.moduleId] : []),
    ...('targetModuleId' in command && command.targetModuleId ? [command.targetModuleId] : []),
  ]
}

export function requiresHumanGate(commands: readonly AuthoringCommand[], intent: string): string[] {
  const reasons = new Set<string>()
  if (commands.some((command) => command.type === 'removeCall')) reasons.add('important-deletion')
  if (commands.some((command) => command.type === 'moveStatement' || command.type === 'extractDefinition'
    || command.type === 'inlineDefinition' || command.type === 'wrapInGroup' || command.type === 'ungroup')) {
    reasons.add('structural-refactor')
  }
  if (/\b(publish|release|export|refactor|delete)\b/iu.test(intent) || /(发布|导出|重构|删除)/u.test(intent)) {
    reasons.add('high-impact-intent')
  }
  return [...reasons].sort()
}

export function boundedUnique(values: readonly string[], limit: number): string[] {
  return [...new Set(values)].sort().slice(0, limit)
}
