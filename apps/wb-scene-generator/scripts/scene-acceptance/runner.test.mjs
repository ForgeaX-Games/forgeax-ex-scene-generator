import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  GATES,
  digest,
  execute,
  parseArgs,
  selectCells,
  validatePromoted,
} from './runner-core.mjs'

const contract = {
  functionName: 'example',
  kind: 'atomic',
  contractVersion: '1.0.0',
  description: 'Example.',
  inputs: [],
  outputs: [{ name: 'value', type: 'number' }],
  deterministic: true,
}

const inventory = {
  schemaVersion: 1,
  cells: [
    {
      id: 'example.cell',
      batch: 'pilot',
      contract: { functionName: 'example', expected: contract },
    },
  ],
}

test('parses selectors and retry flags', () => {
  assert.deepEqual(
    parseArgs(['--batch', 'one,two', '--cell', 'a', '--resume', '--retry-failed']),
    {
      batches: ['one', 'two'],
      cells: ['a'],
      resume: true,
      retryFailed: true,
      json: false,
    },
  )
})

test('all implemented gates pass with reproducible evidence', async () => {
  const checkpoint = await execute({
    inventory,
    promoted: { schemaVersion: 1, promotions: [] },
    promotedPath: '/tmp/promoted.json',
    options: parseArgs([]),
    contracts: [contract],
    gateEvidence: {
      'example.cell': {
        roundTrip: { canonical: true },
        graphWriteBack: { reverseFunction: 'example' },
        execute: {
          status: 'pass',
          reason: 'executed',
          evidence: { executionStatus: 'completed', outputPorts: ['value'] },
        },
        sourceMap: { statementId: 'fixture-target', entityId: 'node_example' },
        capability: { policy: 'public-atomic' },
        visual: { evidenceId: 'visual-example', screenshots: ['/tmp/example.png'], explicitCellMapping: true },
      },
    },
  })
  assert.equal(checkpoint.status, 'pass')
  assert.equal(checkpoint.cells['example.cell'].gates.contract.status, 'pass')
  assert.equal(checkpoint.cells['example.cell'].gates.roundTrip.status, 'pass')
  assert.equal(checkpoint.cells['example.cell'].gates.graphWriteBack.status, 'pass')
  assert.equal(checkpoint.cells['example.cell'].gates.execute.status, 'pass')
  assert.equal(checkpoint.cells['example.cell'].gates.sourceMap.status, 'pass')
  assert.equal(checkpoint.cells['example.cell'].gates.capability.status, 'pass')
  assert.equal(checkpoint.cells['example.cell'].gates.visual.status, 'pass')
})

test('sourceMap fixture failures are reported instead of passing', async () => {
  const checkpoint = await execute({
    inventory,
    promoted: { schemaVersion: 1, promotions: [] },
    promotedPath: '/tmp/promoted.json',
    options: parseArgs([]),
    contracts: [contract],
    gateEvidence: {
      'example.cell': {
        roundTrip: { canonical: true },
        graphWriteBack: { reverseFunction: 'example' },
        execute: { status: 'pending', reason: 'not part of this focused assertion' },
        sourceMap: {
          status: 'failed',
          reason: 'no constructible typed fixture producer for example.input (Scene)',
        },
        capability: { policy: 'public-atomic' },
      },
    },
  })
  assert.equal(checkpoint.cells['example.cell'].gates.sourceMap.status, 'failed')
  assert.match(checkpoint.cells['example.cell'].gates.sourceMap.reason, /typed fixture producer/)
})

test('resume skips pass and retry-failed selects only failures', () => {
  const previous = {
    cells: {
      'example.cell': { status: 'failed' },
    },
  }
  assert.deepEqual(
    selectCells(inventory, parseArgs(['--retry-failed']), previous).map((cell) => cell.id),
    ['example.cell'],
  )
  previous.cells['example.cell'].status = 'pass'
  assert.deepEqual(selectCells(inventory, parseArgs(['--resume']), previous), [])
})

test('promoted evidence requires a current checkpoint with seven passes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'scene-acceptance-'))
  try {
    const cellResult = {
      id: 'example.cell',
      batch: 'pilot',
      status: 'pass',
      gates: Object.fromEntries(GATES.map((gate) => {
        const evidence = { gate, observed: true }
        return [gate, { status: 'pass', evidence, evidenceDigest: digest(evidence) }]
      })),
    }
    const checkpointPath = join(directory, 'checkpoint.json')
    await writeFile(checkpointPath, JSON.stringify({
      schemaVersion: 1,
      inventoryDigest: digest(inventory),
      cells: { 'example.cell': cellResult },
    }))
    const promoted = {
      schemaVersion: 1,
      promotions: [{
        cellId: 'example.cell',
        checkpoint: 'checkpoint.json',
        evidenceDigest: digest(cellResult),
      }],
    }
    assert.deepEqual(
      await validatePromoted(promoted, inventory, join(directory, 'promoted.json')),
      { status: 'pass', checked: 1 },
    )
    promoted.promotions[0].evidenceDigest = 'tampered'
    const invalid = await validatePromoted(promoted, inventory, join(directory, 'promoted.json'))
    assert.equal(invalid.status, 'failed')
    assert.match(invalid.errors.join('\n'), /evidence digest mismatch/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('coverage cannot promote an unpromoted contract identity', async () => {
  const validationInventory = {
    schemaVersion: 1,
    cells: [{
      id: 'atomic:example_op',
      batch: 'atomic',
      contract: {
        functionName: 'example',
        inventoryEntry: {
          kind: 'atomic',
          opId: 'example_op',
          functionNameSuggestion: 'example',
        },
      },
    }],
  }
  const promoted = {
    schemaVersion: 1,
    promotions: [],
    coverage: {
      'atomic:example_op': [...GATES],
    },
  }

  const result = await validatePromoted(promoted, validationInventory, '/tmp/promoted.json')

  assert.equal(result.status, 'failed')
  assert.match(result.errors.join('\n'), /coverage must exactly match/)
})
