import { describe, expect, it } from 'vitest'
import {
  createNode,
  emptyGraph,
  ROOT_ID,
  removeNode,
  moveNode,
  graftSubtree,
} from '../../vendor/shared/types/scene/graph.js'
import { meshContent } from '../../vendor/shared/types/scene/content.js'
import {
  makeScenePort,
  parseScenePort,
} from '../../vendor/shared/types/scene/port.js'
import { decodeSceneDocument } from '@forgeax/scene-authoring/scene-wire'
import type { SceneDocument } from '@forgeax/scene-authoring/scene-asset'
import { sceneNode } from '../../batteries/Scene/bridge/scene_node/index.js'
import { projectScene } from '../src/pack-export/engineBridge.js'

const mesh = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  indices: new Uint16Array([0, 1, 2]),
}
function hierarchy() {
  const house = createNode(emptyGraph(), ROOT_ID, 'house', {
    content: meshContent(mesh),
  })
  const child = createNode(house.graph, house.id, 'window')
  return { graph: child.graph, house: house.id, child: child.id }
}
describe('scene graph invariants and native transport', () => {
  it('removes descendants from the current snapshot while retaining the old snapshot', () => {
    const { graph, house, child } = hierarchy(),
      removed = removeNode(graph, house)
    expect(removed.size).toBe(1)
    expect(removed.get(child)).toBeUndefined()
    expect(graph.get(child)).toBeDefined()
  })
  it('rejects cycles and duplicate names without changing the input graph', () => {
    const { graph, house, child } = hierarchy()
    expect(() => moveNode(graph, house, child)).toThrow(/descendant/)
    expect(() => moveNode(graph, house, house)).toThrow(/descendant/)
    expect(() => createNode(graph, ROOT_ID, 'house')).toThrow(/duplicate/)
    expect(graph.size).toBe(3)
  })
  it('keeps renamed identity and allocates a distinct id when recreating its old label', () => {
    const { graph, house } = hierarchy(),
      renamed = moveNode(graph, house, ROOT_ID, 'renamed')
    expect([...renamed.get(ROOT_ID)!.children.keys()]).toEqual(['renamed'])
    const created = createNode(renamed, ROOT_ID, 'house')
    expect(created.id).not.toBe(house)
    expect(created.graph.get(house)!.name).toBe('renamed')
  })
  it('retains an explicit source key through grafting when a display label changes', () => {
    const a = createNode(emptyGraph(), ROOT_ID, 'Before', {
      key: 'stable-house',
    })
    const b = createNode(emptyGraph(), ROOT_ID, 'After', {
      key: 'stable-house',
    })
    expect(
      graftSubtree(emptyGraph(), ROOT_ID, 'Before', a.graph, a.id).id,
    ).toBe(graftSubtree(emptyGraph(), ROOT_ID, 'After', b.graph, b.id).id)
  })
  it('accepts typed authoring buffers and preserves shared native mesh resources across wire', () => {
    expect(
      sceneNode({ name: 'triangle', geometry: { kind: 'mesh', ...mesh } })
        .error,
    ).toBeUndefined()
    const { graph, house } = hierarchy(),
      copy = graftSubtree(graph, ROOT_ID, 'second', graph, house)
    const wire = JSON.parse(JSON.stringify(makeScenePort(copy.graph, ROOT_ID)))
    const doc = decodeSceneDocument<SceneDocument>(wire)
    expect(doc.scene.kind).toBe('scene')
    expect(doc.scene.entities).toHaveLength(5)
    expect(Object.keys(doc.assets)).toHaveLength(1)
    const asset = Object.values(doc.assets)[0] as any
    expect(asset.indices).toBeInstanceOf(Uint16Array)
    expect(asset.vertices).toHaveLength(36)
    expect(asset.attributes.position).toBeUndefined()
    expect(asset.vertices[11]).toBe(1)
    const restored = parseScenePort(wire)!
    expect(restored.graph.size).toBe(5)
    expect(restored.graph.get(house)!.content).toMatchObject({ schema: 'mesh' })
    expect(projectScene(restored).vertexCount).toBe(6)
  })
  it('retains full parent TRS and computes world bounds without rewriting mesh vertices', () => {
    const parent = createNode(emptyGraph(), ROOT_ID, 'parent', {
      transform: {
        pos: [10, 0, 2],
        quat: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
        scale: [2, 3, 1],
      },
    })
    const child = createNode(parent.graph, parent.id, 'child', {
      transform: { pos: [1, 0, 0] },
      content: meshContent(mesh),
    })
    const result = projectScene(makeScenePort(child.graph, ROOT_ID))
    expect(
      result.entities.find((e) => e.name === 'parent')!.transform.scale,
    ).toEqual([2, 3, 1])
    expect(result.bounds.min[0]).toBeCloseTo(7)
    expect(result.bounds.max[1]).toBeCloseTo(4)
    expect(
      result.entities.find((e) => e.name === 'child')!.mesh!.vertices[0],
    ).toBe(0)
  })
})
