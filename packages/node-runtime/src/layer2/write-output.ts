// Layer 2 — out-of-band single-port output write for manual-trigger ops.
//
// Most node outputs are produced by the pipeline walker (execute-node.ts), which
// caches each port's raw output value under outputs/<nodeId>/<portId>.json.
// Manual-trigger ops (OpSpec.manualTrigger — e.g. the AI generators behind the
// editor's Run button) are deliberately NEVER auto-run by the walker; the walker
// treats them as data boundaries and hydrates downstream consumers from this
// cache (see execute-node.ts). Their output therefore has to be produced by the
// explicit user action (the Run button) and persisted here, so genuine
// downstream consumers pick it up on the next incremental run WITHOUT the op
// being re-fired.
//
// Cache contract (must match the walker): `data` holds the port value in the
// SAME wire shape the executor's dispatcher produces — a DataTreeEntry[] array
// (e.g. an item-access scalar is `[{ path: [0], items: [value] }]`). The walker
// reads `entry.data` straight back and feeds it to the downstream op's
// dispatcher (see resolve-inputs.ts), which peels item/list/tree access. Writing
// a bare scalar here would break item-access consumers, so we wrap with DataTree.

import { DataTree } from '../layer1/index.js'
import { busFor } from './event-bus.js'
import type { Runtime } from './runtime.js'

// Coerce a raw value into the dispatcher wire form (DataTreeEntry[]): a DataTree becomes its JSON
// entries, an already-wire-shaped entries array passes through untouched, and anything else is
// wrapped as a single item-access scalar.
function toWire(value: unknown): unknown {
  if (DataTree.isDataTree(value)) return value.toJSON()
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (e) => e !== null && typeof e === 'object' && 'path' in (e as object) && 'items' in (e as object),
    )
  ) {
    return value
  }
  return DataTree.fromItem(value).toJSON()
}

export interface WriteNodeOutputResult {
  nodeId: string
  portId: string
  outputType: string
}

// Persist one (nodeId, portId) output into the run cache out-of-band of the walker, for
// manual-trigger ops only. Emits `exec:node:output` so subscribed clients refresh, resolves the
// type from the op's declared port (defaulting to 'any'), and tags the entry with the current
// graph.hash so a later partial run treats it as a valid boundary value.
export function writeNodeOutput(
  runtime: Runtime,
  nodeId: string,
  portId: string,
  value: unknown,
): WriteNodeOutputResult {
  const graphFile = runtime.graph.load()
  const node = graphFile?.nodes[nodeId]
  const op = node ? runtime.registry.get(node.opId) : undefined
  const outputType = op?.outputs.find((o) => o.name === portId)?.type ?? 'any'
  const executedHash = graphFile?.hash ?? ''

  runtime.outputs.write(nodeId, portId, {
    valid: true,
    executedAt: new Date().toISOString(),
    executedHash,
    type: outputType,
    data: toWire(value),
  })

  busFor(runtime).emit({
    kind: 'exec:node:output',
    pipelineId: runtime.config.pipelineId,
    nodeId,
    portId,
    outputType,
  })

  return { nodeId, portId, outputType }
}
