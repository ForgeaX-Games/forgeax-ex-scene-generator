import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import type { ContractRegistry, NodeFunctionContract } from '../../../../packages/scene-authoring/src/index.ts'
import { buildSourceMapEvidence } from './source-map-evidence.mts'

const numberValue: NodeFunctionContract = {
  functionName: 'numberValue',
  kind: 'atomic',
  contractVersion: '1.0.0',
  opId: 'number_value',
  description: 'Produces a number.',
  inputs: [],
  outputs: [{ name: 'value', type: 'number' }],
}

function registry(contracts: NodeFunctionContract[]): ContractRegistry {
  return {
    get: (name) => contracts.find((contract) => contract.functionName === name),
    list: () => contracts,
  }
}

test('atomic evidence compiles a typed producer and reproduces IDs', async () => {
  const target: NodeFunctionContract = {
    functionName: 'consumeNumber',
    kind: 'atomic',
    contractVersion: '1.0.0',
    opId: 'consume_number',
    description: 'Consumes a number.',
    inputs: [{ name: 'input', type: 'number', required: true, mode: 'value' }],
    outputs: [{ name: 'value', type: 'number' }],
  }
  const evidence = await buildSourceMapEvidence({
    entries: [{
      cellId: 'atomic:consume_number',
      opId: 'consume_number',
      kind: 'atomic',
      status: 'ready',
    }],
  }, registry([numberValue, target]), '/unused')
  const sourceMap = evidence['atomic:consume_number'].sourceMap
  assert.equal('status' in sourceMap, false)
  assert.equal(sourceMap.kind, 'atomic')
  assert.match(JSON.stringify(sourceMap), /fixture-producer/)
  assert.equal(sourceMap.variants[0].secondCompilationIdentical, true)
  assert.equal(sourceMap.variants[0].runtimeEdgeIds.length, 1)
})

test('canonical group and template Definitions reproduce origin identities', async () => {
  const root = await mkdtemp(join(tmpdir(), 'source-map-evidence-'))
  try {
    const directory = join(root, 'defs')
    await mkdir(directory)
    await writeFile(join(directory, 'example.scene.ts'), `
export const exampleGroup = defineGroup(
  {
    id: "scene.example",
    version: "1.0.0",
    inputs: {},
    outputs: { value: { type: NumberValue, runtimeType: "number" } },
  },
  ({}) => {
    // @scene-id internal-number
    const value = numberValue({})
    return { value: value.value }
  },
)
`)
    const entries = (['group', 'template'] as const).map((kind) => ({
      cellId: `${kind}:example`,
      opId: 'example',
      kind,
      functionNameSuggestion: 'exampleGroup',
      source: 'defs/example.json',
      status: 'ready',
    }))
    const evidence = await buildSourceMapEvidence({ entries }, registry([numberValue]), root)
    for (const kind of ['group', 'template'] as const) {
      const sourceMap = evidence[`${kind}:example`].sourceMap
      assert.equal('status' in sourceMap, false, JSON.stringify(sourceMap))
      assert.equal(sourceMap.kind, kind)
      assert.equal(sourceMap.definitionId, 'scene.example')
      assert.equal(sourceMap.definitionVersion, '1.0.0')
      assert.equal(sourceMap.instancePath, sourceMap.entityId)
      assert.deepEqual(Object.keys(sourceMap.runtimeOrigins).sort(), [...sourceMap.runtimeNodeIds].sort())
      assert.equal(sourceMap.secondCompilationIdentical, true)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
