import { describe, it, expect, beforeEach } from 'vitest'
import { useRenderStore } from '../store'

describe('render store', () => {
  beforeEach(() => {
    useRenderStore.getState().reset()
    for (const mode of ['default', 'top', 'topBillboard', 'iso', 'free3d', '3DMesh'] as const) {
      useRenderStore.getState().setViewGuideVisible(mode, false)
    }
  })
  it('setLayers builds RendererVoxelLayers keyed nodeId:nodePath with resolved names', () => {
    useRenderStore.getState().setLayers('node1', 'scene_output',
      [{ nodePath: '/A', nodeName: 'A', value: 1, cells: [{ x: 0, y: 0, z: 0 }] }],
      [{ id: 1, name: 'wall', type: 'tile' }])
    const layers = Object.values(useRenderStore.getState().layers)
    expect(layers).toHaveLength(1)
    expect(layers[0].key).toBe('node1:/A')
    expect(layers[0].assetName).toBe('wall')
    expect(layers[0].cells).toHaveLength(1)
  })
  it('setMeshLayer updates when interior vertices change with the same triangle count', () => {
    const s = useRenderStore.getState()
    const indices = [0, 1, 2]
    s.setMeshLayer('hf', 'mesh', 'Terrain', {
      positions: [0, 0, 1, 1, 0, 1, 0, -1, 1],
      indices,
      role: 'terrain',
    })
    s.setMeshLayer('hf', 'mesh', 'Terrain', {
      positions: [0, 0, 1, 1, 0, 4, 0, -1, 1],
      indices,
      role: 'terrain',
    })
    expect(useRenderStore.getState().meshLayers['hf:mesh']?.mesh.positions[5]).toBe(4)
  })

  it('moveGuidePoint updates only that control point (drag preview)', () => {
    const s = useRenderStore.getState()
    s.setGuideLayer('gd', 'points', 'Guide', [
      { x: 6, y: 24, sourceNodeId: 'p0' },
      { x: 18, y: 20, sourceNodeId: 'p1' },
    ])
    s.moveGuidePoint('gd:points', 0, 8, 22)
    const layer = useRenderStore.getState().guideLayers['gd:points']
    expect(layer.points[0]).toEqual({ x: 8, y: 22, sourceNodeId: 'p0' })
    expect(layer.points[1]).toEqual({ x: 18, y: 20, sourceNodeId: 'p1' })
  })

  it('schema layer groups default to visible and toggle independently', () => {
    const s = useRenderStore.getState()
    expect(s.schemaVisible).toEqual({ voxel: true, grid: true, mesh: true, road: true, houses: true, guide: true, ref: true })
    s.setSchemaVisible('voxel', false)
    expect(useRenderStore.getState().schemaVisible).toEqual({ voxel: false, grid: true, mesh: true, road: true, houses: true, guide: true, ref: true })
    s.setSchemaVisible('grid', false)
    expect(useRenderStore.getState().schemaVisible).toEqual({ voxel: false, grid: false, mesh: true, road: true, houses: true, guide: true, ref: true })
    s.reset()
    expect(useRenderStore.getState().schemaVisible).toEqual({ voxel: true, grid: true, mesh: true, road: true, houses: true, guide: true, ref: true })
  })
  it('default viewMode is Default, drawMode is color', () => {
    const s = useRenderStore.getState()
    expect(s.viewMode).toBe('default')
    expect(s.drawMode).toBe('color')
    expect(s.viewport2d).toEqual({ offsetX: 0, offsetY: 0, scale: 0.7 })
  })
  it('stores view-guide visibility independently per render mode', () => {
    const s = useRenderStore.getState()
    s.setViewGuideVisible('topBillboard', true)
    s.setViewGuideVisible('3DMesh', true)
    expect(useRenderStore.getState().viewGuides).toMatchObject({
      default: false,
      top: false,
      topBillboard: true,
      iso: false,
      free3d: false,
      '3DMesh': true,
    })
    s.setViewGuideVisible('topBillboard', false)
    expect(useRenderStore.getState().viewGuides['3DMesh']).toBe(true)
  })
  it('setAliasMetas stores the asset alias pool; reset clears it', () => {
    expect(useRenderStore.getState().aliasMetas).toEqual([])
    useRenderStore.getState().setAliasMetas([{ alias: '[a][b][c][d][grass]', tileType: 'tilemap' }])
    expect(useRenderStore.getState().aliasMetas).toHaveLength(1)
    useRenderStore.getState().reset()
    expect(useRenderStore.getState().aliasMetas).toEqual([])
  })
  // G3: AI/Agent control-channel selection + open-all-sublayers.
  it('setSelectedLayer records the selected layerKey + sub-value', () => {
    expect(useRenderStore.getState().selectedLayerKey).toBeNull()
    useRenderStore.getState().setSelectedLayer('node1:/A', 3)
    expect(useRenderStore.getState().selectedLayerKey).toBe('node1:/A')
    expect(useRenderStore.getState().selectedSubValue).toBe(3)
    useRenderStore.getState().setSelectedLayer(null)
    expect(useRenderStore.getState().selectedLayerKey).toBeNull()
    expect(useRenderStore.getState().selectedSubValue).toBeNull()
  })
  it('openAllSubLayers makes a node\'s layers visible (and all sub-tokens on)', () => {
    useRenderStore.getState().setLayers('node1', 'scene_output',
      [{ nodePath: '/A', nodeName: 'A', value: 1, cells: [{ x: 0, y: 0, z: 0 }] }],
      [{ id: 1, name: 'wall', type: 'tile' }])
    const key = 'node1:/A'
    useRenderStore.getState().setLayerVisible(key, false)
    expect(useRenderStore.getState().layers[key].visible).toBe(false)
    useRenderStore.getState().openAllSubLayers('node1')
    expect(useRenderStore.getState().layers[key].visible).toBe(true)
    // Scoped to nodeId: an unrelated node stays untouched when off.
    useRenderStore.getState().setLayers('node2', 'scene_output',
      [{ nodePath: '/B', nodeName: 'B', value: 1, cells: [{ x: 1, y: 1, z: 0 }] }],
      [{ id: 1, name: 'roof', type: 'tile' }])
    useRenderStore.getState().setLayerVisible('node2:/B', false)
    useRenderStore.getState().openAllSubLayers('node1')
    expect(useRenderStore.getState().layers['node2:/B'].visible).toBe(false)
  })

  it('setLayerVisible toggles a single layer visibility flag', () => {
    useRenderStore.getState().setLayers('node1', 'scene_output',
      [{ nodePath: '/A', nodeName: 'A', value: 1, cells: [{ x: 0, y: 0, z: 0 }] }],
      [{ id: 1, name: 'wall', type: 'tile' }])
    const key = 'node1:/A'
    expect(useRenderStore.getState().layers[key].visible).toBe(true)
    useRenderStore.getState().setLayerVisible(key, false)
    expect(useRenderStore.getState().layers[key].visible).toBe(false)
    // No-op on unknown keys (does not throw / create entries).
    useRenderStore.getState().setLayerVisible('missing:key', false)
    expect(useRenderStore.getState().layers['missing:key']).toBeUndefined()
  })

  // ── Partial-redraw guards (legacy "only the affected region re-renders") ──
  // A graph mutation re-pulls EVERY node's output; re-writing an unchanged layer
  // would churn its reference and force its per-layer subscriber to re-render.
  // The setters keep the existing object reference when the content is identical.
  it('setPreviewLayer keeps the layer reference stable when re-set with identical data', () => {
    const s = useRenderStore.getState()
    s.setPreviewLayer('n1', 'grid', 'Noise', [[1, 0], [0, 1]])
    const first = useRenderStore.getState().previewLayers['n1:grid']
    // Re-set with content-equal but freshly-allocated data (mirrors a refetch).
    s.setPreviewLayer('n1', 'grid', 'Noise', [[1, 0], [0, 1]])
    expect(useRenderStore.getState().previewLayers['n1:grid']).toBe(first)
    // A real content change DOES produce a new reference.
    s.setPreviewLayer('n1', 'grid', 'Noise', [[1, 1], [0, 1]])
    expect(useRenderStore.getState().previewLayers['n1:grid']).not.toBe(first)
  })

  it('setPreviewLayer does not churn OTHER nodes when one node changes', () => {
    const s = useRenderStore.getState()
    s.setPreviewLayer('a', 'grid', 'A', [[1]])
    s.setPreviewLayer('b', 'grid', 'B', [[2]])
    const aRef = useRenderStore.getState().previewLayers['a:grid']
    // Re-pull both (a unchanged, b changed) as a refresh would.
    s.setPreviewLayer('a', 'grid', 'A', [[1]])
    s.setPreviewLayer('b', 'grid', 'B', [[9]])
    // a keeps identity (no re-render); b updates.
    expect(useRenderStore.getState().previewLayers['a:grid']).toBe(aRef)
    expect(useRenderStore.getState().previewLayers['b:grid'].data).toEqual([[9]])
  })

  // ── G2: multi-value (per-token) sub-layers ──
  const multiLayer = () => ({
    nodePath: '/House', nodeName: 'House', value: 1,
    cells: [
      { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 },
    ],
    tokens: ['wall', 'roof'],
    cellsByToken: {
      wall: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
      roof: [{ x: 0, y: 0, z: 1 }],
    },
  })

  it('setLayers builds sub-layer state (subTokens/subVisible) for a multi-token layer', () => {
    useRenderStore.getState().setLayers('n', 'scene_output', [multiLayer()], [{ id: 1, name: 'h', type: 't' }])
    const l = useRenderStore.getState().layers['n:/House']
    expect(l.subTokens).toEqual(['wall', 'roof'])
    expect(l.subVisible).toEqual({ wall: true, roof: true })
    expect(l.cells).toHaveLength(3)
  })

  it('toggleSubLayerVisible hides one token and recomputes the union cells', () => {
    const s = useRenderStore.getState()
    s.setLayers('n', 'scene_output', [multiLayer()], [{ id: 1, name: 'h', type: 't' }])
    s.toggleSubLayerVisible('n:/House', 'roof')
    let l = useRenderStore.getState().layers['n:/House']
    expect(l.subVisible).toEqual({ wall: true, roof: false })
    expect(l.cells).toHaveLength(2) // only wall cells remain
    // Toggling back restores the full union.
    s.toggleSubLayerVisible('n:/House', 'roof')
    l = useRenderStore.getState().layers['n:/House']
    expect(l.subVisible!.roof).toBe(true)
    expect(l.cells).toHaveLength(3)
  })

  it('toggleSubLayerVisible is a no-op on non-multi layers / unknown tokens', () => {
    const s = useRenderStore.getState()
    s.setLayers('n', 'scene_output',
      [{ nodePath: '/A', nodeName: 'A', value: 1, cells: [{ x: 0, y: 0, z: 0 }] }],
      [{ id: 1, name: 'wall', type: 'tile' }])
    const before = useRenderStore.getState().layers
    s.toggleSubLayerVisible('n:/A', 'wall')
    expect(useRenderStore.getState().layers).toBe(before)
  })

  it('setLayers carries forward a hidden parent layer across a re-pull (re-exec must not re-show it)', () => {
    const s = useRenderStore.getState()
    s.setLayers('node1', 'scene_output',
      [{ nodePath: '/A', nodeName: 'A', value: 1, cells: [{ x: 0, y: 0, z: 0 }] }],
      [{ id: 1, name: 'wall', type: 'tile' }])
    const key = 'node1:/A'
    s.setLayerVisible(key, false)
    expect(useRenderStore.getState().layers[key].visible).toBe(false)
    // A re-execution / refresh re-pulls the same output. The user's hidden choice
    // must persist (legacy contract), not snap back to visible.
    s.setLayers('node1', 'scene_output',
      [{ nodePath: '/A', nodeName: 'A', value: 1, cells: [{ x: 0, y: 0, z: 0 }] }],
      [{ id: 1, name: 'wall', type: 'tile' }])
    expect(useRenderStore.getState().layers[key].visible).toBe(false)
  })

  // Wiring up ANOTHER scene_output triggers a full refresh, which calls
  // setLayersVisibleForNode(nodeId, true) for every previewEnabled sink. That
  // node-level show must not resurrect layers the user hid by hand.
  it('setLayersVisibleForNode(true) restores the user\'s per-layer choice, not a blanket show', () => {
    const s = useRenderStore.getState()
    s.setLayers('node1', 'scene_output', [
      { nodePath: '/A', nodeName: 'A', value: 1, cells: [{ x: 0, y: 0, z: 0 }] },
      { nodePath: '/B', nodeName: 'B', value: 2, cells: [{ x: 1, y: 0, z: 0 }] },
    ], [{ id: 1, name: 'wall', type: 'tile' }, { id: 2, name: 'roof', type: 'tile' }])
    s.setLayerVisible('node1:/A', false)

    s.setLayersVisibleForNode('node1', true)
    expect(useRenderStore.getState().layers['node1:/A'].visible).toBe(false)
    // Untouched layers still follow the node-level flag.
    expect(useRenderStore.getState().layers['node1:/B'].visible).toBe(true)
  })

  it('setLayersVisibleForNode(false) still hides everything (preview toggle off)', () => {
    const s = useRenderStore.getState()
    s.setLayers('node1', 'scene_output',
      [{ nodePath: '/A', nodeName: 'A', value: 1, cells: [{ x: 0, y: 0, z: 0 }] }],
      [{ id: 1, name: 'wall', type: 'tile' }])
    s.setLayerVisible('node1:/A', true)
    s.setLayersVisibleForNode('node1', false)
    expect(useRenderStore.getState().layers['node1:/A'].visible).toBe(false)
    // Re-enabling preview restores the user's explicit `true`.
    s.setLayersVisibleForNode('node1', true)
    expect(useRenderStore.getState().layers['node1:/A'].visible).toBe(true)
  })

  it('marks layers switched off by the node preview gate, and clears it on re-enable', () => {
    const s = useRenderStore.getState()
    s.setLayers('node1', 'scene_output',
      [{ nodePath: '/A', nodeName: 'A', value: 1, cells: [{ x: 0, y: 0, z: 0 }] }],
      [{ id: 1, name: 'wall', type: 'tile' }])
    expect(useRenderStore.getState().layers['node1:/A'].nodeDisabled).toBeFalsy()

    s.setLayersVisibleForNode('node1', false)
    expect(useRenderStore.getState().layers['node1:/A'].nodeDisabled).toBe(true)
    // Survives a re-pull so the panel keeps rendering it as gated, not hidden.
    s.setLayers('node1', 'scene_output',
      [{ nodePath: '/A', nodeName: 'A', value: 1, cells: [{ x: 0, y: 0, z: 0 }] }],
      [{ id: 1, name: 'wall', type: 'tile' }])
    expect(useRenderStore.getState().layers['node1:/A'].nodeDisabled).toBe(true)

    s.setLayersVisibleForNode('node1', true)
    expect(useRenderStore.getState().layers['node1:/A'].nodeDisabled).toBe(false)
  })

  it('drops a deleted layer\'s pinned visibility so a re-created key starts visible', () => {
    const s = useRenderStore.getState()
    s.setLayers('node1', 'scene_output',
      [{ nodePath: '/A', nodeName: 'A', value: 1, cells: [{ x: 0, y: 0, z: 0 }] }],
      [{ id: 1, name: 'wall', type: 'tile' }])
    s.setLayerVisible('node1:/A', false)
    s.retainVoxelNodes(new Set())
    expect(useRenderStore.getState().layers['node1:/A']).toBeUndefined()

    s.setLayers('node1', 'scene_output',
      [{ nodePath: '/A', nodeName: 'A', value: 1, cells: [{ x: 0, y: 0, z: 0 }] }],
      [{ id: 1, name: 'wall', type: 'tile' }])
    s.setLayersVisibleForNode('node1', true)
    expect(useRenderStore.getState().layers['node1:/A'].visible).toBe(true)
  })

  it('setLayers carries forward prior sub-layer visibility across a re-pull', () => {
    const s = useRenderStore.getState()
    s.setLayers('n', 'scene_output', [multiLayer()], [{ id: 1, name: 'h', type: 't' }])
    s.toggleSubLayerVisible('n:/House', 'wall') // hide wall
    // Re-pull (same projection): the user's hidden-wall choice must persist.
    s.setLayers('n', 'scene_output', [multiLayer()], [{ id: 1, name: 'h', type: 't' }])
    const l = useRenderStore.getState().layers['n:/House']
    expect(l.subVisible).toEqual({ wall: false, roof: true })
    expect(l.cells).toHaveLength(1) // only roof
  })

  it('openAllSubLayers restores every hidden sub-token and the full cells', () => {
    const s = useRenderStore.getState()
    s.setLayers('n', 'scene_output', [multiLayer()], [{ id: 1, name: 'h', type: 't' }])
    s.toggleSubLayerVisible('n:/House', 'wall')
    s.toggleSubLayerVisible('n:/House', 'roof')
    expect(useRenderStore.getState().layers['n:/House'].cells).toHaveLength(0)
    s.openAllSubLayers('n')
    const l = useRenderStore.getState().layers['n:/House']
    expect(l.subVisible).toEqual({ wall: true, roof: true })
    expect(l.cells).toHaveLength(3)
  })

  it('setLayers keeps the whole store state stable when re-set with identical voxels', () => {
    const s = useRenderStore.getState()
    const call = () => s.setLayers('node1', 'scene_output',
      [{ nodePath: '/A', nodeName: 'A', value: 1, cells: [{ x: 0, y: 0, z: 0 }] }],
      [{ id: 1, name: 'wall', type: 'tile' }])
    call()
    const stateAfterFirst = useRenderStore.getState().layers
    const entry = stateAfterFirst['node1:/A']
    call() // identical re-pull → no-op
    expect(useRenderStore.getState().layers).toBe(stateAfterFirst)
    expect(useRenderStore.getState().layers['node1:/A']).toBe(entry)
    // A changed cell set produces a new entry.
    s.setLayers('node1', 'scene_output',
      [{ nodePath: '/A', nodeName: 'A', value: 1, cells: [{ x: 1, y: 0, z: 0 }] }],
      [{ id: 1, name: 'wall', type: 'tile' }])
    expect(useRenderStore.getState().layers['node1:/A']).not.toBe(entry)
  })

  // ── Baked (graph-independent) editable layers ──
  const bakedDTO = () => [
    { nodePath: '/Floor', nodeName: 'Floor', value: 1, assetName: 'grass', assetType: 'tile', cells: [{ x: 0, y: 0, z: 0 }] },
  ]

  it('setBakedLayers populates the bakedLayers bucket (not layers), keyed baked:nodePath', () => {
    const s = useRenderStore.getState()
    s.setBakedLayers(bakedDTO())
    const baked = useRenderStore.getState().bakedLayers
    expect(Object.keys(baked)).toEqual(['baked:/Floor'])
    expect(baked['baked:/Floor'].assetName).toBe('grass')
    expect(baked['baked:/Floor'].cells).toHaveLength(1)
    // It must NOT leak into the graph `layers` bucket.
    expect(useRenderStore.getState().layers['baked:/Floor']).toBeUndefined()
  })

  it('the graph-refresh GC (retainVoxelNodes) never evicts baked layers', () => {
    const s = useRenderStore.getState()
    s.setBakedLayers(bakedDTO())
    // Simulate a graph refresh GC that keeps NO graph nodes.
    s.retainVoxelNodes(new Set())
    expect(useRenderStore.getState().bakedLayers['baked:/Floor']).toBeDefined()
  })

  it('setBakedLayers carries forward a hidden baked layer across a refetch', () => {
    const s = useRenderStore.getState()
    s.setBakedLayers(bakedDTO())
    s.setBakedLayerVisible('baked:/Floor', false)
    s.setBakedLayers(bakedDTO()) // refetch
    expect(useRenderStore.getState().bakedLayers['baked:/Floor'].visible).toBe(false)
  })

  it('setBakedLayers keeps baked layer references stable on identical refetches', () => {
    const s = useRenderStore.getState()
    s.setBakedLayers(bakedDTO())
    const firstBucket = useRenderStore.getState().bakedLayers
    const firstLayer = firstBucket['baked:/Floor']

    s.setBakedLayers(bakedDTO())

    expect(useRenderStore.getState().bakedLayers).toBe(firstBucket)
    expect(useRenderStore.getState().bakedLayers['baked:/Floor']).toBe(firstLayer)

    s.setBakedLayers([
      { nodePath: '/Floor', nodeName: 'Floor', value: 1, assetName: 'grass', assetType: 'tile', cells: [{ x: 1, y: 0, z: 0 }] },
    ])
    expect(useRenderStore.getState().bakedLayers['baked:/Floor']).not.toBe(firstLayer)
  })

  it('setBakedLayers does not overwrite optimistic local edits with a stale same-version refetch', () => {
    const s = useRenderStore.getState()
    s.setBakedLayers([
      { nodePath: '/Floor', nodeName: 'Floor', value: 1, assetName: 'grass', assetType: 'tile', version: 1, cells: [] },
    ])
    s.paintBakedCells('baked:/Floor', [
      { x: 0, y: 0, z: 0, token: 'grass' },
      { x: 1, y: 0, z: 0, token: 'grass' },
    ])

    s.setBakedLayers([
      { nodePath: '/Floor', nodeName: 'Floor', value: 1, assetName: 'grass', assetType: 'tile', version: 1, cells: [] },
    ])

    expect(useRenderStore.getState().bakedLayers['baked:/Floor'].cells).toEqual([
      { x: 0, y: 0, z: 0, token: 'grass' },
      { x: 1, y: 0, z: 0, token: 'grass' },
    ])

    s.setBakedLayers([
      {
        nodePath: '/Floor',
        nodeName: 'Floor',
        value: 1,
        assetName: 'grass',
        assetType: 'tile',
        version: 1,
        cells: [
          { x: 0, y: 0, z: 0, token: 'grass' },
          { x: 1, y: 0, z: 0, token: 'grass' },
        ],
      },
    ])
    s.setBakedLayers([
      { nodePath: '/Floor', nodeName: 'Floor', value: 1, assetName: 'grass', assetType: 'tile', version: 2, cells: [{ x: 2, y: 0, z: 0, token: 'grass' }] },
    ])
    expect(useRenderStore.getState().bakedLayers['baked:/Floor'].cells).toEqual([
      { x: 2, y: 0, z: 0, token: 'grass' },
    ])
  })

  it('paintBakedCells overwrites the active layer cells; editMode + active key toggle', () => {
    const s = useRenderStore.getState()
    s.setBakedLayers(bakedDTO())
    s.setActiveBakedLayer('baked:/Floor')
    s.setEditMode(true)
    expect(useRenderStore.getState().editMode).toBe(true)
    expect(useRenderStore.getState().activeBakedLayerKey).toBe('baked:/Floor')
    s.paintBakedCells('baked:/Floor', [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }])
    expect(useRenderStore.getState().bakedLayers['baked:/Floor'].cells).toHaveLength(2)
    // reset clears baked state too.
    s.reset()
    expect(useRenderStore.getState().bakedLayers).toEqual({})
    expect(useRenderStore.getState().editMode).toBe(false)
    expect(useRenderStore.getState().activeBakedLayerKey).toBeNull()
  })

  it('paintBakedCells stamps a STRICTLY-INCREASING version even for same-millisecond paints (dead-stop guard)', async () => {
    // A fast stroke can fire two paints within the same wall-clock millisecond.
    // If both got the same updatedAt (old Date.now() behaviour), the incremental-
    // bake effect's content signature (`${layerIdx}@${version}`) wouldn't change
    // between them and the 2nd paint's cells would be committed but never baked
    // (a visual dead-stop). The version stamp must therefore be strictly monotonic.
    const { vi } = await import('vitest')
    const { consumeLastPaintDelta } = await import('../store')
    const s = useRenderStore.getState()
    s.setBakedLayers(bakedDTO())
    const spy = vi.spyOn(Date, 'now').mockReturnValue(5_000_000)
    try {
      s.paintBakedCells('baked:/Floor', (prev) => [...prev, { x: 1, y: 0, z: 0 }])
      const v1 = useRenderStore.getState().bakedLayers['baked:/Floor'].updatedAt
      const d1 = consumeLastPaintDelta()
      s.paintBakedCells('baked:/Floor', (prev) => [...prev, { x: 2, y: 0, z: 0 }])
      const v2 = useRenderStore.getState().bakedLayers['baked:/Floor'].updatedAt
      const d2 = consumeLastPaintDelta()
      expect(v2).toBeGreaterThan(v1) // distinct version despite same Date.now()
      expect(d1?.version).toBe(v1)
      expect(d2?.version).toBe(v2)
    } finally {
      spy.mockRestore()
    }
  })

  it('does not silently discard an unconsumed paint delta when a DIFFERENT key is painted (cross-key dead-stop guard)', async () => {
    // The module-singleton lastPaintDelta is keyed. If key A's delta is unconsumed
    // when key B is painted, blindly overwriting it would drop A's already-committed
    // cells from the incremental bake (committed-but-never-baked = visually missing).
    // The hardening forces the next delta onto the full-rebuild fallback (pureAppend:
    // false) so BOTH layers reconcile rather than silently losing A.
    const { consumeLastPaintDelta } = await import('../store')
    const s = useRenderStore.getState()
    s.setBakedLayers([
      { nodePath: '/Floor', nodeName: 'Floor', value: 1, assetName: 'grass', assetType: 'tile', cells: [{ x: 0, y: 0, z: 0 }] },
      { nodePath: '/Wall', nodeName: 'Wall', value: 2, assetName: 'brick', assetType: 'tile', cells: [{ x: 0, y: 0, z: 0 }] },
    ])
    s.paintBakedCells('baked:/Floor', (prev) => [...prev, { x: 1, y: 0, z: 0 }])
    // Do NOT consume A's delta; paint a different key B.
    s.paintBakedCells('baked:/Wall', (prev) => [...prev, { x: 5, y: 0, z: 0 }])
    const d = consumeLastPaintDelta()
    // The overwriting delta must NOT claim to be a pure append (which would let the
    // fast path bake only B and silently skip A) — it degrades to the full rebuild.
    expect(d?.pureAppend).toBe(false)
  })

  it('setVoxelSelection stores/clears the SELECT-tool highlight without churning layer buckets', () => {
    const s = useRenderStore.getState()
    s.setBakedLayers(bakedDTO())
    s.setLayers('n1', 'scene_output',
      [{ nodePath: '/A', nodeName: 'A', value: 1, cells: [{ x: 0, y: 0, z: 0 }] }],
      [{ id: 1, name: 'wall', type: 'tile' }])
    const bakedBefore = useRenderStore.getState().bakedLayers
    const layersBefore = useRenderStore.getState().layers
    expect(useRenderStore.getState().voxelSelection).toBeNull()
    s.setVoxelSelection({ layerKey: 'baked:/Floor', voxels: [{ x: 0, y: 0, z: 0 }] })
    expect(useRenderStore.getState().voxelSelection).toEqual({ layerKey: 'baked:/Floor', voxels: [{ x: 0, y: 0, z: 0 }] })
    // Selecting is a query — it must NOT re-allocate (re-bake) the layer buckets.
    expect(useRenderStore.getState().bakedLayers).toBe(bakedBefore)
    expect(useRenderStore.getState().layers).toBe(layersBefore)
    s.setVoxelSelection(null)
    expect(useRenderStore.getState().voxelSelection).toBeNull()
  })

  it('a SELECT publish (setSelectedLayer + setVoxelSelection) notifies subscribers without re-baking layers', () => {
    const s = useRenderStore.getState()
    s.setBakedLayers(bakedDTO())
    const bakedBefore = useRenderStore.getState().bakedLayers
    let bakedChanged = false
    const unsub = useRenderStore.subscribe((state) => {
      if (state.bakedLayers !== bakedBefore) bakedChanged = true
    })
    s.setSelectedLayer('baked:/Floor')
    s.setVoxelSelection({ layerKey: 'baked:/Floor', voxels: [{ x: 0, y: 0, z: 0 }] })
    unsub()
    expect(useRenderStore.getState().selectedLayerKey).toBe('baked:/Floor')
    expect(useRenderStore.getState().voxelSelection?.layerKey).toBe('baked:/Floor')
    // The heavy layer bucket reference never changed → no master/compose re-bake.
    expect(bakedChanged).toBe(false)
  })

  it('reset clears voxelSelection', () => {
    const s = useRenderStore.getState()
    s.setVoxelSelection({ layerKey: 'baked:/Floor', voxels: [{ x: 0, y: 0, z: 0 }] })
    s.reset()
    expect(useRenderStore.getState().voxelSelection).toBeNull()
  })

  it('brush/edit overlay state: setters + dedup + reset', () => {
    const s = useRenderStore.getState()
    expect(useRenderStore.getState().brushMode).toBe('free')
    s.setBrushMode('box')
    expect(useRenderStore.getState().brushMode).toBe('box')
    s.setEditZ(2.8)
    expect(useRenderStore.getState().editZ).toBe(2)

    s.setEditHoverCell({ x: 2, y: 3, z: 2 })
    const ref = useRenderStore.getState().editHoverCell
    s.setEditHoverCell({ x: 2, y: 3, z: 2 }) // same coords → keep the same reference
    expect(useRenderStore.getState().editHoverCell).toBe(ref)
    s.setEditHoverCell({ x: 4, y: 5, z: 2 })
    expect(useRenderStore.getState().editHoverCell).toEqual({ x: 4, y: 5, z: 2 })

    s.setEditBox({ x0: 0, y0: 0, x1: 2, y1: 2, z: 2 })
    expect(useRenderStore.getState().editBox).toEqual({ x0: 0, y0: 0, x1: 2, y1: 2, z: 2 })
    const boxRef = useRenderStore.getState().editBox
    s.setEditBox({ x0: 0, y0: 0, x1: 2, y1: 2, z: 2 }) // same coords → keep the same reference
    expect(useRenderStore.getState().editBox).toBe(boxRef)
    s.setActivePaintTarget('baked:/Floor/layer-1')
    expect(useRenderStore.getState().activePaintTargetKey).toBe('baked:/Floor/layer-1')

    s.reset()
    expect(useRenderStore.getState().brushMode).toBe('free')
    expect(useRenderStore.getState().editZ).toBe(0)
    expect(useRenderStore.getState().editHoverCell).toBeNull()
    expect(useRenderStore.getState().editBox).toBeNull()
    expect(useRenderStore.getState().activePaintTargetKey).toBeNull()
  })
})
