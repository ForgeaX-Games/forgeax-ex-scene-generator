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

  it('defaults omitted version and maps spatial port identifiers', () => {
    const result = parseGeneratorContractSource(`
      import { defineGenerator } from '@forgeax/project-generator'
      export const streetTrees = defineGenerator({
        id: "street-trees",
        inputs: { network: RoadNetwork, spacing: { type: NumberValue, defaultValue: 8 } },
        outputs: { placements: PlacementSet },
        run(ctx, args) {
          return { placements: { placements: [] } }
        },
      })
    `, 'generators/street-trees.generator.ts')

    expect(result.diagnostics).toEqual([])
    expect(result.exports[0]?.meta.version).toBe('1')
    expect(result.exports[0]?.contract.inputs).toEqual([
      expect.objectContaining({ name: 'network', type: 'any', runtimeType: 'road-network' }),
      expect.objectContaining({ name: 'spacing', type: 'number', defaultValue: 8 }),
    ])
    expect(result.exports[0]?.contract.outputs).toEqual([
      expect.objectContaining({ name: 'placements', type: 'any', runtimeType: 'placement-set' }),
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
})
