// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useNodePreviews } from '../useNodePreviews'
import { useRenderStore } from '../../store'
import type { HttpApiClient } from '../../../api/HttpApiClient'

// Fake ApiClient surface useNodePreviews consumes. A graph of:
//   noise (cellular_noise: grid) → sink (scene_output: voxel_layers + name_list)
// exercises BOTH buckets: the intermediate grid preview AND the voxel sink.
// Port TYPES come from listOps; output VALUES from getNodeOutput (wire form).
function makeFakeClient(opts?: { sinkPreviewOff?: boolean }) {
  let execCb: ((e: { kind: string; executionId?: string }) => void) | null = null
  let graphCb: ((e: { kind: string; batchId?: string }) => void) | null = null
  let draftCb: ((payload: unknown) => void) | null = null
  let outputReads = 0
  let completedOutputReads = 0
  let outputReadGate: Promise<void> | null = null
  let releaseOutputReads: (() => void) | null = null
  let syncedProjectId: string | null = null
  // `wire(value)` = the kernel `DataTree.fromItem(value)` serialization
  // (`[{path:[0], items:[value]}]`), matching the LIVE backend exactly:
  //   * grid       → value is the grid → items:[grid]              (single-wrap)
  //   * voxel/names→ value is the LIST → items:[[ …elements ]]      (double-wrap)
  const wire = (v: unknown) => [{ path: [0], items: [v] }]
  const outputs: Record<string, unknown> = {
    'noise:grid': wire([
      [0, 1],
      [1, 0],
    ]),
    'sink:layers': wire([{ nodePath: '/A', nodeName: 'A', value: 1, cells: [{ x: 0, y: 0, z: 0 }] }]),
    'sink:names': wire([{ id: 1, name: 'wall', type: 'tile' }]),
  }
  // Mutable node set so tests can simulate a deletion/disconnect then fire a
  // graph mutation; listNodes() is the post-mutation source of truth.
  let nodes: Array<Record<string, unknown>> = [
    { id: 'noise', opId: 'cellular_noise', position: { x: 0, y: 0 }, params: {} },
    {
      id: 'sink',
      opId: 'scene_output',
      position: { x: 0, y: 0 },
      params: {},
      previewEnabled: opts?.sinkPreviewOff ? false : undefined,
    },
  ]
  const client = {
    subscribe(channel: string, cb: (e: { kind: string; executionId?: string; batchId?: string }) => void) {
      if (channel === 'execution') execCb = cb
      else if (channel === 'graph') graphCb = cb
      return () => {
        if (channel === 'execution') execCb = null
        else if (channel === 'graph') graphCb = null
      }
    },
    subscribeRaw(event: string, cb: (payload: unknown) => void) {
      if (event === 'scene-script:draft') draftCb = cb
      return () => {
        if (event === 'scene-script:draft') draftCb = null
      }
    },
    async listOps() {
      return [
        { id: 'cellular_noise', outputs: [{ name: 'grid', type: 'grid' }] },
        {
          id: 'scene_output',
          outputs: [
            { name: 'layers', type: 'voxel_layers' },
            { name: 'names', type: 'name_list' },
          ],
        },
      ]
    },
    async listNodes() {
      return nodes
    },
    async ensureViewingProject() {},
    syncViewingProjectId(projectId: string) {
      syncedProjectId = projectId
    },
    async getNodeOutput(nodeId: string, port: string) {
      outputReads += 1
      const value = outputs[`${nodeId}:${port}`]
      const gate = outputReadGate
      if (gate) await gate
      completedOutputReads += 1
      return value
    },
  }
  return {
    client: client as unknown as HttpApiClient,
    completeExecution: () => execCb?.({ kind: 'exec:completed', executionId: 'exec-test' }),
    startExecution: () => execCb?.({ kind: 'exec:started', executionId: 'exec-test' }),
    applyGraph: (batchId = 'graph-test') => graphCb?.({ kind: 'graph:applied', batchId }),
    emitDraft: (generation: number, previewRevision: string, withRender = false) => draftCb?.({
      projectId: 'p1',
      draftId: 'studio-p1',
      generation,
      valid: true,
      diagnostics: [],
      status: 'visible',
      previewRevision,
      projectRevision: 'project-1',
      ...(withRender
        ? {
            render: {
              graph: {
                nodes: [{
                  id: 'draft-noise',
                  opId: 'cellular_noise',
                  name: 'Draft noise',
                  position: { x: 0, y: 0 },
                  params: {},
                }],
              },
              ops: [{ id: 'cellular_noise', outputs: [{ name: 'grid', type: 'grid' }] }],
              outputs: {
                'draft-noise': {
                  grid: wire([[7, 8]]),
                },
              },
            },
          }
        : {}),
    }),
    setOutput: (nodeId: string, port: string, value: unknown) => {
      outputs[`${nodeId}:${port}`] = value
    },
    getOutputReads: () => outputReads,
    getCompletedOutputReads: () => completedOutputReads,
    getSyncedProjectId: () => syncedProjectId,
    delayOutputReads: () => {
      outputReadGate = new Promise<void>((resolve) => { releaseOutputReads = resolve })
      return () => {
        releaseOutputReads?.()
        releaseOutputReads = null
        outputReadGate = null
      }
    },
    deleteNodes: (ids: string[]) => {
      nodes = nodes.filter((n) => !ids.includes(n.id as string))
    },
  }
}

