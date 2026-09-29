import { describe, expect, it } from 'vitest'
import {
  contentSchema,
  reviveContentFromWire,
  voxelContent,
} from '../../vendor/shared/types/scene/content.ts'
import {
  ROOT_ID,
  addChildren,
  emptyGraph,
  getNode,
  reviveGraphFromWire,
} from '../../vendor/shared/types/scene/graph.ts'
import { cellCount, iterCells, uniformVolume } from '../../vendor/shared/types/scene/volume.ts'

describe('SceneContent union', () => {
  it('treats a bare Volume as voxel', () => {
    const volume = uniformVolume({ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 0, maxZ: 0 }, 'cell')
    expect(contentSchema(volume)).toBe('voxel')
    expect(cellCount(volume)).toBe(2)
  })

  it('wraps Volume as { schema: voxel, volume } without changing cell counts', () => {
    const volume = uniformVolume({ minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 2 }, 'cell')
    const wrapped = voxelContent(volume)
    expect(wrapped.schema).toBe('voxel')
    expect(contentSchema(wrapped)).toBe('voxel')
    expect(cellCount(wrapped)).toBe(3)
    expect([...iterCells(wrapped)]).toHaveLength(3)
  })

  it('revives a bare Volume wire as Volume (compat) and a tagged voxel wrapper as tagged', () => {
    const volume = { kind: 'uniform', bbox: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }, token: 'cell' }
    const bare = reviveContentFromWire(volume)
    expect(contentSchema(bare)).toBe('voxel')
    expect((bare as { kind: string }).kind).toBe('uniform')

    const tagged = reviveContentFromWire({ schema: 'voxel', volume })
    expect(tagged).toEqual({ schema: 'voxel', volume: expect.objectContaining({ kind: 'uniform' }) })
  })

  it('round-trips wrapped voxel content through reviveGraphFromWire', () => {
    const volume = uniformVolume({ minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }, 'rock')
    const { graph, ids } = addChildren(emptyGraph(), ROOT_ID, [
      { name: 'Hill', content: voxelContent(volume) },
    ])
    const wire = JSON.parse(JSON.stringify(graph)) as Record<string, unknown>
    const revived = reviveGraphFromWire(wire)
    const node = getNode(revived, ids[0]!)!
    expect(contentSchema(node.content)).toBe('voxel')
    expect(cellCount(node.content)).toBe(1)
  })

  it('does not count mesh content as voxels', () => {
    const mesh = reviveContentFromWire({
      schema: 'mesh',
      mesh: { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] },
    })
    expect(contentSchema(mesh)).toBe('mesh')
    expect(cellCount(mesh)).toBe(0)
    expect([...iterCells(mesh)]).toEqual([])
  })

  it('revives a Ref with no mesh and keeps schema ref', () => {
    const revived = reviveContentFromWire({
      schema: 'ref',
      module: 'modules/house-box.scene.ts',
      exportName: 'HouseBox',
    })
    expect(contentSchema(revived)).toBe('ref')
    expect((revived as { module?: string }).module).toBe('modules/house-box.scene.ts')
    expect((revived as { mesh?: unknown }).mesh).toBeUndefined()
    expect(cellCount(revived)).toBe(0)
  })
})
