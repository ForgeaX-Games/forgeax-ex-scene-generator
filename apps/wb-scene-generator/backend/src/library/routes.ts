/**
 * Library HTTP routes. The base library (`library.db`) is READ-ONLY; user
 * imports/edits live in the project-private store (`privateStore.ts`). The
 * browse routes below MERGE the two so the AssetStore pane shows both, with
 * private records flagged `private: true`:
 *   GET /api/v1/library/serve/<alias>     → blob bytes (base → private → rule JSON)
 *   GET /api/v1/library/aliases?zone=      → string[]   (base only; renderer use)
 *   GET /api/v1/library/aliases-meta[?zone=] → meta[]   (renderer pool; no zone = all zones)
 *   GET /api/v1/library/zones              → base ∪ private zones (+ staging/trash)
 *   GET /api/v1/library/list               → merged, paginated (private first)
 *   GET /api/v1/library/facets             → merged folder counts
 *   GET /api/v1/library/rules              → vendored autotile rules
 *
 * Write + info routes (import/repair/trash/monitor/…) live in ./privateRoutes.ts.
 *
 * Single-tenant: the legacy `?slug=` query param is accepted but ignored.
 */

import type { FastifyInstance } from 'fastify'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getActiveProjectDir } from '../runtime.js'
import { getLibraryService, resolveBlobPath, rulesDir, type AssetRecord, type FacetItem, type FacetScheme } from './service.js'
import {
  listMergedAliasMetas,
  listMergedAliasMetasAllZones,
} from './mergedLibraryPool.js'
import {
  STAGING_ZONE,
  TRASH_ZONE,
  facetPrivate,
  filterPrivate,
  getPrivateByAlias,
  listPrivateZones,
  resolvePrivateBlobPath,
  type PrivateAssetRecord,
} from './privateStore.js'
import {
  listGameSandboxRecords,
  resolveGameSandboxBlobByAlias,
} from './gameSandboxStore.js'

/** Project-private record → the AssetRecord shape the grid consumes (+ flag). */
function toAssetRecord(r: PrivateAssetRecord): AssetRecord {
  return {
    id: r.id,
    alias: r.alias,
    zone: r.zone,
    blobSha256: r.blobSha256,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    ...(r.widthPx ? { widthPx: r.widthPx } : {}),
    ...(r.heightPx ? { heightPx: r.heightPx } : {}),
    anchorX: r.anchorX,
    anchorY: r.anchorY,
    ...(r.createdAt ? { createdAt: r.createdAt } : {}),
    ...(r.updatedAt ? { updatedAt: r.updatedAt } : {}),
    private: true,
  }
}

// `fieldFilters=8:wall||9:16` → [{fieldIdx:8,value:'wall'},…]
function parseFieldFilters(raw?: string): Array<{ fieldIdx: number; value: string }> {
  if (!raw) return []
  return raw
    .split('||')
    .map((tok) => {
      const i = tok.indexOf(':')
      if (i < 0) return null
      const idx = Number(tok.slice(0, i))
      const value = tok.slice(i + 1)
      return Number.isFinite(idx) ? { fieldIdx: idx, value } : null
    })
    .filter((x): x is { fieldIdx: number; value: string } => x != null && x.value.trim().length > 0)
}

