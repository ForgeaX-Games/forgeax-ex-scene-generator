import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { applyBatch } from '@forgeax/node-runtime'
import { getRuntimeForProject } from '../src/runtime.js'

// Isolated workspace — module-level singleton registry (see runtime.ts), must be
// set before the first buildApp()/getRuntime() call in this file.
const ws = mkdtempSync(join(tmpdir(), 'baked-bake-from-execute-'))
process.env.FORGEAX_PROJECT_ROOT = ws

describe('POST /api/v1/projects/:id/baked/bake-from-execute', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    const { buildApp } = await import('../src/main.js')
    app = await buildApp()
  })

  afterAll(async () => {
    await app.close()
  })

  it('rejects with 422 when the empty graph has nothing to bake (either execute status or zero layers)', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/projects/main/baked/bake-from-execute' })
    expect(r.statusCode).toBe(422)
    expect(r.json().error).toMatch(/did not complete|zero scene layers/)
  })

  it('rejects with 422 when execute completes but the scene subtree has zero cells to bake', async () => {
    const batch = await applyBatch(await getRuntimeForProject('main'), [
          {
            type: 'createNode',
            nodeId: 'empty_g2n',
            opId: 'grid2node',
            position: { x: 0, y: 0 },
            params: { name: 'Empty', grid: [[0, 0], [0, 0]] },
          },
        ], { actor: 'test-runtime-fixture' })
    expect(batch.status).toBe('ok')

    const bake = await app.inject({ method: 'POST', url: '/api/v1/projects/main/baked/bake-from-execute' })
    expect(bake.statusCode).toBe(422)
    expect(bake.json().error).toMatch(/zero scene layers/)

    await applyBatch(await getRuntimeForProject('main'), [{ type: 'deleteNode', nodeId: 'empty_g2n' }], {
      actor: 'test-runtime-fixture',
    })
  })

  it('executes the graph, snapshots scene output ports into baked layers, and bakes them', async () => {
    const batch = await applyBatch(await getRuntimeForProject('main'), [
          {
            type: 'createNode',
            nodeId: 'house_grid',
            opId: 'rect_grid',
            position: { x: -200, y: 0 },
            params: { width: 2, height: 2, fillValue: 1 },
          },
          {
            type: 'createNode',
            nodeId: 'g2n',
            opId: 'grid2node',
            position: { x: 0, y: 0 },
            params: { name: 'House' },
          },
          {
            type: 'connect',
            edgeId: 'house_grid_to_scene',
            source: { nodeId: 'house_grid', port: 'grid' },
            target: { nodeId: 'g2n', port: 'grid' },
          },
          {
            type: 'createNode',
            nodeId: 'result',
            opId: 'scene_output',
            position: { x: 200, y: 0 },
            params: {},
          },
          {
            type: 'connect',
            edgeId: 'house_scene_to_result',
            source: { nodeId: 'g2n', port: 'scene' },
            target: { nodeId: 'result', port: 'scene' },
          },
        ], { actor: 'test-runtime-fixture' })
    expect(batch.status).toBe('ok')

    const bake = await app.inject({ method: 'POST', url: '/api/v1/projects/main/baked/bake-from-execute' })
    expect(bake.statusCode, bake.body).toBe(200)
    const body = bake.json() as { paths: string[]; layerCount: number; executionId: string }
    expect(body.layerCount).toBeGreaterThan(0)
    expect(body.paths).toEqual(expect.arrayContaining(['/House']))

    const layers = await app.inject({ method: 'GET', url: '/api/v1/projects/main/baked/layers' })
    expect(layers.statusCode).toBe(200)
    const houseLayer = (layers.json().layers as Array<{ nodePath: string; cells: unknown[] }>).find(
      (l) => l.nodePath === '/House',
    )
    expect(houseLayer).toBeTruthy()
    expect(houseLayer!.cells.length).toBe(4)
  })
})
