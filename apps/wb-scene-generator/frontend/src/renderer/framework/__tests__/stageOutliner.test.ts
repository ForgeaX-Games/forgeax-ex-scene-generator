import { describe, expect, it } from 'vitest'
import { projectKeysToDisplayIndex } from '../displayIndex'
import { buildStageOutliner, nodeIdsForOutlinerNode, stagePathForSchema } from '../stageOutliner'

describe('stageOutliner', () => {
  it('builds a tree from scene node names, not Terrain/Houses folders', () => {
    const index = projectKeysToDisplayIndex({
      voxelKeys: [],
      bakedKeys: [],
      gridKeys: [],
      meshItems: [
        { key: 'hf:mesh', schema: 'mesh', nodeId: 'n-lake', label: 'Lake' },
        { key: 'rd:mesh', schema: 'road', nodeId: 'n-pier', label: 'Pier' },
        { key: 'hx:mesh', schema: 'houses', nodeId: 'n-cabins', label: 'Cabins' },
      ],
      guideItems: [{ key: 'gd:points', nodeId: 'n-markers', label: 'Markers' }],
    })
    const tree = buildStageOutliner(index)
    expect(tree.map((n) => n.path).sort()).toEqual(['/Cabins', '/Lake', '/Markers', '/Pier'])
    expect(tree.find((n) => n.path === '/Cabins')?.nodeId).toBe('n-cabins')
    expect(tree.find((n) => n.path === '/Markers')?.nodeId).toBe('n-markers')
    expect(tree.find((n) => n.path === '/Lake')?.label).toBe('Lake')
  })

  it('handles empty DisplayIndex gracefully', () => {
    const tree = buildStageOutliner(projectKeysToDisplayIndex({
      voxelKeys: [],
      bakedKeys: [],
      gridKeys: [],
    }))
    expect(tree).toHaveLength(0)
    expect(stagePathForSchema('houses', 'Cabins')).toBe('/Cabins')
    expect(stagePathForSchema('mesh', 'Lake')).toBe('/Lake')
  })

  it('nests a Ref under Houses', () => {
    const index = projectKeysToDisplayIndex({
      voxelKeys: [],
      bakedKeys: [],
      gridKeys: [],
      meshItems: [
        { key: 'hx:mesh', schema: 'houses', nodeId: 'n-houses', label: 'Houses' },
        { key: 'ref:mesh', schema: 'ref', nodeId: 'n-box', label: 'Houses/HouseBox' },
      ],
    })
    const tree = buildStageOutliner(index)
    const houses = tree.find((n) => n.path === '/Houses')
    expect(houses?.schema).toBe('houses')
    expect(houses?.children.map((c) => ({ path: c.path, schema: c.schema }))).toEqual([
      { path: '/Houses/HouseBox', schema: 'ref' },
    ])
  })
})
