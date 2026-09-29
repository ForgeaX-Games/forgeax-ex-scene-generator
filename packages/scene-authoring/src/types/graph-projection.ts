import type { PortAccess, ScenePortTypeName } from '../model/types.js'

/**
 * Graph port access is the canvas name of a TypeScript shape layer.
 * SceneTree is a value, so its Scene port is `item`, not `tree`.
 */
export type TsShapeLayer = 'item' | 'list' | 'tree' | 'scene'

export const GRAPH_SHAPE_PROJECTION = {
  item: { ts: 'Item<T>', graphAccess: 'item' },
  list: { ts: 'List<T>', graphAccess: 'list' },
  tree: { ts: 'ShapeTree<T>', graphAccess: 'tree' },
  scene: { ts: 'SceneTree', graphAccess: 'item' },
} as const satisfies Record<TsShapeLayer, { ts: string; graphAccess: PortAccess }>

export function graphAccessForTsShape(layer: TsShapeLayer): PortAccess {
  return GRAPH_SHAPE_PROJECTION[layer].graphAccess
}

/** First-batch payloads are single values (Item), not lists or DataTrees. */
export const FIRST_BATCH_ITEM_TYPES = [
  'NumberValue',
  'StringValue',
  'BooleanValue',
  'Grid',
  'Heightfield',
  'Point2d',
  'Polyline2d',
  'Spline2d',
  'Polygon2d',
  'Network2d',
  'Point3d',
  'Polyline3d',
  'Spline3d',
  'Polygon3d',
  'Network3d',
  'Geometry',
  'Dict',
] as const satisfies readonly ScenePortTypeName[]

/** Catalog aliases for `List<number>` / `List<string>`. Not first-class scene kinds. */
export const LIST_ALIAS_TYPES = ['NumberList', 'StringList'] as const satisfies readonly ScenePortTypeName[]
