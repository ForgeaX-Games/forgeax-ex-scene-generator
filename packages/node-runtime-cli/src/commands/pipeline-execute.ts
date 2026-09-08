// `forgeax pipeline execute` handler — run a node's upstream closure (or the whole pipeline) headlessly, streaming execution events to the emitter as they fire and mapping any non-completed result to a non-zero exit. Unlike the read/mutate verbs this one needs ops registered, so it loads the runtime with the battery dir.

import { executeNode } from '@forgeax/node-runtime'
import type { ExecutionHandle, RuntimeEvent } from '@forgeax/node-runtime'
import { resolveConfig } from '../config.js'
import { loadRuntime } from '../runtime.js'
import { makeEmitter } from '../output.js'
import { CliError } from '../errors.js'
import { postExecute, resolveServerUrl } from '../http-client.js'
import { mode } from './shared.js'

export async function pipelineExecute(opts: Record<string, unknown>): Promise<void> {
  const serverUrl = resolveServerUrl(opts)
  const emit = makeEmitter(mode(opts))
  const nodeId = typeof opts.node === 'string' ? opts.node : undefined

  if (serverUrl) {
    const result = await postExecute(serverUrl, nodeId)
    emit.record({ result })
    if (result.status !== 'completed') {
      const detail = result.error?.message
      throw new CliError(detail ? `execution ${result.status}: ${detail}` : `execution ${result.status}`, 1)
    }
    return
  }

  const config = resolveConfig(opts)
  const runtime = await loadRuntime(config) // needs ops registered → uses batteriesDir

  const unsubscribe = runtime.subscriptions.subscribe(
    config.pipelineId,
    ['execution'],
    (event: RuntimeEvent) => emit.record(event),
  )

  try {
    let handle: ExecutionHandle
    try {
      handle = await executeNode(runtime, nodeId ? { nodeId } : {})
    } catch (err) {
      // Synchronous validation reject (unknown node / cycle / no graph): emit a structured error record so NDJSON consumers see it, then exit non-zero.
      const message = err instanceof Error ? err.message : String(err)
      emit.record({ result: { status: 'error', error: { message } } })
      throw new CliError(message, 1)
    }
    const result = await handle.done
    emit.record({ result })
    if (result.status !== 'completed') {
      const detail = result.error?.message
      throw new CliError(detail ? `execution ${result.status}: ${detail}` : `execution ${result.status}`, 1)
    }
  } finally {
    unsubscribe()
  }
}
