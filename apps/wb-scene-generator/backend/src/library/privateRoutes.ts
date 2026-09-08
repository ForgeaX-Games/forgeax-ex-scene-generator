/**
 * Project-private asset WRITE + INFO routes — the writable half of the library
 * the AssetStore pane drives (the base `library.db` stays read-only). All of
 * these operate ONLY on the active project's private store (`privateStore.ts`):
 *
 *   POST   /api/v1/library/import                 → import a file (base64 JSON)
 *   PATCH  /api/v1/library/private/:id            → rename/repair alias
 *   POST   /api/v1/library/private/:id/trash      → soft-delete (recycle bin)
 *   POST   /api/v1/library/private/:id/restore    → trash → staging
 *   POST   /api/v1/library/private/:id/move       → change zone
 *   DELETE /api/v1/library/private/:id            → permanent delete
 *   POST   /api/v1/library/private/batch          → batch trash/restore/delete/move
 *   GET    /api/v1/library/private/non-standard   → assets with non-bracket aliases
 *   POST   /api/v1/library/private/batch-repair   → fill filename → item-name field
 *   GET    /api/v1/library/monitor                → merged library-info stats
 *   GET    /api/v1/library/field-values?fieldIdx= → merged distinct field values
 *
 * Every mutation broadcasts `library:changed` so any open pane re-pulls.
 */
import type { FastifyInstance } from 'fastify'
import { broadcastToClients } from '../routes/ws.js'
import { getLibraryService } from './service.js'
import {
  deletePrivate,
  getPrivateById,
  importPrivateAsset,
  listAllPrivate,
  listNonStandardPrivate,
  movePrivate,
  privateFieldValues,
  privateZoneStats,
  publishExternalAsset,
  renamePrivate,
  restorePrivate,
  trashPrivate,
  updatePrivateMeta,
  type PublishExternalInput,
} from './privateStore.js'
import { setGameTexturesDir } from './gameSandboxStore.js'

function notifyChanged(msg: string): void {
  console.log(`[library] ${msg}`)
  broadcastToClients({ event: 'library:changed', payload: {} })
}

// Build the standard bracket-field alias from a raw filename: 13 empty fields
// with the filename (sans extension) dropped into the item-name slot (idx 2).
function repairAlias(rawAlias: string): string {
  const dot = rawAlias.lastIndexOf('.')
  const ext = dot >= 0 ? rawAlias.slice(dot) : ''
  const name = (dot >= 0 ? rawAlias.slice(0, dot) : rawAlias).trim()
  const fields = Array.from({ length: 13 }, () => '')
  fields[2] = name
  return fields.map((f) => `[${f}]`).join('_') + ext
}

