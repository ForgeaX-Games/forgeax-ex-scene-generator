import { describe, expect, it } from 'vitest'
import {
  createNode,
  emptyGraph,
  ROOT_ID,
} from '../../../../../vendor/shared/types/scene/graph.js'
import { meshContent } from '../../../../../vendor/shared/types/scene/content.js'
import {
  makeScenePort,
  parseScenePort,
} from '../../../../../vendor/shared/types/scene/port.js'
import { collectRefMeshesFromScene } from '../sceneMeshHydration.js'
import {
  worldXformOf,
  applyWorldXformToPoints,
  invertWorldXformToXY,
} from '../sceneWorldXform.js'

describe('native scene wire in the preview', () => {
  it('preserves nested rotated/scaled typed geometry, winding and UVs through JSON', () => {
    const parent = createNode(emptyGraph(), ROOT_ID, 'building', {
      transform: {
        pos: [4, 5, 6],
        quat: [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
        scale: [-2, 3, 1],
      },
    })
    const part = createNode(parent.graph, parent.id, 'canopy', {
      transform: { pos: [0, 1, 0] },
      content: meshContent({
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint16Array([0, 1, 2]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
      }),
    })
    const port = makeScenePort(part.graph, ROOT_ID),
      restored = parseScenePort(JSON.parse(JSON.stringify(port)))!
    const actual = collectRefMeshesFromScene(restored)[0]!.mesh,
      original = collectRefMeshesFromScene(port)[0]!.mesh
    expect(actual.positions).toEqual(original.positions)
    expect(actual.uvs).toEqual([0, 0, 1, 0, 0, 1])
    expect(actual.indices).toEqual([0, 1, 2])
    expect(actual.positions[0]).toBeCloseTo(4)
    expect(actual.positions[1]).toBeCloseTo(-5)
    expect(actual.positions[2]).toBeCloseTo(9)
    expect(actual.normals![1]).toBeCloseTo(1)
    expect(restored.graph.get(ROOT_ID)!.transform).toBeUndefined()
  })
  it('maps scaled XY guides back into source-local coordinates', () => {
    const node = createNode(emptyGraph(), ROOT_ID, 'city', {
      transform: {
        pos: [10, 20, 0],
        quat: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
        scale: [2, 3, 1],
      },
    })
    const matrix = worldXformOf(node.graph, node.id),
      point = applyWorldXformToPoints([{ x: 2, y: 3 }], matrix)[0]!
    const local = invertWorldXformToXY(point.x, point.y, matrix)
    expect(local.x).toBeCloseTo(2)
    expect(local.y).toBeCloseTo(3)
  })
})
