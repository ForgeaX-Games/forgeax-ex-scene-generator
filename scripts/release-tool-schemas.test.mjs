import assert from 'node:assert/strict'
import test from 'node:test'

import { materializeToolSchemas } from './release-tool-schemas.mjs'

test('materializes every release tool schema as a deterministic package-local JSON file', () => {
  const written = new Map()
  const referenced = new Map([
    ['./schemas/source.args.json', { type: 'object', required: ['name'], properties: { name: { type: 'string' } } }],
  ])
  const inlineArgs = { type: 'object', additionalProperties: false }
  const inlineReturns = { type: 'array', items: { type: 'string' } }

  const tools = materializeToolSchemas([
    { id: 'scene:alpha.run', args: inlineArgs, returns: inlineReturns, exposedToAI: true },
    { id: 'scene:beta/run', args: './schemas/source.args.json' },
    { id: 'scene:gamma' },
  ], {
    indexOffset: 7,
    readSchema: (reference) => referenced.get(reference),
    writeSchema: (reference, schema) => written.set(reference, schema),
  })

  assert.deepEqual(tools.map(({ args, returns }) => ({ args, returns })), [
    {
      args: './schemas/tools/007-scene-alpha.run.args.json',
      returns: './schemas/tools/007-scene-alpha.run.returns.json',
    },
    {
      args: './schemas/tools/008-scene-beta-run.args.json',
      returns: undefined,
    },
    {
      args: './schemas/tools/009-scene-gamma.args.json',
      returns: undefined,
    },
  ])
  assert.deepEqual(written.get(tools[0].args), inlineArgs)
  assert.deepEqual(written.get(tools[0].returns), inlineReturns)
  assert.deepEqual(written.get(tools[1].args), referenced.get('./schemas/source.args.json'))
  assert.deepEqual(written.get(tools[2].args), { type: 'object', additionalProperties: false })
  assert.equal(tools[0].exposedToAI, true)
})

test('rejects schema values that are neither object documents nor string references', () => {
  assert.throws(() => materializeToolSchemas([
    { id: 'scene:invalid', args: 42 },
  ], {
    writeSchema: () => {},
  }), /scene:invalid args must be a JSON Schema object or path reference/u)
})

test('preserves fragment references and rejects external references that relocation would break', () => {
  const written = new Map()
  const fragmentSchema = {
    type: 'object',
    $defs: { name: { type: 'string' } },
    properties: { name: { $ref: '#/$defs/name' } },
  }
  materializeToolSchemas([
    {
      id: 'scene:fragment',
      args: fragmentSchema,
    },
  ], {
    writeSchema: (reference, schema) => written.set(reference, schema),
  })
  assert.equal(written.size, 1)
  assert.deepEqual([...written.values()][0], fragmentSchema)

  assert.throws(() => materializeToolSchemas([
    { id: 'scene:external', args: { $ref: './definitions.json' } },
  ], {
    writeSchema: () => {},
  }), /scene:external args contains an external JSON Schema reference that cannot be relocated/u)
})
