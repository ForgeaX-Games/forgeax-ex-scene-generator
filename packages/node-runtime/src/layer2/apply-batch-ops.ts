import { randomUUID } from 'node:crypto'

import type { GraphFileV1 } from '../layer1/storage/types.js'
import type { GraphNode } from '../layer1/types/graph.js'
import type { OpRegistry } from '../layer1/op-registry.js'
import type { Diagnostic, Op } from './apply-batch-types.js'
import { autoNodePosition } from './apply-batch-classify.js'
import { requireIdentifier, unresolvedNodeRef } from './apply-batch-validate.js'
import {
  applyCreateGroup,
  applyDeleteGroup,
  applyUngroup,
  applyUpdateGroup,
} from './apply-batch-group-ops.js'
import { NUMBER_CONST_OP_ID, isNumberConstSliderParamKey } from './number-const-slider.js'

// Bootstrap an empty graph file — used by the first applyBatch on a fresh project.
export function emptyGraph(pipelineId: string, ts: string): Omit<GraphFileV1, 'hash'> {
  return {
    schemaVersion: 1,
    id: pipelineId,
    createdAt: ts,
    updatedAt: ts,
    nodes: {},
    edges: {},
  }
}

// Mint a unique edge id when a connect op omits `edgeId`. Collision-checked
// against the live graph so a batch creating several auto edges stays unique.
export function mintEdgeId(graph: GraphFileV1): string {
  let id: string
  do {
    id = `e_${randomUUID().slice(0, 8)}`
  } while (graph.edges[id])
  return id
}

/**
 * Agents often confuse `text_panel` with `number_const` and write
 * `params: { value: "墙体" }` instead of `params: { text: "墙体" }`.
 * The panel battery / UI / asset scanners all read `params.text`, so a lone
 * `value` makes WallAsset / AssetName silently empty at execute time.
 * Normalize at the applyBatch boundary (same class of field-typo defense as
 * requireIdentifier).
 */
export function normalizeTextPanelParams(
  opId: string | undefined,
  params: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!params || opId !== 'text_panel') return params
  const text = params.text
  const value = params.value
  const textOk = typeof text === 'string' && text.trim().length > 0
  const valueOk = typeof value === 'string' && value.trim().length > 0
  if (textOk || !valueOk) return params
  return { ...params, text: value }
}

export function mergeNodeParams(
  opId: string | undefined,
  existing: Record<string, unknown> | undefined,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...(existing ?? {}), ...patch }
  if (opId && opId !== NUMBER_CONST_OP_ID) {
    const leakedChrome = ['min', 'max', 'precision'].some((key) => key in merged)
    if (leakedChrome) {
      for (const key of Object.keys(merged)) {
        if (isNumberConstSliderParamKey(key)) delete merged[key]
      }
      if (typeof merged.value === 'number') delete merged.value
    }
  }
  return normalizeTextPanelParams(opId, merged) ?? merged
}

