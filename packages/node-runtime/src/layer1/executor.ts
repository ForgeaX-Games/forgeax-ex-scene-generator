// Single-op dispatcher.
//
// Calls one registered `OpSpec.execute` via the DataTree dispatcher. Scene
// execution is runSceneModule, not a walk of the display graph. Plugin-aware
// concerns are not the kernel's job — the plugin attaches its `execute`
// closure to OpSpec at registerOp() time.
//
// The executor only knows OpSpec, GraphNode, GraphEdge. It does
// not know Battery, sourcePath, JSON / TS / AI distinctions, or any concrete
// service shape.

import { DataTree, type DataTreeEntry } from './datatree/index.js'
import { executeWithDataTreeDispatch } from './dispatcher.js'
import type { OpRegistry } from './op-registry.js'
import type { ExecutionContext, OpAccess } from './types/op-spec.js'
import type { GraphEdge, GraphNode } from './types/graph.js'

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
