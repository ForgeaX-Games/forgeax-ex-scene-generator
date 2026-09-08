/** Author API for project-local Generators. Compile and sandbox stay in the rest of this package. */
export {
  DEFAULT_GENERATOR_VERSION,
  defineGenerator,
  localGeneratorOpId,
  normalizeGeneratorVersion,
  type GeneratorContext,
  type GeneratorDefinition,
  type GeneratorDefinitionInput,
  type GeneratorDefinitionMeta,
  type GeneratorPortDescriptor,
} from '@forgeax/scene-authoring'

export {
  aabbOf,
  alongPolyline,
  asHeightField,
  asPoint,
  asPointList,
  centroidOf,
  createRng,
  dist,
  hashSeed,
  isPoint,
  lerp,
  normalOf,
  pointInPolygon,
  polygonArea,
  polylineLength,
  resamplePolyline,
  sampleHeight,
  type Aabb,
  type HeightField,
  type Point,
} from './geom.js'

export type {
  Mesh,
  Parcel,
  ParcelSet,
  Placement,
  PlacementSet,
  Plane,
  Region,
  RegionSet,
  RoadNetwork,
  RoadSegment,
  WorkGrid,
} from './spatial.js'
