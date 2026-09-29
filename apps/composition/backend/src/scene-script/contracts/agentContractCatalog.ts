import type { NodeFunctionContract } from '@forgeax/scene-authoring'

export const SINO_UTILITY_FUNCTIONS = ['deriveSeed'] as const

export const SINO_COMPOSITION_FUNCTIONS = [
  'emptyScene',
  'sceneNode',
  'addChild',
  'sceneOutput',
] as const

/** First disclosed Modeling / Grid library. Cad / city batteries stay off this list. */
export const SINO_SPATIAL_FUNCTIONS = [
  'allocateSpans',
  'segmentRun',
  'localFrame',
  'fitAnchor',
  'boundsRelation',
  'point2d',
  'basePlane',
  'polyline2d',
  'spline2d',
  'polygon2d',
  'network2d',
  'point3d',
  'polyline3d',
  'spline3d',
  'polygon3d',
  'network3d',
  'geometryMask',
  'createGrid',
  'gridFill',
  'gridGradient',
  'gridDiamondSquare',
  'gridMidpoint',
  'hashNoise',
  'valueNoise',
  'valueCubicNoise',
  'perlinNoise',
  'openSimplex2Noise',
  'openSimplex2sNoise',
  'cellularNoise',
  'gridAdd',
  'gridSub',
  'gridMul',
  'gridMin',
  'gridMax',
  'gridLerp',
  'gridChoose',
  'gridMaskDiff',
  'gridMaskUnion',
  'gridAbs',
  'gridNeg',
  'gridClamp',
  'gridRemap',
  'gridSmoothstep',
  'gridQuantize',
  'gridBlur',
  'gridSharpen',
  'gridMedian',
  'gridNeighborhoodMin',
  'gridNeighborhoodMax',
  'gridDilate',
  'gridErodeMorph',
  'gridOpen',
  'gridClose',
  'gridMajority',
  'gridOutline',
  'gridSlope',
  'gridAspect',
  'gridCurvature',
  'gridThreshold',
  'gridRangeSelect',
  'gridEdge',
  'gridBBox',
  'gridComponents',
  'gridZonalMean',
  'gridStats',
  'gridDistance',
  'gridResize',
  'heightfield',
  'heightfieldExplode',
  'heightfieldSetMask',
  'heightfieldMesh',
  'box',
  'transform',
  'placeOnGround',
  'liftToSurface',
  'surfaceBand',
] as const

/** CAD `g_*` is not loaded in composition. Geometry is the operating-geometry type, not a CAD catalog. */
export const SINO_GEOMETRY_FUNCTIONS = [] as const

export const SCENE_SCRIPT_BUILTINS = [] as const

export const PROJECT_GENERATOR_ABI = {
  import: '@forgeax/project-generator',
  declaration: 'export const name = defineGenerator({ id, version?, description?, inputs, outputs, run(ctx, args) })',
  opId: 'local/<id>',
  isolation: 'Project-local TypeScript imported by .scene.ts; cannot shadow platform functions.',
  contractSource: 'Static defineGenerator AST only; the host does not execute source to discover contracts.',
  context: {
    seed: 'number',
    random: '(salt?: number) => number',
    rng: '(salt?: number) => () => number',
    log: '(level, message) => void',
    signal: 'AbortSignal',
  },
  portTypes: {
    values: ['Scene', 'NumberValue', 'StringValue', 'BooleanValue', 'Grid', 'Heightfield', 'Point2d', 'Polyline2d', 'Spline2d', 'Polygon2d', 'Network2d', 'Geometry', 'Dict', 'Any'],
    shapes: ['Item<T>', 'List<T>', 'ShapeTree<T>', 'SceneTree'],
    spatial: ['Geometry', 'Grid', 'Heightfield', 'Scene'],
    geometry: ['Geometry'],
  },
  geometryImports: [
    '@forgeax/project-generator',
    '@forgeax/project-generator/sdk',
    '@forgeax/project-generator/geom',
  ],
  runtimeRules: [
    'run must return JSON-serializable outputs matching the declared ports.',
    'Use ctx.random/ctx.rng for deterministic randomness; do not use Math.random.',
    'Use relative imports only for .generator-lib.ts helpers inside the same Scene Project.',
  ],
} as const

export const SINO_CATALOG_VERSION = '1.0'

export const SINO_REPRESENTATION = {
  operatingGeometry: 'Geometry is the only geometry payload. Operating kinds: point2d, plane, polyline, spline, polygon, network, plus 3d counterparts point3d / polyline3d / spline3d / polygon3d / network3d. Hangable kinds: mesh, voxel. Canvas port types *2d / *3d are Geometry subtype markers, not a second payload. A street or building is a .scene.ts that consumes operating Geometry, not a new kind. Grid is a script value.',
  review: 'Default (orbit-camera Stage). Voxel and mesh are both valid visible output. verification.ok is not visual acceptance.',
} as const

