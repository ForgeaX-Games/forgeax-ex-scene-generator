import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'

// Phase 2 of the texture pipeline: the scene-side PUBLISH BRIDGE
// (POST /api/v1/library/publish-external, exposed as scene:library.publishExternal)
// lands a 2D-generated PNG into this project's private `raw` zone with a
// renderer-shaped alias + tile rule binding + provenance, atomically + idempotently.
const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
// A different 1-byte-distinct PNG (2x1) to prove re-publish swaps bytes in place.
const PNG_2x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAQAAAB9D+ZGAAAADElEQVR42mNk+M9QDwAEhgGAQ0pHMQAAAABJRU5ErkJggg=='

/** Patch IHDR on a minimal PNG so sniffDimensions returns the requested size. */
function pngBase64(width: number, height: number, source = PNG_1x1): string {
  const copy = Buffer.from(source, 'base64')
  copy.writeUInt32BE(width, 16)
  copy.writeUInt32BE(height, 20)
  return copy.toString('base64')
}

interface AliasMeta { alias: string; tileType?: string }

let buildApp: () => Promise<FastifyInstance>

beforeAll(async () => {
  process.env.FORGEAX_PROJECT_ROOT = mkdtempSync(join(tmpdir(), 'wb-pub-'))
  ;({ buildApp } = await import('../src/main.js'))
})

function publish(app: FastifyInstance, payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/api/v1/library/publish-external', payload })
}

describe('texture publish bridge', () => {
  it('publishes a TILE into raw with rule binding + matchable in the pool', async () => {
    const app = await buildApp()
    const res = await publish(app, {
      assetName: 'grassland',
      assetType: 'tile',
      autotileKind: 'common_16',
      dataBase64: pngBase64(64, 320),
      sourceBlobId: 'blob-grass-1',
    })
    expect(res.statusCode).toBe(200)
    const rec = res.json()
    expect(rec.zone).toBe('raw')
    expect(rec.private).toBe(true)
    expect(rec.source).toBe('pipeline')
    expect(rec.assetKind).toBe('common_16')
    // alias: field4=grassland, field8=common_16 (non-cutout)
    expect(rec.alias).toContain('[grassland]')
    expect(rec.alias).toContain('[common_16]')

    const pool = (await app.inject({ method: 'GET', url: '/api/v1/library/aliases-meta?zone=raw' })).json() as AliasMeta[]
    const hit = pool.find((m) => m.alias === rec.alias)
    expect(hit?.tileType).toBe('common_16')
    await app.close()
  })

  it('publishes a TILE bound to a rule the field[8] legacy map cannot reach (slope_9)', async () => {
    const app = await buildApp()
    const rec = (await publish(app, {
      assetName: 'rocky_slope', assetType: 'tile', autotileKind: 'slope_9', dataBase64: pngBase64(48, 48), sourceBlobId: 'blob-slope',
    })).json()
    const pool = (await app.inject({ method: 'GET', url: '/api/v1/library/aliases-meta?zone=raw' })).json() as AliasMeta[]
    // assetKind path binds the EXACT rule (not via KNOWN_TILE_TYPES).
    expect(pool.find((m) => m.alias === rec.alias)?.tileType).toBe('slope_9')
    await app.close()
  })

  it('publishes an OBJECT as cutout (no tileType)', async () => {
    const app = await buildApp()
    const rec = (await publish(app, {
      assetName: 'wooden_barrel', assetType: 'object', dataBase64: PNG_1x1, sourceBlobId: 'blob-barrel',
    })).json()
    expect(rec.alias).toContain('[asset]')
    expect(rec.assetKind).toBeUndefined()
    const pool = (await app.inject({ method: 'GET', url: '/api/v1/library/aliases-meta?zone=raw' })).json() as AliasMeta[]
    expect(pool.find((m) => m.alias === rec.alias)?.tileType).toBeUndefined()
    await app.close()
  })

  it('is idempotent by sourceBlobId (re-publish updates in place, no duplicate)', async () => {
    const app = await buildApp()
    const first = (await publish(app, {
      assetName: 'pond', assetType: 'tile', autotileKind: 'common_16', dataBase64: pngBase64(64, 320), sourceBlobId: 'blob-pond',
    })).json()
    const second = (await publish(app, {
      assetName: 'pond', assetType: 'tile', autotileKind: 'common_16', dataBase64: pngBase64(64, 320, PNG_2x1), sourceBlobId: 'blob-pond',
    })).json()
    expect(second.id).toBe(first.id) // same record, updated
    expect(second.blobSha256).not.toBe(first.blobSha256) // bytes swapped

    const list = (await app.inject({ method: 'GET', url: '/api/v1/library/list?zone=raw&pageSize=200' })).json()
    const matches = list.items.filter((i: { id: string }) => i.id === first.id)
    expect(matches.length).toBe(1)
    await app.close()
  })

  it('rejects a tile without autotileKind, a missing body, and wrong atlas size', async () => {
    const app = await buildApp()
    const noKind = await publish(app, { assetName: 'x', assetType: 'tile', dataBase64: PNG_1x1 })
    expect(noKind.statusCode).toBe(400)
    const noBytes = await publish(app, { assetName: 'x', assetType: 'object' })
    expect(noBytes.statusCode).toBe(400)
    const badSize = await publish(app, {
      assetName: 'bad_grass', assetType: 'tile', autotileKind: 'common_16', dataBase64: PNG_1x1, sourceBlobId: 'blob-bad',
    })
    expect(badSize.statusCode).toBe(400)
    expect(badSize.body).toContain('64×320px')
    await app.close()
  })
})
