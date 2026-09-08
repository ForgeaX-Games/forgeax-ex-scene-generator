import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  defineAtomic,
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

describe('resolveAtomicContract', () => {
  it('requires runtime discriminators for shared dynamic opIds', () => {
    const points = defineAtomic({ ...definition, functionName: 'mergePoints', opId: 'tree_merge', runtimeDefaults: { inferredType: 'point2d' } })
    const scenes = defineAtomic({ ...definition, functionName: 'mergeScenes', opId: 'tree_merge', runtimeDefaults: { inferredType: 'scene' } })
    const registry = new SceneContractRegistry([points, scenes])

    expect(resolveAtomicContract(registry, 'tree_merge')).toBeUndefined()
    expect(resolveAtomicContract(registry, 'tree_merge', { inferredType: 'scene' })?.functionName).toBe('mergeScenes')
  })
})
