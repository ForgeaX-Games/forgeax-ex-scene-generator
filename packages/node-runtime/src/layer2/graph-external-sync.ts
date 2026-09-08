// Detect graph.json writes that bypass applyBatch (CLI direct, hand edits) and
// announce them on the in-process bus so /ws clients refresh. Self-writes from
// applyBatch are suppressed via markGraphSelfWrite to avoid double graph:applied.

import { mkdirSync, watch } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

import { busFor } from './event-bus.js'
import type { Runtime } from './runtime.js'

interface SelfWrite {
  hash: string
  at: number
}

const selfWrites = new WeakMap<Runtime, SelfWrite>()

/** Called by applyBatch immediately after a successful graph.json save. */
export function markGraphSelfWrite(runtime: Runtime, hash: string): void {
  selfWrites.set(runtime, { hash, at: Date.now() })
}

function graphFilePath(runtime: Runtime): string {
  const layout = runtime.config.layout ?? {}
  return layout.graphFile ?? join(runtime.config.projectRoot, 'state', 'graph.json')
}

const SUPPRESS_MS = 250
const DEBOUNCE_MS = 100

export function attachGraphExternalSync(runtime: Runtime): () => void {
  const graphPath = graphFilePath(runtime)
  let debounce: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const handle = (): void => {
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => {
      debounce = null
      if (disposed) return
      let loaded
      try {
        loaded = runtime.graph.load()
      } catch {
        return
      }
      if (!loaded) return
      const self = selfWrites.get(runtime)
      if (self && self.hash === loaded.hash && Date.now() - self.at < SUPPRESS_MS) {
        return
      }
      busFor(runtime).emit({
        kind: 'graph:applied',
        pipelineId: runtime.config.pipelineId,
        batchId: `external:${randomUUID()}`,
        newHash: loaded.hash,
      })
    }, DEBOUNCE_MS)
  }

  try {
    const dir = dirname(graphPath)
    const file = basename(graphPath)
    mkdirSync(dir, { recursive: true })
    const w = watch(dir, (_event, name) => {
      if (name !== file) return
      handle()
    })
    return () => {
      disposed = true
      if (debounce) clearTimeout(debounce)
      w.close()
    }
  } catch {
    return () => undefined
  }
}
