import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyBatch, createRuntime } from '../layer2/index.js'
import type { RuntimeEvent } from '../layer2/subscriptions.js'

let scratchDir: string

beforeEach(() => {
  scratchDir = join(tmpdir(), `forgeax-ext-sync-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(scratchDir, { recursive: true })
})

afterEach(() => {
  rmSync(scratchDir, { recursive: true, force: true })
})

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('graph external sync', () => {
  it('applyBatch does not double-emit graph:applied via the file watcher', async () => {
    const runtime = createRuntime({
      projectRoot: scratchDir,
      pipelineId: 'ext',
      pluginId: 'plugin.test',
    })
    const events: RuntimeEvent[] = []
    runtime.subscriptions.subscribe('ext', ['graph'], (e) => events.push(e))

    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'n1', opId: 'demo.echo', position: { x: 0, y: 0 }, params: {} },
    ])

    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('graph:applied')
  })

  it('direct graph.json save emits graph:applied for live WS refresh', async () => {
    const runtime = createRuntime({
      projectRoot: scratchDir,
      pipelineId: 'ext2',
      pluginId: 'plugin.test',
    })
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'n1', opId: 'demo.echo', position: { x: 0, y: 0 }, params: { value: 1 } },
    ])

    const events: RuntimeEvent[] = []
    runtime.subscriptions.subscribe('ext2', ['graph'], (e) => events.push(e))

    const loaded = runtime.graph.load()!
    runtime.graph.save({
      ...loaded,
      nodes: {
        ...loaded.nodes,
        n1: { ...loaded.nodes.n1, params: { value: 2 } },
      },
      updatedAt: new Date().toISOString(),
      hash: undefined as unknown as string,
    })

    await wait(200)
    expect(events.some((e) => e.kind === 'graph:applied')).toBe(true)
  })
})
