import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  ApiClient,
  ApplyBatchOptions,
  ApplyBatchResult,
  ExecutionResult,
  GraphEdge,
  GraphNode,
  Op,
  PipelineSnapshot,
} from '@forgeax/node-runtime'

import { configureEditorTransport, createEditorTransport, type EditorTransport } from '../transport/index.js'
import { enqueueParamWrite, flushPendingPersist } from '../stores/pipelinePersist.js'
import { usePipelineStore } from '../stores/pipelineStore.js'
import type { Pipeline } from '../types.js'

function makePipeline(nodes: Array<{ id: string; batteryId?: string; params?: Record<string, unknown> }>): Pipeline {
  const now = '1970-01-01T00:00:00.000Z'
  return {
    id: 'persist-race',
    name: 'persist-race',
    description: '',
    nodes: nodes.map((node, index) => ({
      id: node.id,
      batteryId: node.batteryId ?? 'a.one',
      name: node.id,
      position: { x: index * 100, y: 0 },
      params: node.params ?? {},
    })),
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    status: 'idle',
    createdAt: now,
    updatedAt: now,
  }
}

function snapshotFrom(nodes: Map<string, GraphNode>, hash: string): PipelineSnapshot {
  return {
    id: 'persist-race',
    hash,
    createdAt: '1970-01-01T00:00:00.000Z',
    updatedAt: '1970-01-01T00:00:00.000Z',
    nodes: Object.fromEntries(nodes),
    edges: {},
  }
}

function createRaceClient() {
  const nodes = new Map<string, GraphNode>([
    ['n1', { id: 'n1', opId: 'a.one', name: 'n1', position: { x: 0, y: 0 }, params: {} }],
    ['n2', { id: 'n2', opId: 'a.one', name: 'n2', position: { x: 100, y: 0 }, params: {} }],
  ])
  let hash = 'h0'
  let firstGetPipeline: (() => void) | null = null
  const firstGetStarted = vi.fn()
  const applyBatch = vi.fn(async (ops: readonly Op[]): Promise<ApplyBatchResult> => {
    for (const op of ops) {
      if (op.type === 'deleteNode') nodes.delete(op.nodeId)
      if (op.type === 'createNode') {
        nodes.set(op.nodeId, {
          id: op.nodeId,
          opId: op.opId,
          name: op.name,
          position: op.position,
          params: { ...op.params },
        })
      }
    }
    hash = `h${applyBatch.mock.calls.length}`
    return { status: 'ok', newHash: hash, batchId: hash }
  })
  let getPipelineCalls = 0
  const client: ApiClient = {
    pipelineId: 'persist-race',
    async getPipeline() {
      getPipelineCalls += 1
      if (getPipelineCalls === 1) {
        firstGetStarted()
        await new Promise<void>((resolve) => {
          firstGetPipeline = resolve
        })
      }
      return snapshotFrom(nodes, hash)
    },
    applyBatch,
    execute: async (): Promise<ExecutionResult> => ({ status: 'completed' }) as ExecutionResult,
    getNode: async () => null,
    listNodes: async () => Array.from(nodes.values()),
    listEdges: async (): Promise<readonly GraphEdge[]> => [],
    getNodeOutput: async () => undefined,
    getHistory: async () => [],
    listOps: async () => [],
    getGroup: async () => null,
    listGroups: async () => [],
    subscribe: () => () => {},
    resolveAssetPath: async (template: string) => template,
  }
  return {
    client,
    applyBatch,
    firstGetStarted,
    releaseFirstGetPipeline: () => firstGetPipeline?.(),
    nodeIds: () => Array.from(nodes.keys()).sort(),
  }
}

let transport: EditorTransport | null = null

beforeEach(() => {
  usePipelineStore.setState({
    currentPipeline: null,
    pipelineRevision: 0,
    logs: [],
    nodeOutputs: {},
    dynamicOutputPorts: {},
  })
})

afterEach(() => {
  transport?.dispose()
  transport = null
  configureEditorTransport(null)
})

