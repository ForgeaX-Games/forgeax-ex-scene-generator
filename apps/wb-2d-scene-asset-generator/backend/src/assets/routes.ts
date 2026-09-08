import type { FastifyInstance } from 'fastify'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateTileAtlasDimensions } from '../library/tileRuleAtlasValidation.js'
import { getRuntime } from '../runtime.js'
import {
  copyGeneratedAssetToFolder,
  createFavoriteGroup,
  createGeneratedFolder,
  deleteFavoriteGroup,
  deleteGeneratedAsset,
  deleteGeneratedAssets,
  deleteGeneratedFolder,
  importGeneratedImage,
  listGeneratedAssets,
  listGeneratedFolders,
  moveGeneratedAssets,
  readGeneratedAssetByBlobId,
  readGeneratedAsset,
  renameGeneratedAsset,
  setAssetsFavoriteGroup,
  setGeneratedAssetFavorite,
} from './generatedAssets.js'

const FAVORITES_FILTER = '__favorites__'

interface ImportBody {
  imageBase64?: string
  mimeType?: string
  prompt?: string
  nodeId?: string
  source?: string
  folder?: string
  tags?: string[]
}

let selectedPreviewAlias: string | null = null

// PNG IHDR / JPEG SOF width+height. Stored in the sandbox descriptor so the scene
// side can derive ppu / placement without re-reading every blob (dechouse_gen often
// lands as JPEG).
function sniffImageDimensions(bytes: Buffer): { widthPx?: number; heightPx?: number } {
  if (bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47) {
    return { widthPx: bytes.readUInt32BE(16), heightPx: bytes.readUInt32BE(20) }
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2
    while (i < bytes.length - 8) {
      if (bytes[i] !== 0xff) {
        i += 1
        continue
      }
      const marker = bytes[i + 1]!
      if (marker === 0xc0 || marker === 0xc2) {
        return { heightPx: bytes.readUInt16BE(i + 5), widthPx: bytes.readUInt16BE(i + 7) }
      }
      if (marker === 0xd8) {
        i += 2
        continue
      }
      const len = bytes.readUInt16BE(i + 2)
      i += 2 + len
    }
  }
  return {}
}

// geometry_json.pivot is the AUTHORITATIVE object anchor — [anchorX, anchorY] in
// bottom-left-origin normalized coords (0=bottom…1=top), computed from the
// collision footprint by image_object_geometry. It MUST win over any separately
// passed anchorX/anchorY: callers (the AI publish flow) often send placeholder
// defaults like 0.5/1, which would seat the sprite's TOP on the ground and sink
// the whole object below it. Keeping the descriptor anchor identical to the
// geometry pivot is what lets the scene renderer plant the sprite's base on the
// contact cell (see scene renderer objectSpriteGridRect: y = screenY - (1-ay)*h).
function pivotAnchorFromGeometry(geometryJson?: string): { x: number; y: number } | null {
  if (!geometryJson) return null
  try {
    const parsed = JSON.parse(geometryJson) as Record<string, unknown>
    const pivot = parsed.pivot
    if (Array.isArray(pivot) && pivot.length >= 2) {
      const x = Number(pivot[0])
      const y = Number(pivot[1])
      if (Number.isFinite(x) && Number.isFinite(y)) return { x, y }
    }
  } catch {
    /* malformed geometry → fall back to passed anchors */
  }
  return null
}

// One asset's entry in the shared game sandbox manifest
// (<projectRoot>/.forgeax/games/<slug>/textures/index.json). The scene workbench
// reads these to surface generated textures alongside its built-in library, so
// only the RAW descriptor lives here — the 13-field renderer alias and autotile
// binding are composed on the scene (consumer) side, keeping that contract in one place.
interface GameTextureDescriptor {
  assetName: string
  assetType: 'tile' | 'object'
  autotileKind?: string
  anchorX?: number | null
  anchorY?: number | null
  geometryJson?: string
  sha256: string
  file: string
  mimeType: string
  sizeBytes: number
  widthPx?: number
  heightPx?: number
  sourceBlobId: string
  updatedAt: string
}

