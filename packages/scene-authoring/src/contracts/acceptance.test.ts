import { describe, expect, it } from 'vitest'
import { AcceptanceCoverageMatrix, SceneContractRegistry } from '../index.js'
import type { NodeFunctionContract } from '../index.js'

const atomic: NodeFunctionContract = {
  functionName: 'emptyScene',
  kind: 'atomic',
  contractVersion: '1.0.0',
  opId: 'empty_scene',
  description: 'empty',
  inputs: [],
  outputs: [{ name: 'scene', type: 'scene' }],
}

describe('AcceptanceCoverageMatrix', () => {
  it('does not confuse a callable contract with full equivalence', () => {
    const registry = new SceneContractRegistry([atomic])
    const record = new AcceptanceCoverageMatrix().record(registry.get('emptyScene'), 'emptyScene')
    expect(record.status).toBe('script-callable')
    expect(record.passedGates).toEqual(['contract'])
    expect(record.missingGates).toContain('execute')
  })

  it('requires every gate before promoting an authoring capability', () => {
    const registry = new SceneContractRegistry([atomic])
    const record = new AcceptanceCoverageMatrix({
      'atomic:empty_scene': ['contract', 'roundTrip', 'graphWriteBack', 'execute', 'sourceMap', 'capability', 'visual'],
    }).record(registry.get('emptyScene'), 'emptyScene')
    expect(record.key).toBe('atomic:empty_scene')
    expect(record.status).toBe('equivalence-verified')
    expect(record.missingGates).toEqual([])
  })

  it('uses kind-qualified function names for composite definitions', () => {
    const group: NodeFunctionContract = {
      ...atomic,
      functionName: 'addBaseGrid',
      kind: 'template',
      opId: undefined,
      definitionId: 'scene.template.add-base-grid',
    }
    const record = new AcceptanceCoverageMatrix({
      'template:addBaseGrid': ['contract', 'roundTrip', 'graphWriteBack', 'execute', 'sourceMap', 'capability', 'visual'],
    }).record(group, group.functionName)

    expect(record.key).toBe('template:addBaseGrid')
    expect(record.status).toBe('equivalence-verified')
  })

  it('does not promote a different kind with the same function name', () => {
    const group: NodeFunctionContract = {
      ...atomic,
      functionName: 'sharedName',
      kind: 'group',
      opId: undefined,
      definitionId: 'scene.group.shared',
    }
    const record = new AcceptanceCoverageMatrix({
      'template:sharedName': ['contract', 'roundTrip', 'graphWriteBack', 'execute', 'sourceMap', 'capability', 'visual'],
    }).record(group, group.functionName)

    expect(record.status).toBe('script-callable')
  })
})
