import { describe, expect, expectTypeOf, it } from 'vitest'

import { portContractForType } from '../contracts/portTypes.js'
import {
  FIRST_BATCH_ITEM_TYPES,
  GEOMETRY_KINDS,
  GRAPH_SHAPE_PROJECTION,
  SCENE_CONTENT_SCHEMAS,
  geometryKind,
  asItem,
  asList,
  graphAccessForTsShape,
  isScenePortValue,
  isSceneTree,
  isShapeTree,
  shapeTreeFromItem,
  shapeTreeFromList,
  type Item,
  type List,
  type ScenePortValue,
  type SceneTree,
  type ShapeTree,
} from './index.js'

describe('TypeScript shape layers', () => {
  it('treats Item / List / ShapeTree as distinct layers', () => {
    const item: Item<number> = asItem(4)
    const list: List<number> = asList([1, 2, 3])
    const tree: ShapeTree<number> = shapeTreeFromList(list)

    expect(item).toBe(4)
    expect(list).toEqual([1, 2, 3])
    expect(tree).toEqual([{ path: [0], items: [1, 2, 3] }])
    expect(shapeTreeFromItem(item)).toEqual([{ path: [0], items: [4] }])
    expectTypeOf(tree).toEqualTypeOf<ShapeTree<number>>()
    expectTypeOf(tree).not.toEqualTypeOf<SceneTree>()
  })

  it('does not treat a SceneTree as a ShapeTree', () => {
    const scene: SceneTree = {
      graph: { root: { id: 'root', name: '', parent: null, children: {} } },
      focus: 'root',
    }

    expect(isSceneTree(scene)).toBe(true)
    expect(isShapeTree(scene)).toBe(false)
    expect(isSceneTree(shapeTreeFromList(['a']))).toBe(false)
    expect(isShapeTree(shapeTreeFromItem(scene))).toBe(true)
    expect(isScenePortValue(scene)).toBe(true)
    const port: ScenePortValue = scene
    expect(port.focus).toBe('root')
    expect([...SCENE_CONTENT_SCHEMAS]).toEqual(['voxel', 'mesh'])
  })
})

describe('graph projection of TS shapes', () => {
  it('maps SceneTree to a Scene item port, not DataTree access', () => {
    expect(graphAccessForTsShape('scene')).toBe('item')
    expect(GRAPH_SHAPE_PROJECTION.scene).toEqual({ ts: 'SceneTree', graphAccess: 'item' })
    expect(GRAPH_SHAPE_PROJECTION.tree).toEqual({ ts: 'ShapeTree<T>', graphAccess: 'tree' })
    expect(portContractForType('scene', 'Scene').access).toBe('item')
    expect(portContractForType('scene', 'SceneTree').access).toBe('item')
  })

  it('maps number[] / string[] to list access, not first-class scene kinds', () => {
    expect(graphAccessForTsShape('list')).toBe('list')
    expect(portContractForType('widths', 'number[]')).toEqual({
      name: 'widths',
      type: 'number',
      access: 'list',
    })
    expect(portContractForType('names', 'StringList')).toEqual({
      name: 'names',
      type: 'string',
      access: 'list',
    })
    expect(portContractForType('grid', 'Grid').access).toBe('item')
    expect(portContractForType('heightfield', 'Heightfield').access).toBe('item')
    expect(portContractForType('geometry', 'Geometry').type).toBe('geometry')
    expect(portContractForType('site', 'point2d')).toEqual(expect.objectContaining({
      type: 'point2d',
      runtimeType: 'geometry',
    }))
    expect(portContractForType('geometry', 'polyline2d')).toEqual(expect.objectContaining({
      type: 'polyline2d',
      runtimeType: 'geometry',
    }))
    expect(portContractForType('geometry', 'network2d').type).toBe('network2d')
    expect(portContractForType('attributes', 'dict').type).toBe('dict')
    expect(portContractForType('edges', 'json').type).toBe('dict')
    expect(portContractForType('attributes', 'Dict').access).toBe('item')
    expect(portContractForType('mesh', 'Mesh').type).toBe('geometry')
    expect(portContractForType('plane', 'Plane').type).toBe('any')
    expect(portContractForType('regions', 'RegionSet').type).toBe('any')
  })
})

describe('Geometry kinds', () => {
  it('keeps Geometry as the only geometry payload', () => {
    expect([...GEOMETRY_KINDS]).toEqual([
      'point2d', 'plane', 'polyline', 'spline', 'polygon', 'network',
      'point3d', 'polyline3d', 'spline3d', 'polygon3d', 'network3d',
      'mesh', 'voxel',
    ])
    expect([...FIRST_BATCH_ITEM_TYPES]).not.toContain('Mesh')
    expect([...FIRST_BATCH_ITEM_TYPES]).toContain('Geometry')
    expect([...FIRST_BATCH_ITEM_TYPES]).toContain('Polyline2d')
    expect([...FIRST_BATCH_ITEM_TYPES]).toContain('Point3d')
    expect([...FIRST_BATCH_ITEM_TYPES]).toContain('Dict')
    expect(geometryKind({ kind: 'mesh', positions: [], indices: [] })).toBe('mesh')
    expect(geometryKind({ kind: 'voxel', cells: [] })).toBe('voxel')
    expect(geometryKind({ grid: [[1]] })).toBeUndefined()
  })
})