export async function registerPrivateLibraryRoutes(app: FastifyInstance): Promise<void> {
  const svc = getLibraryService()

  // Import one file. Body is JSON { filename, mimeType?, dataBase64, zone? } —
  // the plugin iframe sandbox blocks multipart, so the frontend base64-encodes.
  app.post('/api/v1/library/import', async (req, reply) => {
    const b = (req.body ?? {}) as {
      filename?: string
      mimeType?: string
      dataBase64?: string
      zone?: string
      sourceBlobId?: string
      anchorX?: number | null
      anchorY?: number | null
      geometryJson?: string
      assetKind?: string
      cropTypeOriginal?: string
      sourceTag?: 'manual' | 'pipeline' | 'ai_gen'
    }
    if (!b.filename || !b.dataBase64) {
      return reply.code(400).send({ error: 'filename and dataBase64 are required' })
    }
    try {
      const rec = await importPrivateAsset({
        filename: b.filename,
        mimeType: b.mimeType,
        dataBase64: b.dataBase64,
        zone: b.zone,
        sourceBlobId: b.sourceBlobId,
        anchorX: b.anchorX,
        anchorY: b.anchorY,
        geometryJson: b.geometryJson,
        assetKind: b.assetKind,
        cropTypeOriginal: b.cropTypeOriginal,
        sourceTag: b.sourceTag,
      })
      notifyChanged(`import ${rec.alias} (${rec.sizeBytes}B)`)
      return rec
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) })
    }
  })

  // Texture-pipeline PUBLISH BRIDGE. Atomically lands a 2D-generated PNG into
  // this scene project's private `raw` zone with a renderer-shaped alias (item
  // -name + type, tile rule binding, provenance). The supervisor agent calls
  // this (via the `scene:library.publishExternal` tool) so cross-app textures
  // become matchable. Idempotent by `sourceBlobId`.
  app.post('/api/v1/library/publish-external', async (req, reply) => {
    const b = (req.body ?? {}) as Partial<PublishExternalInput>
    if (!b.dataBase64) return reply.code(400).send({ error: 'dataBase64 is required' })
    if (!b.assetName) return reply.code(400).send({ error: 'assetName is required' })
    if (b.assetType !== 'tile' && b.assetType !== 'object') {
      return reply.code(400).send({ error: "assetType must be 'tile' or 'object'" })
    }
    try {
      const rec = await publishExternalAsset(b as PublishExternalInput)
      notifyChanged(`publish-external ${rec.alias} → raw`)
      return rec
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) })
    }
  })

  // Bind the shared-game-sandbox textures dir as an asset source. The 2D app
  // publishes finished textures into `<projectRoot>/.forgeax/games/<slug>/textures/`
  // (via asset2d:publishToGame); calling this (the `scene:library.useGameTextures`
  // tool resolves the absolute dir from the host cwd) makes the scene workbench
  // read that sandbox alongside its built-in library — merged into the AssetStore
  // listing AND the renderer matching pool. We only READ the sandbox; no
  // app-internal store is written. Broadcasting `library:changed` makes open
  // panes + the renderer re-pull immediately.
  app.post('/api/v1/library/use-game-textures', async (req, reply) => {
    const b = (req.body ?? {}) as { dir?: string }
    const dir = typeof b.dir === 'string' ? b.dir.trim() : ''
    if (!dir) return reply.code(400).send({ error: 'dir is required' })
    if (!dir.replace(/\\/gu, '/').includes('/.forgeax/games/')) {
      return reply.code(400).send({ error: 'dir must be under .forgeax/games/' })
    }
    await setGameTexturesDir(dir)
    notifyChanged(`bind game-textures sandbox → ${dir}`)
    return { ok: true, dir }
  })

  app.patch('/api/v1/library/private/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id
    const b = (req.body ?? {}) as { alias?: string; anchorX?: number | null; anchorY?: number | null }
    if (b.alias === undefined && b.anchorX === undefined && b.anchorY === undefined) {
      return reply.code(400).send({ error: 'alias and/or anchorX/anchorY required' })
    }
    const rec = await updatePrivateMeta(id, {
      ...(b.alias !== undefined ? { alias: b.alias } : {}),
      ...(b.anchorX !== undefined ? { anchorX: b.anchorX } : {}),
      ...(b.anchorY !== undefined ? { anchorY: b.anchorY } : {}),
    })
    if (!rec) return reply.code(404).send({ error: `private asset not found: ${id}` })
    notifyChanged(`patch ${id}`)
    return rec
  })

  app.post('/api/v1/library/private/:id/trash', async (req, reply) => {
    const id = (req.params as { id: string }).id
    const rec = await trashPrivate(id)
    if (!rec) return reply.code(404).send({ error: `private asset not found: ${id}` })
    notifyChanged(`trash ${id}`)
    return rec
  })

  app.post('/api/v1/library/private/:id/restore', async (req, reply) => {
    const id = (req.params as { id: string }).id
    const rec = await restorePrivate(id)
    if (!rec) return reply.code(404).send({ error: `private asset not found: ${id}` })
    notifyChanged(`restore ${id}`)
    return rec
  })

  app.post('/api/v1/library/private/:id/move', async (req, reply) => {
    const id = (req.params as { id: string }).id
    const b = (req.body ?? {}) as { zone?: string }
    if (!b.zone) return reply.code(400).send({ error: 'zone is required' })
    const rec = await movePrivate(id, b.zone)
    if (!rec) return reply.code(404).send({ error: `private asset not found: ${id}` })
    notifyChanged(`move ${id} → ${b.zone}`)
    return rec
  })

  app.delete('/api/v1/library/private/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id
    const ok = await deletePrivate(id)
    if (!ok) return reply.code(404).send({ error: `private asset not found: ${id}` })
    notifyChanged(`delete ${id}`)
    return reply.code(204).send()
  })

  // Batch op over a set of private ids. Base records (no match) are skipped.
  app.post('/api/v1/library/private/batch', async (req, reply) => {
    const b = (req.body ?? {}) as { ids?: string[]; op?: 'trash' | 'restore' | 'delete' | 'move'; zone?: string }
    const ids = b.ids ?? []
    const op = b.op
    if (!op || ids.length === 0) return reply.code(400).send({ error: 'op and non-empty ids are required' })
    let ok = 0
    for (const id of ids) {
      try {
        if (op === 'trash') ok += (await trashPrivate(id)) ? 1 : 0
        else if (op === 'restore') ok += (await restorePrivate(id)) ? 1 : 0
        else if (op === 'delete') ok += (await deletePrivate(id)) ? 1 : 0
        else if (op === 'move') ok += b.zone && (await movePrivate(id, b.zone)) ? 1 : 0
      } catch {
        /* skip a failed id, keep going */
      }
    }
    notifyChanged(`batch ${op} ${ok}/${ids.length}`)
    return { ok, total: ids.length }
  })

  // Private assets whose alias is not in the bracket-field convention.
  app.get('/api/v1/library/private/non-standard', async () => {
    const rows = await listNonStandardPrivate()
    return rows.map((r) => ({ id: r.id, alias: r.alias, zone: r.zone, sizeBytes: r.sizeBytes }))
  })

  // Repair: rewrite each selected non-standard alias into the standard format
  // (filename → item-name field). Only private records are repairable.
  app.post('/api/v1/library/private/batch-repair', async (req) => {
    const b = (req.body ?? {}) as { ids?: string[] }
    const ids = b.ids ?? []
    const items: Array<{ id: string; oldAlias: string; newAlias: string }> = []
    for (const id of ids) {
      const rec = await getPrivateById(id)
      if (!rec || rec.alias.includes('[')) continue
      const newAlias = repairAlias(rec.alias)
      const updated = await renamePrivate(id, newAlias)
      if (updated) items.push({ id, oldAlias: rec.alias, newAlias })
    }
    if (items.length) notifyChanged(`batch-repair ${items.length}`)
    return { repaired: items.length, items }
  })

  // Merged library-info / monitor: base zone stats + private zone stats.
  app.get('/api/v1/library/monitor', async () => {
    const base = svc.zoneStats().map((z) => ({ ...z, source: 'base' as const }))
    const priv = (await privateZoneStats()).map((z) => ({ ...z, source: 'private' as const }))
    const totalAssets = [...base, ...priv].reduce((n, z) => n + z.assetCount, 0)
    const totalBytes = [...base, ...priv].reduce((n, z) => n + z.totalBytes, 0)
    const privateCount = priv.reduce((n, z) => n + z.assetCount, 0)
    return { totalAssets, totalBytes, privateCount, zoneStats: [...base, ...priv] }
  })

  // Merged distinct values of one bracket field (CategoryNav select options).
  app.get('/api/v1/library/field-values', async (req) => {
    const q = req.query as { fieldIdx?: string; zone?: string }
    const idx = q.fieldIdx ? Number(q.fieldIdx) : 0
    const set = new Set<string>([...svc.fieldValues(idx, q.zone), ...(await privateFieldValues(idx, q.zone))])
    return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hans'))
  })

  // Total private record count (badge/empty-state hints).
  app.get('/api/v1/library/private/count', async () => {
    return { count: (await listAllPrivate()).length }
  })
}
