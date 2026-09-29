import { describe, expect, it } from 'vitest'

import { parseGeneratorContractSource } from './generator-parser.js'

describe('parseGeneratorContractSource', () => {
  it('loads exported static contracts without executing module code', () => {
    const result = parseGeneratorContractSource(`
      import { defineGenerator } from '@forgeax/project-generator'
      throw new Error('must not execute')
      export const coastalTerrain = defineGenerator({
        id: "coastal-terrain",
        version: "1.0.0",
        description: "Coast.",
        inputs: {
          seed: { type: NumberValue, defaultValue: 1 },
          coastline: { type: Any, runtimeType: "curve" },
        },
        outputs: {
          terrain: { type: Any, runtimeType: "heightfield" },
        },
        run(ctx, args) {
          return { terrain: args }
        },
      })
    `, 'generators/coastal-terrain.generator.ts')

    expect(result.diagnostics).toEqual([])
    expect(result.exports).toEqual([
      expect.objectContaining({
        exportName: 'coastalTerrain',
        contract: expect.objectContaining({
          kind: 'atomic',
          functionName: 'coastalTerrain',
          opId: 'local/coastal-terrain',
          definitionId: 'coastal-terrain',
          sourceKind: 'generator',
          sourceFile: 'generators/coastal-terrain.generator.ts',
        }),
      }),
    ])
  })

  it('defaults omitted version and maps Geometry / Heightfield identifiers', async () => {
    const result = parseGeneratorContractSource(`
      import { defineGenerator } from '@forgeax/project-generator'
      export const streetTrees = defineGenerator({
        id: "street-trees",
        inputs: { geometry: Geometry, spacing: { type: NumberValue, defaultValue: 8 } },
        outputs: { heights: Heightfield },
        run(ctx, args) {
          return { heights: args }
        },
      })
    `, 'generators/street-trees.generator.ts')

    expect(result.diagnostics).toEqual([])
    expect(result.exports[0]?.meta.version).toBe('1')
    expect(result.exports[0]?.contract.inputs).toEqual([
      expect.objectContaining({ name: 'geometry', type: 'geometry' }),
      expect.objectContaining({ name: 'spacing', type: 'number', defaultValue: 8 }),
    ])
    expect(result.exports[0]?.contract.outputs).toEqual([
      expect.objectContaining({ name: 'heights', type: 'heightfield' }),
    ])
  })

  it('rejects a missing export and dynamic contract fields', () => {
    const missing = parseGeneratorContractSource('const x = 1\n', 'empty.generator.ts')
    expect(missing.exports).toEqual([])
    expect(missing.diagnostics[0]?.code).toBe('SCENE_GENERATOR_CONTRACT_MISSING')

    const dynamic = parseGeneratorContractSource(`
      export const bad = defineGenerator({
        id: makeId(),
        version: "1",
        inputs: {},
        outputs: {},
        run() { return {} },
      })
    `, 'bad.generator.ts')
    expect(dynamic.exports).toEqual([])
    expect(dynamic.diagnostics[0]?.code).toBe('SCENE_GENERATOR_CONTRACT_STATIC')
  })

  it('accepts TS aliases, string literals, and numeric versions', () => {
    const result = parseGeneratorContractSource(`
      import { defineGenerator } from '@forgeax/project-generator'
      export const valleyTerrain = defineGenerator({
        version: 1,
        description: "Valley terrain generator.",
        inputs: {
          width: 'number',
          height: { type: 'scalar', defaultValue: 100 },
          seed: number,
        },
        outputs: {
          heightGrid: 'number[][]',
          preview: 'grid',
        },
        run(ctx, args) {
          return { heightGrid: [], preview: [] }
        },
      })
    `, 'generators/valley.generator.ts')

    expect(result.diagnostics).toEqual([])
    expect(result.exports[0]?.exportName).toBe('valleyTerrain')
    expect(result.exports[0]?.meta.id).toBe('valley-terrain')
    expect(result.exports[0]?.meta.version).toBe('1')
    expect(result.exports[0]?.contract.inputs).toEqual([
      expect.objectContaining({ name: 'width', type: 'number' }),
      expect.objectContaining({ name: 'height', type: 'number', defaultValue: 100 }),
      expect.objectContaining({ name: 'seed', type: 'number' }),
    ])
    expect(result.exports[0]?.contract.outputs).toEqual([
      expect.objectContaining({ name: 'heightGrid', type: 'grid' }),
      expect.objectContaining({ name: 'preview', type: 'grid' }),
    ])
  })
})
