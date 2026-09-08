// `forgeax pipeline abort` handler — a deliberate no-op: a one-shot CLI process cannot cancel a run living in a separate process, so it just emits a structured "noop" record explaining that cross-process abort needs the (out-of-scope) HTTP+WS channel.

import { makeEmitter } from '../output.js'
import { mode } from './shared.js'

export async function pipelineAbort(opts: Record<string, unknown>): Promise<void> {
  makeEmitter(mode(opts)).record({
    command: 'pipeline abort',
    status: 'noop',
    message:
      'abort is in-process only; a one-shot CLI cannot cancel a separate run. Cross-process abort needs the HTTP+WS channel (out of scope for stage-1).',
  })
}
