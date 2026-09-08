import { describe, expect, it } from 'vitest'
import { drawablesForSchema, layerKeysForSceneNodePointers, projectKeysToDisplayIndex } from '../displayIndex'

describe('projectKeysToDisplayIndex', () => {
  it('keeps voxel and grid as separate schemas instead of folding grids into voxels', () => {
    const index = projectKeysToDisplayIndex({
      voxelKeys: ['n1:/hill'],
      bakedKeys: ['baked:/paint'],
      gridKeys: ['noise:grid', 'mask:grid'],
    })
    expect(drawablesForSchema(index, 'voxel').map((d) => d.layerKey)).toEqual([
      'n1:/hill',
      'baked:/paint',
    ])
    expect(drawablesForSchema(index, 'grid').map((d) => d.layerKey)).toEqual([
      'noise:grid',
      'mask:grid',
    ])
    expect(drawablesForSchema(index, 'mesh')).toEqual([])
  })

  it('keeps mesh as a third schema for Terrain', () => {
    const index = projectKeysToDisplayIndex({
      voxelKeys: ['n1:/hill'],
      bakedKeys: [],
      gridKeys: [],
      meshKeys: ['hf:mesh'],
    })
    expect(drawablesForSchema(index, 'mesh').map((d) => d.layerKey)).toEqual(['hf:mesh'])
    expect(index.drawables.every((d) => d.schema === 'voxel' || d.schema === 'grid' || d.schema === 'mesh')).toBe(true)
  })

  it('keeps road mesh as its own schema so Terrain can hide independently', () => {
    const index = projectKeysToDisplayIndex({
      voxelKeys: [],
      bakedKeys: [],
      gridKeys: [],
      meshItems: [
        { key: 'hf:mesh', schema: 'mesh' },
        { key: 'rd:mesh', schema: 'road' },
      ],
    })
    expect(drawablesForSchema(index, 'mesh').map((d) => d.layerKey)).toEqual(['hf:mesh'])
    expect(drawablesForSchema(index, 'road').map((d) => d.layerKey)).toEqual(['rd:mesh'])
  })

  it('keeps house boxes as their own schema so Terrain / Road can hide independently', () => {
    const index = projectKeysToDisplayIndex({
      voxelKeys: [],
      bakedKeys: [],
      gridKeys: [],
      meshItems: [
        { key: 'hf:mesh', schema: 'mesh' },
        { key: 'rd:mesh', schema: 'road' },
        { key: 'hx:mesh', schema: 'houses' },
      ],
    })
    expect(drawablesForSchema(index, 'houses').map((d) => d.layerKey)).toEqual(['hx:mesh'])
    expect(drawablesForSchema(index, 'mesh').map((d) => d.layerKey)).toEqual(['hf:mesh'])
    expect(drawablesForSchema(index, 'road').map((d) => d.layerKey)).toEqual(['rd:mesh'])
  })

  it('keeps guide keys as their own schema so Road can hide independently', () => {
    const index = projectKeysToDisplayIndex({
      voxelKeys: [],
      bakedKeys: [],
      gridKeys: [],
      meshItems: [{ key: 'rd:mesh', schema: 'road' }],
      guideKeys: ['gd:points'],
    })
    expect(drawablesForSchema(index, 'guide').map((d) => d.layerKey)).toEqual(['gd:points'])
    expect(drawablesForSchema(index, 'road').map((d) => d.layerKey)).toEqual(['rd:mesh'])
  })

  it('stays empty when the store buckets are empty (old projects still get a Default viewport)', () => {
    const index = projectKeysToDisplayIndex({ voxelKeys: [], bakedKeys: [], gridKeys: [] })
    expect(index.drawables).toEqual([])
  })

  it('resolves scene ids and uses graphIndex/path to disambiguate duplicate ids', () => {
    const index = {
      drawables: [
        { id: 'a', schema: 'mesh' as const, source: 'mesh' as const, layerKey: 'mesh:a', path: '/Terrain', label: 'Terrain', sceneNodeId: 'shared', graphIndex: 0 },
        { id: 'b', schema: 'road' as const, source: 'mesh' as const, layerKey: 'mesh:b', path: '/Road', label: 'Road', sceneNodeId: 'shared', graphIndex: 1 },
      ],
    }
    expect(layerKeysForSceneNodePointers(index, [
      { id: 'shared', path: '/Road', graphIndex: 1 },
    ])).toEqual(['mesh:b'])
    expect(layerKeysForSceneNodePointers(index, [
      { id: 'missing', path: '/Terrain', graphIndex: 0 },
    ])).toEqual(['mesh:a'])
    expect(layerKeysForSceneNodePointers(index, [{ id: 'missing' }])).toEqual([])
  })

  it('projectSceneGraphToDisplayIndex walks scene graph to extract drawables with proper paths and schemas', async () => {
    const { addChildren, emptyScene, ROOT_ID } = await import('../../../../../vendor/shared/types/scene/graph.js')
    const { meshContent, pointsContent } = await import('../../../../../vendor/shared/types/scene/content.js')
    const { projectSceneGraphToDisplayIndex } = await import('../displayIndex.js')

    const base = emptyScene()
    const { graph: g1 } = addChildren(base.graph, ROOT_ID, [
      { name: 'Hill', schema: 'voxel' },
      { name: 'Lake', schema: 'mesh', content: meshContent({ positions: [0, 0, 0], indices: [0, 1, 2], role: 'terrain' }) },
      { name: 'Pier', schema: 'mesh', content: meshContent({ positions: [0, 0, 0], indices: [0, 1, 2], role: 'road' }) },
      { name: 'Markers', schema: 'points', content: pointsContent([[0, 0], [10, 10]]) },
    ])

    const drawables = projectSceneGraphToDisplayIndex(g1, ROOT_ID, {
      meshLayers: {
        'n_road:mesh': {
          key: 'n_road:mesh',
          nodeId: 'n_road',
          portName: 'mesh',
          nodeName: 'Road',
          mesh: { positions: [0, 0, 0], indices: [0, 1, 2], role: 'road' },
          triangleCount: 1,
          visible: true,
          updatedAt: Date.now(),
        },
      },
    })

    expect(drawables.map((d) => ({ path: d.path, schema: d.schema, label: d.label }))).toEqual([
      { path: '/Hill', schema: 'voxel', label: 'Hill' },
      { path: '/Lake', schema: 'mesh', label: 'Lake' },
      { path: '/Pier', schema: 'road', label: 'Pier' },
      { path: '/Markers', schema: 'guide', label: 'Markers' },
    ])
  })

  it('keeps nested control points under their host mesh path', async () => {
    const { addChildren, emptyScene, ROOT_ID } = await import('../../../../../vendor/shared/types/scene/graph.js')
    const { meshContent, pointsContent } = await import('../../../../../vendor/shared/types/scene/content.js')
    const { projectSceneGraphToDisplayIndex } = await import('../displayIndex.js')

    const base = emptyScene()
    const { graph: withTerrain, ids } = addChildren(base.graph, ROOT_ID, [
      { name: 'Terrain', schema: 'mesh', content: meshContent({ positions: [0, 0, 0], indices: [0, 1, 2] }) },
    ])
    const { graph: withRiver, ids: riverIds } = addChildren(withTerrain, ids[0]!, [
      { name: 'River', schema: 'mesh', content: meshContent({ positions: [0, 0, 0], indices: [0, 1, 2] }) },
    ])
    const { graph } = addChildren(withRiver, riverIds[0]!, [
      { name: 'RiverPath', schema: 'points', content: pointsContent([[0, 52], [22, 56]]) },
    ])
    const drawables = projectSceneGraphToDisplayIndex(graph, ids[0]!, {
      meshLayers: {
        'hf:mesh': {
          key: 'hf:mesh',
          nodeId: 'n-terrain',
          portName: 'mesh',
          nodeName: 'Terrain',
          mesh: { positions: [0, 0, 0], indices: [0, 1, 2] },
          visible: true,
          updatedAt: 1,
          triangleCount: 1,
        },
        'rv:mesh': {
          key: 'rv:mesh',
          nodeId: 'n-river',
          portName: 'mesh',
          nodeName: 'River',
          mesh: { positions: [0, 0, 0], indices: [0, 1, 2] },
          visible: true,
          updatedAt: 1,
          triangleCount: 1,
        },
      },
      guideLayers: {
        'rp:points': {
          key: 'rp:points',
          nodeId: 'n-path',
          portName: 'points',
          nodeName: 'RiverPath',
          points: [{ x: 0, y: 52 }, { x: 22, y: 56 }],
          style: 'polyline',
          visible: true,
          updatedAt: 1,
        },
      },
    })
    expect(drawables.map((d) => ({ path: d.path, schema: d.schema, label: d.label }))).toEqual([
      { path: '/Terrain', schema: 'mesh', label: 'Terrain' },
      { path: '/Terrain/River', schema: 'mesh', label: 'River' },
      { path: '/Terrain/River/RiverPath', schema: 'guide', label: 'RiverPath' },
    ])
  })

  it('binds nested same-named Hub guides by path instead of collapsing to one pin', async () => {
    const { addChildren, emptyScene, ROOT_ID } = await import('../../../../../vendor/shared/types/scene/graph.js')
    const { meshContent, pointsContent } = await import('../../../../../vendor/shared/types/scene/content.js')
    const { mergeUnclaimedStoreLayers, projectSceneGraphToDisplayIndex } = await import('../displayIndex.js')

    const base = emptyScene()
    const { graph: withCity, ids } = addChildren(base.graph, ROOT_ID, [
      { name: 'Harbor', schema: 'mesh', content: meshContent({ positions: [0, 0, 0], indices: [0, 1, 2], role: 'houses' }) },
      { name: 'SuburbWest', schema: 'mesh', content: meshContent({ positions: [0, 0, 0], indices: [0, 1, 2], role: 'houses' }) },
    ])
    const { graph: withHarborHub } = addChildren(withCity, ids[0]!, [
      { name: 'Hub', schema: 'points', content: pointsContent([[10, 20]]) },
    ])
    const { graph } = addChildren(withHarborHub, ids[1]!, [
      { name: 'Hub', schema: 'points', content: pointsContent([[80, 90]]) },
    ])
    const guideLayers = {
      'sink:points:/Harbor/Hub': {
        key: 'sink:points:/Harbor/Hub',
        nodeId: 'sink',
        portName: 'points:/Harbor/Hub',
        nodeName: 'Hub',
        points: [{ x: 10, y: 20 }],
        style: 'points' as const,
        visible: true,
        updatedAt: 1,
      },
      'sink:points:/SuburbWest/Hub': {
        key: 'sink:points:/SuburbWest/Hub',
        nodeId: 'sink',
        portName: 'points:/SuburbWest/Hub',
        nodeName: 'Hub',
        points: [{ x: 80, y: 90 }],
        style: 'points' as const,
        visible: true,
        updatedAt: 1,
      },
      'n_hub_raw:points': {
        key: 'n_hub_raw:points',
        nodeId: 'n_hub_raw',
        portName: 'points',
        nodeName: 'Hub',
        points: [{ x: 10, y: 20 }],
        style: 'points' as const,
        visible: true,
        updatedAt: 1,
      },
    }
    const walked = projectSceneGraphToDisplayIndex(graph, ROOT_ID, { guideLayers })
    const hubs = walked.filter((d) => d.schema === 'guide')
    expect(hubs.map((d) => d.layerKey)).toEqual([
      'sink:points:/Harbor/Hub',
      'sink:points:/SuburbWest/Hub',
    ])
    const merged = mergeUnclaimedStoreLayers(walked, {}, guideLayers)
    expect(merged.filter((d) => d.schema === 'guide').map((d) => d.layerKey)).toEqual([
      'sink:points:/Harbor/Hub',
      'sink:points:/SuburbWest/Hub',
    ])
  })

  it('binds Terrain to an unnamed unroled heightfield layer (mesh_to_node name miss)', async () => {
    const { addChildren, emptyScene, ROOT_ID } = await import('../../../../../vendor/shared/types/scene/graph.js')
    const { meshContent } = await import('../../../../../vendor/shared/types/scene/content.js')
    const { projectSceneGraphToDisplayIndex } = await import('../displayIndex.js')

    const base = emptyScene()
    const { graph: withTerrain, ids } = addChildren(base.graph, ROOT_ID, [
      { name: 'Terrain', schema: 'mesh', content: meshContent({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] }) },
    ])
    const { graph } = addChildren(withTerrain, ids[0]!, [
      { name: 'Road', schema: 'mesh', content: meshContent({ positions: [0, 0, 0], indices: [0, 1, 2], role: 'road' }) },
    ])
    const meshLayers = {
      'node_hf:mesh': {
        key: 'node_hf:mesh',
        nodeId: 'node_hf',
        portName: 'mesh',
        nodeName: 'node_hf',
        mesh: { positions: [0, 0, 0, 2, 0, 0, 0, 2, 0], indices: [0, 1, 2] },
        triangleCount: 1,
        visible: true,
        updatedAt: 1,
      },
      'node_rd:mesh': {
        key: 'node_rd:mesh',
        nodeId: 'node_rd',
        portName: 'mesh',
        nodeName: 'node_rd',
        mesh: { positions: [0, 0, 0], indices: [0, 1, 2], role: 'road' as const },
        triangleCount: 1,
        visible: true,
        updatedAt: 1,
      },
    }
    // Valley compose focuses the Terrain prim, not ROOT — same as live scene_output.
    const drawables = projectSceneGraphToDisplayIndex(graph, ids[0]!, { meshLayers })

    expect(drawables.map((d) => ({ label: d.label, schema: d.schema, layerKey: d.layerKey }))).toEqual([
      { label: 'Terrain', schema: 'mesh', layerKey: 'node_hf:mesh' },
      { label: 'Road', schema: 'road', layerKey: 'node_rd:mesh' },
    ])
  })

  it('does not bind an unroled Road/Houses prim to the leftover terrain layer', async () => {
    const { addChildren, emptyScene, ROOT_ID } = await import('../../../../../vendor/shared/types/scene/graph.js')
    const { meshContent } = await import('../../../../../vendor/shared/types/scene/content.js')
    const { projectSceneGraphToDisplayIndex } = await import('../displayIndex.js')

    const base = emptyScene()
    const { graph: withTerrain, ids } = addChildren(base.graph, ROOT_ID, [
      { name: 'Terrain', schema: 'mesh', content: meshContent({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] }) },
    ])
    const { graph } = addChildren(withTerrain, ids[0]!, [
      { name: 'Road', schema: 'mesh', content: meshContent({ positions: [0, 0, 0], indices: [0, 1, 2] }) },
      { name: 'Houses', schema: 'mesh', content: meshContent({ positions: [0, 0, 0], indices: [0, 1, 2] }) },
    ])
    const meshLayers = {
      'node_hf:mesh': {
        key: 'node_hf:mesh',
        nodeId: 'node_hf',
        portName: 'mesh',
        nodeName: 'node_hf',
        mesh: { positions: [0, 0, 0, 2, 0, 0, 0, 2, 0], indices: [0, 1, 2] },
        triangleCount: 1,
        visible: true,
        updatedAt: 1,
      },
      'node_rd:mesh': {
        key: 'node_rd:mesh',
        nodeId: 'node_rd',
        portName: 'mesh',
        nodeName: 'node_rd',
        mesh: { positions: [9, 0, 0], indices: [0, 1, 2], role: 'road' as const },
        triangleCount: 1,
        visible: true,
        updatedAt: 1,
      },
      'node_hx:mesh': {
        key: 'node_hx:mesh',
        nodeId: 'node_hx',
        portName: 'mesh',
        nodeName: 'node_hx',
        mesh: { positions: [8, 0, 0], indices: [0, 1, 2], role: 'houses' as const },
        triangleCount: 1,
        visible: true,
        updatedAt: 1,
      },
    }
    const { mergeUnclaimedStoreLayers } = await import('../displayIndex.js')
    const walked = projectSceneGraphToDisplayIndex(graph, ids[0]!, { meshLayers })
    expect(walked.find((d) => d.label === 'Terrain')?.layerKey).toBe('node_hf:mesh')
    expect(walked.find((d) => d.label === 'Road')?.layerKey).not.toBe('node_hf:mesh')
    expect(walked.find((d) => d.label === 'Houses')?.layerKey).not.toBe('node_hf:mesh')

    const merged = mergeUnclaimedStoreLayers(walked, meshLayers)
    expect(merged.find((d) => d.schema === 'road')?.layerKey).toBe('node_rd:mesh')
    expect(merged.find((d) => d.schema === 'houses')?.layerKey).toBe('node_hx:mesh')
    expect(merged.filter((d) => d.layerKey === 'node_hf:mesh')).toHaveLength(1)
  })

  it('does not bind Terrain to a 12-triangle house when a large heightfield port exists', async () => {
    const { addChildren, emptyScene, ROOT_ID } = await import('../../../../../vendor/shared/types/scene/graph.js')
    const { meshContent } = await import('../../../../../vendor/shared/types/scene/content.js')
    const { mergeUnclaimedStoreLayers, projectSceneGraphToDisplayIndex } = await import('../displayIndex.js')

    const box = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] }
    const base = emptyScene()
    const { graph: withRoot, ids } = addChildren(base.graph, ROOT_ID, [
      { name: 'Continent', schema: 'scope' },
    ])
    const { graph: withTerrain } = addChildren(withRoot, ids[0]!, [
      { name: 'Terrain', schema: 'mesh', content: meshContent(box) },
    ])
    const { graph } = addChildren(withTerrain, ids[0]!, [
      { name: 'bldg-0', schema: 'mesh', content: meshContent(box) },
    ])
    const meshLayers = {
      'sink:mesh:/Continent/bldg-0': {
        key: 'sink:mesh:/Continent/bldg-0',
        nodeId: 'sink',
        portName: 'mesh:/Continent/bldg-0',
        nodeName: 'bldg-0',
        mesh: box,
        triangleCount: 12,
        visible: true,
        updatedAt: 1,
      },
      'hf:mesh': {
        key: 'hf:mesh',
        nodeId: 'hf',
        portName: 'mesh',
        nodeName: 'node_hf',
        mesh: { positions: [0, 0, 0, 2000, 0, 0, 0, 2000, 0], indices: [0, 1, 2] },
        triangleCount: 124990,
        visible: true,
        updatedAt: 1,
      },
    }
    const walked = projectSceneGraphToDisplayIndex(graph, ids[0]!, { meshLayers })
    expect(walked.find((d) => d.label === 'Terrain')?.layerKey).toBe('hf:mesh')
    const merged = mergeUnclaimedStoreLayers(walked, meshLayers)
    expect(merged.find((d) => d.label === 'Terrain')?.layerKey).toBe('hf:mesh')
    expect(merged.some((d) => d.layerKey === 'hf:mesh')).toBe(true)
  })

  it('keeps a Ref drawable when the referenced module has no mesh', async () => {
    const { addChildren, emptyScene, ROOT_ID } = await import('../../../../../vendor/shared/types/scene/graph.js')
    const { refContent } = await import('../../../../../vendor/shared/types/scene/content.js')
    const { projectSceneGraphToDisplayIndex } = await import('../displayIndex.js')
    const base = emptyScene()
    const { graph: withHouses } = addChildren(base.graph, ROOT_ID, [
      { name: 'Houses', schema: 'houses' },
    ])
    const housesId = [...withHouses.values()].find((n) => n.name === 'Houses')!.id
    const { graph } = addChildren(withHouses, housesId, [
      { name: 'HouseBox', schema: 'ref', content: refContent({ module: 'modules/house-box.scene.ts' }) },
    ])
    const drawables = projectSceneGraphToDisplayIndex(graph, ROOT_ID)
    expect(drawables.map((d) => ({ path: d.path, schema: d.schema }))).toEqual([
      { path: '/Houses', schema: 'houses' },
      { path: '/Houses/HouseBox', schema: 'ref' },
    ])
  })
})
