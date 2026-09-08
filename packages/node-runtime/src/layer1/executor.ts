// Pipeline executor.
//
// Walks a graph in topological order, calls each op via the dispatcher, and
// caches outputs. Plugin-aware concerns (dynamic op imports, type-specific
// invocation, plugin service ctx construction) are not the kernel's job —
// the plugin attaches its `execute` closure to OpSpec at registerOp() time.
//
// The executor only knows OpSpec, GraphNode, GraphEdge, NodeGroup. It does
// not know Battery, sourcePath, JSON / TS / AI distinctions, or any concrete
// service shape.

import { DataTree, type DataTreeEntry } from './datatree/index.js'
import { executeWithDataTreeDispatch } from './dispatcher.js'
import type { OpRegistry } from './op-registry.js'
import type { ExecutionContext, OpAccess } from './types/op-spec.js'
import type { GraphEdge, GraphNode, NodeGroup } from './types/graph.js'

const RELAY_OP_ID = '__relay__'
const RELAY_INPUT_PORT = 'input'
const RELAY_OUTPUT_PORT = 'output'
const GROUP_OP_ID = '__group__'

function logNodeFailure(ctx: ExecutionContext, message: string): void {
  if (ctx.execLogMode === 'summary') {
    if (!ctx.execFailures) ctx.execFailures = []
    ctx.execFailures.push(message)
    return
  }
  ctx.log('error', message)
}

function mergeIndexedListInputs(
  opInputs: ReadonlyArray<{ name: string; access?: OpAccess }>,
  inputValues: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...inputValues }
  for (const port of opInputs) {
    if (port.access !== 'list' || merged[port.name] !== undefined) continue
    const prefix = `${port.name}_`
    const indexed = Object.entries(merged)
      .filter(([name]) => name.startsWith(prefix) && /^\d+$/.test(name.slice(prefix.length)))
      .sort(([left], [right]) => Number(left.slice(prefix.length)) - Number(right.slice(prefix.length)))
    if (indexed.length === 0) continue
    const items: unknown[] = []
    for (const [name, value] of indexed) {
      const tree = value instanceof DataTree
        ? value
        : DataTree.isDataTree(value)
          ? DataTree.fromEntries((value as { toJSON(): ReadonlyArray<DataTreeEntry<unknown>> }).toJSON())
          : Array.isArray(value)
            ? DataTree.fromJSON(value as DataTreeEntry<unknown>[])
            : DataTree.fromItem(value)
      for (const entry of tree.toJSON()) items.push(...entry.items)
      delete merged[name]
    }
    merged[port.name] = DataTree.fromEntries(
      items.map((item, index) => ({ path: [0, index], items: [item] })),
    ).toJSON()
  }
  return merged
}

// ── Diagnostics ──────────────────────────────────────────────────────────────
// Compact, bounded shape descriptor for a wire value (DataTreeEntry[] = [{path,
// items}]). Surfaces the signals that explain WHY a scene op (e.g. add_child)
// errors or produces nothing — without ever dumping the full (possibly huge)
// payload. For scene items it lifts `focus`, the field add_child validates.
function describeWireItem(item: unknown): string {
  if (item !== null && typeof item === 'object') {
    const o = item as Record<string, unknown>
    if (typeof o.focus === 'string') return `focus="${o.focus}"`
    return `keys=${Object.keys(o).slice(0, 4).join('|') || '∅'}`
  }
  if (typeof item === 'string') return `"${item.slice(0, 32)}"`
  return String(item)
}

function describeWireValue(val: unknown): string {
  if (val === undefined) return 'undefined'
  if (val === null) return 'null'
  if (Array.isArray(val)) {
    let items = 0
    let sample = ''
    for (const e of val) {
      if (e !== null && typeof e === 'object' && Array.isArray((e as { items?: unknown }).items)) {
        const its = (e as { items: unknown[] }).items
        items += its.length
        if (!sample && its.length > 0) sample = describeWireItem(its[0])
      }
    }
    return `entries[${val.length}] items[${items}]${sample ? ` first{${sample}}` : ''}`
  }
  if (typeof val === 'object') return 'object'
  if (typeof val === 'string') return `"${val.slice(0, 32)}"`
  return String(val)
}

function summarizeWireInputs(inputs: Record<string, unknown>): string {
  const parts = Object.entries(inputs).map(([port, val]) => `${port}=${describeWireValue(val)}`)
  return parts.length > 0 ? parts.join(', ') : '<none>'
}

