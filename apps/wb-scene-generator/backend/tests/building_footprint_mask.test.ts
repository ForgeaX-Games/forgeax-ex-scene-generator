import { describe, it, expect } from 'vitest'

import {
  emptyGraph,
  ensurePath,
  makeScenePort,
  setBounds,
  setContent,
  setSchema,
  volumeFromCells,
  ROOT_ID,
  type Cell,
  type NodeId,
  type SceneGraph,
} from '../../vendor/dist/shared/types/index.js'

import { buildingFootprintMask } from '../../batteries/scene/query/building_footprint_mask/index.js'

/** 在 rootId 下按 relPath 落一个携带内容的节点（对照 voxels2scene 的 upsertContentNode）。 */
function upsertContentNode(
  graph: SceneGraph,
  rootId: NodeId,
  relPath: string,
  schema: string,
  cells: readonly Cell[],
  bounds?: { width: number; height: number },
): { graph: SceneGraph; id: NodeId } {
  const segs = relPath.split('/').filter(Boolean)
  const { graph: g1, id } = ensurePath(graph, rootId, segs)
  let g = setContent(g1, id, volumeFromCells(cells))
  g = setSchema(g, id, schema)
  if (bounds) g = setBounds(g, id, bounds)
  return { graph: g, id }
}

function makeBuildingScene(): ReturnType<typeof makeScenePort> {
  let g = emptyGraph()
  const bldg = upsertContentNode(g, ROOT_ID, 'bldg', 'building', [
    { x: 1, y: 1, z: 0, token: 'wall' },
    { x: 2, y: 1, z: 0, token: 'wall' },
    { x: 3, y: 1, z: 0, token: 'wall' },
  ], { width: 20, height: 20 })
  g = bldg.graph
  const door = upsertContentNode(g, bldg.id, 'outer_door', 'door', [
    { x: 2, y: 0, z: 0, token: 'door' },
  ])
  g = door.graph
  return makeScenePort(g, bldg.id)
}

describe('building_footprint_mask', () => {
  it('extracts bbox-cropped 0/1/2 grid with door overwriting occupied', () => {
    const scene = makeBuildingScene()
    const out = buildingFootprintMask({ scene })

    expect(out.error).toBeUndefined()
    expect(out.exists).toBe(true)
    expect(out.width).toBe(3)
    expect(out.height).toBe(2)
    expect(out.originX).toBe(1)
    expect(out.originY).toBe(0)
    expect(out.grid).toEqual([
      [0, 2, 0],
      [1, 1, 1],
    ])
    expect(out.doorCount).toBe(1)
    expect(out.cellCount).toBe(4)
  })

  it('does not use node bounds canvas size', () => {
    const scene = makeBuildingScene()
    const out = buildingFootprintMask({ scene })
    expect(out.width).toBe(3)
    expect(out.height).toBe(2)
  })

  it('filters by z when provided', () => {
    const g0 = emptyGraph()
    const { graph, id } = upsertContentNode(g0, ROOT_ID, 'bldg', 'building', [
      { x: 0, y: 0, z: 0, token: 'floor' },
      { x: 1, y: 0, z: 1, token: 'wall' },
    ])
    const scene = makeScenePort(graph, id)

    const allZ = buildingFootprintMask({ scene })
    expect(allZ.grid).toEqual([[1, 1]])

    const z0 = buildingFootprintMask({ scene, z: 0 })
    expect(z0.grid).toEqual([[1]])

    const z1 = buildingFootprintMask({ scene, z: 1 })
    expect(z1.grid).toEqual([[1]])
  })

  it('returns empty when focus subtree has no voxels', () => {
    const graph = emptyGraph()
    const scene = makeScenePort(graph, ROOT_ID)
    const out = buildingFootprintMask({ scene })
    expect(out.exists).toBe(false)
    expect(out.grid).toEqual([])
    expect(out.width).toBe(0)
    expect(out.height).toBe(0)
  })

  it('supports custom door child names', () => {
    const g0 = emptyGraph()
    const bldg = upsertContentNode(g0, ROOT_ID, 'bldg', 'building', [
      { x: 0, y: 0, z: 0, token: 'wall' },
    ])
    const entry = upsertContentNode(bldg.graph, bldg.id, 'entry', 'door', [
      { x: 1, y: 0, z: 0, token: 'door' },
    ])
    const scene = makeScenePort(entry.graph, bldg.id)
    const out = buildingFootprintMask({ scene, doorNames: 'entry' })
    expect(out.grid).toEqual([
      [1, 2],
    ])
  })
})
