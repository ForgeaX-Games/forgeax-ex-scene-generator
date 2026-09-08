// Pipeline store tests — focus on the live-sync backbone:
//   (1) agentAddNode drives the store + persists through applyBatch (the same
//       path a human edit takes);
//   (2) a graph:applied event delivered via the subscribe adapter triggers the
//       store to refetch and the canvas nodes to change (non-vacuous: assert
//       store.currentPipeline gains a node it did not have before).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { OpSpec } from '@forgeax/node-runtime'

import { createMockApiClient, type MockApiClient } from '../../test/mockApiClient.js'
import {
  configureEditorTransport,
  createEditorTransport,
  type EditorTransport,
} from '../transport/index.js'
import { usePipelineStore } from '../stores/pipelineStore.js'
import { useHistoryStore } from '../stores/historyStore.js'
import { createEmptyPipeline } from '../stores/pipelineStore.helpers.js'
import { isTooLargeOutputSummary } from '../utils/tooLargeOutputSummary.js'

function spec(id: string, name: string, outputs: OpSpec['outputs'] = []): OpSpec {
  return { id, name, inputs: [], outputs, params: [], execute: () => null }
}

let client: MockApiClient
let transport: EditorTransport

function resetStores(): void {
  usePipelineStore.setState({
    batteries: [],
    categories: [],
    currentPipeline: null,
    sessionRestorePending: null,
    pipelineStatus: 'idle',
    selectedNode: null,
    selectedNodeIds: [],
    logs: [],
    nodeOutputs: {},
    dynamicOutputPorts: {},
    groupViewStack: [],
  })
  useHistoryStore.setState({ entries: [], cursor: 0, _redoTip: null })
}

async function flush(): Promise<void> {
  // Let the async loadPipeline triggered by the sync event resolve.
  await Promise.resolve()
  await Promise.resolve()
}

