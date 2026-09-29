// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { addChildren, emptyGraph, ensurePath, getNode, ROOT_ID, setContent } from '../../../../vendor/shared/types/scene/graph.js'
import { volumeFromCells } from '../../../../vendor/shared/types/scene/volume.js'
import { makeScenePort } from '../../../../vendor/shared/types/scene/port.js'
import { collectNodeStats, extractScenePortFromWire, idsExpandedToFocus } from '../sceneStructureUtils.js'

describe('sceneStructureUtils', () => {
  it('collectNodeStats aggregates own and subtree voxel counts', () => {
    let graph = emptyGraph()
    const a = ensurePath(graph, ROOT_ID, ['a'])
    graph = setContent(a.graph, a.id, volumeFromCells([{ x: 0, y: 0, z: 0, token: 'g' }]))
    const b = ensurePath(graph, a.id, ['b'])
    graph = setContent(b.graph, b.id, volumeFromCells([
      { x: 1, y: 0, z: 0, token: 'g' },
      { x: 2, y: 0, z: 0, token: 'g' },
    ]))

    const root = getNode(graph, ROOT_ID)!
    const stats = collectNodeStats(graph, root)
    expect(stats.ownVoxels).toBe(0)
    expect(stats.subtreeVoxels).toBe(3)
    expect(stats.nodeCount).toBe(3)
  })

  it('extractScenePortFromWire reads a direct ScenePortValue', () => {
    const graph = emptyGraph()
    const port = makeScenePort(graph, ROOT_ID)
    expect(extractScenePortFromWire(port)?.focus).toBe(ROOT_ID)
  })

  it('extractScenePortFromWire reads DataTree wire shape', () => {
    const { graph, ids } = addChildren(emptyGraph(), ROOT_ID, [{ name: 'child' }])
    const port = makeScenePort(graph, ids[0]!)
    const wire = [{ path: [0], items: [port] }]
    expect(extractScenePortFromWire(wire)?.focus).toBe(ids[0])
  })

  it('extractScenePortFromWire uses only the first scene in a multi-item DataTree', () => {
    const a = ensurePath(emptyGraph(), ROOT_ID, ['a'])
    const graphA = setContent(a.graph, a.id, volumeFromCells([{ x: 0, y: 0, z: 0, token: 'g' }]))
    const b = ensurePath(emptyGraph(), ROOT_ID, ['b'])
    const graphB = setContent(b.graph, b.id, volumeFromCells([{ x: 1, y: 0, z: 0, token: 'g' }]))

    const wire = [
      {
        path: [0],
        items: [makeScenePort(graphA, a.id), makeScenePort(graphB, b.id)],
      },
      {
        path: [1],
        items: [makeScenePort(graphB, b.id)],
      },
    ]

    expect(extractScenePortFromWire(wire)?.focus).toBe(a.id)
  })

  it('idsExpandedToFocus includes ancestors up to the root', () => {
    let graph = emptyGraph()
    const a = ensurePath(graph, ROOT_ID, ['a'])
    graph = a.graph
    const b = ensurePath(graph, a.id, ['b'])
    graph = b.graph
    const c = ensurePath(graph, b.id, ['c'])
    graph = c.graph

    const expanded = idsExpandedToFocus(graph, c.id)
    expect(expanded.has(ROOT_ID)).toBe(true)
    expect(expanded.has(a.id)).toBe(true)
    expect(expanded.has(b.id)).toBe(true)
    expect(expanded.has(c.id)).toBe(true)
  })
})