export const SINO_AUTHORING_ROUTES = [
  {
    kind: 'operating-geometry',
    use: 'point2d / basePlane / polyline2d / spline2d / polygon2d / network2d / point3d / polyline3d / spline3d / polygon3d / network3d -> Geometry',
    when: 'Select operating geometry in authoring metres. point2d is a plan site (x, y); point3d is a world site (x, y, z). plane is a box; *2d / *3d curves and networks match. Payload kinds are polyline / spline / polygon / network or the 3d counterparts. No width or use on the Geometry. A consuming .scene.ts expands it. Do not steal-fill z on 2d kinds.',
  },
  {
    kind: 'geometry-mask',
    use: 'geometryMask({ plane, geometry, columns, rows, width?, feather? }) -> Grid',
    when: 'Burn operating Geometry onto plane + columns + rows as a 0–1 mask. Width and feather are metres on this call, not on the Geometry. Combine with gridMul / gridLerp; bind with heightfield({ mask }). Not a Heightfield op.',
  },
  {
    kind: 'valued-grid',
    use: 'createGrid / gridFill / gridGradient / gridDiamondSquare / gridMidpoint / hashNoise / valueNoise / valueCubicNoise / perlinNoise / openSimplex2Noise / openSimplex2sNoise / cellularNoise -> Grid',
    when: 'Make a valued number[][] field. No Geometry required. createGrid is a constant fill; gridFill rewrites an existing table; gridGradient is a row/col/radial ramp in index space; diamond-square and midpoint are 2^n+1 fractal tables. Sampling noise is Grid/noise: perlinNoise and the other six identifiers. No mask on the sampler.',
  },
  {
    kind: 'valued-grid-math',
    use: 'gridAdd / gridBlur / gridDilate / gridErodeMorph / gridSlope / gridThreshold / gridComponents / gridZonalMean / gridDistance / gridResize -> Grid; gridBBox / gridStats -> numbers',
    when: 'Same-lattice Arith / Filter / Morph / Derive, plus Partition / Zone / Global / Lattice. Radius is cells (1–16), not metres; convert metres before the call. gridSlope is Δvalue/cell. gridDistance is cells (unreachable 1e9). gridStats + gridRemap is normalize. gridComponents writes integer ids (0 background). gridZonalMean leaves zone 0 unchanged. gridResize aligns lattices before Arith. Stretch is { error }. Optional mask writeback is lerp. gridErodeMorph is surface morph, not hydro. Erosion stays in .generator.ts.',
  },
  {
    kind: 'heightfield-bind',
    use: 'heightfield({ geometry, height, mask?, attributes? }) -> Heightfield',
    when: 'Bind a plane to a height Grid. Packet is region + lattice + height + mask (default ones) + a dict of named attribute Grids. Stretch metrics lift as SCENE_GRID_STRETCH. Not a mesh and not scene content.',
  },
  {
    kind: 'heightfield-explode',
    use: 'heightfieldExplode({ heightfield }) -> { geometry, columns, rows, height, mask, attributes }',
    when: 'Unpack the packet into its parts. Downstream kernels that only need Grids take height / mask / the attributes dict from here.',
  },
  {
    kind: 'heightfield-set-mask',
    use: 'heightfieldSetMask({ heightfield, mask }) -> Heightfield',
    when: 'Replace packet.mask only. Same lattice or { error }. Keeps geometry, height, and attributes. Default paints a red halo when mask is not all 1s.',
  },
  {
    kind: 'heightfield-mesh',
    use: 'heightfieldMesh({ heightfield }) -> Geometry kind mesh',
    when: 'Weave the packet plane + height into hangable Geometry. Vertex Z and planar UV (0–1 over the plane) use the same sampleHeight bilinear. Mask does not punch holes. Hang with sceneNode, then sceneOutput. Unused packets warn SCENE_HEIGHTFIELD_NOT_IN_SCENE. The packet itself is not scene content.',
  },
  {
    kind: 'mesh-solid',
    use: 'box({ width, depth, height }) -> Geometry kind mesh',
    when: 'Local hangable mesh. Origin is the floor-centre contact. width +X, depth +Y, height +Z. Do not write world vertices. Pose with transform or placeOnGround.',
  },
  {
    kind: 'mesh-pose',
    use: 'transform({ geometry, x, y, z, yaw?, scale? }) -> Geometry kind mesh',
    when: 'Move a local hangable mesh so its origin sits at (x, y, z). Yaw is radians about +Z; the object stays upright. z is not terrain height unless you sampled it.',
  },
  {
    kind: 'mesh-ground',
    use: 'placeOnGround({ geometry, heightfield, x, y, yaw?, offset? }) -> Geometry kind mesh',
    when: 'Sit the mesh AABB floor on the same Heightfield sampleHeight reads. Keep upright. Field-outside (x, y) is { error }. Scatter loops should use sampleHeight so the graph does not explode.',
  },
  {
    kind: 'lift-to-surface',
    use: 'liftToSurface({ geometry, surface }) -> matching 3D Geometry',
    when: 'Vertical lift Φ(u,v)=(xy,h) onto the Heightfield. Preserves network node indices. Edges densify by XY arc length. Off-field is { error }. Query sampleSurface({ surface, x, y }) is not a graph node.',
  },
  {
    kind: 'surface-band',
    use: 'surfaceBand({ mesh, geometry, width, widths?, metric?, offset? }) -> Geometry kind mesh',
    when: 'Minkowski band of a 3D skeleton already on a hangable mesh. Width is metres on this call. Builds stadium strips and node disks, then sits those vertices on the mesh — does not clip the input triangulation. geodesic is tangent-plane offset; plan is XY stadium. Not a road kind. Hang with sceneNode.',
  },
  {
    kind: 'heightfield-sample',
    use: 'sampleHeight({ heightfield, x, y }) -> { z }',
    when: 'Read the height channel of the same Heightfield packet. Query helper, not a graph node. Do not invent a second height function.',
  },
  {
    kind: 'scene-tree',
    use: 'emptyScene / sceneNode({ name, geometry, structure?, part? }) / addChild → sceneOutput({ scene })',
    when: 'Build a SceneTree of voxel and mesh nodes, then assemble it. addChild grafts any SceneTree (leaf or module). sceneNode structure/part mark consuming modules (road + pavement) so placement can find them. Authoring without sceneOutput is allowed; the run warns SCENE_OUTPUT_INCOMPLETE until the entry outputs a tree that already has mesh or voxel nodes. Empty sceneOutput({ scene: emptyScene() }) is still incomplete. Host { error } fails the run.',
  },
  {
    kind: 'scene-module',
    use: 'One declarative .scene.ts per semantic layer or reusable component',
    when: 'Compose typed values and imported project Generators. Nested modules export SceneTrees; only main.scene.ts calls sceneOutput. Persist the .scene.ts, not graph.json.',
  },
  {
    kind: 'project-generator',
    use: 'One project-local .generator.ts per bounded algorithm',
    when: 'Optional project-local solvers. Agent may implement tools in any .ts; platform libraries are incremental workload reduction, not a closed set. Numeric loops and generation that do not belong in a declarative module often land in .generator.ts.',
  },
] as const

