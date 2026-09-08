import type { NodeFunctionContract } from '@forgeax/scene-authoring'

export const SINO_UTILITY_FUNCTIONS = [
  'booleanValue',
  'numberValue',
  'emptyScene',
  'sceneOutput',
] as const

export const SINO_COMPOSITION_FUNCTIONS = [
  'scopeSceneNode',
  'addSceneChildren',
  'meshSceneNode',
  'gridSceneNode',
  'pointsToNode',
  'controlPoints',
  'bindMaterial',
  'previewSurface',
  'materialLook',
] as const

export const SINO_SPATIAL_FUNCTIONS = [
  'basePlane',
  'workGrid',
  'rectangularGrid',
  'valleyHeightfield',
  'heightfieldMesh',
  'extractPlane',
  'place',
  'prototypeCatalog',
  'instantiatePlacements',
] as const

export const SCENE_SCRIPT_BUILTINS = [
  {
    functionName: 'choose',
    kind: 'compiler-builtin',
    signature: 'choose({ when: BooleanValue, then: T, otherwise: T }) -> { value: T }',
    constraints: [
      'when, then, and otherwise reference earlier statements.',
      'then and otherwise have the same type, runtimeType, and access.',
      'Both branches are evaluated before the runtime selector.',
    ],
  },
  {
    functionName: 'repeat',
    kind: 'compiler-builtin',
    signature: 'repeat({ count: 1..16, initial: T, step: SceneFunction }) -> { state: T }',
    constraints: [
      'count is a static integer from 1 through 16.',
      'step has one state input, an optional number index input, and one compatible state output.',
      'Use defineGroup to bind any additional step inputs.',
    ],
  },
] as const

export const PROJECT_GENERATOR_ABI = {
  import: '@forgeax/project-generator',
  declaration: 'export const name = defineGenerator({ id, version?, description?, inputs, outputs, run(ctx, args) })',
  opId: 'local/<id>',
  isolation: 'Project-local overlay registry; cannot shadow platform operations.',
  contractSource: 'Static defineGenerator AST only; the host does not execute source to discover contracts.',
  context: {
    seed: 'number',
    random: '(salt?: number) => number',
    rng: '(salt?: number) => () => number',
    log: '(level, message) => void',
    signal: 'AbortSignal',
  },
  portTypes: {
    values: ['Scene', 'NumberValue', 'StringValue', 'BooleanValue', 'Grid', 'Point2d', 'Mesh', 'NumberList', 'StringList', 'Any'],
    spatial: ['Plane', 'WorkGrid', 'RegionSet', 'RoadNetwork', 'ParcelSet', 'PlacementSet', 'Reserved'],
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

export const SINO_CATALOG_VERSION = '0.7'

export const SINO_REPRESENTATION = {
  terrain: 'heightfieldMesh + meshSceneNode',
  occupancy: 'gridSceneNode voxels; top view is a partition map, not terrain',
  review: 'Default or 3DMesh',
} as const

export const SINO_AUTHORING_ROUTES = [
  {
    kind: 'terrain-mesh',
    use: 'Height Grid → heightfieldMesh → meshSceneNode',
    when: 'Walkable landform, lake basin, ridge, or ground. gridSceneNode occupancy is an overlay, never the terrain surface.',
  },
  {
    kind: 'scene-module',
    use: 'One declarative .scene.ts per semantic layer or reusable component',
    when: 'Compose typed values, project Generators, components, materials, and one reachable sceneOutput.',
  },
  {
    kind: 'project-generator',
    use: 'One project-local .generator.ts per bounded algorithm',
    when: 'Terrain, regions, routes, parcels, placement, search, geometry, optimization, or large iteration is required.',
  },
  {
    kind: 'spatial-composition',
    use: 'Metre-space basePlane / workGrid / extractPlane / place plus composition primitives',
    when: 'Build nested world, region, site, and component coordinate frames at independent resolutions.',
  },
] as const

const utilityFunctions = new Set<string>(SINO_UTILITY_FUNCTIONS)
const compositionFunctions = new Set<string>(SINO_COMPOSITION_FUNCTIONS)
const spatialFunctions = new Set<string>(SINO_SPATIAL_FUNCTIONS)
const MAX_DETAIL_FUNCTIONS = 6
const MAX_SUMMARY_GENERATORS = 12
type ContractPort = NodeFunctionContract['inputs'][number]
const LITERAL_TYPES = new Set(['number', 'string', 'boolean', 'point2d'])

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

export function isSinoApprovedContract(contract: NodeFunctionContract): boolean {
  const localGenerator = contract.sourceKind === 'generator' && contract.opId?.startsWith('local/')
  return Boolean(
    utilityFunctions.has(contract.functionName)
    || compositionFunctions.has(contract.functionName)
    || spatialFunctions.has(contract.functionName)
    || localGenerator,
  )
}

function categoryOf(contract: NodeFunctionContract):
  'project-generator' | 'composition' | 'spatial' | 'utility' {
  if (contract.sourceKind === 'generator') return 'project-generator'
  if (compositionFunctions.has(contract.functionName)) return 'composition'
  if (spatialFunctions.has(contract.functionName)) return 'spatial'
  return 'utility'
}

function summaryContract(contract: NodeFunctionContract) {
  const compactType = (port: ContractPort) =>
    `${port.name}:${port.type}${port.runtimeType ? `<${port.runtimeType}>` : ''}`
  const category = categoryOf(contract)
  const includeUsage = category === 'composition' || category === 'spatial'
  return {
    functionName: contract.functionName,
    kind: contract.kind,
    category,
    description: boundedText(contract.description, 180),
    inputs: contract.inputs.map(compactType),
    outputs: contract.outputs.map(compactType),
    ...(includeUsage
      ? {
          inputUsage: contract.inputs.map((port) => ({
            name: port.name,
            required: port.required === true,
            ...(port.defaultValue !== undefined ? { defaultValue: port.defaultValue } : {}),
            ...(port.mode ? { mode: port.mode } : {}),
          })),
        }
      : {}),
    ...contractMaturity(contract),
  }
}

function detailedContract(contract: NodeFunctionContract) {
  return {
    functionName: contract.functionName,
    kind: contract.kind,
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
  const allApproved = contracts
    .filter((contract) => contract.agentVisible !== false && isSinoApprovedContract(contract))
    .sort((left, right) =>
      left.kind.localeCompare(right.kind) || left.functionName.localeCompare(right.functionName))
  const projectGenerators = allApproved.filter((contract) => contract.sourceKind === 'generator')
  const approved = request.mode === 'detail'
    ? allApproved
    : [
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
      generatorAbi: PROJECT_GENERATOR_ABI,
      builtins: SCENE_SCRIPT_BUILTINS,
      functions: approved.map(summaryContract),
      next: {
        mode: 'detail',
        instruction: 'Request exact functionNames only after selecting calls from this summary.',
        maxFunctionNames: MAX_DETAIL_FUNCTIONS,
      },
    }
  }

  const requested = [...new Set(request.functionNames ?? [])].slice(0, MAX_DETAIL_FUNCTIONS)
  const byName = new Map(approved.map((contract) => [contract.functionName, contract]))
  const authoringContracts = new Map<string, Record<string, unknown>>([
    ['defineGenerator', {
      functionName: 'defineGenerator',
      kind: 'project-generator-authoring-abi',
      ...PROJECT_GENERATOR_ABI,
    }],
    ...SCENE_SCRIPT_BUILTINS.map((builtin) => [builtin.functionName, builtin] as const),
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
