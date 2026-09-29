import { describe, expect, it } from 'vitest'
import { addChildren, emptyScene, ROOT_ID } from '../../../../../vendor/shared/types/scene/graph.js'
import { meshContent, refContent } from '../../../../../vendor/shared/types/scene/content.js'
import { makeScenePort } from '../../../../../vendor/shared/types/scene/port.js'
import { collectRefMeshesFromGraph } from '../sceneMeshHydration.js'
import { projectSceneGraphToDisplayIndex } from '../displayIndex.js'
import { buildStageOutliner } from '../stageOutliner.js'
import { parseScenePortFromWire } from '../../bridge/scenePortWire.js'

const houseMesh = {
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  indices: [0, 1, 2],
  role: 'houses' as const,
}

describe('collectRefMeshesFromGraph', () => {
  it('collects a Ref mesh so Default can draw houses without a mesh port', () => {
    const base = emptyScene()
    const { graph: withHouses } = addChildren(base.graph, ROOT_ID, [
      { name: 'Houses', schema: 'houses' },
    ])
    const housesId = [...withHouses.values()].find((n) => n.name === 'Houses')!.id
    const { graph } = addChildren(withHouses, housesId, [
      {
        name: 'HouseBox',
        schema: 'ref',
        content: refContent({ module: 'modules/house-box.scene.ts', mesh: houseMesh }),
      },
    ])
    const meshes = collectRefMeshesFromGraph(graph, ROOT_ID)
    expect(meshes).toHaveLength(1)
    expect(meshes[0]).toMatchObject({
      name: 'HouseBox',
      path: '/Houses/HouseBox',
      portName: 'ref:/Houses/HouseBox',
      mesh: { role: 'houses', indices: [0, 2, 1] },
    })
    expect(meshes[0]?.mesh.positions[7]).toBe(-1)
  })

  it('collects mesh_to_node prims so Road/Houses draw without a matching mesh-port name', () => {
    const roadMesh = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2], role: 'road' as const }
    const base = emptyScene()
    const { graph } = addChildren(base.graph, ROOT_ID, [
      { name: 'Road', schema: 'mesh', content: meshContent(roadMesh) },
    ])
    const meshes = collectRefMeshesFromGraph(graph, ROOT_ID)
    expect(meshes).toHaveLength(1)
    expect(meshes[0]).toMatchObject({
      name: 'Road',
      path: '/Road',
      portName: 'mesh:/Road',
      mesh: { role: 'road', indices: [0, 2, 1] },
    })
    expect(meshes[0]?.mesh.positions[7]).toBe(-1)
  })

  it('skips a Ref that has no mesh', () => {
    const base = emptyScene()
    const { graph } = addChildren(base.graph, ROOT_ID, [
      { name: 'HouseBox', schema: 'ref', content: refContent({ module: 'modules/house-box.scene.ts' }) },
    ])
    expect(collectRefMeshesFromGraph(graph, ROOT_ID)).toEqual([])
  })
})

describe('projectSceneGraphToDisplayIndex + Ref mesh layer', () => {
  it('binds HouseBox to the hydrated mesh layer by node name', () => {
    const base = emptyScene()
    const { graph: withHouses } = addChildren(base.graph, ROOT_ID, [
      { name: 'Houses', schema: 'houses' },
    ])
    const housesId = [...withHouses.values()].find((n) => n.name === 'Houses')!.id
    const { graph } = addChildren(withHouses, housesId, [
      {
        name: 'HouseBox',
        schema: 'ref',
        content: refContent({ module: 'modules/house-box.scene.ts', mesh: houseMesh }),
      },
    ])
    const drawables = projectSceneGraphToDisplayIndex(graph, ROOT_ID, {
      meshLayers: {
        'sink:ref:/Houses/HouseBox': {
          key: 'sink:ref:/Houses/HouseBox',
          nodeId: 'sink',
          portName: 'ref:/Houses/HouseBox',
          nodeName: 'HouseBox',
          mesh: houseMesh,
          triangleCount: 1,
          visible: true,
          updatedAt: 1,
        },
      },
    })
    expect(drawables.find((d) => d.schema === 'ref')).toEqual(expect.objectContaining({
      path: '/Houses/HouseBox',
      label: 'HouseBox',
      layerKey: 'sink:ref:/Houses/HouseBox',
      nodeId: 'sink',
    }))
  })
})

describe('parseScenePortFromWire', () => {
  it('unwraps a DataTree scene port so Outliner can see Houses/HouseBox', () => {
    const base = emptyScene()
    const { graph: withHouses } = addChildren(base.graph, ROOT_ID, [
      { name: 'Houses', schema: 'houses' },
    ])
    const housesId = [...withHouses.values()].find((n) => n.name === 'Houses')!.id
    const { graph } = addChildren(withHouses, housesId, [
      {
        name: 'HouseBox',
        schema: 'ref',
        content: refContent({ module: 'modules/house-box.scene.ts', mesh: houseMesh }),
      },
    ])
    const live = makeScenePort(graph, ROOT_ID)
    const wire = [{ path: [0], items: [JSON.parse(JSON.stringify(live))] }]
    const parsed = parseScenePortFromWire(wire)
    expect(parsed).toBeTruthy()
    const drawables = projectSceneGraphToDisplayIndex(parsed!.graph, parsed!.focus)
    expect(drawables.map((d) => ({ path: d.path, schema: d.schema }))).toEqual([
      { path: '/Houses', schema: 'houses' },
      { path: '/Houses/HouseBox', schema: 'ref' },
    ])
    const tree = buildStageOutliner({ drawables })
    expect(tree.map((n) => n.path)).toEqual(['/Houses'])
    expect(tree[0]?.children.map((c) => ({ path: c.path, schema: c.schema }))).toEqual([
      { path: '/Houses/HouseBox', schema: 'ref' },
    ])
  })
})