/** Non-blocking client: applyBatch mutates an in-memory graph synchronously. */
function createSimpleClient() {
  const nodes = new Map<string, GraphNode>([
    ['n1', { id: 'n1', opId: 'a.one', name: 'n1', position: { x: 0, y: 0 }, params: {} }],
    ['n2', { id: 'n2', opId: 'a.one', name: 'n2', position: { x: 100, y: 0 }, params: {} }],
  ])
  let hash = 'h0'
  const applyBatch = vi.fn(async (ops: readonly Op[], _opts?: ApplyBatchOptions): Promise<ApplyBatchResult> => {
    for (const op of ops) {
      if (op.type === 'deleteNode') nodes.delete(op.nodeId)
      if (op.type === 'createNode') {
        nodes.set(op.nodeId, { id: op.nodeId, opId: op.opId, name: op.name, position: op.position, params: { ...op.params } })
      }
      if (op.type === 'updateNode' && op.params) {
        const node = nodes.get(op.nodeId)
        if (node) node.params = { ...node.params, ...op.params }
      }
    }
    hash = `h${applyBatch.mock.calls.length}`
    return { status: 'ok', newHash: hash, batchId: hash }
  })
  const client: ApiClient = {
    pipelineId: 'persist-final',
    async getPipeline() {
      return snapshotFrom(nodes, hash)
    },
    applyBatch,
    execute: async (): Promise<ExecutionResult> => ({ status: 'completed' }) as ExecutionResult,
    getNode: async () => null,
    listNodes: async () => Array.from(nodes.values()),
    listEdges: async (): Promise<readonly GraphEdge[]> => [],
    getNodeOutput: async () => undefined,
    getHistory: async () => [],
    listOps: async () => [],
    getGroup: async () => null,
    listGroups: async () => [],
    subscribe: () => () => {},
    resolveAssetPath: async (template: string) => template,
  }
  return { client, applyBatch, nodeIds: () => Array.from(nodes.keys()).sort() }
}