// Per-node execution result returned from the executor.
export interface NodeExecutionResult {
  nodeId: string
  // Per-port output bag; data ports hold DataTreeEntry<unknown>[] (toJSON form).
  outputs: Record<string, unknown>
  durationMs: number
  error?: string
  // Dynamic-output op only: actual output port descriptors after execution.
  dynamicOutputPorts?: Array<{ name: string; type: string; label: string; access?: OpAccess }>
  // loopUnpack engineBehavior payload (the unpacked batch).
  loopBatch?: unknown[]
  // loopUnpack engineBehavior payload (collector id pairing list_unpack with list_collect).
  loopCollectorId?: string
}

// Inputs to a single node call: upstream wire values keyed by target port name.
export type NodeInputValues = Record<string, unknown>

// Snapshot of cached outputs for one node, keyed by port name.
export type NodeOutputCache = Record<string, Record<string, unknown>>

function isDataTreeWireValue(value: unknown): value is DataTreeEntry<unknown>[] {
  return Array.isArray(value) && value.every((entry) =>
    entry !== null &&
    typeof entry === 'object' &&
    Array.isArray((entry as DataTreeEntry<unknown>).path) &&
    Array.isArray((entry as DataTreeEntry<unknown>).items),
  )
}

// Execute one node by op id. The plugin pre-registered the OpSpec with its execute
// closure, so the kernel just resolves the spec and hands it to the dispatcher.
export async function executeNode(
  registry: OpRegistry,
  node: GraphNode,
  inputValues: NodeInputValues,
  ctx: ExecutionContext,
): Promise<NodeExecutionResult> {
  const start = Date.now()
  const op = registry.get(node.opId)
  if (!op) {
    return {
      nodeId: node.id,
      outputs: {},
      durationMs: 0,
      error: `Op not registered: ${node.opId}`,
    }
  }

  // Split incoming values into wire-borne (dataInputs) and panel/default
  // (controlInputs). dataInputs precedence overrides node.params overrides
  // op input defaults.
  const dataInputs: Record<string, unknown> = {}
  const normalizedInputValues = mergeIndexedListInputs(op.inputs, inputValues)
  for (const [key, val] of Object.entries(normalizedInputValues)) {
    if (val !== undefined) dataInputs[key] = val
  }
  const controlInputs: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(node.params ?? {})) {
    if (val === undefined || key in dataInputs) continue
    // Scene Script array literals are persisted in DataTreeEntry[] wire form.
    // Route them through the dispatcher so the destination port's item/list/tree
    // contract peels the collection correctly. Ordinary scalar params retain
    // their historical raw-control-input behavior.
    if (isDataTreeWireValue(val)) dataInputs[key] = val
    else controlInputs[key] = val
  }
  for (const inp of op.inputs) {
    if (
      controlInputs[inp.name] === undefined &&
      !(inp.name in dataInputs) &&
      inp.default !== undefined
    ) {
      controlInputs[inp.name] = inp.default
    }
  }

  // Engine-derived connection inference (carried on the context, not node.params)
  // is surfaced to adaptive ops via the args bag at execution time only — and
  // never overrides a value the node already locked in params / wired inputs.
  const inference = ctx.connectionInference
  if (inference) {
    if (
      inference.access !== undefined &&
      controlInputs.inferredAccess === undefined &&
      !('inferredAccess' in dataInputs)
    ) {
      controlInputs.inferredAccess = inference.access
    }
    if (
      inference.type !== undefined &&
      controlInputs.inferredType === undefined &&
      !('inferredType' in dataInputs)
    ) {
      controlInputs.inferredType = inference.type
    }
  }

  try {
    const fnWithCtx = (input: Record<string, unknown>): unknown | Promise<unknown> =>
      op.execute(ctx, input)

    const dispatched = await executeWithDataTreeDispatch(
      op,
      dataInputs,
      controlInputs,
      fnWithCtx as (i: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>,
    )

    // Pull engineBehavior signals out of the dispatched result.
    let loopBatch: unknown[] | undefined
    let loopCollectorId: string | undefined
    if (op.engineBehavior === 'loopUnpack' && Array.isArray(dispatched._loopBatch)) {
      loopBatch = dispatched._loopBatch as unknown[]
      loopCollectorId =
        typeof dispatched._loopCollectorId === 'string' ? dispatched._loopCollectorId : 'default'
      ctx.log('debug', `Loop signal: op=${op.id} collectorId=${loopCollectorId} batch.length=${loopBatch.length}`)
    }

    // Wire payload normalisation: every data port is serialised as
    // DataTreeEntry<unknown>[] (the toJSON form). Non-DataTree returns
    // become an empty entries array.
    const toJsonEntries = (v: unknown): DataTreeEntry<unknown>[] =>
      v instanceof DataTree ? (v.toJSON() as DataTreeEntry<unknown>[]) : []

    const outputs: Record<string, unknown> = {}
    for (const out of op.outputs) {
      const v = dispatched[out.name]
      if (v === undefined) continue
      outputs[out.name] = toJsonEntries(v)
    }

    // `error` may arrive either as a raw signal (legacy ops that don't declare
    // an `error` output) or as a wrapped DataTree (ops that declare it as an
    // output port — processImage batteries). Unwrap to a scalar string, and
    // only treat a NON-EMPTY message as a genuine execution error. An empty
    // string is the success sentinel and must not fail the node.
    const unwrapError = (v: unknown): string => {
      if (v === undefined) return ''
      if (v instanceof DataTree) {
        const first = (v.toJSON() as DataTreeEntry<unknown>[])[0]?.items?.[0]
        return first === undefined || first === null ? '' : String(first)
      }
      return String(v)
    }
    const errStr = unwrapError(dispatched.error)
    const fnError = errStr !== '' ? errStr : undefined

    if (op.dynamicOutputs) {
      if (fnError !== undefined) {
        return {
          nodeId: node.id,
          outputs,
          durationMs: Date.now() - start,
          loopBatch,
          loopCollectorId,
          error: fnError,
        }
      }

      const { prefix, labelTemplate, type, access } = op.dynamicOutputs
      const dynamicOutputPorts: Array<{
        name: string
        type: string
        label: string
        access?: OpAccess
      }> = []

      const dynKeys = Object.keys(dispatched)
        .filter((k) => k.startsWith(prefix))
        .sort((a, b) => {
          const ia = parseInt(a.slice(prefix.length), 10)
          const ib = parseInt(b.slice(prefix.length), 10)
          return ia - ib
        })

      for (const key of dynKeys) {
        const v = dispatched[key]
        if (v === undefined) continue
        const idx = key.slice(prefix.length)
        outputs[key] = toJsonEntries(v)
        dynamicOutputPorts.push({
          name: key,
          type,
          label: labelTemplate.replace('$i', idx),
          access,
        })
      }

      ctx.log(
        'debug',
        `Op (dynamicOutputs) executed: ${op.id} static=${op.outputs.length} dynamic=${dynamicOutputPorts.length} (${Date.now() - start}ms)`,
      )
      return {
        nodeId: node.id,
        outputs,
        dynamicOutputPorts,
        durationMs: Date.now() - start,
        loopBatch,
        loopCollectorId,
        ...(fnError ? { error: fnError } : {}),
      }
    }

    ctx.log('debug', `Op executed: ${op.id} (${Date.now() - start}ms)`)
    return {
      nodeId: node.id,
      outputs,
      durationMs: Date.now() - start,
      loopBatch,
      loopCollectorId,
      ...(fnError ? { error: fnError } : {}),
    }
  } catch (err) {
    logNodeFailure(ctx, `Op execution error [${op.id}]: ${err instanceof Error ? err.message : String(err)}`)
    return {
      nodeId: node.id,
      outputs: {},
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// Kahn topological sort: order nodeIds by dependency so every upstream node runs
// before its downstream consumers.
export function topologicalSort(nodeIds: readonly string[], edges: readonly GraphEdge[]): string[] {
  const nodeSet = new Set(nodeIds)
  const inDegree = new Map<string, number>()
  const adj = new Map<string, string[]>()

  for (const id of nodeIds) {
    inDegree.set(id, 0)
    adj.set(id, [])
  }

  for (const edge of edges) {
    const src = edge.source.nodeId
    const tgt = edge.target.nodeId
    if (!nodeSet.has(src) || !nodeSet.has(tgt)) continue
    adj.get(src)!.push(tgt)
    inDegree.set(tgt, (inDegree.get(tgt) ?? 0) + 1)
  }

  const queue = [...nodeIds].filter((id) => inDegree.get(id) === 0)
  const sorted: string[] = []

  while (queue.length > 0) {
    const curr = queue.shift()!
    sorted.push(curr)
    for (const next of adj.get(curr) ?? []) {
      const deg = (inDegree.get(next) ?? 0) - 1
      inDegree.set(next, deg)
      if (deg === 0) queue.push(next)
    }
  }

  return sorted
}

// BFS downstream from a starting node; partial execution uses it to pick the impacted
// node subset.
export function getDownstreamNodeIds(
  startId: string,
  allNodeIds: readonly string[],
  edges: readonly GraphEdge[],
): string[] {
  const nodeSet = new Set(allNodeIds)
  const visited = new Set<string>([startId])
  const queue = [startId]

  while (queue.length > 0) {
    const curr = queue.shift()!
    for (const edge of edges) {
      const tgt = edge.target.nodeId
      if (edge.source.nodeId === curr && nodeSet.has(tgt) && !visited.has(tgt)) {
        visited.add(tgt)
        queue.push(tgt)
      }
    }
  }

  return [...visited]
}

// Execute a NodeGroup's inner sub-graph: map external inputs onto the matching inner-node
// ports, topo-sort and run the inner nodes feeding each other through internal edges, then
// read the exposed outputs back out as the group's external output bag. A group whose id is
// already being visited throws, so nested groups can't recurse into a cycle.
export async function executeGroupSubgraph(
  group: NodeGroup,
  externalInputs: NodeInputValues,
  registry: OpRegistry,
  ctx: ExecutionContext,
  options: {
    // Resolver for nested __group__ inner nodes. Without it, nesting is unsupported.
    getNestedGroup?: (groupId: string) => NodeGroup | undefined
    // Cycle detection state.
    visiting?: ReadonlySet<string>
    /**
     * Per-inner-node result sink. Invoked once after each inner node executes
     * with its output bag (DataTreeEntry[] form, keyed by port name). Used by
     * the editor "probe" path so a group's INTERNAL view can show real data on
     * its inner nodes' wires instead of empty "no result". Pure observation —
     * it never affects the group's external output. The `groupId` identifies
     * which (possibly nested) sub-graph the inner node belongs to so callers can
     * scope/route the values (top-level inner ids are globally unique).
     */
    onInnerResult?: (info: {
      groupId: string
      innerNodeId: string
      opId: string
      outputs: Record<string, unknown>
    }) => void
  } = {},
): Promise<Record<string, unknown>> {
  const { getNestedGroup, visiting = new Set(), onInnerResult } = options

  if (visiting.has(group.id)) {
    throw new Error(`Group cycle detected: ${[...visiting, group.id].join(' → ')}`)
  }
  const nextVisiting = new Set(visiting)
  nextVisiting.add(group.id)

  const innerNodeMap = new Map(group.nodes.map((n) => [n.id, n]))
  const innerEdgesByTarget = new Map<string, GraphEdge[]>()
  for (const edge of group.edges) {
    const arr = innerEdgesByTarget.get(edge.target.nodeId) ?? []
    arr.push(edge)
    innerEdgesByTarget.set(edge.target.nodeId, arr)
  }

  // External-input injection map: inner nodeId → { inner port name → value }
  const externalInjections = new Map<string, Record<string, unknown>>()
  for (const ep of group.exposedInputs) {
    const val = externalInputs[ep.portName]
    if (val !== undefined) {
      const existing = externalInjections.get(ep.sourceNodeId) ?? {}
      existing[ep.sourcePortName] = val
      externalInjections.set(ep.sourceNodeId, existing)
    }
  }

  const innerNodeIds = group.nodes.map((n) => n.id)
  const sortedIds = topologicalSort(innerNodeIds, group.edges)
  const innerOutputCache: NodeOutputCache = {}

  for (const innerNodeId of sortedIds) {
    const innerNode = innerNodeMap.get(innerNodeId)
    if (!innerNode) continue

    const innerInputValues: NodeInputValues = {}
    for (const edge of innerEdgesByTarget.get(innerNodeId) ?? []) {
      const upstream = innerOutputCache[edge.source.nodeId]
      if (upstream?.[edge.source.port] !== undefined) {
        innerInputValues[edge.target.port] = upstream[edge.source.port]
      }
    }
    const injections = externalInjections.get(innerNodeId)
    if (injections) Object.assign(innerInputValues, injections)

    // Nested __group__ inner node: recurse.
    if (innerNode.opId === GROUP_OP_ID) {
      const innerGroupId = typeof innerNode.params?.groupId === 'string' ? innerNode.params.groupId : ''
      const innerGroup = getNestedGroup ? getNestedGroup(innerGroupId) : undefined
      if (!innerGroup) {
        ctx.log('warn', `[Group ${group.id}] Nested group not found: ${innerGroupId} (node ${innerNodeId})`)
        innerOutputCache[innerNodeId] = {}
        continue
      }
      try {
        innerOutputCache[innerNodeId] = await executeGroupSubgraph(
          innerGroup,
          innerInputValues,
          registry,
          ctx,
          { getNestedGroup, visiting: nextVisiting, onInnerResult },
        )
      } catch (e) {
        // Cycles are structural errors — propagate so callers can surface them.
        if (e instanceof Error && /cycle detected/i.test(e.message)) throw e
        ctx.log('error', `[Group ${group.id}] Nested group ${innerGroupId} failed: ${e}`)
        innerOutputCache[innerNodeId] = {}
      }
      onInnerResult?.({ groupId: group.id, innerNodeId, opId: innerNode.opId, outputs: innerOutputCache[innerNodeId] })
      continue
    }

    if (innerNode.opId === RELAY_OP_ID) {
      innerOutputCache[innerNodeId] = {
        [RELAY_OUTPUT_PORT]: innerInputValues[RELAY_INPUT_PORT],
      }
      onInnerResult?.({ groupId: group.id, innerNodeId, opId: innerNode.opId, outputs: innerOutputCache[innerNodeId] })
      continue
    }

    // Manual-trigger ops are never auto-run (see executeNode in layer2): firing
    // them on every group execution would re-hit an expensive/side-effecting API.
    // Instead treat the inner node as a data boundary and HYDRATE its outputs
    // from the Run result persisted on its params under the `_gen_<port>`
    // convention (the same fields the Run button / AI route write: `_gen_image`,
    // `_gen_result`, `_gen_error`). This lets the external mapped Run button (or
    // an AI tool naming the inner node) drive the inner battery and have its
    // result flow out through the group's exposed output to downstream consumers,
    // exactly like a top-level manual-trigger node. With no persisted result the
    // output stays empty (never run yet).
    const innerOp = registry.get(innerNode.opId)
    if (innerOp?.manualTrigger) {
      const hydrated: Record<string, unknown> = {}
      const params = innerNode.params ?? {}
      for (const out of innerOp.outputs) {
        const persisted = params[`_gen_${out.name}`]
        if (typeof persisted === 'string' && persisted !== '') {
          hydrated[out.name] = DataTree.fromItem(persisted).toJSON()
        }
      }
      ctx.log(
        'debug',
        `[Group ${group.id}] Manual-trigger inner node ${innerNodeId}: hydrated ports [${Object.keys(hydrated).join(',')}]`,
      )
      innerOutputCache[innerNodeId] = hydrated
      onInnerResult?.({ groupId: group.id, innerNodeId, opId: innerNode.opId, outputs: hydrated })
      continue
    }

    const result = await executeNode(registry, innerNode, innerInputValues, ctx)
    if (result.error) {
      // Include the resolved inputs the node received: an inner scene op that
      // "stops" the chain (add_child et al.) almost always fails because an
      // upstream port arrived empty/malformed — the input shape pinpoints which.
      logNodeFailure(
        ctx,
        `[Group ${group.id}] Inner node error [${innerNodeId}] op=${innerNode.opId}: ${result.error} | inputs: ${summarizeWireInputs(innerInputValues)}`,
      )
    } else {
      // Per-node trace (gated by FORGEAX_EXEC_DEBUG at the log sink): shows the
      // full inner data flow so a chain that quietly produces empty downstream
      // can be traced to the exact node where a port went empty.
      ctx.log(
        'debug',
        `[Group ${group.id}] inner ${innerNodeId} op=${innerNode.opId} inputs: ${summarizeWireInputs(innerInputValues)} → out[${Object.keys(result.outputs).join(',') || '∅'}]`,
      )
    }
    innerOutputCache[innerNodeId] = result.outputs
    onInnerResult?.({ groupId: group.id, innerNodeId, opId: innerNode.opId, outputs: result.outputs })
  }

  const groupOutputs: Record<string, unknown> = {}
  for (const ep of group.exposedOutputs) {
    const bag = innerOutputCache[ep.sourceNodeId]
    const val = bag?.[ep.sourcePortName]
    if (val !== undefined) groupOutputs[ep.portName] = val
    else {
      // Diagnostic for the "group output = no result" report: an exposed output
      // resolved to nothing. Either the source inner node never produced (bag
      // empty / undefined) or the source PORT name doesn't match the inner
      // node's actual output port (a nested group emits keys = its OWN exposed
      // portName, so the outer ep.sourcePortName must equal that).
      if (ctx.execLogMode !== 'summary') {
        ctx.log(
          'warn',
          `[Group ${group.id}] exposed output "${ep.portName}" empty: ` +
            `source=${ep.sourceNodeId}.${ep.sourcePortName} ` +
            `bagPorts=[${bag ? Object.keys(bag).join(',') : '<no-bag>'}]`,
        )
      }
    }
  }
  return groupOutputs
}
