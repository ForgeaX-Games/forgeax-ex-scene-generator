import type { GraphFileV1 } from '../layer1/storage/types.js'
import type { Position } from '../layer1/types/graph.js'
import { GROUP_OP_ID } from './group-constants.js'
import type { Op } from './apply-batch-types.js'

/** Legacy grid fallback when `autoLayoutNew: false` or before incremental layout runs. */
export function autoNodePosition(graph: GraphFileV1): Position {
  const n = Object.keys(graph.nodes).length
  const COLS = 6
  const DX = 220
  const DY = 140
  return { x: (n % COLS) * DX, y: Math.floor(n / COLS) * DY }
}

// A batch that only repositions things or updates presentation metadata (viewport / frames /
// annotations) changes nothing the executor or renderer depends on. It is still persisted and
// recorded in history, but must NOT emit a `graph:applied` data-change event — otherwise every
// live client re-pulls the snapshot and rebuilds previews on each node drag. Mirrors the legacy
// model where moving a node was a plain position save, never a re-exec/re-pull trigger.
export function batchIsLayoutOnly(ops: readonly Op[], before?: GraphFileV1): boolean {
  if (ops.length === 0) return false
  return ops.every((op) => opIsPresentationOnly(op, before))
}

/**
 * Node params that describe the node's BOX on the canvas, not its computation.
 * Resizable panel nodes persist width+height through the generic `params` bag.
 */
const PRESENTATION_PARAM_KEYS = new Set(['_nodeWidth', '_nodeHeight'])

function paramsChangeIsPresentationOnly(
  before: GraphFileV1 | undefined,
  nodeId: string,
  params: Readonly<Record<string, unknown>>,
): boolean {
  const prev = before?.nodes?.[nodeId]?.params
  if (!prev) return false
  for (const key of new Set([...Object.keys(prev), ...Object.keys(params)])) {
    if (PRESENTATION_PARAM_KEYS.has(key)) continue
    if (prev[key] === params[key]) continue
    if (JSON.stringify(prev[key] ?? null) !== JSON.stringify(params[key] ?? null)) return false
  }
  return true
}

function opIsPresentationOnly(op: Op, before?: GraphFileV1): boolean {
  switch (op.type) {
    case 'updateNode': {
      if (op.name !== undefined) return false
      if (op.params !== undefined && !paramsChangeIsPresentationOnly(before, op.nodeId, op.params)) {
        return false
      }
      return op.position !== undefined || op.previewEnabled !== undefined || op.params !== undefined
    }
    case 'updateGroup':
      return (
        (op.position !== undefined || op.innerLayout !== undefined) &&
        op.name === undefined &&
        op.nameEn === undefined &&
        op.exposedPorts === undefined &&
        op.exposedWiring === undefined &&
        op.nodes === undefined &&
        op.edges === undefined
      )
    case 'setMetadata':
      return op.key === 'viewport' || op.key === 'frames' || op.key === 'annotations'
    default:
      return false
  }
}

/** Compact op summary for perf / persist tracing logs. */
export function summarizeBatchOps(ops: readonly Op[]): string {
  return ops
    .map((op) => {
      switch (op.type) {
        case 'updateNode': {
          const parts: string[] = []
          if (op.position !== undefined) parts.push('pos')
          if (op.params !== undefined) parts.push('params')
          if (op.name !== undefined) parts.push('name')
          if (op.previewEnabled !== undefined) parts.push('preview')
          return `updateNode:${op.nodeId}{${parts.join('+') || '?'}}`
        }
        case 'setMetadata':
          return `setMetadata:${op.key}`
        case 'connect':
          return `connect:${op.edgeId ?? 'auto'}`
        case 'disconnect':
          return `disconnect:${op.edgeId}`
        case 'deleteEdge':
          return `deleteEdge:${op.edgeId}`
        case 'createNode':
          return `createNode:${op.nodeId}`
        case 'deleteNode':
          return `deleteNode:${op.nodeId}`
        case 'createGroup':
          return `createGroup:${op.groupId}`
        case 'updateGroup':
          return `updateGroup:${op.groupId}`
        case 'deleteGroup':
          return `deleteGroup:${op.groupId}`
        case 'ungroup':
          return `ungroup:${op.groupId}`
        default:
          return (op as { type: string }).type
      }
    })
    .join(',')
}

