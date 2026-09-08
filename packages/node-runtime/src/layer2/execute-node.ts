// Layer 2 execution API. Runs a graph — a target node's DOWNSTREAM closure
// (the node plus every node it feeds, with boundary upstream inputs hydrated
// from the persisted output cache), or the whole pipeline — and streams
// progress over the runtime's event bus.
//
// Hybrid lifecycle: executeNode validates synchronously, emits exec:started,
// resolves a handle, then walks the closure in the background. The returned
// promise does NOT wait for the run to finish; await handle.done for that.

import { randomUUID } from 'node:crypto'

import { executeNode as executeNodeL1, executeGroupSubgraph } from '../layer1/index.js'
import type { ExecutionContext, GraphEdge, GraphNode, OpAccess, OpRegistry } from '../layer1/index.js'
import { busFor, type EventBus } from './event-bus.js'
import { collectCachedNodeIds, GROUP_OP_ID } from './apply-batch.js'
import {
  buildExecutionClosure,
  expandClosureForMissingBoundaryCaches,
  resolveNodeInputs,
  type ExecutionClosure,
} from './resolve-inputs.js'
import type { Runtime } from './runtime.js'

// Mirrors the relay sentinel in layer1/executor.ts (a wire pass-through node).
const RELAY_OP_ID = '__relay__'

export interface ExecuteNodeRequest {
  // Run this node's downstream closure. Omit to run the whole pipeline.
  nodeId?: string
  /** Collect per-node failures and emit one summary line instead of flooding logs. */
  quietErrors?: boolean
}

export interface ExecutionResult {
  executionId: string
  status: 'completed' | 'error' | 'aborted'
  // nodeId -> portId -> wire value (DataTreeEntry[] form).
  outputs: Record<string, Record<string, unknown>>
  /**
   * Small, serializable origin records for every public output, including ports
   * whose large value was omitted from `outputs`. Hosts may enrich these with
   * authoring/SceneGraph lineage without touching the business value.
   */
  resultMetadata?: Record<string, Record<string, {
    producerNodeId: string
    producerPort: string
    outputType: string
    value: { inline: boolean; ref?: string }
  }>>
  error?: { nodeId?: string; message: string }
  /** Bounded structured node failures; hosts should prefer this over parsing execFailures strings. */
  failures?: Array<{ nodeId?: string; message: string }>
  /** Present when `quietErrors: true`; mirrors Studio execute failure summary. */
  execFailures?: string[]
  durationMs: number
}

export interface ExecutionHandle {
  executionId: string
  abort(): void
  done: Promise<ExecutionResult>
}

type LoadedGraph = NonNullable<ReturnType<Runtime['graph']['load']>>

function portTypeOf(registry: OpRegistry, opId: string, portId: string): string {
  return registry.get(opId)?.outputs.find((o) => o.name === portId)?.type ?? 'any'
}

// Infer an adaptive dynamic-input node's connection access/type from the upstream source
// port feeding its first dynamic input. Returned for the execution context (never written
// into node.params) so it can't collide with a user param of the same name; the engine
// surfaces it to the op only when the node hasn't already locked the values.
function resolveConnectionInference(
  registry: OpRegistry,
  node: GraphNode,
  nodesById: ReadonlyMap<string, GraphNode>,
  edges: readonly GraphEdge[],
): { access: OpAccess; type?: string } | undefined {
  // A persisted params lock (written by the frontend on first connect) wins;
  // skip inference entirely so we don't shadow it. `node.params` may be absent
  // entirely (undefined) on graphs built via the backend applyBatch/import path
  // or hand-edited JSON — unlike the editor, which always writes `params: {}`.
  // Guard the access so a params-less node falls through to live inference
  // instead of throwing "Cannot read properties of undefined (reading
  // 'inferredAccess')" and aborting the whole pipeline.
  if (node.params?.inferredAccess !== undefined) return undefined

  const targetOp = registry.get(node.opId)
  const dyn = targetOp?.dynamicInputs
  if (!dyn) return undefined

  const firstDynamicPort = `${dyn.prefix}0`
  const firstEdge = edges.find((edge) => edge.target.nodeId === node.id && edge.target.port === firstDynamicPort)
  if (!firstEdge) return undefined

  const sourceNode = nodesById.get(firstEdge.source.nodeId)
  const sourceOp = sourceNode ? registry.get(sourceNode.opId) : undefined
  const sourcePort = sourceOp?.outputs.find((output) => output.name === firstEdge.source.port)
  if (!sourcePort) return undefined

  return {
    access: sourcePort.access ?? 'item',
    ...(sourcePort.type !== undefined ? { type: sourcePort.type } : {}),
  }
}

