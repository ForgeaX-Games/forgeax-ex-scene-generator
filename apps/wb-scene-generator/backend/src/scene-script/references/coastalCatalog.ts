import { readFile } from 'node:fs/promises'
import { posix, resolve } from 'node:path'
import { appRoot } from '../../resources.js'

export const COASTAL_REFERENCE_TOPICS = [
  'terrain',
  'districts',
  'roads',
  'parcels',
  'buildings',
  'dressing',
] as const

export type CoastalReferenceTopic = (typeof COASTAL_REFERENCE_TOPICS)[number]

const MAX_REFERENCE_ROOTS = 8
const MAX_CLOSURE_FILES = 96

interface TopicSpec {
  title: string
  role: string
  invariants: string[]
  inputs: string[]
  outputs: string[]
  files: readonly string[]
}

const COASTAL_ROOT = 'examples/scene-script/coastal-small-city'

const TOPICS: Record<CoastalReferenceTopic, TopicSpec> = {
  terrain: {
    title: 'Coastal landform',
    role: 'Build the continent mesh, shoreline, creek, harbor, and city-site contract before any settlement.',
    invariants: [
      'Terrain owns height, water, and the CitySite polygon. City content is not composed here.',
      'World extent is metres on basePlane (2000×2000); workGrid.cellSize is independent (8 m). Do not size the continent as a 64/96/128 voxel canvas.',
      'Deterministic seed and explicit coastline control points. Do not random-walk the shore.',
      'Later layers consume field.cityBoundary / shoreline / creek / harbor / heightGrid, not a copy of the mesh.',
    ],
    inputs: ['coastline points', 'seaLevel', 'seed', 'world width/height in metres', 'cellSize in metres'],
    outputs: ['terrain.scene', 'field.heightGrid', 'field.cityBoundary', 'field.shoreline', 'field.creek', 'field.harbor'],
    files: ['terrain.scene.ts', 'generators/coastal-terrain.generator.ts'],
  },
  districts: {
    title: 'Urban / suburb occupancy',
    role: 'Partition the CitySite into named districts with occupancy and style families.',
    invariants: [
      'Districts consume the terrain CitySite contract; they do not rebuild landform.',
      'Named Urban/Suburb children stay addressable for roads, parcels, and dressing.',
      'One generator owns the occupancy solver; the .scene.ts file only wires it.',
    ],
    inputs: ['cityBoundary', 'shoreline', 'creek', 'harbor', 'heightGrid', 'cellSize'],
    outputs: ['district occupancy', 'urban/suburb children', 'city.scene'],
    files: ['generators/coastal-districts.generator.ts'],
  },
  roads: {
    title: 'Arterial and local circulation',
    role: 'Generate a road network from district hubs with ribbons that follow terrain height.',
    invariants: [
      'Circulation is a project Generator, not pathConnectionLink. Prefer explicit hubs and derived edges.',
      'Arterials meet waterfront/bridge roles; local streets densify after the arterial graph exists.',
      'Road ribbons sample the same heightGrid the terrain exported. Do not lift roads onto a flat plane.',
    ],
    inputs: ['district hubs', 'cityBoundary', 'shoreline', 'heightGrid', 'cellSize'],
    outputs: ['road network mesh', 'edge polylines', 'crossing/hub points'],
    files: ['generators/road-network.generator.ts', 'generators/local-streets.generator.ts'],
  },
  parcels: {
    title: 'Buildable lots',
    role: 'Carve parcels from remaining district area after roads occupy corridors.',
    invariants: [
      'Parcels are derived from district occupancy minus road clearance, not independent scatter.',
      'Each parcel keeps a style family so buildings can instantiate without guessing typology.',
      'Leave civic/park reservations before residential fill.',
    ],
    inputs: ['district occupancy', 'road corridors', 'heightGrid'],
    outputs: ['parcel set', 'style family per lot', 'civic reservations'],
    files: ['generators/parcels.generator.ts', 'generators/civic-park-plan.generator.ts'],
  },
  buildings: {
    title: 'Footprints and components',
    role: 'Instantiate building components onto parcels with explicit footprints and materials.',
    invariants: [
      'Buildings come from project components (row-house, shop-house, civic, …), not one-off boxes in main.',
      'Layout generator assigns components to parcels; .scene.ts only imports and wires catalogs.',
      'Keep landmark anchors (town hall, lighthouse, clock tower) as named placements, not random leftovers.',
    ],
    inputs: ['parcels', 'style families', 'component catalogs'],
    outputs: ['building placements', 'landmark anchors', 'composed district fabric'],
    files: [
      'generators/building-layout.generator.ts',
      'components/row-house.scene.ts',
      'components/town-hall.scene.ts',
    ],
  },
  dressing: {
    title: 'Street life and yards',
    role: 'Add trees, street furniture, and yard fill after buildings and circulation are stable.',
    invariants: [
      'Dressing fills leftover space; it must not invent a new road or district.',
      'Street-life and suburb-yard generators take the already-built fabric as obstacles.',
      'Keep density bounded and seeded. Unconstrained scatter is blockout only.',
    ],
    inputs: ['road edges', 'parcels', 'building footprints', 'heightGrid'],
    outputs: ['trees', 'stalls/benches/lanterns', 'suburb yards'],
    files: [
      'generators/street-trees.generator.ts',
      'generators/street-life.generator.ts',
      'generators/suburb-yards.generator.ts',
    ],
  },
}

