import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  contractToOpSpec,
  defineAtomic,
  parseBatteryContractSpec,
  resolveAtomicContract,
  SceneContractRegistry,
  type AtomicNodeFunctionContract,
  type AtomicNodeFunctionContractDefinition,
} from '../index.js'

const definition: AtomicNodeFunctionContractDefinition = {
  functionName: 'sampleAtomic',
  contractVersion: '1.0.0',
  opId: 'sample_atomic',
  description: 'Exercise every public port field.',
  inputs: [
    {
      name: 'value',
      type: 'number',
      access: 'list',
      required: true,
      runtimePort: 'values',
      description: 'Input values.',
      mode: 'parameter',
      parameterTarget: { templateNodeId: 'inner', param: 'value' },
    },
  ],
  outputs: [
    {
      name: 'result',
      type: 'number',
      access: 'tree',
      required: false,
      runtimePort: 'result_tree',
      description: 'Computed values.',
      mode: 'value',
      parameterTarget: { param: 'result' },
    },
  ],
  runtimeDefaults: { precision: 2 },
  effects: { creates: ['sample'] },
  deterministic: true,
  contextDependencies: ['seed'],
}

describe('defineAtomic', () => {
  it('normalizes an omitted kind and preserves the complete contract', () => {
    const contract = defineAtomic(definition)

    expectTypeOf(contract).toEqualTypeOf<AtomicNodeFunctionContract>()
    expect(contract).toEqual({ ...definition, kind: 'atomic' })
    expect(contract.inputs).toEqual(definition.inputs)
    expect(contract.outputs).toEqual(definition.outputs)
  })

  it('accepts an explicit atomic kind', () => {
    expect(defineAtomic({ ...definition, kind: 'atomic' }).kind).toBe('atomic')
  })

  it('rejects a non-atomic kind at runtime', () => {
    expect(() =>
      defineAtomic({
        ...definition,
        kind: 'group',
      } as unknown as AtomicNodeFunctionContractDefinition),
    ).toThrow("defineAtomic only accepts kind 'atomic'")
  })

  it('rejects a missing or blank atomic operation id at runtime', () => {
    expect(() =>
      defineAtomic({
        ...definition,
        opId: '  ',
      }),
    ).toThrow('defineAtomic requires a non-empty opId')
  })
})

describe('contractToOpSpec', () => {
  it('maps identity, defaults, and palette titles from the contract', () => {
    const spec = contractToOpSpec(defineAtomic({
      ...definition,
      label: '中点位移',
      nameEn: 'GridMidpoint',
      inputs: [
        {
          name: 'power',
          type: 'number',
          access: 'item',
          defaultValue: 6,
          mode: 'parameter',
          label: '幂次',
          options: ['a', 'b'],
        },
      ],
    }))

    expect(spec.id).toBe('sample_atomic')
    expect(spec.name).toBe('中点位移')
    expect(spec.nameEn).toBe('GridMidpoint')
    expect(spec.params).toEqual([])
    expect(spec.inputs).toEqual([
      expect.objectContaining({
        name: 'power',
        type: 'number',
        required: true,
        default: 6,
        label: '幂次',
        options: ['a', 'b'],
        access: 'item',
      }),
    ])
    expect(spec.manualTrigger).toBe(false)
  })

  it('falls back to functionName when no label is set', () => {
    expect(contractToOpSpec(defineAtomic(definition)).name).toBe('sampleAtomic')
  })

  it('marks ai_battery canvas nodes as manual trigger', () => {
    const spec = contractToOpSpec(defineAtomic({
      ...definition,
      canvas: { nodeType: 'ai_battery', hideOutputs: true },
    }))
    expect(spec.manualTrigger).toBe(true)
  })

  it('parseBatteryContractSpec reads a static defineAtomic source', () => {
    const spec = parseBatteryContractSpec(
      '/tmp/perlin_noise',
      `import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'perlinNoise',
  contractVersion: '1.0.0',
  opId: 'perlin_noise',
  label: 'Perlin 噪声',
  nameEn: 'PerlinNoise',
  inputs: [{ name: 'fractal', type: 'string', access: 'item', defaultValue: 'none', options: ['none', 'fbm'] }],
  outputs: [{ name: 'grid', type: 'grid', access: 'item' }],
})
`,
    )
    expect(spec.id).toBe('perlin_noise')
    expect(spec.name).toBe('Perlin 噪声')
    expect(spec.inputs[0]).toEqual(expect.objectContaining({
      name: 'fractal',
      default: 'none',
      options: ['none', 'fbm'],
    }))
  })
})

describe('resolveAtomicContract', () => {
  it('requires runtime discriminators for shared dynamic opIds', () => {
    const points = defineAtomic({ ...definition, functionName: 'mergePoints', opId: 'tree_merge', runtimeDefaults: { inferredType: 'point2d' } })
    const scenes = defineAtomic({ ...definition, functionName: 'mergeScenes', opId: 'tree_merge', runtimeDefaults: { inferredType: 'scene' } })
    const registry = new SceneContractRegistry([points, scenes])

    expect(resolveAtomicContract(registry, 'tree_merge')).toBeUndefined()
    expect(resolveAtomicContract(registry, 'tree_merge', { inferredType: 'scene' })?.functionName).toBe('mergeScenes')
  })
})
