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
function makeFakeClient(opts?: { sinkPreviewOff?: boolean; terrainMesh?: boolean; plane?: boolean; point?: boolean; polyline?: boolean; spline?: boolean; geometryMesh?: boolean; heightfieldPacket?: boolean; planeAndHeightfield?: boolean }) {
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
    'sink:layers': wire(opts?.terrainMesh
      ? []
      : [{ nodePath: '/A', nodeName: 'A', value: 1, cells: [{ x: 0, y: 0, z: 0 }] }]),
    'sink:names': wire(opts?.terrainMesh ? [] : [{ id: 1, name: 'wall', type: 'tile' }]),
    ...(opts?.terrainMesh
      ? {
          'terrain:geometry': wire({
            kind: 'mesh',
            positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
            indices: [0, 1, 2],
          }),
        }
      : {}),
  }
  // Mutable node set so tests can simulate a deletion/disconnect then fire a
  // graph mutation; listNodes() is the post-mutation source of truth.
  let nodes: Array<Record<string, unknown>> = opts?.planeAndHeightfield
    ? [
      { id: 'plane', opId: 'base_plane', position: { x: 0, y: 0 }, params: {} },
      { id: 'field', opId: 'heightfield', position: { x: 0, y: 0 }, params: {} },
    ]
    : opts?.point
    ? [{ id: 'site', opId: 'point2d', position: { x: 0, y: 0 }, params: {} }]
    : opts?.polyline
    ? [{ id: 'line', opId: 'polyline2d', position: { x: 0, y: 0 }, params: {} }]
    : opts?.spline
    ? [{ id: 'curve', opId: 'spline2d', position: { x: 0, y: 0 }, params: {} }]
    : opts?.plane
    ? [{ id: 'plane', opId: 'base_plane', position: { x: 0, y: 0 }, params: {} }]
    : opts?.heightfieldPacket
        ? [{ id: 'field', opId: 'heightfield', position: { x: 0, y: 0 }, params: {} }]
    : opts?.geometryMesh
        ? [{ id: 'terrain', opId: 'mesh_to_node', position: { x: 0, y: 0 }, params: {} }]
    : [
      { id: 'noise', opId: 'cellular_noise', position: { x: 0, y: 0 }, params: {} },
      ...(opts?.terrainMesh
        ? [{ id: 'terrain', opId: 'mesh_to_node', position: { x: 0, y: 0 }, params: {} }]
        : []),
      {
        id: 'sink',
        opId: 'scene_output',
        position: { x: 0, y: 0 },
        params: {},
        previewEnabled: opts?.sinkPreviewOff ? false : undefined,
      },
    ]
  if (opts?.plane || opts?.planeAndHeightfield) {
    outputs['plane:geometry'] = wire({
      kind: 'plane',
      origin: [0, 0],
      width: 10,
      height: opts?.planeAndHeightfield ? 10 : 6,
      rotationDeg: 0,
    })
  }
  if (opts?.point) {
    outputs['site:geometry'] = wire({
      kind: 'point2d',
      x: 4,
      y: 6,
    })
  }
  if (opts?.polyline) {
    outputs['line:geometry'] = wire({
      kind: 'polyline',
      points: [[0, 0], [10, 4]],
    })
  }
  if (opts?.spline) {
    outputs['curve:geometry'] = wire({
      kind: 'spline',
      points: [[40, 0], [18, 48], [40, 30]],
      degree: 3,
    })
  }
  if (opts?.geometryMesh) {
    outputs['terrain:geometry'] = wire({
      kind: 'mesh',
      origin: [0, 0, 0],
      width: 10,
      height: 6,
      positions: [0, 0, 0, 10, 0, 0, 0, -6, 1],
      indices: [0, 1, 2],
      role: 'terrain',
    })
  }
  if (opts?.heightfieldPacket || opts?.planeAndHeightfield) {
    outputs['field:heightfield'] = wire({
      type: 'heightfield',
      geometry: {
        kind: 'plane',
        origin: [0, 0, 0],
        xAxis: [1, 0, 0],
        yAxis: [0, 1, 0],
        width: 10,
        height: 10,
      },
      columns: 2,
      rows: 2,
      height: [
        [0, 1],
        [2, 4],
      ],
      mask: [
        [1, 1],
        [1, 1],
      ],
      attributes: {},
    })
  }
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
        { id: 'mesh_to_node', outputs: [{ name: 'geometry', type: 'geometry' }] },
        { id: 'base_plane', outputs: [{ name: 'geometry', type: 'geometry' }] },
        { id: 'point2d', outputs: [{ name: 'geometry', type: 'point2d' }] },
        { id: 'polyline2d', outputs: [{ name: 'geometry', type: 'polyline2d' }] },
        { id: 'spline2d', outputs: [{ name: 'geometry', type: 'spline2d' }] },
        { id: 'heightfield', outputs: [{ name: 'heightfield', type: 'heightfield' }] },
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

  it('GCs a structural delete even while an unrelated execute is in flight', async () => {
    const { client, startExecution, applyGraph, deleteNodes } = makeFakeClient()
    renderHook(() => useNodePreviews(client))
    await waitFor(() => {
      expect(useRenderStore.getState().previewLayers['noise:grid']).toBeDefined()
      expect(useRenderStore.getState().layers['sink:/A']).toBeDefined()
    })
    startExecution()
    deleteNodes(['noise', 'sink'])
    applyGraph()
    await waitFor(() => {
      expect(useRenderStore.getState().previewLayers['noise:grid']).toBeUndefined()
      expect(useRenderStore.getState().layers['sink:/A']).toBeUndefined()
    })
  })

  it('keeps the last frame while a param-drag execute is in flight', async () => {
    const { client, startExecution, completeExecution, applyGraph, deleteNodes, getOutputReads } = makeFakeClient()
    renderHook(() => useNodePreviews(client))
    await waitFor(() => {
      expect(useRenderStore.getState().previewLayers['noise:grid']).toBeDefined()
      expect(useRenderStore.getState().layers['sink:/A']).toBeDefined()
    })
    const readsBefore = getOutputReads()
    startExecution()
    deleteNodes(['noise', 'sink'])
    applyGraph('editor-param-drag-1')
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(useRenderStore.getState().previewLayers['noise:grid']).toBeDefined()
    expect(useRenderStore.getState().layers['sink:/A']).toBeDefined()
    expect(getOutputReads()).toBe(readsBefore)
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
  // (authoring:preview-change), not the backend graph. Off hides in place; on
  // restores the last frame. GC on hide + empty OutputCache is the "toggle
  // off then on and the grid is gone" bug.
  it('honors a client-side previewOverride and restores layers when re-enabled', async () => {
    const { client, setOutput } = makeFakeClient()
    renderHook(() => useNodePreviews(client))
    await waitFor(() => {
      expect(useRenderStore.getState().previewLayers['noise:grid']).toBeDefined()
      expect(useRenderStore.getState().layers['sink:/A']).toBeDefined()
    })
    const gridBefore = useRenderStore.getState().previewLayers['noise:grid']!.data

    useRenderStore.getState().setPreviewDisabledNodeIds(['noise'])
    await waitFor(() => {
      expect(useRenderStore.getState().previewLayers['noise:grid']?.visible).toBe(false)
    })
    expect(useRenderStore.getState().layers['sink:/A']).toBeDefined()

    setOutput('noise', 'grid', [{ path: [0], items: [] }])
    useRenderStore.getState().setPreviewDisabledNodeIds([])
    await waitFor(() => {
      expect(useRenderStore.getState().previewLayers['noise:grid']?.visible).toBe(true)
    })
    expect(useRenderStore.getState().previewLayers['noise:grid']?.data).toEqual(gridBefore)
  })

  it('projects scene_output voxels from a live authoring:preview-data push', async () => {
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

  it('keeps heightfield mesh when scene_output has empty voxels and no scene port', async () => {
    const { client } = makeFakeClient({ terrainMesh: true })
    renderHook(() => useNodePreviews(client))
    await waitFor(() => {
      const mesh = useRenderStore.getState().meshLayers['terrain:geometry']
      expect(mesh).toBeDefined()
      expect(mesh.mesh.indices.length).toBeGreaterThanOrEqual(3)
    })
    expect(Object.keys(useRenderStore.getState().layers).filter((key) => key.startsWith('sink:'))).toEqual([])
  })

  it('lifts a Heightfield packet as a terrain overlay on the bound plane', async () => {
    const { client } = makeFakeClient({ heightfieldPacket: true })
    renderHook(() => useNodePreviews(client))
    await waitFor(() => {
      const mesh = useRenderStore.getState().meshLayers['field:heightfield']
      expect(mesh).toBeDefined()
      expect(mesh.mesh.role).toBe('terrain')
      expect(mesh.mesh.indices.length).toBeGreaterThanOrEqual(6)
      const xs = []
      for (let i = 0; i < mesh.mesh.positions.length; i += 3) xs.push(mesh.mesh.positions[i]!)
      expect(Math.max(...xs)).toBeCloseTo(10, 5)
    })
  })

  it('paints a live Heightfield push onto the known packet node', async () => {
    const { client } = makeFakeClient({ heightfieldPacket: true })
    renderHook(() => useNodePreviews(client))
    await waitFor(() => expect(useRenderStore.getState().meshLayers['field:heightfield']).toBeDefined())

    const wire = (v: unknown) => [{ path: [0], items: [v] }]
    const { projectLiveOutputs } = await import('../useNodePreviews')
    projectLiveOutputs({
      field: {
        heightfield: wire({
          type: 'heightfield',
          geometry: {
            kind: 'plane',
            origin: [2, 0, 0],
            xAxis: [1, 0, 0],
            yAxis: [0, 1, 0],
            width: 8,
            height: 8,
          },
          columns: 2,
          rows: 2,
          height: [
            [0, 1],
            [1, 2],
          ],
          mask: [
            [1, 1],
            [1, 1],
          ],
          attributes: {},
        }),
      },
    })
    const mesh = useRenderStore.getState().meshLayers['field:heightfield']
    expect(mesh).toBeDefined()
    expect(mesh.mesh.role).toBe('terrain')
    expect(mesh.mesh.indices.length).toBeGreaterThanOrEqual(6)
    const xs = []
    for (let i = 0; i < mesh.mesh.positions.length; i += 3) xs.push(mesh.mesh.positions[i]!)
    expect(Math.min(...xs)).toBeCloseTo(2, 5)
    expect(Math.max(...xs)).toBeCloseTo(10, 5)
  })

  it('does not move Heightfield when only a live BasePlane pose arrives', async () => {
    const { client } = makeFakeClient({ planeAndHeightfield: true })
    renderHook(() => useNodePreviews(client))
    await waitFor(() => expect(useRenderStore.getState().meshLayers['field:heightfield']).toBeDefined())
    const before = useRenderStore.getState().meshLayers['field:heightfield'].mesh.positions.slice()

    const wire = (v: unknown) => [{ path: [0], items: [v] }]
    const { projectLiveOutputs } = await import('../useNodePreviews')
    projectLiveOutputs({
      plane: {
        geometry: wire({
          kind: 'plane',
          origin: [0, 9, 0],
          xAxis: [1, 0, 0],
          yAxis: [0, 1, 0],
          width: 10,
          height: 10,
        }),
      },
    })
    expect(useRenderStore.getState().meshLayers['field:heightfield'].mesh.positions).toEqual(before)
  })

  it('projects a heightfield Geometry mesh without sceneOutput, like a plane', async () => {
    const { client } = makeFakeClient({ geometryMesh: true })
    renderHook(() => useNodePreviews(client))
    await waitFor(() => {
      const mesh = useRenderStore.getState().meshLayers['terrain:geometry']
      expect(mesh).toBeDefined()
      expect(mesh.mesh.indices.length).toBeGreaterThanOrEqual(3)
      expect(useRenderStore.getState().worldPlanes.some((plane) => plane.extent[0] === 10)).toBe(false)
    })
  })

  it('projects a Spline2d Geometry as a sampled curve without waiting for a second Rerun', async () => {
    const { client } = makeFakeClient({ spline: true })
    renderHook(() => useNodePreviews(client))
    await waitFor(() => {
      const curves = useRenderStore.getState().worldCurves
      expect(curves.length).toBe(1)
      expect(curves[0]?.kind).toBe('spline')
      expect(curves[0]?.vertices).toEqual([[40, 0], [18, 48], [40, 30]])
      expect(curves[0]?.strokes[0]?.points.length).toBeGreaterThan(3)
    })
  })

  it('projects a Polyline2d Geometry stroke without waiting for a second Rerun', async () => {
    const { client } = makeFakeClient({ polyline: true })
    renderHook(() => useNodePreviews(client))
    await waitFor(() => {
      const curves = useRenderStore.getState().worldCurves
      expect(curves.length).toBe(1)
      expect(curves[0]).toEqual(expect.objectContaining({
        id: 'line',
        kind: 'polyline',
        strokes: [{ points: [[0, 0], [10, 4]] }],
      }))
    })
  })

  it('projects a Point2d Geometry X mark without waiting for a second Rerun', async () => {
    const { client } = makeFakeClient({ point: true })
    renderHook(() => useNodePreviews(client))
    await waitFor(() => {
      const points = useRenderStore.getState().worldPoints
      expect(points.length).toBe(1)
      expect(points[0]).toEqual(expect.objectContaining({ id: 'site', x: 4, y: 6 }))
    })
  })

  it('projects a BasePlane Geometry overlay without waiting for a second Rerun', async () => {
    const { client } = makeFakeClient({ plane: true })
    renderHook(() => useNodePreviews(client))
    await waitFor(() => {
      const planes = useRenderStore.getState().worldPlanes
      expect(planes.length).toBe(1)
      expect(planes[0]?.extent).toEqual([10, 6])
    })
  })

  it('paints a live Geometry push even before listNodes knows the compiled id', async () => {
    const { client } = makeFakeClient({ plane: true })
    renderHook(() => useNodePreviews(client))
    await waitFor(() => expect(useRenderStore.getState().worldPlanes.length).toBe(1))

    const wire = (v: unknown) => [{ path: [0], items: [v] }]
    const { projectLiveOutputs } = await import('../useNodePreviews')
    projectLiveOutputs({
      'compiled-plane': {
        geometry: wire({ kind: 'plane', origin: [2, 4], width: 8, height: 8, rotationDeg: 0 }),
      },
    })
    const planes = useRenderStore.getState().worldPlanes
    expect(planes.some((plane) => plane.extent[0] === 8 && plane.origin[0] === 2)).toBe(true)
  })

  it('clears the world-plane overlay when the battery is deleted (no Rerun needed)', async () => {
    const { client, applyGraph, deleteNodes } = makeFakeClient({ plane: true })
    renderHook(() => useNodePreviews(client))
    await waitFor(() => expect(useRenderStore.getState().worldPlanes.length).toBe(1))

    deleteNodes(['plane'])
    applyGraph()
    await waitFor(() => expect(useRenderStore.getState().worldPlanes).toEqual([]))
  })

  it('does not let a live output push trap world-plane GC behind a param-drag window', async () => {
    const { client, applyGraph, deleteNodes } = makeFakeClient({ plane: true })
    renderHook(() => useNodePreviews(client))
    await waitFor(() => expect(useRenderStore.getState().worldPlanes.length).toBe(1))

    const wire = (v: unknown) => [{ path: [0], items: [v] }]
    const { projectLiveOutputs } = await import('../useNodePreviews')
    projectLiveOutputs({
      plane: {
        geometry: wire({ kind: 'plane', origin: [0, 0], width: 10, height: 6, rotationDeg: 0 }),
      },
    })
    deleteNodes(['plane'])
    applyGraph()
    await waitFor(() => expect(useRenderStore.getState().worldPlanes).toEqual([]))
  })
})
