import { createHash } from 'node:crypto'

export interface SceneScaffoldFile {
  file: string
  source: string
}

export interface SceneScaffoldManifestFile {
  path: string
  kind: 'scene' | 'generator'
  bytes: number
  sha256: string
  imports: string[]
}

export interface SceneScaffoldManifest {
  version: '1.0'
  id: 'minimal-terrain'
  entryFile: 'main.scene.ts'
  description: string
  files: SceneScaffoldManifestFile[]
  closedImports: true
}

export const MINIMAL_SCENE_SCAFFOLD_FILES: readonly SceneScaffoldFile[] = [
  {
    file: 'main.scene.ts',
    source: `// @scene-module-id starter.main
import { terrain } from "./terrain.scene.ts"

sceneOutput({
  scene: terrain.scene,
})
`,
  },
  {
    file: 'terrain.scene.ts',
    source: `// @scene-module-id starter.terrain
import { starterTerrain } from "./generators/starter-terrain.generator.ts"

const world = basePlane({
  width: 2000,
  height: 2000,
})

const samples = workGrid({
  plane: world.plane,
  cellSize: 20,
})

const generated = starterTerrain({
  grid: samples.grid,
})

const heights = valleyHeightfield({
  width: 100,
  height: 100,
  valleyDepth: 18,
  valleyWidth: 28,
  seed: 23,
})

const surface = heightfieldMesh({
  grid: heights.heightGrid,
})

const terrainMesh = meshSceneNode({
  name: "Terrain",
  mesh: surface.mesh,
})

const groundGrid = rectangularGrid({
  width: 100,
  height: 100,
  fillValue: 1,
})

const terrainCells = gridSceneNode({
  name: "Terrain Cells",
  grid: groundGrid.grid,
  token: "Ground",
})

const terrainGuide = pointsToNode({
  name: "Terrain Guide",
  points: generated.contour,
  style: "polyline",
})

const visibleTerrain = addSceneChildren({
  scene: terrainMesh.scene,
  nodes: [terrainCells.scene],
})

export const terrain = addSceneChildren({
  scene: visibleTerrain.scene,
  nodes: [terrainGuide.scene],
})
`,
  },
  {
    file: 'generators/starter-terrain.generator.ts',
    source: `import { defineGenerator } from '@forgeax/project-generator'

export const starterTerrain = defineGenerator({
  id: 'starter-terrain',
  version: '1',
  description: 'Produce one deterministic metre-space terrain contour.',
  inputs: {
    grid: WorkGrid,
  },
  outputs: {
    contour: { type: Point2d, access: 'list' },
  },
  run(_ctx, args: { grid: { origin?: readonly [number, number]; cellSize?: number; columns?: number; rows?: number } }) {
    const origin = args.grid.origin ?? [0, 0]
    const cellSize = args.grid.cellSize ?? 20
    const width = Math.max(20, (args.grid.columns ?? 100) * cellSize)
    const height = Math.max(20, (args.grid.rows ?? 100) * cellSize)
    const x = origin[0]
    const y = origin[1]
    return {
      contour: [
        [x, y],
        [x + width, y],
        [x + width, y + height],
        [x, y + height],
        [x, y],
      ],
    }
  },
})
`,
  },
] as const

function relativeImports(source: string): string[] {
  return [...source.matchAll(/from\s+["'](\.[^"']+)["']/g)].map((match) => match[1]!)
}

function sha256(source: string): string {
  return createHash('sha256').update(source).digest('hex')
}

export function minimalSceneScaffoldManifest(): SceneScaffoldManifest {
  const paths = new Set(MINIMAL_SCENE_SCAFFOLD_FILES.map((item) => item.file))
  const files = MINIMAL_SCENE_SCAFFOLD_FILES.map((item) => {
    const imports = relativeImports(item.source)
    for (const specifier of imports) {
      const base = item.file.includes('/') ? item.file.slice(0, item.file.lastIndexOf('/') + 1) : ''
      const resolved = new URL(specifier, `file:///${base}`).pathname.slice(1)
      if (!paths.has(resolved)) {
        throw new Error(`minimal Scene scaffold has an unresolved relative import: ${item.file} -> ${specifier}`)
      }
    }
    return {
      path: item.file,
      kind: item.file.endsWith('.generator.ts') ? 'generator' as const : 'scene' as const,
      bytes: Buffer.byteLength(item.source),
      sha256: sha256(item.source),
      imports,
    }
  })
  return {
    version: '1.0',
    id: 'minimal-terrain',
    entryFile: 'main.scene.ts',
    description: 'A closed, compilable Scene Project with a terrain module and one project-local Generator.',
    files,
    closedImports: true,
  }
}