const utilityFunctions = new Set<string>(SINO_UTILITY_FUNCTIONS)
const compositionFunctions = new Set<string>(SINO_COMPOSITION_FUNCTIONS)
const spatialFunctions = new Set<string>(SINO_SPATIAL_FUNCTIONS)
const geometryFunctions = new Set<string>(SINO_GEOMETRY_FUNCTIONS)
const MAX_DETAIL_FUNCTIONS = 6
const MAX_SUMMARY_GENERATORS = 12
type ContractPort = NodeFunctionContract['inputs'][number]
const LITERAL_TYPES = new Set(['number', 'string', 'boolean', 'point2d', 'point3d'])

function portAcceptsLiteral(port: ContractPort): boolean {
  return port.mode === 'parameter' || LITERAL_TYPES.has(port.type)
}

function compactPort(port: ContractPort) {
  return {
    name: port.name,
    type: port.type,
    ...(port.runtimeType ? { runtimeType: port.runtimeType } : {}),
    access: port.access,
    ...(port.required === true ? { required: true, requiredAtRuntime: true } : {}),
    ...(port.defaultValue !== undefined ? { defaultValue: port.defaultValue } : {}),
  }
}

function detailedPort(port: ContractPort) {
  return {
    ...compactPort(port),
    acceptsLiteral: portAcceptsLiteral(port),
    ...(port.label ? { label: port.label } : {}),
    ...(port.mode ? { mode: port.mode } : {}),
    ...(port.description ? { description: boundedText(port.description, 360) } : {}),
  }
}

