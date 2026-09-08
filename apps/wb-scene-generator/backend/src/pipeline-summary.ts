/**
 * Lightweight pipeline projection for AI agents — avoids pouring full graph +
 * params into context on every `pipeline.get`.
 */
import type { GraphEdge, GraphNode, PipelineSnapshot } from '@forgeax/node-runtime'

export interface PipelineSummaryNode {
  id: string
  opId: string
  name?: string
  batteryId?: string
}

export interface PipelineSummaryEdge {
  id?: string
  source: { nodeId: string; port: string }
  target: { nodeId: string; port: string }
}

export interface PipelineSummary {
  id: string
  hash: string
  summarized: true
  nodeCount: number
  edgeCount: number
  nodes: PipelineSummaryNode[]
  edges: PipelineSummaryEdge[]
  /** Stable ids for M0 export chain when present. */
  exportChain?: {
    treeMerge?: string
    treeFlatten?: string
    sceneMerge?: string
    sceneOutput?: string
  }
  /**
   * Present only when `nameContains`/`opIdIn` was passed (P0-3 grep-style
   * filter) — `matchCount` is how many nodes matched the filter itself,
   * BEFORE the one-hop-neighbor expansion that also lands in `nodes`/`edges`.
   * A caller that gets `matchCount: 0` back knows the search itself found
   * nothing (rather than silently falling back to the whole graph, or
   * confusing "0 direct matches, but neighbors of some other filter" with
   * "no matches at all").
   */
  search?: { matchCount: number }
}

function normalizeNodes(raw: PipelineSnapshot['nodes']): GraphNode[] {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') return Object.values(raw as Record<string, GraphNode>)
  return []
}

function normalizeEdges(raw: PipelineSnapshot['edges']): GraphEdge[] {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') return Object.values(raw as Record<string, GraphEdge>)
  return []
}

function detectExportChain(nodes: GraphNode[]): PipelineSummary['exportChain'] {
  const byOp = new Map<string, string>()
  for (const n of nodes) {
    if (n.opId) byOp.set(n.opId, n.id)
  }
  const chain: NonNullable<PipelineSummary['exportChain']> = {}
  if (byOp.has('tree_merge')) chain.treeMerge = byOp.get('tree_merge')
  if (byOp.has('tree_flatten')) chain.treeFlatten = byOp.get('tree_flatten')
  if (byOp.has('scene_merge_subtrees')) chain.sceneMerge = byOp.get('scene_merge_subtrees')
  if (byOp.has('scene_output')) chain.sceneOutput = byOp.get('scene_output')
  return Object.keys(chain).length > 0 ? chain : undefined
}

function nodeTouchesSet(nodeId: string, ids: ReadonlySet<string>, edges: GraphEdge[]): boolean {
  if (ids.has(nodeId)) return true
  return edges.some(
    (e) =>
      (e.source.nodeId === nodeId && ids.has(e.target.nodeId))
      || (e.target.nodeId === nodeId && ids.has(e.source.nodeId)),
  )
}

export function summarizePipeline(
  snap: PipelineSnapshot | null,
  opts?: { nodeIds?: readonly string[]; groupId?: string; nameContains?: string; opIdIn?: readonly string[] },
): PipelineSummary | null {
  if (!snap) return null
  const allNodes = normalizeNodes(snap.nodes)
  const allEdges = normalizeEdges(snap.edges)

  // P0-3: grep 式模糊过滤。所有筛选条件（groupId / nodeIds / nameContains /
  // opIdIn）先各自算出直接命中的节点 id，取并集作为 directIds；再统一做一次
  // 一跳邻居展开（跟原来 groupId/nodeIds-only 的行为完全一致，只是把命中源
  // 从"只能是精确 id"扩展成"也可以是名字子串/opId 白名单"）。
  const directIds = new Set<string>()
  if (opts?.groupId) directIds.add(opts.groupId)
  if (opts?.nodeIds?.length) for (const id of opts.nodeIds) directIds.add(id)
  const hasSearch = Boolean(opts?.nameContains?.trim()) || Boolean(opts?.opIdIn?.length)
  const searchMatchIds = new Set<string>()
  if (opts?.nameContains?.trim()) {
    const needle = opts.nameContains.trim().toLowerCase()
    for (const n of allNodes) {
      // Match name OR id — instantiated groups often share a battery name
      // (e.g. PlaceOneDecoration) while the caller remembers the groupId
      // prefix it chose (p1d_gate). Searching only `name` returned matchCount:0
      // and agents concluded the nodes were gone.
      const nameHit = typeof n.name === 'string' && n.name.toLowerCase().includes(needle)
      const idHit = typeof n.id === 'string' && n.id.toLowerCase().includes(needle)
      if (nameHit || idHit) searchMatchIds.add(n.id)
    }
  }
  if (opts?.opIdIn?.length) {
    const opIdSet = new Set(opts.opIdIn)
    for (const n of allNodes) {
      if (opIdSet.has(n.opId)) searchMatchIds.add(n.id)
    }
  }
  for (const id of searchMatchIds) directIds.add(id)

  // 任何过滤条件被显式传入时都不应该"查不到就回退成全图"——尤其是
  // nameContains/opIdIn 查询 0 命中时，返回全图会让 search.matchCount:0 这个
  // 信号毫无意义（agent 拿到一堆节点，还得自己再判断"这是不是真的命中了"）。
  // 只有完全没传任何过滤条件时，才是原来的"不过滤 = 全图"语义。
  const anyFilterGiven = Boolean(opts?.groupId || opts?.nodeIds?.length || hasSearch)

  let focusIds: Set<string> | null = null
  if (anyFilterGiven) {
    focusIds = new Set(directIds)
    for (const id of directIds) {
      for (const e of allEdges) {
        if (e.source.nodeId === id) focusIds.add(e.target.nodeId)
        if (e.target.nodeId === id) focusIds.add(e.source.nodeId)
      }
    }
  }

  const nodes = focusIds
    ? allNodes.filter((n) => nodeTouchesSet(n.id, focusIds!, allEdges))
    : allNodes
  const nodeIdSet = new Set(nodes.map((n) => n.id))
  const edges = focusIds
    ? allEdges.filter((e) => nodeIdSet.has(e.source.nodeId) && nodeIdSet.has(e.target.nodeId))
    : allEdges

  return {
    id: snap.id,
    hash: snap.hash,
    summarized: true,
    nodeCount: allNodes.length,
    edgeCount: allEdges.length,
    nodes: nodes.map((n) => ({
      id: n.id,
      opId: n.opId,
      ...(n.name ? { name: n.name } : {}),
      ...((n as { batteryId?: string }).batteryId
        ? { batteryId: (n as { batteryId?: string }).batteryId }
        : {}),
    })),
    edges: edges.map((e) => ({
      ...(e.id ? { id: e.id } : {}),
      source: { nodeId: e.source.nodeId, port: e.source.port },
      target: { nodeId: e.target.nodeId, port: e.target.port },
    })),
    exportChain: detectExportChain(allNodes),
    ...(hasSearch ? { search: { matchCount: searchMatchIds.size } } : {}),
  }
}

export function pipelineHashOnly(snap: PipelineSnapshot | null): { id: string; hash: string; nodeCount: number; edgeCount: number; hashOnly: true } | null {
  if (!snap) return null
  const nodes = normalizeNodes(snap.nodes)
  const edges = normalizeEdges(snap.edges)
  return {
    id: snap.id,
    hash: snap.hash,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    hashOnly: true,
  }
}
