/**
 * Wire-shape regression tests for `POST /nodes/outputs/batch`.
 *
 * The route assembles its response body by splicing per-port, already-serialized
 * JSON fragments together instead of calling `JSON.stringify` on the whole result
 * array (a reassembled sharded scene port would otherwise be serialized twice —
 * once to measure it against the response cap, once to send it — which is
 * seconds of event-loop-blocking CPU per request on a large map). Hand-assembled
 * JSON has to match what `JSON.stringify({ results })` produced byte-for-byte in
 * shape, so these tests pin the contract the preview bridge and the editor store
 * both parse: `value` present only when there is one, `meta` always present,
 * `tooLarge`/`estimatedBytes` only on deferred ports, and correct escaping of
 * ids that contain JSON metacharacters.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'

import { createRuntime, type Runtime } from '@forgeax/node-runtime'
import { registerProjectPipelineRoutes } from '../src/routes/projectPipeline.js'

const PROJECT_ID = 'p_test'

let scratch: string
let app: FastifyInstance
let runtime: Runtime

/** Post to the batch route and return the parsed body. */
async function batch(
  ports: Array<{ nodeId: string; portId: string }>,
  metaOnly = false,
): Promise<{
  results: Array<{
    nodeId: string
    portId: string
    value?: unknown
    meta: { executedHash?: string; valid?: boolean } | null
    tooLarge?: boolean
  }>
}> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${PROJECT_ID}/nodes/outputs/batch`,
    payload: { ports, metaOnly },
  })
  expect(res.statusCode).toBe(200)
  // Parse rather than trusting the injected helper: a malformed hand-assembled
  // body would throw right here, which is precisely what we want to catch.
  return JSON.parse(res.body)
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'fx-output-batch-'))
  runtime = createRuntime({ projectRoot: scratch, pipelineId: 'p1', pluginId: 'scene-test' })
  app = Fastify()
  await registerProjectPipelineRoutes(app, {
    getProjectRegistry: async () =>
      ({ getProject: (id: string) => (id === PROJECT_ID ? { id } : null) }) as never,
    getRuntimeForProject: async () => runtime,
    extractCaller: () => ({ actor: 'test' }) as never,
  })
  await app.ready()
})

afterAll(async () => {
  await app?.close()
  rmSync(scratch, { recursive: true, force: true })
})

function writeOutput(nodeId: string, portId: string, data: unknown, hash = 'h1'): void {
  runtime.outputs.write(nodeId, portId, {
    valid: true,
    executedAt: new Date().toISOString(),
    executedHash: hash,
    type: 'grid',
    data,
  } as never)
}

describe('POST /nodes/outputs/batch wire shape', () => {
  it('round-trips a port value and its meta unchanged', async () => {
    const grid = [{ path: '{0}', items: [[[1, 2], [3, 4]]] }]
    writeOutput('n1', 'out', grid)

    const body = await batch([{ nodeId: 'n1', portId: 'out' }])
    expect(body.results).toHaveLength(1)
    const [r] = body.results
    expect(r!.nodeId).toBe('n1')
    expect(r!.portId).toBe('out')
    expect(r!.value).toEqual(grid)
    expect(r!.meta?.executedHash).toBe('h1')
    expect(r!.meta?.valid).toBe(true)
    expect(r!.tooLarge).toBeUndefined()
  })

  it('preserves payloads containing JSON metacharacters and non-ASCII text', async () => {
    // The manual assembly path must escape exactly like JSON.stringify would.
    const tricky = [{ path: '{0}', items: [{ label: 'a"b\\c\nd', zh: '中文', emoji: '🌲' }] }]
    writeOutput('n2', 'out', tricky)

    const body = await batch([{ nodeId: 'n2', portId: 'out' }])
    expect(body.results[0]!.value).toEqual(tricky)
  })

  it('escapes node/port ids that contain JSON metacharacters', async () => {
    const weirdId = 'node "quoted"\\slash'
    writeOutput(weirdId, 'p"1', [{ path: '{0}', items: [7] }])

    const body = await batch([{ nodeId: weirdId, portId: 'p"1' }])
    expect(body.results[0]!.nodeId).toBe(weirdId)
    expect(body.results[0]!.portId).toBe('p"1')
    expect(body.results[0]!.value).toEqual([{ path: '{0}', items: [7] }])
  })

  it('omits `value` entirely in metaOnly mode but still reports meta', async () => {
    writeOutput('n3', 'out', [{ path: '{0}', items: [1] }], 'h9')

    const body = await batch([{ nodeId: 'n3', portId: 'out' }], true)
    const [r] = body.results
    expect('value' in r!).toBe(false)
    expect(r!.meta?.executedHash).toBe('h9')
  })

  it('reports a never-executed port as meta:null without inventing a value', async () => {
    const body = await batch([{ nodeId: 'ghost', portId: 'nope' }])
    const [r] = body.results
    expect(r!.nodeId).toBe('ghost')
    expect(r!.meta).toBeNull()
    expect(r!.value ?? null).toBeNull()
  })

  it('returns one result per requested port, in request order', async () => {
    writeOutput('a1', 'out', [{ path: '{0}', items: [1] }])
    writeOutput('a2', 'out', [{ path: '{0}', items: [2] }])

    const body = await batch([
      { nodeId: 'a2', portId: 'out' },
      { nodeId: 'a1', portId: 'out' },
      { nodeId: 'ghost', portId: 'out' },
    ])
    expect(body.results.map((r) => r.nodeId)).toEqual(['a2', 'a1', 'ghost'])
  })

  it('returns an empty result array for an empty port list', async () => {
    const body = await batch([])
    expect(body.results).toEqual([])
  })
})