function boundedText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`
}

function contractMaturity(contract: NodeFunctionContract): {
  maturity: 'project-local' | 'platform-primitive'
  referenceVerified: boolean
} {
  if (contract.sourceKind === 'generator') {
    return { maturity: 'project-local', referenceVerified: false }
  }
  return { maturity: 'platform-primitive', referenceVerified: true }
}

export function isLowpolyGeometryContract(contract: NodeFunctionContract): boolean {
  return typeof contract.opId === 'string' && contract.opId.startsWith('g_')
}

export function isSinoApprovedContract(contract: NodeFunctionContract): boolean {
  const localGenerator = contract.sourceKind === 'generator' && contract.opId?.startsWith('local/')
  return Boolean(
    utilityFunctions.has(contract.functionName)
    || compositionFunctions.has(contract.functionName)
    || spatialFunctions.has(contract.functionName)
    || geometryFunctions.has(contract.functionName)
    || localGenerator,
  )
}

export function sinoApprovedFunctionNames(): string[] {
  return [
    ...SINO_UTILITY_FUNCTIONS,
    ...SINO_COMPOSITION_FUNCTIONS,
    ...SINO_SPATIAL_FUNCTIONS,
    ...SINO_GEOMETRY_FUNCTIONS,
  ]
}

function isSinoDetailContract(contract: NodeFunctionContract): boolean {
  return isSinoApprovedContract(contract)
}

function categoryOf(contract: NodeFunctionContract):
  'project-generator' | 'composition' | 'spatial' | 'utility' {
  if (contract.sourceKind === 'generator') return 'project-generator'
  if (compositionFunctions.has(contract.functionName)) return 'composition'
  if (spatialFunctions.has(contract.functionName)) return 'spatial'
  return 'utility'
}

function summaryContract(contract: NodeFunctionContract) {
  return {
    functionName: contract.functionName,
    category: categoryOf(contract),
  }
}

function detailedContract(contract: NodeFunctionContract) {
  return {
    functionName: contract.functionName,
    kind: contract.kind,
    category: categoryOf(contract),
    description: boundedText(contract.description, 800),
    contractVersion: contract.contractVersion,
    ...(contract.definitionId ? { definitionId: contract.definitionId } : {}),
    ...(contract.definitionVersion ? { definitionVersion: contract.definitionVersion } : {}),
    ...(contract.sourceKind ? { sourceKind: contract.sourceKind } : {}),
    ...(contract.sourceFile ? { sourceFile: contract.sourceFile } : {}),
    ...(contract.opId?.startsWith('local/') ? { opId: contract.opId } : {}),
    inputs: contract.inputs.map(detailedPort),
    outputs: contract.outputs.map(detailedPort),
    deterministic: contract.deterministic,
    sceneScriptStatus: contract.sceneScriptStatus,
    capabilities: contract.capabilities,
    ...contractMaturity(contract),
  }
}

export function projectSinoContractCatalog(
  contracts: NodeFunctionContract[],
  request: { mode?: 'summary' | 'detail'; functionNames?: string[] },
) {
  const allVisible = contracts
    .filter((contract) => contract.agentVisible !== false && isSinoDetailContract(contract))
    .sort((left, right) =>
      left.kind.localeCompare(right.kind) || left.functionName.localeCompare(right.functionName))
  const allApproved = allVisible.filter((contract) => isSinoApprovedContract(contract))
  const projectGenerators = allApproved.filter((contract) => contract.sourceKind === 'generator')
  const approved = [
    ...allApproved.filter((contract) => contract.sourceKind !== 'generator'),
    ...projectGenerators.slice(0, MAX_SUMMARY_GENERATORS),
  ].sort((left, right) =>
    left.kind.localeCompare(right.kind) || left.functionName.localeCompare(right.functionName))

  if (request.mode !== 'detail') {
    return {
      version: SINO_CATALOG_VERSION,
      mode: 'summary',
      scope: 'scene-project-code-first',
      total: approved.length,
      omittedProjectGenerators: Math.max(0, projectGenerators.length - MAX_SUMMARY_GENERATORS),
      routing: SINO_AUTHORING_ROUTES,
      representation: SINO_REPRESENTATION,
      functions: approved.map(summaryContract),
      next: {
        mode: 'detail',
        instruction: 'Select functions relevant to the scene design and request their exact functionNames for signatures before use. Combine suitable library calls with adapted helpers and original project algorithms.',
        maxFunctionNames: MAX_DETAIL_FUNCTIONS,
      },
    }
  }

  const requested = [...new Set(request.functionNames ?? [])].slice(0, MAX_DETAIL_FUNCTIONS)
  const byName = new Map(allVisible.map((contract) => [contract.functionName, contract]))
  const authoringContracts = new Map<string, Record<string, unknown>>([
    ['defineGenerator', {
      functionName: 'defineGenerator',
      kind: 'project-generator-authoring-abi',
      ...PROJECT_GENERATOR_ABI,
    }],
  ])
  return {
    version: SINO_CATALOG_VERSION,
    mode: 'detail',
    scope: 'scene-project-code-first',
    requested,
    notFound: requested.filter((name) => !byName.has(name) && !authoringContracts.has(name)),
    functions: requested.flatMap((name) => {
      const contract = byName.get(name)
      if (contract) return [detailedContract(contract)]
      const authoringContract = authoringContracts.get(name)
      return authoringContract ? [authoringContract] : []
    }),
    limit: MAX_DETAIL_FUNCTIONS,
  }
}