async function runWalk(
  runtime: Runtime,
  bus: EventBus,
  graphFile: LoadedGraph,
  closure: ExecutionClosure,
  executionId: string,
  signal: AbortSignal,
  quietErrors = false,
): Promise<ExecutionResult> {
  const startedAt = Date.now()
  const pipelineId = runtime.config.pipelineId
  // In-memory output cache that feeds DOWNSTREAM inputs during this run. It is
  // NOT the result payload — entries are evicted the moment every in-closure
  // consumer has run (see `releaseProduced`), so peak memory is bounded to the
  // live working set instead of the sum of every node's output. The durable
  // copy lives in the on-disk output cache (`runtime.outputs`), which is also
  // what boundary/cold reads fall back to.
  const produced = new Map<string, Record<string, unknown>>()
  // The result payload echoed back to the caller for instant preview apply.
  // Only SMALL port values are inlined here; large (sharded) outputs are
  // omitted so the response never rebuilds a multi-hundred-MB JSON string —
  // the client re-fetches those lazily from the output cache.
  const resultOutputs: Record<string, Record<string, unknown>> = {}
  const resultMetadata: NonNullable<ExecutionResult['resultMetadata']> = {}

  // Reference counts for `produced` eviction: how many distinct in-closure
  // consumer nodes still need to read each producer's cached output. Boundary
  // (out-of-closure) consumers are excluded — they read from disk, not memory.
  const inClosure = new Set(closure.sorted)
  const producersByConsumer = new Map<string, Set<string>>()
  const consumersRemaining = new Map<string, number>()
  {
    const counted = new Set<string>()
    for (const e of closure.edges) {
      const p = e.source.nodeId
      const c = e.target.nodeId
      if (!inClosure.has(p) || !inClosure.has(c)) continue
      let set = producersByConsumer.get(c)
      if (!set) {
        set = new Set<string>()
        producersByConsumer.set(c, set)
      }
      set.add(p)
      const key = `${p}\u0000${c}`
      if (!counted.has(key)) {
        counted.add(key)
        consumersRemaining.set(p, (consumersRemaining.get(p) ?? 0) + 1)
      }
    }
  }
  // Called after a node finishes: drop any upstream producer whose last
  // consumer just ran, and drop the node itself if it is a closure sink. The
  // freed values become eligible for GC immediately rather than at run end.
  const releaseProduced = (consumerId: string): void => {
    const producers = producersByConsumer.get(consumerId)
    if (producers) {
      for (const p of producers) {
        const n = (consumersRemaining.get(p) ?? 0) - 1
        consumersRemaining.set(p, n)
        if (n <= 0) produced.delete(p)
      }
    }
    if ((consumersRemaining.get(consumerId) ?? 0) <= 0) produced.delete(consumerId)
  }

  const baseCtx: ExecutionContext = {
    pipelineId,
    log: () => {},
    signal,
    ...(quietErrors ? { execLogMode: 'summary' as const, execFailures: [] } : {}),
  }
  // Generic seam: a host may enrich the context (e.g. inject `services`) via RuntimeConfig.createExecutionContext. Default = base context unchanged.
  const ctx: ExecutionContext = runtime.config.createExecutionContext
    ? runtime.config.createExecutionContext(baseCtx)
    : baseCtx
  const executedHash = graphFile.hash
  // Full node map (every graph node, not just this run's closure) so connection
  // inference can resolve a boundary upstream source port that a partial
  // (downstream) closure does not include in `nodesById`.
  const allNodesById = new Map<string, GraphNode>(Object.entries(graphFile.nodes))

  // A failing node does NOT abort the run — the walker records it and keeps
  // going. Aborting made one bad node blank the whole graph: every node after
  // it in topological order never executed, so their output caches stayed empty
  // and every port downstream of the failure point read "-" until something
  // else happened to re-run them. A half-wired preview sink (`scene_output`
  // with no scene yet) is enough to trigger that, and it is a completely normal
  // intermediate state while wiring a graph. Unrelated branches must still
  // compute and persist. The reported `status`/`error` keep the old contract:
  // error status, first failure's message.
  let firstError: ExecutionResult['error'] | undefined
  const failures: NonNullable<ExecutionResult['failures']> = []
  const recordNodeFailure = (nodeId: string, message: string): void => {
    bus.emit({ kind: 'exec:error', pipelineId, executionId, nodeId, message })
    if (!firstError) firstError = { nodeId, message }
    if (failures.length < 20) failures.push({ nodeId, message })
    ctx.execFailures?.push(`${nodeId}: ${message}`)
    // Empty outputs so consumers resolve "no value" (and fail loudly on their
    // own terms) instead of silently reading a stale cached value.
    produced.set(nodeId, {})
    resultOutputs[nodeId] = {}
    releaseProduced(nodeId)
  }

  const finalize = (
    status: ExecutionResult['status'],
    error?: ExecutionResult['error'],
  ): ExecutionResult => ({
    executionId,
    status,
    outputs: resultOutputs,
    resultMetadata,
    ...(error ? { error } : {}),
    ...(failures.length > 0 ? { failures: [...failures] } : {}),
    ...(ctx.execFailures && ctx.execFailures.length > 0 ? { execFailures: [...ctx.execFailures] } : {}),
    durationMs: Date.now() - startedAt,
  })

  try {
    for (const nodeId of closure.sorted) {
      if (signal.aborted) {
        bus.emit({ kind: 'exec:error', pipelineId, executionId, message: 'aborted' })
        return finalize('aborted')
      }

      const node = closure.nodesById.get(nodeId)!

      // Manual-trigger gate: an op flagged manualTrigger (e.g. the AI image/text
      // generators behind the editor's Run button) is NEVER auto-executed by the
      // walker. Calling it here would re-fire an expensive / side-effecting API
      // on every upstream change — the "上游变化绕过 Run 按钮" bug. Instead treat
      // it exactly like a boundary upstream node: skip `execute` and hydrate its
      // outputs from the persisted output cache so genuine downstream consumers
      // still receive the last value the Run button produced. The node's output
      // is produced out-of-band (the Run button writes the cache directly).
      const opSpec = runtime.registry.get(node.opId)
      if (opSpec?.manualTrigger) {
        const cached: Record<string, unknown> = {}
        for (const out of opSpec.outputs) {
          const entry = runtime.outputs.read(nodeId, out.name)
          if (entry?.data !== undefined) cached[out.name] = entry.data
        }
        produced.set(nodeId, cached)
        // Cached manualTrigger outputs are tiny refs (e.g. image ids), safe to
        // echo back for fast preview apply.
        resultOutputs[nodeId] = { ...cached }
        resultMetadata[nodeId] = Object.fromEntries(Object.keys(cached).map((portId) => [
          portId,
          {
            producerNodeId: nodeId,
            producerPort: portId,
            outputType: portTypeOf(runtime.registry, node.opId, portId),
            value: { inline: true },
          },
        ]))
        bus.emit({ kind: 'exec:node:skipped', pipelineId, executionId, nodeId, reason: 'manualTrigger' })
        releaseProduced(nodeId)
        continue
      }

      // Boundary upstream (nodes outside this partial closure) feed in from the
      // persisted output cache — the legacy "上游数据由后端 outputCache 补全".
      const inputs = resolveNodeInputs(node, closure.edges, produced, (srcId, port) =>
        produced.has(srcId) ? undefined : runtime.outputs.read(srcId, port)?.data,
      )

      // Diagnostic: a partial (downstream) run hydrates boundary upstream inputs
      // from the output cache. If a boundary source has never executed there is
      // no cache entry, so the input silently resolves to empty — surface a
      // non-fatal warn so the operator knows to run the upstream / full pipeline.
      for (const edge of closure.edges) {
        if (edge.target.nodeId !== nodeId) continue
        const srcId = edge.source.nodeId
        if (closure.nodesById.has(srcId)) continue // in-closure: produced this run
        if (runtime.outputs.read(srcId, edge.source.port)?.data !== undefined) continue
        bus.emit({
          kind: 'exec:warn',
          pipelineId,
          executionId,
          nodeId,
          message:
            `input "${edge.target.port}" has no upstream value: boundary node ` +
            `"${srcId}" (port "${edge.source.port}") has no cached output — ` +
            `run it or the full pipeline first`,
        })
      }

      let outputs: Record<string, unknown>
      // For a group shadow node the `__group__` op spec declares no statically
      // typed output ports (they are per-instance), so portTypeOf() would fall
      // back to 'any'. The authoritative type lives on the group's exposedOutputs
      // contract — capture it here so the output write below carries the real
      // port type (scene/mesh/…) instead of 'any' on the data probe.
      let groupOutputTypeByPort: ReadonlyMap<string, string> | undefined
      if (node.opId === RELAY_OP_ID) {
        outputs = { output: inputs.input }
      } else if (node.opId === GROUP_OP_ID) {
        // Top-level shadow nodes built by applyBatch use id === groupId, so node.id
        // is the operative key. The params.groupId lookup mirrors the convention the
        // executor uses for nested inner group nodes (layer1/executor.ts) and guards
        // hand-built graphs that set it explicitly.
        const groupId = typeof node.params?.groupId === 'string' ? node.params.groupId : node.id
        const group = graphFile.groups?.[groupId]
        if (!group) {
          recordNodeFailure(nodeId, `executeNode: group sub-graph not found: ${groupId}`)
          continue
        }
        groupOutputTypeByPort = new Map(group.exposedOutputs.map((p) => [p.portName, p.portType]))
        // Nested groups resolve via the flat registry: a __group__ inner node's
        // params.groupId keys back into graphFile.groups. layer1 recurses with
        // visiting-set cycle detection.
        outputs = await executeGroupSubgraph(group, inputs, runtime.registry, ctx, {
          getNestedGroup: (gid) => graphFile.groups?.[gid],
          // Persist EVERY inner node's real output (at every nesting level —
          // onInnerResult fires per inner node of this group and recurses into
          // child groups) into the same output cache top-level nodes use. Inner
          // node ids are globally unique, so the editor's internal view can read
          // back the actual last-run values per inner port — no separate re-run.
          // A group otherwise discards these intermediates (black box). Cold /
          // never-run ports simply stay absent (faithfully empty). image_gen &
          // other manualTrigger inner nodes are hydrated by executeGroupSubgraph
          // from their cached `_gen_*`, so what we persist is their last cached
          // result, never a re-trigger.
          onInnerResult: ({ innerNodeId, opId, outputs: innerOutputs }) => {
            for (const [portId, value] of Object.entries(innerOutputs)) {
              if (value === undefined) continue
              runtime.outputs.write(innerNodeId, portId, {
                valid: true,
                executedAt: new Date().toISOString(),
                executedHash,
                type: portTypeOf(runtime.registry, opId, portId),
                data: value,
                ...(runtime.registry.get(opId)?.implementationRevision
                  ? { opRevision: runtime.registry.get(opId)!.implementationRevision }
                  : {}),
              })
            }
          },
        })
      } else {
        const inference = resolveConnectionInference(runtime.registry, node, allNodesById, closure.edges)
        const nodeCtx: ExecutionContext = inference ? { ...ctx, connectionInference: inference } : ctx
        const result = await executeNodeL1(runtime.registry, node, inputs, nodeCtx)
        if (result.error) {
          recordNodeFailure(nodeId, result.error)
          continue
        }
        outputs = result.outputs
      }

      produced.set(nodeId, outputs)
      const resultPorts: Record<string, unknown> = {}
      const metadataPorts: NonNullable<ExecutionResult['resultMetadata']>[string] = {}
      for (const [portId, value] of Object.entries(outputs)) {
        if (value === undefined) continue
        const outputType = groupOutputTypeByPort?.get(portId) ?? portTypeOf(runtime.registry, node.opId, portId)
        const large = runtime.outputs.write(nodeId, portId, {
          valid: true,
          executedAt: new Date().toISOString(),
          executedHash,
          type: outputType,
          data: value,
          ...(runtime.registry.get(node.opId)?.implementationRevision
            ? { opRevision: runtime.registry.get(node.opId)!.implementationRevision }
            : {}),
        })
        // Inline only small values in the response; large (sharded) outputs are
        // omitted so the HTTP body never rebuilds a giant string — the client
        // re-fetches them from the output cache (the trailing exec:completed
        // fan-out already does this). Scene / mesh ports embed terrain copies
        // even after instance dedup (~5–6MB each); putting every intermediate
        // compose on the execute bus froze the preview.
        const omitInline = large || outputType === 'scene' || outputType === 'mesh'
        if (!omitInline) resultPorts[portId] = value
        metadataPorts[portId] = {
          producerNodeId: nodeId,
          producerPort: portId,
          outputType,
          value: omitInline
            ? { inline: false, ref: `outputs/${encodeURIComponent(nodeId)}/${encodeURIComponent(portId)}` }
            : { inline: true },
        }
        bus.emit({ kind: 'exec:node:output', pipelineId, nodeId, portId, outputType })
      }
      resultOutputs[nodeId] = resultPorts
      resultMetadata[nodeId] = metadataPorts
      releaseProduced(nodeId)
    }

    bus.emit({ kind: 'exec:completed', pipelineId, executionId })
    runtime.outputs.pruneByRetention({ protectedNodeIds: collectCachedNodeIds(graphFile) })
    if (ctx.execLogMode === 'summary' && ctx.execFailures && ctx.execFailures.length > 0) {
      const n = ctx.execFailures.length
      const sample = ctx.execFailures.slice(0, 4).join(' | ')
      const more = n > 4 ? ` (+${n - 4} more)` : ''
      ctx.log('warn', `Execute finished with ${n} node failure(s): ${sample}${more}`)
    }
    return firstError ? finalize('error', firstError) : finalize('completed')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    bus.emit({ kind: 'exec:error', pipelineId, executionId, message })
    if (failures.length < 20) failures.push({ message })
    return finalize('error', { message })
  }
}

