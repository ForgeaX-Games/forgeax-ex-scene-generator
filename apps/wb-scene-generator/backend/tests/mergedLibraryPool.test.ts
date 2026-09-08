import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'

const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

let buildApp: () => Promise<FastifyInstance>

beforeAll(async () => {
  process.env.FORGEAX_PROJECT_ROOT = mkdtempSync(join(tmpdir(), 'wb-merged-pool-'))
  ;({ buildApp } = await import('../src/main.js'))
})

describe('mergedLibraryPool', () => {
  it('resolveMergedAssetContent reads project-private imports', async () => {
    const app = await buildApp()
    const alias = '[]_[]_[土地]_[]_[]_[]_[]_[common_16]_[]_[]_[]_[].png'
    await app.inject({
      method: 'POST',
      url: '/api/v1/library/import',
      payload: {
        filename: alias,
        dataBase64: PNG_1x1,
        zone: 'raw',
        assetKind: 'common_16',
        cropTypeOriginal: '瓦片组',
      },
    })

    const { listMergedAliasMetas, resolveMergedAssetContent } = await import('../src/library/mergedLibraryPool.js')
    const pool = await listMergedAliasMetas('raw')
    expect(pool.some((m) => m.alias === alias && m.tileType === 'common_16')).toBe(true)

    const bytes = await resolveMergedAssetContent(alias)
    expect(bytes?.bytes.length).toBeGreaterThan(0)
    await app.close()
  })
})