/** Every node id that may legitimately own an outputs/<id>/ cache directory. */
export function collectCachedNodeIds(graph: GraphFileV1): Set<string> {
  const ids = new Set(Object.keys(graph.nodes))
  for (const group of Object.values(graph.groups ?? {})) {
    for (const inner of group.nodes) ids.add(inner.id)
  }
  return ids
}

/** Inner member ids for one group, including nested sub-groups (deleteGroup GC). */
export function collectGroupMemberNodeIds(graph: GraphFileV1, groupId: string): Set<string> {
  const out = new Set<string>()
  const walk = (gid: string): void => {
    const group = graph.groups?.[gid]
    if (!group) return
    for (const inner of group.nodes) {
      out.add(inner.id)
      if (inner.opId === GROUP_OP_ID) {
        const childGid = typeof inner.params?.groupId === 'string' ? inner.params.groupId : ''
        if (childGid) walk(childGid)
      }
    }
  }
  walk(groupId)
  return out
}
/**
 * Collect the nodes whose INPUT topology a batch changes — the seeds for output-
 * cache invalidation. Deleting / adding an incoming edge, or deleting a node /
 * group, changes what a target node (and everything downstream of it) resolves
 * for its inputs, so any persisted output cache for that subtree is now stale.
 *
 * `disconnect` targets must be resolved against the PRE-batch graph (`before`),
 * because by the time invalidation runs the edge is already gone from `after`.
 * For node/group deletion we seed the deleted node id itself plus its direct
 * downstream targets (read from `before`); the deleted node's own cache is
 * removed too, and the downstream BFS over `after.edges` covers the rest.
 */
export function collectInvalidationSeeds(
  before: GraphFileV1,
  ops: readonly Op[],
): Set<string> {
  const seeds = new Set<string>()
  const addDownstreamTargetsOf = (nodeId: string): void => {
    for (const edge of Object.values(before.edges)) {
      if (edge.source.nodeId === nodeId) seeds.add(edge.target.nodeId)
    }
  }
  for (const op of ops) {
    switch (op.type) {
      case 'connect':
        seeds.add(op.target.nodeId)
        break
      case 'disconnect':
      case 'deleteEdge': {
        const edge = before.edges[op.edgeId]
        if (edge) seeds.add(edge.target.nodeId)
        break
      }
      case 'deleteNode':
        seeds.add(op.nodeId)
        addDownstreamTargetsOf(op.nodeId)
        break
      case 'deleteGroup': {
        seeds.add(op.groupId)
        addDownstreamTargetsOf(op.groupId)
        // Inner members are removed with the group but are not downstream of
        // the shadow node in the outer edge graph — invalidate them explicitly.
        for (const id of collectGroupMemberNodeIds(before, op.groupId)) {
          seeds.add(id)
        }
        break
      }
      case 'ungroup':
        seeds.add(op.groupId)
        addDownstreamTargetsOf(op.groupId)
        break
      // Param / inner-subgraph edits change what downstream nodes resolve without
      // any edge mutation — invalidate the edited node (or group shadow) and its
      // downstream closure so the next partial execute cannot re-hydrate stale
      // scene_output / tree_merge caches (the "slider moves but sink stays" bug).
      // Presentation-only edits (drag, preview toggle) are excluded: they compute
      // nothing new, and they are exactly the batches that suppress
      // `graph:applied`, so anything wiped here would never be recomputed.
      case 'updateNode':
        if (!opIsPresentationOnly(op, before)) seeds.add(op.nodeId)
        break
      case 'updateGroup':
        if (!opIsPresentationOnly(op, before)) seeds.add(op.groupId)
        break
      default:
        break
    }
  }
  return seeds
}
