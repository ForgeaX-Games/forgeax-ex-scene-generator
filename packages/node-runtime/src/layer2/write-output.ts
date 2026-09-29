// Layer 2 — out-of-band single-port OutputCache write.
//
// Scene execution writes ports via runSceneModule → writeTraceOutputs. This
// helper is the same cache contract for editor/tests that need to seed or
// replace one port without walking the display graph.
//
// Cache contract: `data` holds the port value in the dispatcher wire shape —
// a DataTreeEntry[] array (an item-access scalar is
// `[{ path: [0], items: [value] }]`). Writing a bare scalar would break
// item-access consumers, so we wrap with DataTree.

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