describe('pipelineStore persist ordering', () => {
  it('persists the final state after rapid consecutive edits (no dropped last beat)', async () => {
    const sim = createSimpleClient()
    transport = createEditorTransport(sim.client)
    configureEditorTransport(transport)

    usePipelineStore.setState({ currentPipeline: makePipeline([{ id: 'n1' }, { id: 'n2' }]) })

    // Fire several edits + persists back-to-back in a single tick: intermediate
    // persists may be coalesced away, but the FINAL snapshot must always land.
    const persists: Array<Promise<unknown>> = []
    for (let i = 0; i < 5; i += 1) {
      usePipelineStore.getState().addNode({
        id: `r${i}`,
        batteryId: 'a.one',
        name: `r${i}`,
        position: { x: i * 50, y: 200 },
        params: {},
      })
      persists.push(usePipelineStore.getState().persistSession())
    }
    await Promise.all(persists)

    // The kernel must reflect every added node — the latest beat is never lost.
    expect(sim.nodeIds()).toEqual(['n1', 'n2', 'r0', 'r1', 'r2', 'r3', 'r4'])
  })

  it('does not let an older persist snapshot recreate a root-deleted node', async () => {
    const race = createRaceClient()
    transport = createEditorTransport(race.client)
    configureEditorTransport(transport)

    usePipelineStore.setState({ currentPipeline: makePipeline([{ id: 'n1' }, { id: 'n2' }]) })
    const stalePersist = usePipelineStore.getState().persistSession()
    await vi.waitFor(() => expect(race.firstGetStarted).toHaveBeenCalled())

    usePipelineStore.getState().removeNode('n1')
    const deletePersist = usePipelineStore.getState().persistSession()

    race.releaseFirstGetPipeline()
    await Promise.all([stalePersist, deletePersist])

    expect(race.applyBatch).toHaveBeenCalledWith(
      [{ type: 'deleteNode', nodeId: 'n1' }],
      expect.objectContaining({ actor: 'editor' }) as ApplyBatchOptions,
    )
    expect(race.nodeIds()).toEqual(['n2'])
  })

  // Refreshing inside the 500ms debounce window used to discard the edit: the
  // timer died with the document and nothing flushed on unload.
  it('flushes a debounced persist when the page is hidden instead of losing it', async () => {
    const sim = createSimpleClient()
    transport = createEditorTransport(sim.client)
    configureEditorTransport(transport)
    usePipelineStore.setState({ currentPipeline: makePipeline([{ id: 'n1' }, { id: 'n2' }]) })
    const unsubscribe = usePipelineStore.getState().subscribeLiveSync()

    usePipelineStore.getState().addNode({
      id: 'late',
      batteryId: 'a.one',
      name: 'late',
      position: { x: 0, y: 300 },
      params: {},
    })
    usePipelineStore.getState().schedulePersistSession('test')
    expect(sim.applyBatch).not.toHaveBeenCalled()

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    await vi.waitFor(() => expect(sim.nodeIds()).toContain('late'))
    unsubscribe()
  })

  // Opening the authoring over plain http on a LAN address (http://<host>:9555)
  // is NOT a secure context, so crypto.randomUUID is undefined there. It was
  // called on the first line of every persist, so the whole save+execute chain
  // threw before a single request went out.
  it('persists in an insecure context, where crypto.randomUUID does not exist', async () => {
    const sim = createSimpleClient()
    transport = createEditorTransport(sim.client)
    configureEditorTransport(transport)
    usePipelineStore.setState({ currentPipeline: makePipeline([{ id: 'n1' }]) })

    const original = Object.getOwnPropertyDescriptor(globalThis.crypto, 'randomUUID')
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true })
    try {
      usePipelineStore.getState().addNode({
        id: 'insecure',
        batteryId: 'a.one',
        name: 'insecure',
        position: { x: 0, y: 0 },
        params: {},
      })
      await usePipelineStore.getState().persistSession()
    } finally {
      if (original) Object.defineProperty(globalThis.crypto, 'randomUUID', original)
    }

    expect(sim.nodeIds()).toContain('insecure')
  })

  it('reports a save that could not be sent (no transport) instead of dropping it silently', async () => {
    configureEditorTransport(null)
    usePipelineStore.setState({ currentPipeline: makePipeline([{ id: 'n1' }]), logs: [] })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    usePipelineStore.getState().addNode({
      id: 'orphan',
      batteryId: 'a.one',
      name: 'orphan',
      position: { x: 0, y: 0 },
      params: {},
    })
    await usePipelineStore.getState().persistSession()

    expect(errorSpy).toHaveBeenCalled()
    expect(usePipelineStore.getState().logs.some((l) => l.includes('保存失败'))).toBe(true)
    errorSpy.mockRestore()
  })

  it('reloads the kernel snapshot when persist is rejected so optimistic nodes do not survive', async () => {
    const sim = createSimpleClient()
    const err = Object.assign(new Error('Legacy Runtime Graph projects are read-only'), { status: 409 })
    sim.applyBatch.mockRejectedValueOnce(err)
    transport = createEditorTransport(sim.client)
    configureEditorTransport(transport)
    usePipelineStore.setState({ currentPipeline: makePipeline([{ id: 'n1' }, { id: 'n2' }]), logs: [] })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    usePipelineStore.getState().addNode({
      id: 'orphan',
      batteryId: 'base_plane',
      name: 'BasePlane',
      position: { x: 120, y: 80 },
      params: {},
    })
    expect(usePipelineStore.getState().currentPipeline?.nodes.map((n) => n.id)).toContain('orphan')
    await usePipelineStore.getState().persistSession()
    await vi.waitFor(() => {
      expect(usePipelineStore.getState().currentPipeline?.nodes.map((n) => n.id)).not.toContain('orphan')
    })
    errorSpy.mockRestore()
  })

  it('commits a slider value after ephemeral ticks even when the kernel already has it', async () => {
    const sim = createSimpleClient()
    transport = createEditorTransport(sim.client)
    configureEditorTransport(transport)
    usePipelineStore.setState({
      currentPipeline: makePipeline([{
        id: 'n1',
        params: { value: 48, min: 0, max: 96, precision: 0, __sceneScriptFunctionName: 'numberValue' },
      }, { id: 'n2' }]),
    })

    await enqueueParamWrite('n1', {
      value: 48,
      min: 0,
      max: 96,
      precision: 0,
      __sceneScriptFunctionName: 'numberValue',
    })
    await usePipelineStore.getState().persistSession()

    const durable = sim.applyBatch.mock.calls.find(([, opts]) => !opts?.ephemeral)
    expect(durable?.[0]?.[0]).toEqual({ type: 'updateNode', nodeId: 'n1', params: { value: 48 } })
    expect(JSON.stringify(durable?.[0])).not.toContain('numberValue')
    expect(JSON.stringify(durable?.[0])).not.toMatch(/"min":/)
  })

  it('param-edit-settle persist sends only extraOps, not a whole-graph diff', async () => {
    const sim = createSimpleClient()
    const getPipeline = vi.spyOn(sim.client, 'getPipeline')
    transport = createEditorTransport(sim.client)
    configureEditorTransport(transport)
    usePipelineStore.setState({
      currentPipeline: makePipeline([{
        id: 'n1',
        params: { value: 48, min: 0, max: 96, precision: 0, leaked: true },
      }, { id: 'n2', params: { value: 1, min: 0, max: 2 } }]),
    })

    await enqueueParamWrite('n1', {
      value: 48,
      min: 0,
      max: 96,
      precision: 0,
      __sceneScriptFunctionName: 'numberValue',
    })
    getPipeline.mockClear()
    sim.applyBatch.mockClear()

    usePipelineStore.getState().schedulePersistSession('param-edit-settle')
    flushPendingPersist('test')
    await vi.waitFor(() => expect(sim.applyBatch).toHaveBeenCalled())

    expect(getPipeline).not.toHaveBeenCalled()
    expect(sim.applyBatch).toHaveBeenCalledTimes(1)
    expect(sim.applyBatch.mock.calls[0]?.[0]).toEqual([
      { type: 'updateNode', nodeId: 'n1', params: { value: 48 } },
    ])
    expect(sim.applyBatch.mock.calls[0]?.[1]?.ephemeral).toBeUndefined()
    expect(JSON.stringify(sim.applyBatch.mock.calls[0]?.[0])).not.toContain('leaked')
    expect(JSON.stringify(sim.applyBatch.mock.calls[0]?.[0])).not.toContain('n2')
  })
})
