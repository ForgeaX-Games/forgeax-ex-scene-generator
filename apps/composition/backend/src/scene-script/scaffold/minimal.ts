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
`,
  },
  {
    file: 'terrain.scene.ts',
    source: `// @scene-module-id starter.terrain
import { basinHeights } from "./generators/basin-heights.generator.ts"

const world = basePlane({
  origin: [0, 0],
  width: 100,
  height: 100,
})

const heights = basinHeights({
  width: 100,
  height: 100,
  depth: 18,
  seed: 23,
})

const field = heightfield({
  geometry: world.geometry,
  grid: heights.heightGrid,
})

export const terrain = heightfieldMesh({
  heightfield: field,
})
`,
  },
  {
    file: 'generators/basin-heights.generator.ts',
    source: `import { defineGenerator } from '@forgeax/project-generator'

export const basinHeights = defineGenerator({
  id: 'basin-heights',
  version: '1.0.0',
  description: 'Project-local height Grid for a round basin. Not a platform primitive.',
  inputs: {
    width: { type: 'NumberValue', defaultValue: 100 },
    height: { type: 'NumberValue', defaultValue: 100 },
    depth: { type: 'NumberValue', defaultValue: 18 },
    seed: { type: 'NumberValue', defaultValue: 23 },
  },
  outputs: {
    heightGrid: { type: 'Grid', runtimeType: 'grid' },
  },
  run(_ctx, args: { width: number; height: number; depth: number; seed: number }) {
    const columns = Math.max(8, Math.round(args.width))
    const rows = Math.max(8, Math.round(args.height))
    const cx = (columns - 1) / 2
    const cy = (rows - 1) / 2
    const radius = Math.max(cx, cy) * 0.72
    const heightGrid: number[][] = []
    for (let y = 0; y < rows; y++) {
      const row: number[] = []
      for (let x = 0; x < columns; x++) {
        const dx = (x - cx) / radius
        const dy = (y - cy) / radius
        const t = Math.min(1, Math.sqrt(dx * dx + dy * dy))
        row.push(args.depth * t * t)
      }
      heightGrid.push(row)
    }
    return { heightGrid }
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
    description: 'Internal leftover mesh-only package: project-local height Generator → heightfield → heightfieldMesh. Not Sino bootstrap.',
    files,
    closedImports: true,
  }
}