export async function registerGeneratedAssetRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/generated-assets', async (req) => {
    const query = req.query as { folder?: string }
    const rt = await getRuntime()
    return listGeneratedAssets(rt, query.folder)
  })

  app.get('/api/v1/generated-assets/folders', async () => {
    const rt = await getRuntime()
    return listGeneratedFolders(rt)
  })

  // Create an (empty) folder column — a new menu (top-level) or sub-menu
  // (one-level nested under a non-fixed parent). Mirrors a real on-disk dir so
  // the menu persists even with no assets yet.
  app.post('/api/v1/generated-assets/folders', async (req, reply) => {
    const body = (req.body ?? {}) as { path?: unknown }
    const path = typeof body.path === 'string' ? body.path.trim() : ''
    if (!path) return reply.code(400).send({ error: 'missing path' })
    const rt = await getRuntime()
    // A `__favorites__/<group>` path creates a favorite sub-group (a virtual
    // organize bucket), not an on-disk folder column.
    if (path.startsWith(`${FAVORITES_FILTER}/`)) {
      const group = createFavoriteGroup(rt, path.slice(`${FAVORITES_FILTER}/`.length))
      if (!group) return reply.code(400).send({ error: 'invalid favorite group name' })
      return { folder: `${FAVORITES_FILTER}/${group}` }
    }
    const folder = createGeneratedFolder(rt, path)
    if (!folder) return reply.code(400).send({ error: 'invalid or rejected folder path' })
    return { folder }
  })

  // Delete a folder column (and every asset inside it, recursively). Rejected
  // for preset/virtual/fixed columns. A `__favorites__/<group>` path removes a
  // favorite sub-group (assets stay favorited, just ungrouped).
  app.post('/api/v1/generated-assets/folders/delete', async (req, reply) => {
    const body = (req.body ?? {}) as { path?: unknown }
    const path = typeof body.path === 'string' ? body.path.trim() : ''
    if (!path) return reply.code(400).send({ error: 'missing path' })
    const rt = await getRuntime()
    if (path.startsWith(`${FAVORITES_FILTER}/`)) {
      const ok = deleteFavoriteGroup(rt, path.slice(`${FAVORITES_FILTER}/`.length))
      if (!ok) return reply.code(400).send({ error: 'favorite group not deletable' })
      return { deleted: [] }
    }
    const result = deleteGeneratedFolder(rt, path)
    if (!result.ok) return reply.code(400).send({ error: 'folder not deletable' })
    if (selectedPreviewAlias && result.deleted.includes(selectedPreviewAlias)) selectedPreviewAlias = null
    return { deleted: result.deleted }
  })

  app.get('/api/v1/generated-assets/:alias', async (req, reply) => {
    const params = req.params as { alias?: string }
    const alias = params.alias?.trim()
    if (!alias) return reply.code(400).send({ error: 'missing alias' })
    const rt = await getRuntime()
    const found = readGeneratedAsset(rt, alias)
    if (!found) return reply.code(404).send({ error: 'asset not found' })
    return found.record
  })

  app.delete('/api/v1/generated-assets/:alias', async (req, reply) => {
    const params = req.params as { alias?: string }
    const alias = params.alias?.trim()
    if (!alias) return reply.code(400).send({ error: 'missing alias' })
    const rt = await getRuntime()
    const deleted = deleteGeneratedAsset(rt, alias)
    if (!deleted) return reply.code(404).send({ error: 'asset not found' })
    if (selectedPreviewAlias === alias) selectedPreviewAlias = null
    return { deleted }
  })

  app.patch('/api/v1/generated-assets/:alias', async (req, reply) => {
    const params = req.params as { alias?: string }
    const alias = params.alias?.trim()
    if (!alias) return reply.code(400).send({ error: 'missing alias' })
    const body = (req.body ?? {}) as { name?: unknown }
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return reply.code(400).send({ error: 'missing name' })
    const rt = await getRuntime()
    const updated = renameGeneratedAsset(rt, alias, name)
    if (!updated) return reply.code(404).send({ error: 'asset not found' })
    return { asset: updated }
  })

  app.post('/api/v1/generated-assets/delete', async (req, reply) => {
    const body = (req.body ?? {}) as { aliases?: unknown }
    const aliases = Array.isArray(body.aliases)
      ? body.aliases.filter((a): a is string => typeof a === 'string' && a.trim() !== '').map((a) => a.trim())
      : []
    if (aliases.length === 0) return reply.code(400).send({ error: 'missing aliases' })
    const rt = await getRuntime()
    const deleted = deleteGeneratedAssets(rt, aliases)
    if (selectedPreviewAlias && deleted.includes(selectedPreviewAlias)) selectedPreviewAlias = null
    return { deleted }
  })

  app.post('/api/v1/generated-assets/:alias/favorite', async (req, reply) => {
    const params = req.params as { alias?: string }
    const alias = params.alias?.trim()
    if (!alias) return reply.code(400).send({ error: 'missing alias' })
    const body = (req.body ?? {}) as { favorite?: unknown; group?: unknown }
    const favorite = body.favorite !== false
    const group = typeof body.group === 'string' ? body.group : undefined
    const rt = await getRuntime()
    const updated = setGeneratedAssetFavorite(rt, alias, favorite, group)
    if (!updated) return reply.code(404).send({ error: 'asset not found' })
    return { asset: updated }
  })

  // Move favorited assets into a favorite sub-group (group=null/'' ungroups).
  // Auto-favorites any target not yet favorited.
  app.post('/api/v1/generated-assets/favorite-group', async (req, reply) => {
    const body = (req.body ?? {}) as { aliases?: unknown; group?: unknown }
    const aliases = Array.isArray(body.aliases)
      ? body.aliases.filter((a): a is string => typeof a === 'string' && a.trim() !== '').map((a) => a.trim())
      : []
    const group = typeof body.group === 'string' ? body.group : null
    if (aliases.length === 0) return reply.code(400).send({ error: 'missing aliases' })
    const rt = await getRuntime()
    const updated = setAssetsFavoriteGroup(rt, aliases, group)
    return { updated }
  })

  app.post('/api/v1/generated-assets/move', async (req, reply) => {
    const body = (req.body ?? {}) as { aliases?: unknown; folder?: unknown }
    const aliases = Array.isArray(body.aliases)
      ? body.aliases.filter((a): a is string => typeof a === 'string' && a.trim() !== '').map((a) => a.trim())
      : []
    const folder = typeof body.folder === 'string' ? body.folder.trim() : ''
    if (aliases.length === 0) return reply.code(400).send({ error: 'missing aliases' })
    if (!folder) return reply.code(400).send({ error: 'missing folder' })
    const rt = await getRuntime()
    const moved = moveGeneratedAssets(rt, aliases, folder)
    return { moved }
  })

  app.post('/api/v1/generated-assets/copy-to-folder', async (req, reply) => {
    const body = (req.body ?? {}) as { alias?: unknown; folder?: unknown }
    const alias = typeof body.alias === 'string' ? body.alias.trim() : ''
    const folder = typeof body.folder === 'string' ? body.folder.trim() : ''
    if (!alias) return reply.code(400).send({ error: 'missing alias' })
    if (!folder) return reply.code(400).send({ error: 'missing folder' })
    const rt = await getRuntime()
    const asset = copyGeneratedAssetToFolder(rt, alias, folder)
    if (!asset) return reply.code(404).send({ error: 'asset not found' })
    return { asset }
  })

  // Cross-app byte hand-off for the texture pipeline. Returns the generated
  // asset's record PLUS its bytes as base64 in one JSON response, so an agent
  // holding only an alias (this 2D app's files are NOT visible to the scene
  // app's filesystem) can feed `scene:library.publishExternal({ dataBase64 })`.
  // `request()` JSON-parses, hence base64 (not a raw binary stream) here.
  app.get('/api/v1/generated-assets/:alias/base64', async (req, reply) => {
    const params = req.params as { alias?: string }
    const alias = params.alias?.trim()
    if (!alias) return reply.code(400).send({ error: 'missing alias' })
    const rt = await getRuntime()
    const found = readGeneratedAsset(rt, alias)
    if (!found) return reply.code(404).send({ error: 'asset not found' })
    return {
      alias: found.record.alias,
      blobId: found.record.blobId,
      mimeType: found.record.mimeType,
      sizeBytes: found.record.sizeBytes,
      dataBase64: Buffer.from(found.bytes).toString('base64'),
    }
  })

  app.get('/api/v1/generated-assets/blob/:alias', async (req, reply) => {
    const params = req.params as { alias?: string }
    const alias = params.alias?.trim()
    if (!alias) return reply.code(400).send({ error: 'missing alias' })
    const rt = await getRuntime()
    const found = readGeneratedAsset(rt, alias)
    if (!found) return reply.code(404).send({ error: 'asset not found' })
    return reply.header('content-type', found.record.mimeType).send(found.bytes)
  })

  app.get('/api/v1/library/blob/:blobId', async (req, reply) => {
    const params = req.params as { blobId?: string }
    const blobId = params.blobId?.trim()
    if (!blobId) return reply.code(400).send({ error: 'missing blobId' })
    const rt = await getRuntime()
    const found = readGeneratedAssetByBlobId(rt, blobId)
    if (!found) return reply.code(404).send({ error: 'asset not found' })
    return reply.header('content-type', found.record.mimeType).send(found.bytes)
  })

  app.post('/api/v1/generated-assets/import', { bodyLimit: 20 * 1024 * 1024 }, async (req, reply) => {
    const body = (req.body ?? {}) as ImportBody
    if (!body.imageBase64?.trim()) return reply.code(400).send({ error: 'missing imageBase64' })
    const rt = await getRuntime()
    return importGeneratedImage(rt, {
      imageBase64: body.imageBase64,
      ...(body.mimeType ? { mimeType: body.mimeType } : {}),
      ...(body.prompt ? { prompt: body.prompt } : {}),
      ...(body.nodeId ? { nodeId: body.nodeId } : {}),
      ...(body.source ? { source: body.source } : {}),
      ...(body.folder ? { folder: body.folder } : {}),
      ...(Array.isArray(body.tags) ? { tags: body.tags } : {}),
    })
  })

  // Publish a finished 2D asset into the SHARED GAME SANDBOX so the scene
  // workbench can use + display it next to its built-in library. We write the
  // bytes (content-addressed) + a descriptor into
  //   <targetDir>/blobs/<sha>.png   and   <targetDir>/index.json
  // where targetDir is `<projectRoot>/.forgeax/games/<slug>/textures` (resolved
  // by the host tool layer from its cwd). The sandbox is the only cross-app
  // common ground: each workbench runs under its own isolated FORGEAX_PROJECT_ROOT,
  // but both can reach the project's .forgeax/games tree. We never touch either
  // app's internal stores — generated files stay in the sandbox, kept separate
  // from built-in (固有) assets.
  app.post('/api/v1/publish-to-game', { bodyLimit: 32 * 1024 * 1024 }, async (req, reply) => {
    const b = (req.body ?? {}) as {
      alias?: string
      targetDir?: string
      assetName?: string
      assetType?: string
      autotileKind?: string
      anchorX?: number | null
      anchorY?: number | null
      geometryJson?: string
    }
    const alias = b.alias?.trim()
    const targetDir = b.targetDir?.trim()
    const assetName = b.assetName?.trim()
    if (!alias || !targetDir || !assetName) {
      return reply.code(400).send({ error: 'alias, targetDir and assetName are required' })
    }
    if (b.assetType !== 'tile' && b.assetType !== 'object') {
      return reply.code(400).send({ error: "assetType must be 'tile' or 'object'" })
    }
    if (b.assetType === 'tile' && !b.autotileKind?.trim()) {
      return reply.code(400).send({ error: 'autotileKind is required for tile assets' })
    }
    // Safety: only ever write inside a project's .forgeax/games sandbox.
    if (!targetDir.replace(/\\/gu, '/').includes('/.forgeax/games/')) {
      return reply.code(400).send({ error: 'targetDir must be under .forgeax/games/' })
    }
    const rt = await getRuntime()
    const found = readGeneratedAsset(rt, alias)
    if (!found) return reply.code(404).send({ error: 'asset not found' })

    const bytes = Buffer.from(found.bytes)
    if (bytes.length === 0) return reply.code(422).send({ error: 'asset has empty bytes' })

    const dims = sniffImageDimensions(bytes)
    if (b.assetType === 'tile') {
      const check = validateTileAtlasDimensions(b.autotileKind!.trim(), dims.widthPx, dims.heightPx)
      if (!check.ok) {
        return reply.code(422).send({ error: check.error, allowedSizes: check.allowedSizes })
      }
    }

    const sha = createHash('sha256').update(bytes).digest('hex')
    const file = `blobs/${sha}.png`
    mkdirSync(join(targetDir, 'blobs'), { recursive: true })
    writeFileSync(join(targetDir, join('blobs', `${sha}.png`)), bytes)

    // Geometry pivot is the source of truth for an object's anchor; fall back to
    // the passed anchorX/anchorY only when there's no usable pivot (e.g. tiles, or
    // objects published without computed geometry).
    const pivotAnchor = pivotAnchorFromGeometry(b.geometryJson)
    const desc: GameTextureDescriptor = {
      assetName,
      assetType: b.assetType,
      ...(b.assetType === 'tile' ? { autotileKind: b.autotileKind!.trim() } : {}),
      anchorX: pivotAnchor?.x ?? b.anchorX ?? null,
      anchorY: pivotAnchor?.y ?? b.anchorY ?? null,
      ...(b.geometryJson ? { geometryJson: b.geometryJson } : {}),
      sha256: sha,
      file,
      mimeType: found.record.mimeType,
      sizeBytes: bytes.length,
      ...(dims.widthPx ? { widthPx: dims.widthPx } : {}),
      ...(dims.heightPx ? { heightPx: dims.heightPx } : {}),
      sourceBlobId: found.record.blobId,
      updatedAt: new Date().toISOString(),
    }

    const indexPath = join(targetDir, 'index.json')
    let list: GameTextureDescriptor[] = []
    if (existsSync(indexPath)) {
      try {
        const parsed = JSON.parse(readFileSync(indexPath, 'utf-8')) as unknown
        if (Array.isArray(parsed)) list = parsed as GameTextureDescriptor[]
      } catch {
        list = []
      }
    }
    // Idempotent: replace by provenance (sourceBlobId) else by assetName+assetType.
    const idx = list.findIndex((d) =>
      d.sourceBlobId === desc.sourceBlobId ||
      (d.assetName === desc.assetName && d.assetType === desc.assetType))
    if (idx >= 0) list[idx] = desc
    else list.push(desc)
    writeFileSync(indexPath, JSON.stringify(list, null, 2))

    return { ok: true, descriptor: desc, targetDir, total: list.length }
  })

  app.get('/api/v1/preview/latest', async () => {
    const rt = await getRuntime()
    if (selectedPreviewAlias) {
      const selected = readGeneratedAsset(rt, selectedPreviewAlias)
      if (selected) return selected.record
      selectedPreviewAlias = null
    }
    return listGeneratedAssets(rt).items[0] ?? null
  })

  app.post('/api/v1/preview/select-asset', async (req, reply) => {
    const body = (req.body ?? {}) as { alias?: string }
    const alias = body.alias?.trim()
    if (!alias) return reply.code(400).send({ error: 'missing alias' })
    const rt = await getRuntime()
    const found = readGeneratedAsset(rt, alias)
    if (!found) return reply.code(404).send({ error: 'asset not found' })
    selectedPreviewAlias = alias
    return { selected: found.record }
  })
}