beforeEach(() => useRenderStore.getState().reset())

describe('useNodePreviews', () => {
  it('projects an intermediate node grid into previewLayers (no scene_output needed)', async () => {
    const { client } = makeFakeClient()
    renderHook(() => useNodePreviews(client))
    await waitFor(() => {
      expect(Object.keys(useRenderStore.getState().previewLayers)).toContain('noise:grid')
    })
    const layer = useRenderStore.getState().previewLayers['noise:grid']
    expect(layer.rows).toBe(2)
    expect(layer.cols).toBe(2)
    expect(layer.outputType).toBe('grid')
  })

  it('projects scene_output into the voxel layers bucket', async () => {
    const { client } = makeFakeClient()
    renderHook(() => useNodePreviews(client))
    await waitFor(() => {
      expect(useRenderStore.getState().layers['sink:/A']).toBeDefined()
    })
    expect(useRenderStore.getState().layers['sink:/A'].assetName).toBe('wall')
  })

  // Regression: the LIVE backend double-wraps voxel_layers/name_list. Before the
  // flattenWireList fix, setLayers received a single array-element and the
  // renderer crashed with `layer.cells is not iterable`. Assert the projected
  // layer is a REAL VoxelLayer with an iterable `cells` array (and the grid's
  // single-wrap still yields a real number[][] — so neither regresses the other).
  it('projects a non-empty (double-wrapped) scene_output into real VoxelLayers with iterable cells', async () => {
    const { client } = makeFakeClient()
    renderHook(() => useNodePreviews(client))
    await waitFor(() => expect(useRenderStore.getState().layers['sink:/A']).toBeDefined())

    const layer = useRenderStore.getState().layers['sink:/A']
    expect(Array.isArray(layer.cells)).toBe(true)
    expect(layer.cells).toHaveLength(1)
    expect(layer.value).toBe(1)
    // The grid bucket (single-wrap) stays a real dense grid, not over-flattened.
    const grid = useRenderStore.getState().previewLayers['noise:grid']
    expect(grid.rows).toBe(2)
    expect(grid.cols).toBe(2)
  })

  it('refreshes both buckets when an execution completes', async () => {
    const { client, completeExecution } = makeFakeClient()
    renderHook(() => useNodePreviews(client))
    await waitFor(() => expect(useRenderStore.getState().previewLayers['noise:grid']).toBeDefined())

    useRenderStore.getState().reset()
    expect(useRenderStore.getState().previewLayers['noise:grid']).toBeUndefined()

    completeExecution()
    await waitFor(() => expect(useRenderStore.getState().previewLayers['noise:grid']).toBeDefined())
  })

  it('refreshes for the newest visible draft and rejects stale generations/revisions', async () => {
    const { client, emitDraft, getOutputReads } = makeFakeClient()
    renderHook(() => useNodePreviews(client))
    await waitFor(() => expect(useRenderStore.getState().previewLayers['noise:grid']).toBeDefined())
    const initialReads = getOutputReads()

    emitDraft(2, 'preview-2')
    await waitFor(() => expect(getOutputReads()).toBeGreaterThan(initialReads))
    const readsAfterNewest = getOutputReads()

    emitDraft(2, 'preview-conflict')
    emitDraft(1, 'preview-1')
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(getOutputReads()).toBe(readsAfterNewest)
  })

  it('projects isolated draft outputs without re-reading the canonical runtime', async () => {
    const { client, emitDraft, getOutputReads, getSyncedProjectId } = makeFakeClient()
    renderHook(() => useNodePreviews(client))
    await waitFor(() => expect(useRenderStore.getState().previewLayers['noise:grid']).toBeDefined())
    const canonicalReads = getOutputReads()

    emitDraft(1, 'preview-draft', true)

    await waitFor(() => {
      expect(useRenderStore.getState().previewLayers['draft-noise:grid']?.data).toEqual([[7, 8]])
    })
    expect(useRenderStore.getState().previewLayers['noise:grid']).toBeUndefined()
    expect(getOutputReads()).toBe(canonicalReads)
    expect(getSyncedProjectId()).toBe('p1')
  })

  it('keeps the last grid frame when a refresh sees an empty declared-grid output', async () => {
    const { client, completeExecution, setOutput, getOutputReads } = makeFakeClient()
    renderHook(() => useNodePreviews(client))
    await waitFor(() => expect(useRenderStore.getState().previewLayers['noise:grid']).toBeDefined())
    const previous = useRenderStore.getState().previewLayers['noise:grid']
    const readsBeforeRefresh = getOutputReads()

    // graph:applied invalidates output caches before execute repopulates them.
    // The transient empty fetch must not make an unrelated grid disappear.
    setOutput('noise', 'grid', undefined)
    completeExecution()
    await waitFor(() => expect(getOutputReads()).toBeGreaterThan(readsBeforeRefresh))

    expect(useRenderStore.getState().previewLayers['noise:grid']).toBe(previous)
  })

  it('does not let an in-flight refresh overwrite a newer live grid push', async () => {
    const {
      client, completeExecution, setOutput, getOutputReads,
      getCompletedOutputReads, delayOutputReads,
    } = makeFakeClient()
    renderHook(() => useNodePreviews(client))
    await waitFor(() => expect(useRenderStore.getState().previewLayers['noise:grid']).toBeDefined())

    const wire = (v: unknown) => [{ path: [0], items: [v] }]
    setOutput('noise', 'grid', wire([[1]]))
    const readsBeforeRefresh = getOutputReads()
    const completedBeforeRefresh = getCompletedOutputReads()
    const release = delayOutputReads()
    completeExecution()
    await waitFor(() => expect(getOutputReads()).toBeGreaterThan(readsBeforeRefresh))

    const { projectLiveOutputs } = await import('../useNodePreviews')
    projectLiveOutputs({ noise: { grid: wire([[9]]) } })
    expect(useRenderStore.getState().previewLayers['noise:grid']?.data).toEqual([[9]])

    release()
    await waitFor(() => expect(getCompletedOutputReads()).toBeGreaterThan(completedBeforeRefresh))
    expect(useRenderStore.getState().previewLayers['noise:grid']?.data).toEqual([[9]])
  })

  it('evicts a deleted node\'s grid preview AND voxel layer on graph:applied (no execution needed)', async () => {
    const { client, applyGraph, deleteNodes } = makeFakeClient()
    renderHook(() => useNodePreviews(client))
    // Both buckets populated initially.
    await waitFor(() => {
      expect(useRenderStore.getState().previewLayers['noise:grid']).toBeDefined()
      expect(useRenderStore.getState().layers['sink:/A']).toBeDefined()
    })

    // Simulate deleting BOTH nodes in the editor: a pure delete fires no
    // execution, only graph:applied. The GC must still prune the stale layers.
    deleteNodes(['noise', 'sink'])
    applyGraph()

    await waitFor(() => {
      expect(useRenderStore.getState().previewLayers['noise:grid']).toBeUndefined()
      expect(useRenderStore.getState().layers['sink:/A']).toBeUndefined()
    })
  })

  it('keeps the last frame while execute is in flight after graph:applied', async () => {
    const { client, startExecution, completeExecution, applyGraph, deleteNodes } = makeFakeClient()
    renderHook(() => useNodePreviews(client))
    await waitFor(() => {
      expect(useRenderStore.getState().previewLayers['noise:grid']).toBeDefined()
      expect(useRenderStore.getState().layers['sink:/A']).toBeDefined()
    })
    startExecution()
    deleteNodes(['noise', 'sink'])
    applyGraph()
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(useRenderStore.getState().previewLayers['noise:grid']).toBeDefined()
    expect(useRenderStore.getState().layers['sink:/A']).toBeDefined()
    completeExecution()
    await waitFor(() => {
      expect(useRenderStore.getState().previewLayers['noise:grid']).toBeUndefined()
      expect(useRenderStore.getState().layers['sink:/A']).toBeUndefined()
    })
  })

  it('honors previewEnabled=false by clearing that node\'s layers', async () => {
    const { client } = makeFakeClient({ sinkPreviewOff: true })
    renderHook(() => useNodePreviews(client))
    // Grid still previews; the scene_output sink with preview off must not project.
    await waitFor(() => expect(useRenderStore.getState().previewLayers['noise:grid']).toBeDefined())
    expect(useRenderStore.getState().layers['sink:/A']).toBeUndefined()
  })

  // G4: the editor's preview toggle rides the client-side previewOverrides map
  // (workbench:preview-change), not the backend graph. Flipping a node off drops
  // its layers immediately; clearing the override restores them.
  it('honors a client-side previewOverride and restores layers when cleared', async () => {
    const { client } = makeFakeClient()
    renderHook(() => useNodePreviews(client))
    // Both buckets populated with no override.
    await waitFor(() => {
      expect(useRenderStore.getState().previewLayers['noise:grid']).toBeDefined()
      expect(useRenderStore.getState().layers['sink:/A']).toBeDefined()
    })

    // Editor turns the grid node's preview OFF → override drops its grid layer.
    useRenderStore.getState().setPreviewOverrides({ noise: false })
    await waitFor(() => expect(useRenderStore.getState().previewLayers['noise:grid']).toBeUndefined())
    // The sink (not overridden) keeps projecting.
    expect(useRenderStore.getState().layers['sink:/A']).toBeDefined()

    // Editor turns it back ON (override cleared) → grid layer comes back.
    useRenderStore.getState().setPreviewOverrides({})
    await waitFor(() => expect(useRenderStore.getState().previewLayers['noise:grid']).toBeDefined())
  })

  it('projects scene_output voxels from a live workbench:preview-data push', async () => {
    const wire = (v: unknown) => [{ path: [0], items: [v] }]
    const { client } = makeFakeClient()
    renderHook(() => useNodePreviews(client))
    await waitFor(() => expect(useRenderStore.getState().layers['sink:/A']).toBeDefined())

    useRenderStore.getState().reset()
    expect(useRenderStore.getState().layers['sink:/A']).toBeUndefined()

    const { projectLiveOutputs } = await import('../useNodePreviews')
    projectLiveOutputs({
      sink: {
        layers: wire([{ nodePath: '/A', nodeName: 'A', value: 1, cells: [{ x: 2, y: 2, z: 0 }] }]),
        names: wire([{ id: 1, name: 'wall', type: 'tile' }]),
      },
    })
    await waitFor(() => expect(useRenderStore.getState().layers['sink:/A']?.cells[0]).toEqual({ x: 2, y: 2, z: 0 }))
  })

  it('keeps the last voxel frame when a refresh sees an empty scene_output (param-drag race)', async () => {
    let execCb: ((e: { kind: string }) => void) | null = null
    const wire = (v: unknown) => [{ path: [0], items: [v] }]
    let sinkCells = [{ x: 0, y: 0, z: 0 }]
    const outputs: Record<string, unknown> = {
      'noise:grid': wire([[0, 1], [1, 0]]),
      get 'sink:layers'() {
        return wire([{ nodePath: '/A', nodeName: 'A', value: 1, cells: sinkCells }])
      },
      'sink:names': wire([{ id: 1, name: 'wall', type: 'tile' }]),
    }
    const client = {
      subscribe(channel: string, cb: (e: { kind: string }) => void) {
        if (channel === 'execution') execCb = cb
        return () => { execCb = null }
      },
      async ensureViewingProject() {},
      async listOps() {
        return [
          { id: 'cellular_noise', outputs: [{ name: 'grid', type: 'grid' }] },
          { id: 'scene_output', outputs: [{ name: 'layers', type: 'voxel_layers' }, { name: 'names', type: 'name_list' }] },
        ]
      },
      async listNodes() {
        return [
          { id: 'noise', opId: 'cellular_noise', position: { x: 0, y: 0 }, params: {} },
          { id: 'sink', opId: 'scene_output', position: { x: 0, y: 0 }, params: {} },
        ]
      },
      async getNodeOutput(nodeId: string, port: string) {
        return outputs[`${nodeId}:${port}`]
      },
    } as unknown as HttpApiClient

    renderHook(() => useNodePreviews(client))
    await waitFor(() => expect(useRenderStore.getState().layers['sink:/A']).toBeDefined())
    expect(useRenderStore.getState().layers['sink:/A'].cells).toHaveLength(1)

    // Cache invalidated mid-drag: empty payload must NOT wipe the preview.
    sinkCells = []
    ;(execCb as ((event: { kind: string }) => void) | null)?.({ kind: 'exec:completed' })
    await waitFor(() => expect(useRenderStore.getState().layers['sink:/A']?.cells).toHaveLength(1))

    sinkCells = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]
    ;(execCb as ((event: { kind: string }) => void) | null)?.({ kind: 'exec:completed' })
    await waitFor(() => expect(useRenderStore.getState().layers['sink:/A']?.cells).toHaveLength(2))
  })

  it('lets direct live frames own a local drag and performs one settled cache refresh', async () => {
    const { client, completeExecution, getOutputReads } = makeFakeClient()
    renderHook(() => useNodePreviews(client))
    await waitFor(() => expect(useRenderStore.getState().layers['sink:/A']).toBeDefined())
    const baseline = getOutputReads()
    const { notifyLocalParamEdit } = await import('../useNodePreviews')

    notifyLocalParamEdit()
    completeExecution()
    notifyLocalParamEdit()
    completeExecution()

    // No network pull may race the invalidated cache while the drag is active.
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(getOutputReads()).toBe(baseline)
    // One trailing refresh reconciles cache + GC after the quiet window.
    await waitFor(() => expect(getOutputReads()).toBeGreaterThan(baseline), { timeout: 1200 })
  })
})