export async function executeNode(
  runtime: Runtime,
  request: ExecuteNodeRequest = {},
): Promise<ExecutionHandle> {
  const bus = busFor(runtime)
  const executionId = randomUUID()
  const controller = new AbortController()
  const pipelineId = runtime.config.pipelineId

  // Resolve `handle.done` with a structured error result rather than throwing.
  // The execution model already represents failures as `status: 'error'` (every
  // per-node failure in runWalk returns one), so a request that can't even build
  // a closure — no graph yet, or an unknown / cyclic target — must surface the
  // SAME way instead of rejecting the promise. A reject becomes a bare HTTP 500
  // at the backend seam (the app runs Fastify with logger:false), which is
  // exactly what a drop-then-execute race produced: the execute for a group node
  // raced ahead of its still-in-flight createGroup persist, so the node did not
  // yet exist and `buildExecutionClosure` threw "target node not found" → 500.
  const failed = (message: string): ExecutionHandle => {
    bus.emit({ kind: 'exec:started', pipelineId, executionId })
    bus.emit({ kind: 'exec:error', pipelineId, executionId, message })
    return {
      executionId,
      abort: () => controller.abort(),
      done: Promise.resolve<ExecutionResult>({
        executionId,
        status: 'error',
        outputs: {},
        resultMetadata: {},
        error: { ...(request.nodeId ? { nodeId: request.nodeId } : {}), message },
        failures: [{ ...(request.nodeId ? { nodeId: request.nodeId } : {}), message }],
        durationMs: 0,
      }),
    }
  }

  const graphFile = runtime.graph.load()
  if (!graphFile) return failed('executeNode: no graph.json to execute')

  // Build the execution closure. An unknown / cyclic target is a client/timing
  // error, not a server fault, so it resolves as a structured error result.
  // The freshness probe lets a partial (target) run pull in cold upstream
  // ancestors (never executed / cache-invalidated) so the target's inputs are
  // actually computed instead of resolving to empty — fresh upstream stays a
  // cached boundary, keeping the incremental param-edit path fast.
  const isFresh = (nodeId: string, port: string): boolean => {
    const meta = runtime.outputs.readMeta(nodeId, port)
    if (meta?.valid !== true) return false
    const node = graphFile.nodes[nodeId]
    const spec = node ? runtime.registry.get(node.opId) : undefined
    if (spec?.implementationRevision && meta.opRevision !== spec.implementationRevision) return false
    return true
  }
  let closure: ExecutionClosure
  try {
    closure = buildExecutionClosure(graphFile.nodes, graphFile.edges, request.nodeId, isFresh)
    if (request.nodeId !== undefined) {
      closure = expandClosureForMissingBoundaryCaches(
        graphFile.nodes,
        graphFile.edges,
        closure,
        (nodeId, port) => runtime.outputs.read(nodeId, port)?.data,
      )
    }
  } catch (err) {
    return failed(err instanceof Error ? err.message : String(err))
  }

  bus.emit({ kind: 'exec:started', pipelineId, executionId })

  const done = runWalk(runtime, bus, graphFile, closure, executionId, controller.signal, request.quietErrors === true)
  return { executionId, abort: () => controller.abort(), done }
}
