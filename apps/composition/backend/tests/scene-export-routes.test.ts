import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildSceneExportDownloadUrl } from '../src/scene-export/routes.js'

const ws = mkdtempSync(join(tmpdir(), 'scene-export-route-'))
process.env.FORGEAX_PROJECT_ROOT = ws

describe('scene export routes', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    const { buildApp } = await import('../src/main.js')
    app = await buildApp()
  })

  afterAll(async () => {
    await app.close()
  })

  it('cooks active baked layers into scene.zip and an unpacked mirror', async () => {
    const workspaceRes = await app.inject({ method: 'GET', url: '/api/v1/workspace' })
    const projectId = (workspaceRes.json() as { viewingProjectId?: string }).viewingProjectId
    expect(projectId).toBeTruthy()

    await app.inject({
      method: 'PATCH',
      url: '/api/v1/baked/layers/cells',
      payload: {
        path: '/Ground',
        cells: [{ x: 0, y: 0, z: 0 }],
        asset: { name: 'grass', type: 'tile' },
      },
    })
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/baked/layers/attributes',
      payload: { path: '/Ground', attributes: { export_role: 'terrain', template_id: 'grass' } },
    })

    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/scene-export/cook',
      headers: {
        host: 'localhost:9557',
        'x-forwarded-host': '192.168.50.20:9557',
        'x-forwarded-proto': 'http',
      },
      payload: { sceneName: 'Route Demo', allowMissingAssets: false },
    })

    expect(r.statusCode).toBe(200)
    const body = r.json() as { bundleId: string; zipPath: string; unpackedDir: string; downloadUrl: string; warnings: string[] }
    expect(body.bundleId).toMatch(/^route-demo-/)
    expect(existsSync(body.zipPath)).toBe(true)
    expect(existsSync(join(body.unpackedDir, 'terrain.json'))).toBe(true)
    expect(body.zipPath).toContain(join(ws, 'exports', 'scene'))
    expect(body.downloadUrl).toBe(`http://192.168.50.20:9557/api/v1/projects/${encodeURIComponent(projectId!)}/scene-export/download/${body.bundleId}`)
    expect(body.warnings).toEqual([])

    const download = await app.inject({
      method: 'GET',
      url: new URL(body.downloadUrl).pathname,
    })
    expect(download.statusCode).toBe(200)
    expect(download.headers['content-disposition']).toBe('attachment; filename="scene.zip"')
    expect(download.headers['content-type']).toContain('application/octet-stream')
    expect(download.headers['content-length']).toBe(String(download.rawPayload.length))
    expect(download.headers['cache-control']).toBe('no-store')
    expect(download.headers['x-content-type-options']).toBe('nosniff')
    expect(Buffer.from(download.rawPayload).subarray(0, 2).toString()).toBe('PK')
  })

  it('applies narrative area tags to the cooked terrain.json when narrative is provided', async () => {
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/baked/layers/cells',
      payload: { path: '/Town/Ground', cells: [{ x: 0, y: 0, z: 0 }], asset: { name: 'grass', type: 'tile' } },
    })
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/baked/layers/attributes',
      payload: { path: '/Town/Ground', attributes: { export_role: 'terrain', template_id: 'grass' } },
    })

    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/scene-export/cook',
      payload: {
        sceneName: 'Narrative Demo',
        narrative: { sceneName: 'Narrative World', locations: [{ name: 'Town', parent: null }] },
      },
    })

    expect(r.statusCode).toBe(200)
    const body = r.json() as { unpackedDir: string }
    const { readFileSync } = await import('node:fs')
    const terrain = JSON.parse(readFileSync(join(body.unpackedDir, 'terrain.json'), 'utf-8'))
    expect(terrain.cells['0'][0].areaTags).toEqual({ area_L0: ['Town'] })
    const terrainConfig = JSON.parse(readFileSync(join(body.unpackedDir, 'terrain-config.json'), 'utf-8'))
    expect(terrainConfig.templates.grass.region).toBe('Narrative World')
  })

  it('fails the cook with a 400 listing all narrative problems', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/scene-export/cook',
      payload: {
        sceneName: 'Broken Narrative Demo',
        narrative: { locations: [{ name: 'NoSuchLayer', parent: null }] },
      },
    })

    expect(r.statusCode).toBe(400)
    expect((r.json() as { error: string }).error).toMatch(/missing: location "NoSuchLayer"/)
  })

  it('uses a LAN IPv4 host for download URLs when the request host is local', () => {
    const req = {
      protocol: 'http',
      headers: { host: 'localhost:9557' },
    }

    expect(buildSceneExportDownloadUrl(req as never, 'p_test_project', 'local-export', () => ({
      lo: [{
        address: '127.0.0.1',
        family: 'IPv4',
        internal: true,
        netmask: '255.0.0.0',
        mac: '00:00:00:00:00:00',
        cidr: '127.0.0.1/8',
      }],
      eth0: [{
        address: '10.11.12.13',
        family: 'IPv4',
        internal: false,
        netmask: '255.255.255.0',
        mac: '00:00:00:00:00:01',
        cidr: '10.11.12.13/24',
      }],
    }))).toBe('http://10.11.12.13:9557/api/v1/projects/p_test_project/scene-export/download/local-export')
  })

  it('returns 404 for a missing scene export bundle download', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/scene-export/download/missing-bundle',
    })

    expect(r.statusCode).toBe(404)
  })

  it('returns 404 for traversal-like bundle ids', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/scene-export/download/..%2F..%2Fpackage.json',
    })

    expect(r.statusCode).toBe(404)
  })

  it('returns 400 for missing asset aliases unless fallback output is allowed', async () => {
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/baked/layers/cells',
      payload: {
        path: '/MissingAlias',
        cells: [{ x: 1, y: 0, z: 0 }],
        asset: { name: 'missing', type: 'tile', alias: 'missing-scene-export-alias' },
      },
    })
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/baked/layers/attributes',
      payload: { path: '/MissingAlias', attributes: { export_role: 'terrain', template_id: 'missing' } },
    })

    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/scene-export/cook',
      payload: { sceneName: 'Missing Demo' },
    })

    expect(r.statusCode).toBe(400)
    expect(r.json().error).toMatch(/missing asset/i)
  })
})
