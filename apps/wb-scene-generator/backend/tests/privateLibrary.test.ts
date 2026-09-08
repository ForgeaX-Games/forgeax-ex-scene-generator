import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'

// Isolate the workspace so private writes land in a throwaway dir (not the repo).
// Must be set BEFORE importing the app (runtime reads FORGEAX_PROJECT_ROOT at the
// first backend call). A 1x1 transparent PNG, base64-encoded, is the import body.
const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

let buildApp: () => Promise<FastifyInstance>

beforeAll(async () => {
  process.env.FORGEAX_PROJECT_ROOT = mkdtempSync(join(tmpdir(), 'wb-priv-'))
  ;({ buildApp } = await import('../src/main.js'))
})

describe('project-private library', () => {
  it('imports a file, merges it into /list (private flag), and serves its blob', async () => {
    const app = await buildApp()
    const imp = await app.inject({
      method: 'POST',
      url: '/api/v1/library/import',
      payload: { filename: 'My Couch.png', dataBase64: PNG_1x1 },
    })
    expect(imp.statusCode).toBe(200)
    const rec = imp.json()
    expect(rec.private).toBe(true)
    expect(rec.zone).toBe('staging')
    expect(rec.widthPx).toBe(1)
    expect(rec.heightPx).toBe(1)

    const list = (await app.inject({ method: 'GET', url: '/api/v1/library/list?zone=staging&pageSize=50' })).json()
    expect(list.items.some((i: { id: string; private?: boolean }) => i.id === rec.id && i.private === true)).toBe(true)

    const serve = await app.inject({ method: 'GET', url: `/api/v1/library/serve/${encodeURIComponent(rec.alias)}` })
    expect(serve.statusCode).toBe(200)
    expect(serve.headers['content-type']).toBe('image/png')
    await app.close()
  })

  it('lists + repairs a non-standard alias into the bracket-field convention', async () => {
    const app = await buildApp()
    const imp = (
      await app.inject({ method: 'POST', url: '/api/v1/library/import', payload: { filename: 'lamp.png', dataBase64: PNG_1x1 } })
    ).json()
    const ns = (await app.inject({ method: 'GET', url: '/api/v1/library/private/non-standard' })).json()
    expect(ns.some((r: { id: string }) => r.id === imp.id)).toBe(true)

    const repaired = (
      await app.inject({ method: 'POST', url: '/api/v1/library/private/batch-repair', payload: { ids: [imp.id] } })
    ).json()
    expect(repaired.repaired).toBe(1)
    expect(repaired.items[0].newAlias).toContain('[lamp]')
    await app.close()
  })

  it('trashes → restores → permanently deletes a private asset', async () => {
    const app = await buildApp()
    const imp = (
      await app.inject({ method: 'POST', url: '/api/v1/library/import', payload: { filename: 'crate.png', dataBase64: PNG_1x1 } })
    ).json()

    expect((await app.inject({ method: 'POST', url: `/api/v1/library/private/${imp.id}/trash` })).json().zone).toBe('trash')
    expect((await app.inject({ method: 'POST', url: `/api/v1/library/private/${imp.id}/restore` })).json().zone).toBe('staging')

    const del = await app.inject({ method: 'DELETE', url: `/api/v1/library/private/${imp.id}` })
    expect(del.statusCode).toBe(204)
    const after = (await app.inject({ method: 'GET', url: '/api/v1/library/private/non-standard' })).json()
    expect(after.some((r: { id: string }) => r.id === imp.id)).toBe(false)
    await app.close()
  })

  it('monitor reports a private count and field-values merge base + private', async () => {
    const app = await buildApp()
    const mon = (await app.inject({ method: 'GET', url: '/api/v1/library/monitor' })).json()
    expect(typeof mon.totalAssets).toBe('number')
    expect(typeof mon.privateCount).toBe('number')
    const fv = await app.inject({ method: 'GET', url: '/api/v1/library/field-values?fieldIdx=8' })
    expect(fv.statusCode).toBe(200)
    expect(Array.isArray(fv.json())).toBe(true)
    await app.close()
  })
})
