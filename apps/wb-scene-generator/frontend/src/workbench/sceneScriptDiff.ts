import type { GraphEdge, GraphNode, NodeGroup, PipelineSnapshot } from '@forgeax/node-runtime'

import type { SceneScriptSourceMapEntry } from '../api/HttpApiClient.js'

export interface SceneGraphSnapshot {
  pipeline: PipelineSnapshot | null
  groups: readonly NodeGroup[]
}

export interface TextDiffLine {
  kind: 'added' | 'removed' | 'unchanged'
  text: string
  oldLine?: number
  newLine?: number
}

export interface SemanticChange {
  kind: 'entity' | 'edge' | 'group'
  change: 'added' | 'removed' | 'modified'
  id: string
  label: string
  statementId?: string
  source?: SceneScriptSourceMapEntry['source']
}

export interface SemanticGraphDiff {
  changes: SemanticChange[]
  counts: Record<SemanticChange['kind'], Record<SemanticChange['change'], number>>
}

export interface PreviewCapture {
  dataUrl: string
  width: number
  height: number
  capturedAt: string
}

export interface SceneDiffEvidence {
  transactionId: string
  file: string
  beforeRevision: string
  afterRevision: string
  acceptedAt: string
  text: TextDiffLine[]
  graph: SemanticGraphDiff
  preview: {
    before: PreviewCapture & { digest: string }
    after: PreviewCapture & { digest: string }
    status: 'changed' | 'unchanged'
  }
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
    .join(',')}}`
}

export function diffTextLines(before: string, after: string): TextDiffLine[] {
  const left = before.split('\n')
  const right = after.split('\n')
  const matrix = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1))
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      matrix[i][j] = left[i] === right[j]
        ? matrix[i + 1][j + 1] + 1
        : Math.max(matrix[i + 1][j], matrix[i][j + 1])
    }
  }
  const result: TextDiffLine[] = []
  let i = 0
  let j = 0
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      result.push({ kind: 'unchanged', text: left[i], oldLine: i + 1, newLine: j + 1 })
      i += 1
      j += 1
    } else if (j < right.length && (i >= left.length || matrix[i][j + 1] >= matrix[i + 1][j])) {
      result.push({ kind: 'added', text: right[j], newLine: j + 1 })
      j += 1
    } else {
      result.push({ kind: 'removed', text: left[i], oldLine: i + 1 })
      i += 1
    }
  }
  return result
}

function allNodes(snapshot: SceneGraphSnapshot): Map<string, GraphNode & { groupId?: string }> {
  const result = new Map<string, GraphNode & { groupId?: string }>()
  for (const node of Object.values(snapshot.pipeline?.nodes ?? {})) result.set(node.id, node)
  for (const group of snapshot.groups) {
    for (const node of group.nodes) result.set(node.id, { ...node, groupId: group.id })
  }
  return result
}

function allEdges(snapshot: SceneGraphSnapshot): Map<string, GraphEdge & { groupId?: string }> {
  const result = new Map<string, GraphEdge & { groupId?: string }>()
  for (const edge of Object.values(snapshot.pipeline?.edges ?? {})) result.set(edge.id, edge)
  for (const group of snapshot.groups) {
    for (const edge of group.edges) result.set(edge.id, { ...edge, groupId: group.id })
  }
  return result
}

function normalizedNode(node: GraphNode & { groupId?: string }): unknown {
  return {
    opId: node.opId,
    name: node.name,
    position: node.position,
    params: node.params,
    groupId: node.groupId,
  }
}

function normalizedEdge(edge: GraphEdge & { groupId?: string }): unknown {
  return { source: edge.source, target: edge.target, groupId: edge.groupId }
}

function normalizedGroup(group: NodeGroup): unknown {
  return {
    name: group.name,
    nameEn: group.nameEn,
    position: group.position,
    nodeIds: group.nodes.map((node) => node.id).sort(),
    edgeIds: group.edges.map((edge) => edge.id).sort(),
    exposedInputs: group.exposedInputs,
    exposedOutputs: group.exposedOutputs,
  }
}

function sourceFor(
  id: string,
  kind: SemanticChange['kind'],
  sourceMap: readonly SceneScriptSourceMapEntry[],
  edge?: GraphEdge,
): SceneScriptSourceMapEntry | undefined {
  const direct = sourceMap.find((entry) => entry.entityId === id || entry.runtimeNodeIds.includes(id))
  if (direct || kind !== 'edge' || !edge) return direct
  const sourceEntry = sourceMap.find(
    (entry) => entry.entityId === edge.source.nodeId || entry.runtimeNodeIds.includes(edge.source.nodeId),
  )
  const targetEntry = sourceMap.find(
    (entry) => entry.entityId === edge.target.nodeId || entry.runtimeNodeIds.includes(edge.target.nodeId),
  )
  return sourceEntry?.statementId === targetEntry?.statementId ? sourceEntry : targetEntry ?? sourceEntry
}

function emptyCounts(): SemanticGraphDiff['counts'] {
  return {
    entity: { added: 0, removed: 0, modified: 0 },
    edge: { added: 0, removed: 0, modified: 0 },
    group: { added: 0, removed: 0, modified: 0 },
  }
}

export function diffSemanticGraph(
  before: SceneGraphSnapshot,
  after: SceneGraphSnapshot,
  sourceMap: readonly SceneScriptSourceMapEntry[],
): SemanticGraphDiff {
  const changes: SemanticChange[] = []
  const counts = emptyCounts()
  const compare = <T,>(
    kind: SemanticChange['kind'],
    left: Map<string, T>,
    right: Map<string, T>,
    normalize: (item: T) => unknown,
    label: (item: T, id: string) => string,
  ): void => {
    for (const [id, item] of left) {
      const next = right.get(id)
      const change = !next ? 'removed' : stable(normalize(item)) !== stable(normalize(next)) ? 'modified' : null
      if (!change) continue
      const mapped = sourceFor(id, kind, sourceMap, kind === 'edge' ? item as GraphEdge : undefined)
      changes.push({ kind, change, id, label: label(item, id), statementId: mapped?.statementId, source: mapped?.source })
      counts[kind][change] += 1
    }
    for (const [id, item] of right) {
      if (left.has(id)) continue
      const mapped = sourceFor(id, kind, sourceMap, kind === 'edge' ? item as GraphEdge : undefined)
      changes.push({ kind, change: 'added', id, label: label(item, id), statementId: mapped?.statementId, source: mapped?.source })
      counts[kind].added += 1
    }
  }
  compare('entity', allNodes(before), allNodes(after), normalizedNode, (node, id) => node.name || node.opId || id)
  compare('edge', allEdges(before), allEdges(after), normalizedEdge, (edge) =>
    `${edge.source.nodeId}.${edge.source.port} → ${edge.target.nodeId}.${edge.target.port}`)
  compare(
    'group',
    new Map(before.groups.map((group) => [group.id, group])),
    new Map(after.groups.map((group) => [group.id, group])),
    normalizedGroup,
    (group, id) => group.name || id,
  )
  return { changes, counts }
}

export function diffAuthoringSourceMap(
  before: readonly SceneScriptSourceMapEntry[],
  after: readonly SceneScriptSourceMapEntry[],
  beforeSource: string,
  afterSource: string,
): SemanticGraphDiff {
  const counts = emptyCounts()
  const changes: SemanticChange[] = []
  const left = new Map(before.map((entry) => [entry.entityId, entry]))
  const right = new Map(after.map((entry) => [entry.entityId, entry]))
  for (const [id, entry] of left) {
    const next = right.get(id)
    const change = !next
      ? 'removed'
      : beforeSource.slice(entry.source.start, entry.source.end) !== afterSource.slice(next.source.start, next.source.end)
        ? 'modified'
        : null
    if (!change) continue
    changes.push({
      kind: 'entity',
      change,
      id,
      label: entry.statementId,
      statementId: entry.statementId,
      source: (next ?? entry).source,
    })
    counts.entity[change] += 1
  }
  for (const [id, entry] of right) {
    if (left.has(id)) continue
    changes.push({
      kind: 'entity',
      change: 'added',
      id,
      label: entry.statementId,
      statementId: entry.statementId,
      source: entry.source,
    })
    counts.entity.added += 1
  }
  return { changes, counts }
}

export function digestPngDataUrl(dataUrl: string): string {
  let hash = 2166136261
  for (let index = 0; index < dataUrl.length; index += 1) {
    hash ^= dataUrl.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`
}
