import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { OpRegistry } from '@forgeax/node-runtime/layer1'

import { runAtomicExecuteBatch } from './execute-gate.mts'

const inventory = (opId: string) => ({
  entries: [{
    cellId: `atomic:${opId}`,
    opId,
    kind: 'atomic',
    category: 'common/test',
    status: 'ready',
  }],
})

test('execute gate invokes a live registered op with DataTree-wrapped defaults', async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), 'scene-execute-gate-'))
  try {
    const registry = new OpRegistry()
    let received: unknown
    registry.register({
      id: 'tested_op',
      inputs: [{ name: 'amount', type: 'number', default: 7 }],
      outputs: [{ name: 'result', type: 'number' }],
      params: [],
      execute: (_context, args) => {
        received = args.amount
        return { result: Number(args.amount) * 2 }
      },
    })
    const evidence = await runAtomicExecuteBatch({
      inventory: inventory('tested_op'),
      registry,
      fixtureDir,
    })
    assert.equal(received, 7)
    assert.equal(evidence['atomic:tested_op']?.execute.status, 'pass')
    assert.deepEqual(
      evidence['atomic:tested_op']?.execute.evidence.outputPorts,
      { result: { branches: 1, items: 1, paths: [[0, 0]] } },
    )
  } finally {
    await rm(fixtureDir, { recursive: true, force: true })
  }
})

test('execute gate records conditional output omissions without inventing output evidence', async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), 'scene-execute-gate-'))
  try {
    const registry = new OpRegistry()
    registry.register({
      id: 'broken_op',
      inputs: [],
      outputs: [{ name: 'required', type: 'string' }],
      params: [],
      execute: () => ({}),
    })
    const evidence = await runAtomicExecuteBatch({
      inventory: inventory('broken_op'),
      registry,
      fixtureDir,
    })
    const gate = evidence['atomic:broken_op']!.execute
    assert.equal(gate.status, 'pass')
    assert.match(gate.reason, /conditional output ports/)
    assert.deepEqual(gate.evidence.missingOutputs, ['required'])
  } finally {
    await rm(fixtureDir, { recursive: true, force: true })
  }
})
