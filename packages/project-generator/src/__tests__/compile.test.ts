import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { compileGeneratorFile } from '../compile.js'
import { diagnoseGeneratorImport } from '../imports.js'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('Generator compile', () => {
  it('rejects npm, Node builtins, dynamic import, and reverse scene imports', () => {
    expect(diagnoseGeneratorImport('g.generator.ts', 'fs')?.code).toBe('GENERATOR_IMPORT_BUILTIN')
    expect(diagnoseGeneratorImport('g.generator.ts', 'lodash')?.code).toBe('GENERATOR_IMPORT_NPM')
    expect(diagnoseGeneratorImport('g.generator.ts', './city.scene.ts')?.code).toBe('GENERATOR_IMPORT_DAG')
    expect(diagnoseGeneratorImport('g.generator.ts', './lib/rng.generator-lib.ts')).toBeUndefined()
    expect(diagnoseGeneratorImport('g.generator.ts', '@forgeax/project-generator/geom')).toBeUndefined()
  })

  it('parses a static contract and bundles a helper closure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'generator-compile-'))
    dirs.push(root)
    await mkdir(join(root, 'generators', 'lib'), { recursive: true })
    await writeFile(join(root, 'generators', 'lib', 'rng.generator-lib.ts'), `
      export function twice(value: number): number { return value * 2 }
    `)
    await writeFile(join(root, 'generators', 'double.generator.ts'), `
      import { defineGenerator } from '@forgeax/project-generator'
      import { twice } from './lib/rng.generator-lib.ts'
      export const doubleValue = defineGenerator({
        id: "double-value",
        version: "1.0.0",
        description: "Double a number.",
        inputs: { value: { type: NumberValue, defaultValue: 2 } },
        outputs: { value: { type: NumberValue } },
        run(_ctx, args: { value: number }) {
          return { value: twice(args.value) }
        },
      })
    `)
    const result = await compileGeneratorFile(root, 'generators/double.generator.ts')
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([])
    expect(result.artifacts[0]?.opId).toBe('local/double-value')
    expect(result.artifacts[0]?.contract.functionName).toBe('doubleValue')
    expect(result.artifacts[0]?.bundle).toContain('twice')
  })

  it('accepts omitted version, spatial ports, and SDK geom imports', async () => {
    const root = await mkdtemp(join(tmpdir(), 'generator-geom-'))
    dirs.push(root)
    await mkdir(join(root, 'generators'), { recursive: true })
    await writeFile(join(root, 'generators', 'trees.generator.ts'), `
      import { defineGenerator } from '@forgeax/project-generator'
      import { dist, resamplePolyline } from '@forgeax/project-generator/geom'
      export const streetTrees = defineGenerator({
        id: "street-trees",
        inputs: { network: RoadNetwork },
        outputs: { placements: PlacementSet, length: NumberValue },
        run(_ctx, args: { network: { segments: Array<{ points: number[][] }> } }) {
          const line = args.network.segments[0]?.points ?? [[0, 0], [10, 0]]
          return {
            placements: { placements: resamplePolyline(line as [number, number][], 4).map((position) => ({ position })) },
            length: dist(line[0] as [number, number], line[line.length - 1] as [number, number]),
          }
        },
      })
    `)
    const result = await compileGeneratorFile(root, 'generators/trees.generator.ts')
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([])
    expect(result.artifacts[0]?.contract.definitionVersion).toBe('1')
    expect(result.artifacts[0]?.contract.inputs[0]).toEqual(
      expect.objectContaining({ name: 'network', type: 'any', runtimeType: 'road-network' }),
    )
    expect(result.artifacts[0]?.bundle).toContain('resamplePolyline')
  })

  it('rejects a cyclic helper import', async () => {
    const root = await mkdtemp(join(tmpdir(), 'generator-cycle-'))
    dirs.push(root)
    await mkdir(join(root, 'generators', 'lib'), { recursive: true })
    await writeFile(join(root, 'generators', 'lib', 'a.generator-lib.ts'), `import { b } from "./b.generator-lib.ts"\nexport const a = b\n`)
    await writeFile(join(root, 'generators', 'lib', 'b.generator-lib.ts'), `import { a } from "./a.generator-lib.ts"\nexport const b = a\n`)
    await writeFile(join(root, 'generators', 'cycle.generator.ts'), `
      import { defineGenerator } from '@forgeax/project-generator'
      import { a } from './lib/a.generator-lib.ts'
      export const cycle = defineGenerator({
        id: "cycle",
        version: "1",
        inputs: {},
        outputs: { value: { type: NumberValue } },
        run() { return { value: a } },
      })
    `)
    const result = await compileGeneratorFile(root, 'generators/cycle.generator.ts')
    expect(result.diagnostics.some((item) => item.code === 'GENERATOR_IMPORT_CYCLE')).toBe(true)
    const cycle = result.diagnostics.find((item) => item.code === 'GENERATOR_IMPORT_CYCLE')
    expect(cycle?.howToFix?.length).toBeGreaterThan(0)
    expect(cycle?.repairSlip).toContain('How to fix:')
  })
})