function importsOf(source: string): string[] {
  return [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]!)
}

function exportsOf(source: string): string[] {
  return [...source.matchAll(/^export\s+(?:const|async function|function|type|\{)\s*([A-Za-z0-9_]+)?/gm)]
    .map((match) => match[1])
    .filter((name): name is string => Boolean(name))
    .slice(0, 16)
}

export async function loadCoastalReference(topic: string): Promise<Record<string, unknown>> {
  if (!COASTAL_REFERENCE_TOPICS.includes(topic as CoastalReferenceTopic)) {
    return {
      status: 'rejected',
      reason: `Unknown reference topic '${topic}'.`,
      topics: COASTAL_REFERENCE_TOPICS,
    }
  }
  const spec = TOPICS[topic as CoastalReferenceTopic]
  if (spec.files.length > MAX_REFERENCE_ROOTS) {
    throw new Error(`Coastal reference topic exceeds ${MAX_REFERENCE_ROOTS} roots`)
  }
  const root = resolve(appRoot, COASTAL_ROOT)
  const files = new Map<string, {
    path: string
    kind: 'scene' | 'generator' | 'helper' | 'material'
    imports: string[]
    externalImports: string[]
    exports: string[]
  }>()
  const visit = async (relative: string): Promise<void> => {
    const normalized = posix.normalize(relative)
    if (files.has(normalized)) return
    if (files.size >= MAX_CLOSURE_FILES) {
      throw new Error(`Coastal reference closure exceeds ${MAX_CLOSURE_FILES} files`)
    }
    const source = await readFile(resolve(root, normalized), 'utf8')
    const imports = importsOf(source)
    const relativeImports = imports
      .filter((specifier) => specifier.startsWith('.'))
      .map((specifier) => posix.normalize(posix.join(posix.dirname(normalized), specifier)))
    files.set(normalized, {
      path: `${COASTAL_ROOT}/${normalized}`,
      kind: normalized.endsWith('.generator-lib.ts')
        ? 'helper'
        : normalized.endsWith('.generator.ts')
          ? 'generator'
          : normalized.endsWith('.material.ts')
            ? 'material'
            : 'scene',
      imports: relativeImports.map((item) => `${COASTAL_ROOT}/${item}`),
      externalImports: imports.filter((specifier) => !specifier.startsWith('.')),
      exports: exportsOf(source),
    })
    for (const dependency of relativeImports) await visit(dependency)
  }
  for (const relative of spec.files) await visit(relative)
  const rootFiles = spec.files.map((relative) => {
    const normalized = posix.normalize(relative)
    const file = files.get(normalized)!
    const dependencies = new Set<string>()
    const collectDependencies = (dependency: string): void => {
      const normalizedDependency = dependency.slice(`${COASTAL_ROOT}/`.length)
      if (dependencies.has(normalizedDependency)) return
      dependencies.add(normalizedDependency)
      for (const child of files.get(normalizedDependency)?.imports ?? []) collectDependencies(child)
    }
    for (const dependency of file.imports) collectDependencies(dependency)
    return {
      path: file.path,
      kind: file.kind,
      exports: file.exports,
      externalImports: file.externalImports,
      directDependencyCount: file.imports.length,
      dependencyCount: dependencies.size,
    }
  })
  return {
    status: 'ok',
    topic,
    title: spec.title,
    role: spec.role,
    architecture: 'terrain → districts → roads → parcels → buildings → dressing',
    invariants: spec.invariants,
    inputs: spec.inputs,
    outputs: spec.outputs,
    referenceManifest: {
      version: '2.0',
      roots: spec.files.map((file) => `${COASTAL_ROOT}/${file}`),
      files: rootFiles,
      fileCount: rootFiles.length,
      dependencyCount: Math.max(0, files.size - rootFiles.length),
      closureFileCount: files.size,
      closureVerified: true,
      sourceIncluded: false,
      maxRoots: MAX_REFERENCE_ROOTS,
    },
    starterManifest: {
      included: false,
      tool: 'scene:script.scaffold',
      reason: 'Request the canonical closed starter separately when starting a new Scene Project.',
    },
    instruction: 'Transfer invariants and input/output shapes. Use scene:script.scaffold for a closed starter; do not copy the Coastal demo or its helper library.',
  }
}