describe('pipelineStore live-sync backbone', () => {
  beforeEach(() => {
    client = createMockApiClient({ ops: [spec('a.one', 'One'), spec('a.two', 'Two')] })
    transport = createEditorTransport(client)
    configureEditorTransport(transport)
    resetStores()
  })

  afterEach(() => {
    transport.dispose()
    configureEditorTransport(null)
  })

  it('loadBatteries populates the catalog from listOps()', async () => {
    await usePipelineStore.getState().loadBatteries()
    expect(usePipelineStore.getState().batteries.map((b) => b.id)).toEqual(['a.one', 'a.two'])
  })

  it('agentAddNode records history, updates the store, and persists via applyBatch', async () => {
    await usePipelineStore.getState().loadBatteries()
    usePipelineStore.getState().setPipeline(createEmptyPipeline())
    const applySpy = vi.spyOn(client, 'applyBatch')

    usePipelineStore.getState().agentAddNode({
      id: 'n1',
      batteryId: 'a.one',
      name: 'One',
      position: { x: 0, y: 0 },
      params: {},
    })

    // Data layer: the node is in the working pipeline.
    expect(usePipelineStore.getState().currentPipeline?.nodes.map((n) => n.id)).toContain('n1')
    // History recorded (same path as a human add).
    expect(useHistoryStore.getState().entries).toHaveLength(1)
    expect(useHistoryStore.getState().entries[0].type).toBe('add_node')

    // Persist + execute flow through applyBatch.
    await flush()
    expect(applySpy).toHaveBeenCalled()
    expect(applySpy.mock.calls[0][0]).toEqual([
      { type: 'createNode', nodeId: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} },
    ])
  })

  it('LIVE-SYNC: a graph change from another actor refetches and updates the canvas', async () => {
    // Start from an empty, loaded pipeline.
    await usePipelineStore.getState().loadPipeline()
    expect(usePipelineStore.getState().currentPipeline?.nodes ?? []).toHaveLength(0)

    // The store subscribes to live-sync (graph:applied → refetch).
    const unsub = usePipelineStore.getState().subscribeLiveSync()

    // Another actor (AI / CLI / another client) mutates the kernel graph
    // directly. The mock emits graph:applied synchronously inside applyBatch.
    await client.applyBatch(
      [{ type: 'createNode', nodeId: 'remote-1', opId: 'a.two', position: { x: 5, y: 5 }, params: {} }],
      { actor: 'ai-agent' },
    )

    // The subscribe adapter drove the store to refetch — non-vacuous: the
    // canvas now shows a node it never had locally.
    await flush()
    const nodes = usePipelineStore.getState().currentPipeline?.nodes ?? []
    expect(nodes.map((n) => n.id)).toContain('remote-1')

    unsub()
  })

  it('LIVE-SYNC RECONCILER: a missed graph:applied frame still reaches the canvas via the hash poll', async () => {
    vi.useFakeTimers()
    try {
      await usePipelineStore.getState().loadPipeline()
      expect(usePipelineStore.getState().currentPipeline?.nodes ?? []).toHaveLength(0)

      const unsub = usePipelineStore.getState().subscribeLiveSync()
      // Let the reconciler adopt the current hash as its baseline.
      await vi.advanceTimersByTimeAsync(1600)

      // Simulate a graph mutation whose `graph:applied` WS frame was DROPPED
      // (reconnect after a backend restart / rebind window): the kernel state +
      // hash change, but NO event is emitted to the subscribers.
      client.__state.nodes.set('orphan-1', {
        id: 'orphan-1',
        opId: 'a.one',
        position: { x: 9, y: 9 },
        params: {},
      })
      client.__state.hash = 'mock-drifted-1'

      // Canvas is stale until the reconciler poll detects the hash drift.
      expect(
        (usePipelineStore.getState().currentPipeline?.nodes ?? []).map((n) => n.id),
      ).not.toContain('orphan-1')

      await vi.advanceTimersByTimeAsync(1600)

      // Self-healed: the poll refetched and the canvas now shows the node.
      expect(
        (usePipelineStore.getState().currentPipeline?.nodes ?? []).map((n) => n.id),
      ).toContain('orphan-1')

      unsub()
    } finally {
      vi.useRealTimers()
    }
  })

  it('LIVE-SYNC: unsubscribe stops further refetches', async () => {    await usePipelineStore.getState().loadPipeline()
    const unsub = usePipelineStore.getState().subscribeLiveSync()
    unsub()

    await client.applyBatch(
      [{ type: 'createNode', nodeId: 'remote-2', opId: 'a.one', position: { x: 0, y: 0 }, params: {} }],
      { actor: 'ai-agent' },
    )
    await flush()

    const nodes = usePipelineStore.getState().currentPipeline?.nodes ?? []
    expect(nodes.map((n) => n.id)).not.toContain('remote-2')
  })

  it('local param edit does NOT trigger a full loadPipeline reload on its self-echo, but a remote edit does', async () => {
    client.__reset({
      ops: [spec('a.one', 'One', [{ name: 'out', type: 'number' }])],
      nodes: [{ id: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: { value: 1 } }],
      edges: [],
    })
    await usePipelineStore.getState().loadBatteries()
    await usePipelineStore.getState().loadPipeline()
    const unsub = usePipelineStore.getState().subscribeLiveSync()

    const loadSpy = vi.spyOn(usePipelineStore.getState(), 'loadPipeline')

    // A LOCAL param edit: the store writes the value locally, persists (applyBatch
    // → graph:applied self-echo), and executes. The self-echo must be recognized
    // as our own write and NOT cause a full snapshot reload (the slider→preview
    // lag). The local value is already present in currentPipeline.
    usePipelineStore.getState().updateNodeParam('n1', 'value', 42)
    await flush()
    await flush()
    expect(usePipelineStore.getState().currentPipeline?.nodes[0]?.params.value).toBe(42)
    expect(loadSpy).not.toHaveBeenCalled()

    // A REMOTE actor's batch must still drive a full reload (no suppression).
    await client.applyBatch(
      [{ type: 'createNode', nodeId: 'remote-x', opId: 'a.one', position: { x: 9, y: 9 }, params: {} }],
      { actor: 'ai-agent' },
    )
    await flush()
    await flush()
    expect(loadSpy).toHaveBeenCalled()
    expect(usePipelineStore.getState().currentPipeline?.nodes.map((n) => n.id)).toContain('remote-x')

    loadSpy.mockRestore()
    unsub()
  })

  it('loadPipeline falls back to the in-memory previewEnabled toggle when a pull omits it', async () => {
    client.__reset({
      ops: [spec('a.one', 'One')],
      nodes: [{ id: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} }],
      edges: [],
    })
    await usePipelineStore.getState().loadPipeline()
    // The fake backend snapshot carries no previewEnabled → undefined after a pull.
    expect(usePipelineStore.getState().currentPipeline?.nodes[0]?.previewEnabled).toBeUndefined()

    // User turns the node's preview OFF (would normally be persisted via setNodePreview).
    usePipelineStore.setState((s) => ({
      currentPipeline: s.currentPipeline
        ? { ...s.currentPipeline, nodes: s.currentPipeline.nodes.map((n) => ({ ...n, previewEnabled: false })) }
        : s.currentPipeline,
    }))

    // A live-sync / re-exec re-pull whose snapshot doesn't echo the field back
    // (e.g. a stale mock, or a transient partial response) must NOT silently
    // re-enable the preview — carryPreviewEnabledNodes is the safety net.
    await usePipelineStore.getState().loadPipeline()
    expect(usePipelineStore.getState().currentPipeline?.nodes[0]?.previewEnabled).toBe(false)
  })

  it('keeps the kernel-persisted hidden flag on an exposed port across a load', async () => {
    // The exposed-port presentation overlay (hidden / order / customLabel*) is
    // kernel-persisted and round-trips verbatim through getPipeline()/listGroups.
    // loadPipeline must trust the freshly-pulled value (no client carry-forward).
    client.__reset({ ops: [spec('a.one', 'One')] })
    client.__state.groups.set('g1', {
      id: 'g1',
      name: 'G',
      nodes: [],
      edges: [],
      position: { x: 0, y: 0 },
      exposedInputs: [
        { portName: 'in_0', portType: 'scene', sourceNodeId: 'a', sourcePortName: 'in', hidden: true },
      ],
      exposedOutputs: [],
    })

    await usePipelineStore.getState().loadPipeline()

    const after = usePipelineStore.getState().currentPipeline
    expect(after?.groups?.[0]?.exposedInputs[0]?.hidden).toBe(true)
  })

  it('executePipeline routes through the transport execute()', async () => {
    const execSpy = vi.spyOn(client, 'execute')
    usePipelineStore.getState().setPipeline(createEmptyPipeline())
    await usePipelineStore.getState().executePipeline()
    expect(execSpy).toHaveBeenCalled()
    expect(usePipelineStore.getState().pipelineStatus).toBe('completed')
  })

  it('executePipeline hydrates nodeOutputs from the execute response (same path as incrementalExecute)', async () => {
    const sceneWire = [{ path: [0], items: [{ focus: '/', name: '' }] }]
    vi.spyOn(client, 'execute').mockResolvedValue({
      executionId: 'exec-test',
      status: 'completed',
      durationMs: 1,
      outputs: { empty: { scene: sceneWire } },
    })

    usePipelineStore.setState({
      currentPipeline: {
        ...createEmptyPipeline(),
        nodes: [
          { id: 'empty', batteryId: 'empty_scene', name: 'empty', position: { x: 0, y: 0 }, params: {} },
        ],
      },
    })

    await usePipelineStore.getState().executePipeline()

    expect(usePipelineStore.getState().nodeOutputs.empty?.scene).toEqual(sceneWire)
  })

  it('incrementalExecute retries against the remapped kernel id after a Scene Script rewrite', async () => {
    client.__reset({
      ops: [spec('empty_scene', 'Empty'), spec('cellular_noise', 'Noise', [{ name: 'grid', type: 'grid' }])],
      nodes: [
        { id: 'empty', opId: 'empty_scene', position: { x: 0, y: 0 }, params: {} },
        { id: 'compiled-noise', opId: 'cellular_noise', position: { x: 80, y: 0 }, params: {} },
      ],
    })
    usePipelineStore.setState({
      currentPipeline: {
        ...createEmptyPipeline(),
        nodes: [
          { id: 'empty', batteryId: 'empty_scene', name: 'empty', position: { x: 0, y: 0 }, params: {} },
          { id: 'canvas-minted', batteryId: 'cellular_noise', name: 'Noise', position: { x: 80, y: 0 }, params: {} },
        ],
      },
    })
    const execSpy = vi.spyOn(client, 'execute').mockImplementation(async (request) => {
      if (request?.nodeId === 'canvas-minted') {
        return {
          executionId: 'miss',
          status: 'error',
          outputs: {},
          durationMs: 0,
          error: { nodeId: 'canvas-minted', message: 'executeNode: target node not found: canvas-minted' },
        }
      }
      return {
        executionId: 'hit',
        status: 'completed',
        durationMs: 1,
        outputs: { 'compiled-noise': { grid: [[1, 0], [0, 1]] } },
      }
    })

    await usePipelineStore.getState().incrementalExecute('canvas-minted', false, { persist: false })

    expect(execSpy).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'canvas-minted' }))
    expect(execSpy).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'compiled-noise' }))
    expect(usePipelineStore.getState().nodeOutputs['compiled-noise']?.grid).toEqual([[1, 0], [0, 1]])
  })

  it('clearCacheAndExecutePipeline clears nodeOutputs then hydrates from execute', async () => {
    const sceneWire = [{ path: [0], items: [{ focus: '/' }] }]
    vi.spyOn(client, 'execute').mockResolvedValue({
      executionId: 'exec-clear',
      status: 'completed',
      durationMs: 1,
      outputs: { empty: { scene: sceneWire } },
    })
    vi.spyOn(client, 'clearOutputCache').mockResolvedValue({ ok: true })

    usePipelineStore.setState({
      currentPipeline: {
        ...createEmptyPipeline(),
        nodes: [
          { id: 'empty', batteryId: 'empty_scene', name: 'empty', position: { x: 0, y: 0 }, params: {} },
        ],
      },
      nodeOutputs: { stale: { scene: [{ path: [0], items: ['old'] }] } },
    })

    await usePipelineStore.getState().clearCacheAndExecutePipeline()

    expect(usePipelineStore.getState().nodeOutputs.stale).toBeUndefined()
    expect(usePipelineStore.getState().nodeOutputs.empty?.scene).toEqual(sceneWire)
  })

  it('refreshConnectedOutputs hydrates unconnected visible output ports for tooltips', async () => {
    client.__reset({
      ops: [
        spec('scene.add_child', 'AddChild', [
          { name: 'scene', type: 'scene', access: 'item' },
          { name: 'childPaths', type: 'string', access: 'list' },
        ]),
        spec('scene.output', 'Scene Output'),
      ],
      nodes: [
        { id: 'add', opId: 'scene.add_child', position: { x: 0, y: 0 }, params: {} },
        { id: 'out', opId: 'scene.output', position: { x: 200, y: 0 }, params: {} },
      ],
      edges: [
        {
          id: 'e-add-scene-out-scene',
          source: { nodeId: 'add', port: 'scene' },
          target: { nodeId: 'out', port: 'scene' },
        },
      ],
    })
    await usePipelineStore.getState().loadBatteries()
    await usePipelineStore.getState().loadPipeline()
    vi.spyOn(client, 'getNodeOutput').mockImplementation(async (_nodeId, portId) => {
      if (portId === 'scene') return [{ path: [0], items: [{ focus: '/Root' }] }]
      if (portId === 'childPaths') {
        return [
          { path: [0, 0], items: ['/Root/A'] },
          { path: [0, 1], items: ['/Root/B'] },
        ]
      }
      return undefined
    })

    await usePipelineStore.getState().refreshConnectedOutputs()

    expect(usePipelineStore.getState().nodeOutputs.add?.childPaths).toEqual([
      { path: [0, 0], items: ['/Root/A'] },
      { path: [0, 1], items: ['/Root/B'] },
    ])
  })

  it('retries a persist that fails once instead of silently leaving the canvas ahead of the kernel', async () => {
    // The dev backend restarts on every kernel source edit (`tsx --watch`), so a
    // transient failure here is routine. Without a retry the node lives only in
    // the browser: the canvas shows it, the kernel never got it, and every
    // execute afterwards runs on a graph without it — the port then reads
    // "no result" forever and a downstream node gets nothing.
    client.__reset({ ops: [spec('a.one', 'One', [{ name: 'out', type: 'any', access: 'item' }])] })
    await usePipelineStore.getState().loadBatteries()
    usePipelineStore.setState({
      currentPipeline: {
        ...createEmptyPipeline(),
        nodes: [{ id: 'a', batteryId: 'a.one', name: 'a', position: { x: 0, y: 0 }, params: {} }],
      },
    })

    const realApply = client.applyBatch.bind(client)
    let attempts = 0
    vi.spyOn(client, 'applyBatch').mockImplementation(async (ops) => {
      attempts += 1
      if (attempts === 1) throw new Error('socket hang up (backend restarting)')
      return realApply(ops)
    })

    await usePipelineStore.getState().persistSession()

    expect(attempts).toBe(2)
    const snapshot = await client.getPipeline()
    expect(snapshot?.nodes['a']).toBeTruthy()
  })

  it('re-runs the output fan-out once the battery catalog lands (a node with no outgoing edge is invisible without it)', async () => {
    // The 'all' scope resolves each node's output ports through the battery
    // catalog. `loadBatteries()` is async, so a project-switch pass can run
    // first and see an empty catalog — collectVisibleOutputPorts then degrades
    // to edge-sourced ports only and a node with no outgoing edge (a parked
    // text panel) never gets hydrated, leaving its port probe on "no result"
    // for the whole session even though the kernel cache holds a value.
    client.__reset({
      ops: [spec('text_panel', 'Panel', [{ name: 'output', type: 'string', access: 'item' }])],
      nodes: [{ id: 'panel', opId: 'text_panel', position: { x: 0, y: 0 }, params: { text: 'hi' } }],
    })
    await usePipelineStore.getState().loadPipeline()
    expect(usePipelineStore.getState().batteries).toHaveLength(0)

    const wire = [{ path: [0], items: ['hi'] }]
    vi.spyOn(client, 'getNodeOutput').mockResolvedValue(wire)

    await usePipelineStore.getState().refreshConnectedOutputs('project-switch')
    expect(usePipelineStore.getState().nodeOutputs.panel?.output).toBeUndefined()

    await usePipelineStore.getState().loadBatteries()
    await vi.waitFor(() =>
      expect(usePipelineStore.getState().nodeOutputs.panel?.output).toEqual(wire),
    )
  })

  it('refreshConnectedOutputs stops re-fetching a port once the batch route reports it tooLarge at a stable hash', async () => {
    // Regression test for a real production trace: a structural merge node
    // (n_merge/tree) that always resolves >100MB always came back `tooLarge`
    // from the batch value-fetch, but because a tooLarge response never calls
    // setNodeOutput(), `cached` stayed undefined forever — so the metaOnly
    // "did this change?" check saw `cached === undefined` and reclassified the
    // port as "changed" on every single refresh pass, re-paying the whole
    // tooLarge round trip each time (observed: 17 repeats / ~5s wasted in one
    // project-switch capture). Once the backend has said tooLarge for a given
    // executedHash, a later pass with the *same* hash must not re-issue the
    // value fetch for that port at all.
    client.__reset({
      ops: [spec('scene.big', 'Big', [{ name: 'tree', type: 'scene', access: 'item' }])],
      nodes: [{ id: 'merge', opId: 'scene.big', position: { x: 0, y: 0 }, params: {} }],
    })
    await usePipelineStore.getState().loadBatteries()
    await usePipelineStore.getState().loadPipeline()

    const meta = { executedHash: 'h1', valid: true, sharded: true, dataChunks: 40 }
    let metaCalls = 0
    let valueCalls = 0
    ;(
      client as unknown as {
        getNodeOutputsBatch: (
          ports: ReadonlyArray<{ nodeId: string; portId: string }>,
          opts?: { metaOnly?: boolean },
        ) => Promise<
          ReadonlyArray<{
            nodeId: string
            portId: string
            value?: unknown
            meta: typeof meta | null
            tooLarge?: boolean
          }>
        >
      }
    ).getNodeOutputsBatch = vi.fn(async (ports, opts) => {
      if (opts?.metaOnly) {
        metaCalls += 1
        return ports.map((p) => ({ nodeId: p.nodeId, portId: p.portId, meta }))
      }
      valueCalls += 1
      return ports.map((p) => ({ nodeId: p.nodeId, portId: p.portId, value: null, meta, tooLarge: true }))
    })

    await usePipelineStore.getState().refreshConnectedOutputs()
    expect(metaCalls).toBe(1)
    expect(valueCalls).toBe(1) // first pass: hash is unseen, must ask once

    const summary = usePipelineStore.getState().nodeOutputs.merge?.tree
    expect(isTooLargeOutputSummary(summary)).toBe(true)
    if (isTooLargeOutputSummary(summary)) {
      expect(summary.portType).toBe('scene')
      expect(summary.dataChunks).toBe(40)
      expect(summary.sharded).toBe(true)
    }

    await usePipelineStore.getState().refreshConnectedOutputs()
    expect(metaCalls).toBe(2)
    expect(valueCalls).toBe(1) // second pass: same hash already known tooLarge — no re-fetch

    await usePipelineStore.getState().refreshConnectedOutputs()
    expect(valueCalls).toBe(1) // stays settled across further passes too
  })

  it('refreshConnectedOutputs hydrates a Phase-2 blob-ref envelope before storing the output', async () => {
    // See wb-scene-generator-scene-tree-storage.md §3: the backend may ship a
    // deduped envelope for a sharded port instead of `tooLarge` — `value` still
    // has the DataTreeEntry[] shape, but a repeated field is replaced by
    // `{ __outputCacheBlobRef }`, with the one real copy in `blobs`. The store
    // must hydrate this BEFORE setNodeOutput so nodeOutputs never holds a raw
    // blob-ref sentinel.
    client.__reset({
      ops: [spec('scene.decor', 'Decor', [{ name: 'tree', type: 'scene', access: 'item' }])],
      nodes: [{ id: 'decor', opId: 'scene.decor', position: { x: 0, y: 0 }, params: {} }],
    })
    await usePipelineStore.getState().loadBatteries()
    await usePipelineStore.getState().loadPipeline()

    const meta = { executedHash: 'h1', valid: true, sharded: true, dataChunks: 2 }
    const sharedTree = { name: 'root', blob: 'shared' }
    ;(
      client as unknown as {
        getNodeOutputsBatch: (
          ports: ReadonlyArray<{ nodeId: string; portId: string }>,
          opts?: { metaOnly?: boolean },
        ) => Promise<
          ReadonlyArray<{
            nodeId: string
            portId: string
            value?: unknown
            blobs?: Record<string, unknown>
            meta: typeof meta | null
          }>
        >
      }
    ).getNodeOutputsBatch = vi.fn(async (ports, opts) => {
      if (opts?.metaOnly) return ports.map((p) => ({ nodeId: p.nodeId, portId: p.portId, meta }))
      return ports.map((p) => ({
        nodeId: p.nodeId,
        portId: p.portId,
        value: [
          { path: [0], items: [{ tree: { __outputCacheBlobRef: 'hash1' }, focus: '/a' }] },
          { path: [1], items: [{ tree: { __outputCacheBlobRef: 'hash1' }, focus: '/b' }] },
        ],
        blobs: { hash1: sharedTree },
        meta,
      }))
    })

    await usePipelineStore.getState().refreshConnectedOutputs()

    const got = usePipelineStore.getState().nodeOutputs.decor?.tree as Array<{
      items: Array<{ tree: unknown; focus: string }>
    }>
    expect(got).toEqual([
      { path: [0], items: [{ tree: sharedTree, focus: '/a' }] },
      { path: [1], items: [{ tree: sharedTree, focus: '/b' }] },
    ])
  })

  it('autoExecuteOnOpen runs when some visible outputs are missing (partial cache)', async () => {
    client.__reset({
      ops: [
        spec('empty_scene', 'Empty', [{ name: 'scene', type: 'scene', access: 'tree' }]),
        spec('scene_output', 'Out', [{ name: 'voxel_layers', type: 'voxel_layers', access: 'list' }]),
      ],
    })
    const execSpy = vi.spyOn(client, 'execute').mockResolvedValue({
      executionId: 'exec-partial',
      status: 'completed',
      durationMs: 1,
      outputs: {},
    } as never)

    usePipelineStore.setState({
      currentPipeline: {
        ...createEmptyPipeline(),
        nodes: [
          { id: 'empty', batteryId: 'empty_scene', name: 'empty', position: { x: 0, y: 0 }, params: {} },
          { id: 'sink', batteryId: 'scene_output', name: 'out', position: { x: 200, y: 0 }, params: {} },
        ],
      },
      nodeOutputs: { sink: { voxel_layers: [{ path: [0], items: [[]] }] } },
    })
    await usePipelineStore.getState().loadBatteries()

    await usePipelineStore.getState().autoExecuteOnOpen()

    expect(execSpy).toHaveBeenCalled()
  })

  it('autoExecuteOnOpen skips when every visible output port is hydrated', async () => {
    client.__reset({
      ops: [spec('empty_scene', 'Empty', [{ name: 'scene', type: 'scene', access: 'tree' }])],
    })
    const execSpy = vi.spyOn(client, 'execute').mockResolvedValue({
      executionId: 'exec-full',
      status: 'completed',
      durationMs: 1,
      outputs: {},
    } as never)

    usePipelineStore.setState({
      currentPipeline: {
        ...createEmptyPipeline(),
        nodes: [
          { id: 'empty', batteryId: 'empty_scene', name: 'empty', position: { x: 0, y: 0 }, params: {} },
        ],
      },
      nodeOutputs: { empty: { scene: [{ path: [0], items: [{ focus: '/' }] }] } },
    })
    await usePipelineStore.getState().loadBatteries()

    await usePipelineStore.getState().autoExecuteOnOpen()

    expect(execSpy).not.toHaveBeenCalled()
  })

  it('autoExecuteOnOpen re-runs a wired sink whose HIDDEN output cache is stale', async () => {
    // Regression for "刷新网页后 SceneOutput 的 preview 永远空白". A sink hides its
    // output handles, so it never appears in the visible-port scan; with every
    // visible port hydrated, nothing marked it missing and nothing re-executed
    // it, while the renderer draws exclusively from that (empty) cache.
    client.__reset({
      ops: [
        spec('empty_scene', 'Empty', [{ name: 'scene', type: 'scene', access: 'tree' }]),
        spec('scene_output', 'Out', [{ name: 'layers', type: 'voxel_layers', access: 'list' }]),
      ],
    })
    const execSpy = vi.spyOn(client, 'execute').mockResolvedValue({
      executionId: 'exec-sink',
      status: 'completed',
      durationMs: 1,
      outputs: {},
    } as never)

    usePipelineStore.setState({
      currentPipeline: {
        ...createEmptyPipeline(),
        nodes: [
          { id: 'empty', batteryId: 'empty_scene', name: 'empty', position: { x: 0, y: 0 }, params: {} },
          { id: 'sink', batteryId: 'scene_output', name: 'out', position: { x: 200, y: 0 }, params: {} },
        ],
        edges: [
          { id: 'e-empty-sink', source: { nodeId: 'empty', port: 'scene' }, target: { nodeId: 'sink', port: 'scene' } },
        ],
      },
      // Every VISIBLE port is hydrated — only the sink's hidden port is stale.
      nodeOutputs: { empty: { scene: [{ path: [0], items: [{ focus: '/' }] }] } },
    })
    await usePipelineStore.getState().loadBatteries()
    usePipelineStore.setState({
      batteries: usePipelineStore
        .getState()
        .batteries.map((b) => (b.id === 'scene_output' ? { ...b, hideOutputs: true } : b)),
    })
    ;(
      client as unknown as {
        getNodeOutputsBatch: (
          ports: ReadonlyArray<{ nodeId: string; portId: string }>,
        ) => Promise<ReadonlyArray<{ nodeId: string; portId: string; meta: { valid: boolean } | null }>>
      }
    ).getNodeOutputsBatch = vi.fn(async (ports) =>
      ports.map((p) => ({ nodeId: p.nodeId, portId: p.portId, meta: { valid: false } })),
    )

    await usePipelineStore.getState().autoExecuteOnOpen()

    expect(execSpy).toHaveBeenCalled()
    expect(execSpy.mock.calls[0]?.[0]).toMatchObject({ nodeId: 'sink' })
  })

  it('autoExecuteOnOpen stays quiet when the hidden sink cache is valid', async () => {
    client.__reset({
      ops: [
        spec('empty_scene', 'Empty', [{ name: 'scene', type: 'scene', access: 'tree' }]),
        spec('scene_output', 'Out', [{ name: 'layers', type: 'voxel_layers', access: 'list' }]),
      ],
    })
    const execSpy = vi.spyOn(client, 'execute').mockResolvedValue({
      executionId: 'exec-none',
      status: 'completed',
      durationMs: 1,
      outputs: {},
    } as never)

    usePipelineStore.setState({
      currentPipeline: {
        ...createEmptyPipeline(),
        nodes: [
          { id: 'empty', batteryId: 'empty_scene', name: 'empty', position: { x: 0, y: 0 }, params: {} },
          { id: 'sink', batteryId: 'scene_output', name: 'out', position: { x: 200, y: 0 }, params: {} },
        ],
        edges: [
          { id: 'e-empty-sink', source: { nodeId: 'empty', port: 'scene' }, target: { nodeId: 'sink', port: 'scene' } },
        ],
      },
      nodeOutputs: { empty: { scene: [{ path: [0], items: [{ focus: '/' }] }] } },
    })
    await usePipelineStore.getState().loadBatteries()
    usePipelineStore.setState({
      batteries: usePipelineStore
        .getState()
        .batteries.map((b) => (b.id === 'scene_output' ? { ...b, hideOutputs: true } : b)),
    })
    ;(
      client as unknown as {
        getNodeOutputsBatch: (
          ports: ReadonlyArray<{ nodeId: string; portId: string }>,
        ) => Promise<ReadonlyArray<{ nodeId: string; portId: string; meta: { valid: boolean } | null }>>
      }
    ).getNodeOutputsBatch = vi.fn(async (ports) =>
      ports.map((p) => ({ nodeId: p.nodeId, portId: p.portId, meta: { valid: true } })),
    )

    await usePipelineStore.getState().autoExecuteOnOpen()

    expect(execSpy).not.toHaveBeenCalled()
  })

  it('autoExecuteOnOpen scopes execute to the missing node, not the whole graph, when only one node is stale', async () => {
    // Regression for the "every project open/switch pays a full-graph
    // recompute" bug: nodeOutputs is wiped on every switch, so a single
    // never-fetched port used to make autoExecuteOnOpen call executePipeline()
    // with NO nodeId (a full re-run of every node). It should instead scope
    // the real compute to just the stale node's downstream closure.
    client.__reset({
      ops: [spec('a.one', 'One', [{ name: 'out', type: 'any', access: 'item' }])],
    })
    const execSpy = vi.spyOn(client, 'execute')

    usePipelineStore.setState({
      currentPipeline: {
        ...createEmptyPipeline(),
        nodes: [
          { id: 'a', batteryId: 'a.one', name: 'a', position: { x: 0, y: 0 }, params: {} },
          { id: 'b', batteryId: 'a.one', name: 'b', position: { x: 200, y: 0 }, params: {} },
          { id: 'c', batteryId: 'a.one', name: 'c', position: { x: 400, y: 0 }, params: {} },
        ],
        edges: [{ id: 'e1', source: { nodeId: 'a', port: 'out' }, target: { nodeId: 'b', port: 'out' } }],
      },
      // `a` and `c` are already hydrated; only `b` is missing.
      nodeOutputs: { a: { out: 'valA' }, c: { out: 'valC' } },
    })
    await usePipelineStore.getState().loadBatteries()

    await usePipelineStore.getState().autoExecuteOnOpen()

    expect(execSpy).toHaveBeenCalledTimes(1)
    expect(execSpy.mock.calls[0][0]).toMatchObject({ nodeId: 'b' })
  })

  it('autoExecuteOnOpen backfills a missing port from the output cache instead of executing when disk cache is warm', async () => {
    // Client-side `nodeOutputs` gets wiped on every project switch, but the
    // disk-backed output cache is often still valid — a plain re-fetch should
    // resolve that gap before falling back to a real recompute.
    client.__reset({
      ops: [spec('a.one', 'One', [{ name: 'out', type: 'any', access: 'item' }])],
    })
    const execSpy = vi.spyOn(client, 'execute')
    ;(
      client as unknown as {
        getNodeOutputsBatch: (
          ports: ReadonlyArray<{ nodeId: string; portId: string }>,
          opts?: { metaOnly?: boolean },
        ) => Promise<ReadonlyArray<{ nodeId: string; portId: string; value?: unknown; meta: unknown }>>
      }
    ).getNodeOutputsBatch = vi.fn(async (ports, opts) => {
      const meta = { executedHash: 'h1', valid: true, sharded: false }
      if (opts?.metaOnly) return ports.map((p) => ({ nodeId: p.nodeId, portId: p.portId, meta }))
      return ports.map((p) => ({ nodeId: p.nodeId, portId: p.portId, value: 'from-disk-cache', meta }))
    })

    usePipelineStore.setState({
      currentPipeline: {
        ...createEmptyPipeline(),
        nodes: [{ id: 'a', batteryId: 'a.one', name: 'a', position: { x: 0, y: 0 }, params: {} }],
      },
      nodeOutputs: {},
    })
    await usePipelineStore.getState().loadBatteries()

    await usePipelineStore.getState().autoExecuteOnOpen()

    expect(usePipelineStore.getState().nodeOutputs.a?.out).toBe('from-disk-cache')
    expect(execSpy).not.toHaveBeenCalled()
  })

  it('renameGroup syncs both the NodeGroup name and the __group__ shadow node mirror', () => {
    // The save-as-template dialog renames via renameGroup. If only group.name
    // updates and the shadow node keeps its stale mirror (e.g. "Group Node"),
    // the persist diff (name = group.name SSOT) and any drag-out (loadGroup ->
    // getGroup) would surface the stale name. Both must move together.
    usePipelineStore.setState({
      currentPipeline: {
        ...createEmptyPipeline(),
        nodes: [
          { id: 'g1', batteryId: '__group__', name: 'Group Node', position: { x: 0, y: 0 }, params: { groupId: 'g1' } },
        ],
        groups: [
          { id: 'g1', name: 'Group Node', nodes: [], edges: [], position: { x: 0, y: 0 }, exposedInputs: [], exposedOutputs: [] },
        ],
      },
    })

    usePipelineStore.getState().renameGroup('g1', 'ttt')

    const pipeline = usePipelineStore.getState().currentPipeline!
    expect(pipeline.groups?.find((g) => g.id === 'g1')?.name).toBe('ttt')
    expect(pipeline.nodes.find((n) => n.id === 'g1')?.name).toBe('ttt')
  })

  describe('group-view shell exposed-port editing', () => {
    function seedGroupPipeline() {
      usePipelineStore.setState({
        currentPipeline: {
          ...createEmptyPipeline(),
          nodes: [
            { id: 'g1', batteryId: '__group__', name: 'G', position: { x: 0, y: 0 }, params: { groupId: 'g1' } },
            { id: 'up', batteryId: 'a.one', name: 'Up', position: { x: -200, y: 0 }, params: {} },
          ],
          edges: [
            { id: 'ext_in', source: { nodeId: 'up', port: 'out' }, target: { nodeId: 'g1', port: 'in_0' } },
          ],
          groups: [
            {
              id: 'g1', name: 'G', nodes: [
                { id: 'inner', batteryId: 'a.one', name: 'In', position: { x: 0, y: 0 }, params: {} },
              ], edges: [], position: { x: 0, y: 0 },
              exposedInputs: [{ portName: 'in_0', portType: 'string', sourceNodeId: 'inner', sourcePortName: 'in', order: 0 }],
              exposedOutputs: [],
            },
          ],
        },
      })
    }

    it('addGroupExposedPort allocates the next stable id and an unmapped placeholder', () => {
      seedGroupPipeline()
      const res = usePipelineStore.getState().addGroupExposedPort('g1', 'input')
      expect(res.ok).toBe(true)
      expect(res.portName).toBe('in_1')
      const ports = usePipelineStore.getState().currentPipeline!.groups![0].exposedInputs
      const added = ports.find((p) => p.portName === 'in_1')!
      expect(added.sourceNodeId).toBe('')
      expect(added.portType).toBe('any')
    })

    it('bind then unbind round-trips an exposed port mapping', () => {
      seedGroupPipeline()
      usePipelineStore.getState().addGroupExposedPort('g1', 'output')
      usePipelineStore.getState().bindGroupExposedPort('g1', 'output', 'out_0', {
        sourceNodeId: 'inner', sourcePortName: 'out', portType: 'string',
      })
      let port = usePipelineStore.getState().currentPipeline!.groups![0].exposedOutputs[0]
      expect(port).toMatchObject({ sourceNodeId: 'inner', sourcePortName: 'out', portType: 'string' })

      usePipelineStore.getState().unbindGroupExposedPort('g1', 'output', 'out_0')
      port = usePipelineStore.getState().currentPipeline!.groups![0].exposedOutputs[0]
      expect(port).toMatchObject({ sourceNodeId: '', sourcePortName: '', portType: 'any' })
    })

    it('removeGroupExposedPort deletes the port and drops its external edge', () => {
      seedGroupPipeline()
      const res = usePipelineStore.getState().removeGroupExposedPort('g1', 'input', 'in_0')
      expect(res.ok).toBe(true)
      const pipeline = usePipelineStore.getState().currentPipeline!
      expect(pipeline.groups![0].exposedInputs).toEqual([])
      expect(pipeline.edges.find((e) => e.id === 'ext_in')).toBeUndefined()
    })
  })
})