export function applyOps(
  graph: GraphFileV1,
  ops: readonly Op[],
  registry?: OpRegistry,
): { ok: true } | { ok: false; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = []
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]
    const rec = op as unknown as Record<string, unknown>
    switch (op.type) {
      case 'createNode': {
        const idErr = requireIdentifier(rec, 'nodeId', 'createNode', i)
        if (idErr) {
          diagnostics.push(idErr)
          break
        }
        if (graph.nodes[op.nodeId]) {
          diagnostics.push({ opIndex: i, severity: 'error', message: `node ${op.nodeId} already exists` })
          break
        }
        graph.nodes[op.nodeId] = {
          id: op.nodeId,
          opId: op.opId,
          position: op.position ?? autoNodePosition(graph),
          params: normalizeTextPanelParams(op.opId, op.params ?? {}) ?? {},
          ...(op.name !== undefined ? { name: op.name } : {}),
          ...(op.previewEnabled !== undefined ? { previewEnabled: op.previewEnabled } : {}),
        }
        break
      }
      case 'updateNode': {
        const idErr = requireIdentifier(rec, 'nodeId', 'updateNode', i)
        if (idErr) {
          diagnostics.push(idErr)
          break
        }
        const node = graph.nodes[op.nodeId]
        if (node) {
          if (op.params !== undefined) node.params = mergeNodeParams(node.opId, node.params, op.params)
          if (op.position !== undefined) node.position = op.position
          if (op.name !== undefined) node.name = op.name
          if (op.previewEnabled !== undefined) node.previewEnabled = op.previewEnabled
          break
        }
        // Group-aware fallback: the node may be a member of a group's inner
        // sub-graph (groups are not flattened into graph.nodes). This lets an
        // external mapped Run button / AI route persist a manual-trigger inner
        // battery's result (`_gen_image` / `_gen_result` / `_gen_error`) onto the
        // inner node by its globally-unique id, the SAME op a top-level node uses.
        let innerNode: GraphNode | undefined
        for (const grp of Object.values(graph.groups ?? {})) {
          const found = grp.nodes.find((n) => n.id === op.nodeId)
          if (found) {
            innerNode = found
            break
          }
        }
        if (!innerNode) {
          diagnostics.push({ opIndex: i, severity: 'error', message: `node ${op.nodeId} does not exist` })
          break
        }
        if (op.params !== undefined) {
          innerNode.params = mergeNodeParams(innerNode.opId, innerNode.params, op.params)
        }
        if (op.position !== undefined) innerNode.position = op.position
        if (op.name !== undefined) innerNode.name = op.name
        if (op.previewEnabled !== undefined) innerNode.previewEnabled = op.previewEnabled
        break
      }
      case 'deleteNode': {
        const idErr = requireIdentifier(rec, 'nodeId', 'deleteNode', i)
        if (idErr) {
          diagnostics.push(idErr)
          break
        }
        if (!graph.nodes[op.nodeId]) {
          diagnostics.push({ opIndex: i, severity: 'error', message: `node ${op.nodeId} does not exist` })
          break
        }
        delete graph.nodes[op.nodeId]
        // Cascade-remove edges that referenced this node.
        for (const [edgeId, edge] of Object.entries(graph.edges)) {
          if (edge.source.nodeId === op.nodeId || edge.target.nodeId === op.nodeId) {
            delete graph.edges[edgeId]
          }
        }
        break
      }
      case 'connect': {
        // Endpoints are nested objects (`{ nodeId, port }`), not top-level fields, so
        // requireIdentifier can't probe them directly — validate shape first to avoid
        // a bare `op.source.nodeId` throwing when `source`/`target` itself is missing
        // or malformed (a crash is its own kind of loud-but-unhelpful failure).
        const sourceRec = (rec.source ?? {}) as Record<string, unknown>
        const targetRec = (rec.target ?? {}) as Record<string, unknown>
        const sourceErr =
          typeof rec.source !== 'object' || rec.source === null
            ? { opIndex: i, severity: 'error' as const, message: `connect op[${i}] is missing a valid "source" object (got ${JSON.stringify(rec.source)})` }
            : requireIdentifier(sourceRec, 'nodeId', 'connect.source', i)
        if (sourceErr) {
          diagnostics.push(sourceErr)
          break
        }
        const targetErr =
          typeof rec.target !== 'object' || rec.target === null
            ? { opIndex: i, severity: 'error' as const, message: `connect op[${i}] is missing a valid "target" object (got ${JSON.stringify(rec.target)})` }
            : requireIdentifier(targetRec, 'nodeId', 'connect.target', i)
        if (targetErr) {
          diagnostics.push(targetErr)
          break
        }
        const edgeId = op.edgeId ?? mintEdgeId(graph)
        if (graph.edges[edgeId]) {
          diagnostics.push({ opIndex: i, severity: 'error', message: `edge ${edgeId} already exists` })
          break
        }
        if (!graph.nodes[op.source.nodeId]) {
          diagnostics.push(unresolvedNodeRef(i, 'connect', 'source.nodeId', op.source.nodeId))
          break
        }
        if (!graph.nodes[op.target.nodeId]) {
          diagnostics.push(unresolvedNodeRef(i, 'connect', 'target.nodeId', op.target.nodeId))
          break
        }
        graph.edges[edgeId] = { id: edgeId, source: op.source, target: op.target }
        break
      }
      // `deleteEdge` is a first-class alias for `disconnect` — see the Op
      // union comment (2026-07-10 postmortem) for why the kernel accepts
      // both spellings instead of only fixing the prompt docs.
      case 'disconnect':
      case 'deleteEdge': {
        const idErr = requireIdentifier(rec, 'edgeId', op.type, i)
        if (idErr) {
          diagnostics.push(idErr)
          break
        }
        if (!graph.edges[op.edgeId]) {
          diagnostics.push({ opIndex: i, severity: 'error', message: `edge ${op.edgeId} does not exist` })
          break
        }
        delete graph.edges[op.edgeId]
        break
      }
      case 'setMetadata': {
        graph.metadata = { ...(graph.metadata ?? {}), [op.key]: op.value }
        break
      }
      case 'deleteGroup': {
        const result = applyDeleteGroup(graph, op, i)
        if (result.error) diagnostics.push(result.error)
        break
      }
      case 'createGroup': {
        const result = applyCreateGroup(graph, op, i, registry)
        if (result.error) diagnostics.push(result.error)
        break
      }
      case 'updateGroup': {
        const result = applyUpdateGroup(graph, op, i)
        if (result.error) diagnostics.push(result.error)
        break
      }
      case 'ungroup': {
        const result = applyUngroup(graph, op, i)
        if (result.error) diagnostics.push(result.error)
        break
      }
      default: {
        // 2026-07-10 postmortem: this switch used to have NO default branch,
        // so an op with an unrecognized `type` (e.g. the long-undocumented
        // kernel/doc mismatch around `deleteEdge` vs `disconnect`) was
        // silently skipped — no diagnostic, batch still returns
        // `status:'ok'`, and the caller has zero signal that op never ran.
        // Any truly unknown type now fails loudly instead of vanishing.
        const unknownType = (rec.type as string | undefined) ?? '(missing)'
        diagnostics.push({
          opIndex: i,
          severity: 'error',
          message: `op[${i}] has unrecognized type "${unknownType}" — this op was NOT applied. `
            + 'Valid types: createNode / updateNode / deleteNode / connect / disconnect (alias deleteEdge) / '
            + 'setMetadata / createGroup / updateGroup / deleteGroup / ungroup.',
        })
        break
      }
    }
  }
  if (diagnostics.some((d) => d.severity === 'error')) return { ok: false, diagnostics }
  return { ok: true }
}
