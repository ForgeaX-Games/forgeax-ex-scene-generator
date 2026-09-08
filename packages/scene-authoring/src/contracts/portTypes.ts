import type { PortContract, ScenePortTypeName } from '../model/types.js'

const catalog: Record<ScenePortTypeName, Omit<PortContract, 'name'>> = {
  Scene: { type: 'scene', access: 'tree' },
  NumberValue: { type: 'number', access: 'item', mode: 'parameter' },
  StringValue: { type: 'string', access: 'item', mode: 'parameter' },
  BooleanValue: { type: 'boolean', access: 'item', mode: 'parameter' },
  Grid: { type: 'grid', access: 'item' },
  Point2d: { type: 'point2d', access: 'item' },
  Mesh: { type: 'mesh', access: 'item' },
  NumberList: { type: 'number', access: 'list' },
  StringList: { type: 'string', access: 'list' },
  Any: { type: 'any' },
  Plane: { type: 'any', runtimeType: 'plane' },
  WorkGrid: { type: 'any', runtimeType: 'work-grid' },
  RegionSet: { type: 'any', runtimeType: 'region-set' },
  RoadNetwork: { type: 'any', runtimeType: 'road-network' },
  ParcelSet: { type: 'any', runtimeType: 'parcel-set' },
  PlacementSet: { type: 'any', runtimeType: 'placement-set' },
  Reserved: { type: 'any', runtimeType: 'region-set' },
}

export function portContractForType(name: string, typeName: ScenePortTypeName): PortContract {
  return { name, ...catalog[typeName] }
}

export function isScenePortTypeName(value: string): value is ScenePortTypeName {
  return value in catalog
}
