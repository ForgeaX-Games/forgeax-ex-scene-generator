import { describe, expect, it } from 'vitest'

import { createSceneArtifact, replaySceneArtifact, verifySceneArtifact } from './artifact.js'
import { SceneContractRegistry } from '../contracts/contracts.js'
import { liftLegacyRuntimeGraph, runtimeGraphSemanticHash } from './lift.js'
import type { NodeFunctionContract, SceneModuleAst } from '../model/types.js'

const contracts: NodeFunctionContract[] = [
  {
    functionName: 'numberValue',
    kind: 'atomic',
    contractVersion: '1',
    opId: 'number_value',
    description: 'number',
    inputs: [{ name: 'value', type: 'number', mode: 'parameter' }],
    outputs: [{ name: 'value', type: 'number', runtimePort: 'out' }],
  },
  {
    functionName: 'consumeNumber',
    kind: 'atomic',
    contractVersion: '1',
    opId: 'consume_number',
    description: 'consumer',
    inputs: [{ name: 'amount', type: 'number', runtimePort: 'in', mode: 'value', required: true }],
    outputs: [{ name: 'value', type: 'number', runtimePort: 'out' }],
  },
  {
    functionName: 'nestedTemplate',
    kind: 'template',
    contractVersion: '1',
    definitionId: 'scene.nested-template',
    definitionVersion: '1.0.0',
    description: 'nested template',
    inputs: [],
    outputs: [],
    definition: {
      id: 'root',
      nodes: [{ id: 'child', opId: '__group__', params: { groupId: 'nested' } }],
      edges: [],
      _nestedGroups: [{
        id: 'nested',
        nodes: [{ id: 'inner', opId: 'number_value', params: { value: 1 } }],
        edges: [],
      }],
    },
  },
]

describe('legacy Runtime Graph lift', () => {
  it('lifts unique atomics, semantic ports, and explicit value calls', async () => {
    const result = await liftLegacyRuntimeGraph({
      nodes: [
        { id: 'n1', opId: 'number_value', position: { x: 0, y: 0 }, params: { value: 7 } },
        { id: 'n2', opId: 'consume_number', position: { x: 1, y: 0 }, params: {} },
      ],
      edges: [{ id: 'e1', source: { nodeId: 'n1', port: 'out' }, target: { nodeId: 'n2', port: 'in' } }],
      groups: [],
    }, new SceneContractRegistry(contracts), { projectId: 'p1' })
    expect(result.canonical).toBe(true)
    expect(result.source).toContain('const numberValue = numberValue({')
    expect(result.source).toContain('amount: numberValue.value')
    expect(result.diagnostics.every((item) => item.confidence === 'high')).toBe(true)
  })

  it('keeps ambiguous graphs read-only with a rawGraph escape hatch', async () => {
    const result = await liftLegacyRuntimeGraph({
      nodes: [{ id: 'unknown', opId: 'missing', position: { x: 0, y: 0 }, params: {} }],
      edges: [],
      groups: [],
    }, new SceneContractRegistry(contracts), { projectId: 'p2' })
    expect(result.canonical).toBe(false)
    expect(result.readOnly).toBe(true)
    expect(result.rawGraph).toBeDefined()
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      entityId: 'unknown',
      confidence: 'low',
      requiresConfirmation: true,
    }))
  })

  it('recognizes nested templates and verifies graph/result semantic parity', async () => {
    const graph = {
      nodes: [{
        id: 'root-instance',
        opId: '__group__',
        position: { x: 0, y: 0 },
        params: {
          groupId: 'root-instance',
          __sceneScriptDefinitionId: 'scene.nested-template',
          __sceneScriptDefinitionVersion: '1.0.0',
        },
      }],
      edges: [],
      groups: [{
        id: 'root-instance',
        name: 'Nested',
        position: { x: 0, y: 0 },
        nodes: [{ id: 'child-instance', opId: '__group__', position: { x: 0, y: 0 }, params: { groupId: 'nested-instance' } }],
        edges: [],
        exposedInputs: [],
        exposedOutputs: [],
        _nestedGroups: [{
          id: 'nested-instance',
          name: 'Inner',
          position: { x: 0, y: 0 },
          nodes: [{ id: 'inner-instance', opId: 'number_value', position: { x: 0, y: 0 }, params: { value: 1 } }],
          edges: [],
          exposedInputs: [],
          exposedOutputs: [],
        }],
      }],
    }
    const result = await liftLegacyRuntimeGraph(
      graph,
      new SceneContractRegistry(contracts),
      { projectId: 'nested', execute: async (value) => ({ resultHash: runtimeGraphSemanticHash(value) }) },
    )
    expect(result.canonical).toBe(true)
    expect(result.semanticParity).toEqual(expect.objectContaining({
      graphEquivalent: true,
      resultEquivalent: true,
    }))
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      entityKind: 'group',
      confidence: 'high',
    }))
  })
})

describe('Scene model artifact', () => {
  it('is deterministic and replays only from canonical AST/source', () => {
    const module: SceneModuleAst = {
      moduleId: 'm1',
      file: 'main.scene.ts',
      imports: [],
      exports: [],
      definitions: [],
      statements: [],
    }
    const input = {
      projectId: 'p1',
      project: { entryModuleId: 'm1', modules: { m1: module } },
      sources: { 'main.scene.ts': '// @scene-module-id m1\n' },
      compilerVersion: '1',
      sceneScriptVersion: '1',
      runtimeSnapshot: { nodes: [] },
    }
    const first = createSceneArtifact(input)
    const second = createSceneArtifact(input)
    expect(first).toEqual(second)
    expect(verifySceneArtifact(first)).toEqual({ valid: true, diagnostics: [] })
    expect(replaySceneArtifact(first)).toEqual(input.project)
  })
})
