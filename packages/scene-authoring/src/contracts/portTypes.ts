import type { PortContract, ScenePortTypeName } from '../model/types.js'
import { graphAccessForTsShape } from '../types/graph-projection.js'

const catalog: Record<ScenePortTypeName, Omit<PortContract, 'name'>> = {
  Scene: { type: 'scene', access: graphAccessForTsShape('scene') },
  NumberValue: { type: 'number', access: graphAccessForTsShape('item'), mode: 'parameter' },
  StringValue: { type: 'string', access: graphAccessForTsShape('item'), mode: 'parameter' },
  BooleanValue: { type: 'boolean', access: graphAccessForTsShape('item'), mode: 'parameter' },
  Grid: { type: 'grid', access: graphAccessForTsShape('item') },
  Heightfield: { type: 'heightfield', access: graphAccessForTsShape('item'), runtimeType: 'heightfield' },
  Point2d: { type: 'point2d', access: graphAccessForTsShape('item'), runtimeType: 'geometry' },
  Polyline2d: { type: 'polyline2d', access: graphAccessForTsShape('item'), runtimeType: 'geometry' },
  Spline2d: { type: 'spline2d', access: graphAccessForTsShape('item'), runtimeType: 'geometry' },
  Polygon2d: { type: 'polygon2d', access: graphAccessForTsShape('item'), runtimeType: 'geometry' },
  Network2d: { type: 'network2d', access: graphAccessForTsShape('item'), runtimeType: 'geometry' },
  Point3d: { type: 'point3d', access: graphAccessForTsShape('item'), runtimeType: 'geometry' },
  Polyline3d: { type: 'polyline3d', access: graphAccessForTsShape('item'), runtimeType: 'geometry' },
  Spline3d: { type: 'spline3d', access: graphAccessForTsShape('item'), runtimeType: 'geometry' },
  Polygon3d: { type: 'polygon3d', access: graphAccessForTsShape('item'), runtimeType: 'geometry' },
  Network3d: { type: 'network3d', access: graphAccessForTsShape('item'), runtimeType: 'geometry' },
  Geometry: { type: 'geometry', access: graphAccessForTsShape('item'), runtimeType: 'geometry' },
  Dict: { type: 'dict', access: graphAccessForTsShape('item') },
  NumberList: { type: 'number', access: graphAccessForTsShape('list') },
  StringList: { type: 'string', access: graphAccessForTsShape('list') },
  Any: { type: 'any' },
}

const PORT_TYPE_ALIASES: Record<string, ScenePortTypeName> = {
  // Number
  number: 'NumberValue',
  numbervalue: 'NumberValue',
  scalar: 'NumberValue',
  float: 'NumberValue',
  int: 'NumberValue',
  integer: 'NumberValue',
  // String
  string: 'StringValue',
  stringvalue: 'StringValue',
  text: 'StringValue',
  // Boolean
  boolean: 'BooleanValue',
  booleanvalue: 'BooleanValue',
  bool: 'BooleanValue',
  // Grid
  grid: 'Grid',
  heightgrid: 'Grid',
  matrix: 'Grid',
  'number[][]': 'Grid',
  heightfield: 'Heightfield',
  // Geometry2D subtype markers — payload is still Geometry
  point2d: 'Point2d',
  point: 'Point2d',
  polyline2d: 'Polyline2d',
  spline2d: 'Spline2d',
  polygon2d: 'Polygon2d',
  network2d: 'Network2d',
  point3d: 'Point3d',
  polyline3d: 'Polyline3d',
  spline3d: 'Spline3d',
  polygon3d: 'Polygon3d',
  network3d: 'Network3d',
  // Geometry — leftover Mesh / mesh payload names fold in; do not grow a sibling type
  mesh: 'Geometry',
  meshpayload: 'Geometry',
  geometry: 'Geometry',
  geom: 'Geometry',
  // Dict — named record on the canvas; not Any
  dict: 'Dict',
  dictionary: 'Dict',
  record: 'Dict',
  json: 'Dict',
  // Lists
  'number[]': 'NumberList',
  numberlist: 'NumberList',
  'string[]': 'StringList',
  stringlist: 'StringList',
  // Scene (one SceneTree value; not a DataTree)
  scene: 'Scene',
  scenegraph: 'Scene',
  scenetree: 'Scene',
  // Any
  any: 'Any',
  unknown: 'Any',
  object: 'Any',
}

export function normalizePortTypeName(value: string | undefined): ScenePortTypeName | undefined {
  if (!value || typeof value !== 'string') return undefined
  if (value in catalog) return value as ScenePortTypeName
  const lower = value.trim().toLowerCase()
  if (PORT_TYPE_ALIASES[lower]) return PORT_TYPE_ALIASES[lower]
  if (PORT_TYPE_ALIASES[value]) return PORT_TYPE_ALIASES[value]
  const clean = lower.replace(/[-_\s]/g, '')
  if (PORT_TYPE_ALIASES[clean]) return PORT_TYPE_ALIASES[clean]
  return undefined
}

export function portContractForType(name: string, typeName: string): PortContract {
  const canonical = normalizePortTypeName(typeName) ?? 'Any'
  return { name, ...catalog[canonical] }
}

export function isScenePortTypeName(value: string): value is ScenePortTypeName {
  return normalizePortTypeName(value) !== undefined
}

