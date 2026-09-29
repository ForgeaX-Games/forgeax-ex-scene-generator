import { afterEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { registerPackExportRoutes } from './routes.js'
import { exportProjectPack } from './service.js'
import { exportSceneModulePack } from './moduleExport.js'

vi.mock('./moduleExport.js', () => ({ exportSceneModulePack: vi.fn(async (options) => ({
  ok: true, path: options.destination, schemaVersion: options.schemaVersion,
  packageId: options.packageId, sceneKey: options.sourceKey,
})) }))
vi.mock('../runtime.js', () => ({
  getProjectRegistry: async () => ({ getProject: () => ({ manifest: { name: 'fixture' } }), getViewingProjectId: () => 'fixture' }),
  getProjectDir: async () => '/fixture/project', getActiveProjectDir: async () => '/fixture/project',
  resolveActiveGameSlug: () => '', resolveSharedGamesRoot: () => '/fixture/games',
}))
afterEach(() => vi.clearAllMocks())

describe('public native pack target selection', () => {
  it.each(['/api/v1/pack-export/cook', '/api/v1/projects/fixture/pack-export/cook'])('passes v1 and stable identities through route and service: %s', async (url) => {
    const app = Fastify(); await registerPackExportRoutes(app)
    try {
      const body = { schemaVersion: '1.0.0', destination: '/fixture/out', packageId: '01900000-0000-7000-8000-000000000202', sourceKey: 'scene/stable' }
      const reply = await app.inject({ method: 'POST', url, payload: body })
      expect(reply.statusCode).toBe(200)
      expect(reply.json()).toMatchObject({ schemaVersion: '1.0.0', packageId: body.packageId, sceneKey: body.sourceKey })
      expect(exportSceneModulePack).toHaveBeenCalledWith(expect.objectContaining(body))
      vi.mocked(exportSceneModulePack).mockClear()
      const invalid = await app.inject({ method: 'POST', url, payload: { ...body, schemaVersion: '3.0.0' } })
      expect(invalid.statusCode).toBe(400)
      expect(invalid.json().error).toMatch(/schemaVersion/)
      expect(exportSceneModulePack).not.toHaveBeenCalled()
    } finally { await app.close() }
  })
  it('keeps the service default at v2 and rejects invalid direct calls', async () => {
    await exportProjectPack({ destination: '/fixture/out' })
    expect(exportSceneModulePack).toHaveBeenCalledWith(expect.objectContaining({ schemaVersion: '2.0.0' }))
    await expect(exportProjectPack({ destination: '/fixture/out', schemaVersion: 'bad' as never })).rejects.toThrow(/schemaVersion/)
  })
})