export async function registerLibraryRoutes(app: FastifyInstance): Promise<void> {
  const svc = getLibraryService()

  app.get('/api/v1/library/serve/*', async (req, reply) => {
    const raw = (req.params as Record<string, string>)['*'] ?? ''
    const alias = decodeURIComponent(raw)

    const rec = svc.getByAlias(alias)
    if (rec) {
      const path = resolveBlobPath(rec)
      if (!existsSync(path)) return reply.code(404).send({ error: `blob missing: ${alias}` })
      reply.header('Content-Type', rec.mimeType)
      reply.header('ETag', `"${rec.blobSha256}"`)
      reply.header('Cache-Control', 'no-cache')
      return reply.send(createReadStream(path))
    }

    // Private blob fallback (user-imported assets in the active project).
    const priv = await getPrivateByAlias(alias)
    if (priv) {
      const path = resolvePrivateBlobPath(await getActiveProjectDir(), priv.blobSha256)
      if (existsSync(path)) {
        reply.header('Content-Type', priv.mimeType)
        reply.header('ETag', `"${priv.blobSha256}"`)
        return reply.send(createReadStream(path))
      }
    }

    // Shared-game-sandbox fallback (textures published by the 2D app).
    const sandbox = await resolveGameSandboxBlobByAlias(alias)
    if (sandbox) {
      reply.header('Content-Type', sandbox.mimeType)
      reply.header('Cache-Control', 'no-cache')
      return reply.send(createReadStream(sandbox.path))
    }

    // Miss → rule JSON disk fallback (rules are vendored, not in the DB).
    const rulePath = join(rulesDir(), `${alias}.json`)
    if (existsSync(rulePath)) {
      reply.header('Content-Type', 'application/json')
      reply.header('Cache-Control', 'no-cache')
      return reply.send(readFileSync(rulePath, 'utf-8'))
    }
    return reply.code(404).send({ error: `alias not found: ${alias}` })
  })

  app.get('/api/v1/library/aliases', async (req) => {
    const zone = (req.query as { zone?: string }).zone ?? 'raw'
    return svc.listAliases(zone)
  })

  // Renderer matching pool. MERGES base + project-private records of the zone so
  // imported/published (cross-app) assets are matchable, not just built-ins. A
  // private record with the same alias OVERRIDES the base one (the user's wins).
  app.get('/api/v1/library/aliases-meta', async (req) => {
    // No `zone` → zone-agnostic pool (all zones except trash); the renderer must
    // match a painted alias wherever it lives. A `zone=` param stays zone-scoped.
    const zone = (req.query as { zone?: string }).zone
    return zone ? listMergedAliasMetas(zone) : listMergedAliasMetasAllZones()
  })

  // Zones: base ∪ private, with `staging` always offered (import target) and
  // `trash` always last (the recycle bin). The frontend adds its Rules pseudo-zone.
  app.get('/api/v1/library/zones', async () => {
    const set = new Set<string>([...svc.listZones(), STAGING_ZONE, ...(await listPrivateZones())])
    set.delete(TRASH_ZONE)
    return [...set, TRASH_ZONE]
  })

  // Tilemap stitching rules (autotile). Vendored JSON under assets/rules/, not in
  // the DB — surfaced as browsable cards in the AssetStore's "Rules" pseudo-zone.
  app.get('/api/v1/library/rules', async () => svc.listRules())

  // Folder taxonomies: merge base + private folder counts/cover samples.
  app.get('/api/v1/library/facets', async (req) => {
    const q = req.query as { zone?: string; by?: FacetScheme; parent?: string }
    const by = q.by ?? 'type'
    const zone = q.zone ?? 'raw'
    const base = svc.listFacets({ zone, by, parent: q.parent })
    const priv = await facetPrivate(zone, by, q.parent)
    return mergeFacets(base, priv, by)
  })

  // Paginated, filtered listing. Private records sort FIRST (they're the user's),
  // then the base library, so the merged stream is stable across pages.
  app.get('/api/v1/library/list', async (req) => {
    const q = req.query as {
      zone?: string
      search?: string
      page?: string
      pageSize?: string
      by?: FacetScheme
      value?: string
      parent?: string
      fieldFilters?: string
    }
    const zone = q.zone ?? 'raw'
    const page = Math.max(1, q.page ? Number(q.page) : 1)
    const pageSize = Math.min(500, Math.max(1, q.pageSize ? Number(q.pageSize) : 60))
    const fieldFilters = parseFieldFilters(q.fieldFilters)
    const facet = { by: q.by, value: q.value, parent: q.parent }

    // User sources sort FIRST (sandbox-published textures, then project-private),
    // then the read-only base library. Sandbox + private are small, so we page
    // them as one in-memory "front" block and let the base library fill the rest.
    const sandbox = await listGameSandboxRecords({ zone, search: q.search })
    const privRecs = (await filterPrivate({ zone, search: q.search, fieldFilters, ...facet })).map(toAssetRecord)
    const front = [...sandbox, ...privRecs]
    const P = front.length
    const offset = (page - 1) * pageSize
    const fromFront = front.slice(offset, offset + pageSize)
    const remaining = pageSize - fromFront.length

    const baseOffset = Math.max(0, offset - P)
    const baseRes = svc.listRecordsRange({
      zone,
      search: q.search,
      ...facet,
      fieldFilters,
      offset: baseOffset,
      limit: remaining,
    })

    return {
      items: [...fromFront, ...baseRes.items],
      total: P + baseRes.total,
      page,
      pageSize,
    }
  })
}

// Merge base + private facet folders: sum counts, concat cover samples (cap 4),
// then sort (size = numeric asc, else count desc) — mirrors service.listFacets.
function mergeFacets(base: FacetItem[], priv: FacetItem[], by: FacetScheme): FacetItem[] {
  const map = new Map<string, FacetItem>()
  for (const f of [...base, ...priv]) {
    const hit = map.get(f.value)
    if (hit) {
      hit.count += f.count
      for (const s of f.samples) if (hit.samples.length < 4) hit.samples.push(s)
    } else {
      map.set(f.value, { ...f, samples: f.samples.slice(0, 4) })
    }
  }
  const items = [...map.values()]
  if (by === 'size') {
    items.sort((a, b) => {
      const na = Number(a.value)
      const nb = Number(b.value)
      if (Number.isNaN(na)) return 1
      if (Number.isNaN(nb)) return -1
      return na - nb
    })
  } else {
    items.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'zh-Hans'))
  }
  return items
}
