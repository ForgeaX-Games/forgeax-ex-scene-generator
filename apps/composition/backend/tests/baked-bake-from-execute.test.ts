import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'

const ws = mkdtempSync(join(tmpdir(), 'baked-bake-from-run-'))
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

  it('rejects with 422 when Scene Script has nothing to bake', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/projects/main/baked/bake-from-execute' })
    expect(r.statusCode).toBe(422)
    expect(r.json().error).toMatch(/did not complete|zero scene layers/)
  })

  it('rejects with 422 when a first-batch script has no scene voxels', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { name: 'bake-empty' },
    })
    const projectId = created.json().id as string
    await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scene-script/commit`,
      payload: {
        entryFile: 'main.scene.ts',
        files: [{
          file: 'main.scene.ts',
          source: 'const world = basePlane({ origin: [0, 0], width: 10, height: 10 })\n',
        }],
      },
    })

    const bake = await app.inject({ method: 'POST', url: `/api/v1/projects/${projectId}/baked/bake-from-execute` })
    expect(bake.statusCode).toBe(422)
    expect(bake.json().error).toMatch(/did not complete|zero scene layers/)
  })
})
