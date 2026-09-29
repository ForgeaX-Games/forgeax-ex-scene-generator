import { describe, expect, it } from 'vitest'

import { addChild } from '../../batteries/Scene/manage/add_child/index.ts'
import { emptyScene } from '../../batteries/Scene/manage/empty_scene/index.ts'
import { sceneNode } from '../../batteries/Scene/bridge/scene_node/index.ts'
import { sceneOutput } from '../../batteries/Scene/output/scene_output/index.ts'
import { childrenOf, contentSchema, getNode, parseScenePort } from '../../vendor/shared/types/index.js'

const triangle = {
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  indices: [0, 1, 2],
}

describe('Scene-tag tree ops', () => {
  it('assembles mesh and voxel Geometry into one SceneTree and sceneOutput', () => {
    const root = emptyScene()
    const terrain = sceneNode({ name: 'terrain', geometry: { kind: 'mesh', ...triangle } })
    const mass = sceneNode({ name: 'mass', geometry: { kind: 'voxel', cells: [{ x: 0, y: 0, z: 0, token: 'stone' }] } })
    expect(terrain.error).toBeUndefined()
    expect(mass.error).toBeUndefined()
    expect(terrain.schema).toBe('mesh')
    expect(mass.schema).toBe('voxel')
    expect(contentSchema(getNode(parseScenePort(terrain.scene)!.graph, parseScenePort(terrain.scene)!.focus)?.content)).toBe('mesh')
    expect(contentSchema(getNode(parseScenePort(mass.scene)!.graph, parseScenePort(mass.scene)!.focus)?.content)).toBe('voxel')

    const assembled = addChild({ scene: root.scene, nodes: [terrain.scene, mass.scene] })
    expect(assembled.error).toBeUndefined()
    const port = parseScenePort(assembled.scene)
    expect(port).not.toBeNull()
    const parent = getNode(port!.graph, port!.focus)
    expect(parent?.children.size).toBe(2)

    const out = sceneOutput({ scene: assembled.scene })
    expect(out.error).toBeUndefined()
    expect(out.names?.[0]?.triangleCount).toBe(1)
  })

  it('grafts a module tree whose focus is the unnamed root', () => {
    const terrain = sceneNode({ name: 'terrain', geometry: { kind: 'mesh', ...triangle } })
    const wallA = sceneNode({ name: 'curtain_west', geometry: { kind: 'mesh', ...triangle } })
    const wallB = sceneNode({ name: 'curtain_east', geometry: { kind: 'mesh', ...triangle } })
    const perimeter = addChild({ scene: emptyScene().scene, nodes: [wallA.scene, wallB.scene] })
    expect(perimeter.error).toBeUndefined()
    expect(parseScenePort(perimeter.scene)?.focus).toBe('root')

    const city = addChild({
      scene: emptyScene().scene,
      nodes: [terrain.scene, perimeter.scene],
    })
    expect(city.error).toBeUndefined()
    const port = parseScenePort(city.scene)
    expect(port).not.toBeNull()
    const names = childrenOf(port!.graph, port!.focus).map((node) => node.name).sort()
    expect(names).toEqual(['curtain_east', 'curtain_west', 'terrain'])
    expect(sceneOutput({ scene: city.scene }).error).toBeUndefined()
  })

  it('skips an empty module tree instead of refusing the root', () => {
    const terrain = sceneNode({ name: 'terrain', geometry: { kind: 'mesh', ...triangle } })
    const assembled = addChild({
      scene: emptyScene().scene,
      nodes: [terrain.scene, emptyScene().scene],
    })
    expect(assembled.error).toBeUndefined()
    const port = parseScenePort(assembled.scene)
    expect(getNode(port!.graph, port!.focus)?.children.size).toBe(1)
  })

  it('copies structure/part onto hung mesh so authoring can find road pavement', () => {
    const hung = sceneNode({
      name: 'deck',
      geometry: { kind: 'mesh', ...triangle, role: 'road' },
      structure: 'road',
      part: 'pavement',
    })
    expect(hung.error).toBeUndefined()
    const port = parseScenePort(hung.scene)
    const node = getNode(port!.graph, port!.focus)
    const mesh = (node?.content as { mesh?: { structure?: string; part?: string } } | undefined)?.mesh
    expect(mesh).toEqual(expect.objectContaining({ structure: 'road', part: 'pavement' }))
  })

  it('unwraps Geometry kind mesh from heightfieldMesh-shaped results', () => {
    const hung = sceneNode({
      name: 'terrain',
      geometry: { kind: 'mesh', ...triangle },
    })
    expect(hung.schema).toBe('mesh')
    expect(parseScenePort(hung.scene)).not.toBeNull()
  })

  it('rejects plane and grid as scene content', () => {
    expect(sceneNode({ name: 'pad', geometry: { kind: 'plane', width: 10, height: 8 } }).error).toMatch(/operating geometry/)
    expect(sceneNode({ name: 'grid', geometry: { grid: [[1, 2], [3, 4]] } }).error).toMatch(/grid is a script value/)
  })

  it('rejects a Heightfield packet and tells the caller to weave first', () => {
    expect(sceneNode({
      name: 'hills',
      geometry: {
        type: 'heightfield',
        geometry: { kind: 'plane', width: 10, height: 8 },
        columns: 2,
        rows: 2,
        height: [[0, 1], [1, 0]],
        mask: [[1, 1], [1, 1]],
        attributes: {},
      },
    }).error).toMatch(/Heightfield packet is not scene content/)
  })
})
