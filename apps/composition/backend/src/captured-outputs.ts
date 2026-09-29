import type { ExecutionResult } from '@forgeax/node-runtime'

/** Resolve omitted canonical output values before deriving acceptance counts. */
export function hydrateCapturedOutputs(
  result: ExecutionResult,
  read: (nodeId: string, portId: string) => unknown,
  captureIds: readonly string[] = [],
): ExecutionResult {
  const outputs = { ...result.outputs }
  for (const nodeId of captureIds) {
    const ports = { ...outputs[nodeId] }
    for (const [port, metadata] of Object.entries(result.resultMetadata?.[nodeId] ?? {})) {
      if (metadata.value.inline || Object.hasOwn(ports, port)) continue
      const value = read(nodeId, port)
      if (value === undefined || value === null) throw new Error(`Missing captured output: ${nodeId}/${port}`)
      ports[port] = value
    }
    outputs[nodeId] = ports
  }
  return { ...result, outputs }
}
