import { describe, it, expect } from 'vitest'
import { utimesSync } from 'node:fs'
import { join } from 'node:path'
import { ASSET_STORE_DIR, __resetSharedDbForTests, getSharedDb } from '../src/library/db.js'
import { deriveAliasMeta, getLibraryService, type CollisionMask } from '../src/library/service.js'
import { buildApp } from '../src/main.js'

describe('library routes', () => {
  it('GET /api/v1/library/aliases-meta?zone=raw returns an array', async () => {
    const app = await buildApp()
    const r = await app.inject({ method: 'GET', url: '/api/v1/library/aliases-meta?zone=raw' })
    expect(r.statusCode).toBe(200)
    const body = r.json() as Array<{ alias: string; tileType?: string }>
    expect(Array.isArray(body)).toBe(true)
    const tile = body.find((x) => x.alias.includes('_[bridge_horizontal_9]_'))
    expect(tile?.tileType).toBe('bridge_horizontal_9')
    await app.close()
  })
  it('GET /api/v1/library/aliases-meta (no zone) returns the zone-agnostic pool', async () => {
    // Renderer matching pool must not be pinned to one zone: a painted alias can
    // live in any zone (e.g. after the base library was migrated raw→staging).
    // Without a `zone` param the pool merges all zones except trash, so it stays
    // non-empty even when zero assets sit in `raw`.
    const app = await buildApp()
    const rawPool = (await app.inject({ method: 'GET', url: '/api/v1/library/aliases-meta?zone=raw' })).json() as unknown[]
    const allPool = (await app.inject({ method: 'GET', url: '/api/v1/library/aliases-meta' })).json() as unknown[]
    expect(Array.isArray(allPool)).toBe(true)
    // The all-zones pool is a superset of any single zone.
    expect(allPool.length).toBeGreaterThanOrEqual(rawPool.length)
    // In this repo every base asset lives in `staging`, so the no-zone pool must
    // surface them even though `raw` is empty.
    const staging = getLibraryService().listAliasesWithMeta('staging')
    if (staging.length > 0) expect(allPool.length).toBeGreaterThan(0)
    await app.close()
  })
  it('GET /api/v1/library/serve/common_16 returns the rule JSON (disk fallback)', async () => {
    const app = await buildApp()
    const r = await app.inject({ method: 'GET', url: '/api/v1/library/serve/common_16' })
    expect(r.statusCode).toBe(200)
    expect(r.headers['content-type']).toContain('application/json')
    expect(r.json().name).toBe('common_16')
    await app.close()
  })
  // Restored from git history (commit 6c419ebb deleted the whole pre-refactor rule
  // set on 2026-07-15) under a simple_ prefix so legacy 64×80-atlas assets (old
  // common_16 / wall_outer_16 shape: 16 base + one shared 4-variant row) still
  // have a loadable rule distinct from the redesigned common_16 / outer_wall_36.
  it('GET /api/v1/library/serve/simple_common_16 returns the restored legacy rule JSON', async () => {
    const app = await buildApp()
    const r = await app.inject({ method: 'GET', url: '/api/v1/library/serve/simple_common_16' })
    expect(r.statusCode).toBe(200)
    expect(r.headers['content-type']).toContain('application/json')
    const body = r.json()
    expect(body.name).toBe('simple_common_16')
    expect(body.sprites).toHaveLength(20)
    await app.close()
  })
  it('GET /api/v1/library/serve/simple_wall_outer_16 returns the restored legacy rule JSON', async () => {
    const app = await buildApp()
    const r = await app.inject({ method: 'GET', url: '/api/v1/library/serve/simple_wall_outer_16' })
    expect(r.statusCode).toBe(200)
    expect(r.headers['content-type']).toContain('application/json')
    const body = r.json()
    expect(body.name).toBe('simple_wall_outer_16')
    expect(body.sprites).toHaveLength(20)
    expect(body.faces.front.basePieces).toBe(16)
    await app.close()
  })
  it('GET /api/v1/library/serve/<real-image-alias> streams the blob', async () => {
    const aliases = getLibraryService().listAliases('raw')
    if (aliases.length === 0) return
    const app = await buildApp()
    const r = await app.inject({ method: 'GET', url: `/api/v1/library/serve/${encodeURIComponent(aliases[0])}` })
    expect(r.statusCode).toBe(200)
    expect(r.headers['content-type']).toMatch(/^image\//)
    await app.close()
  })
  it('GET /api/v1/library/zones returns an array of zone names', async () => {
    const app = await buildApp()
    const r = await app.inject({ method: 'GET', url: '/api/v1/library/zones' })
    expect(r.statusCode).toBe(200)
    expect(Array.isArray(r.json())).toBe(true)
    await app.close()
  })
  it('GET /api/v1/library/list?zone=raw returns a paginated record page', async () => {
    const app = await buildApp()
    const r = await app.inject({ method: 'GET', url: '/api/v1/library/list?zone=raw&page=1&pageSize=5' })
    expect(r.statusCode).toBe(200)
    const body = r.json()
    expect(body.page).toBe(1)
    expect(body.pageSize).toBe(5)
    expect(typeof body.total).toBe('number')
    expect(Array.isArray(body.items)).toBe(true)
    expect(body.items.length).toBeLessThanOrEqual(5)
    if (body.items.length > 0) {
      expect(typeof body.items[0].alias).toBe('string')
      expect(body.items[0].zone).toBe('raw')
    }
    await app.close()
  })
  it('GET /api/v1/library/facets?by=type returns folders with counts + cover samples', async () => {
    const app = await buildApp()
    const r = await app.inject({ method: 'GET', url: '/api/v1/library/facets?zone=raw&by=type' })
    expect(r.statusCode).toBe(200)
    const body = r.json()
    expect(Array.isArray(body)).toBe(true)
    if (body.length > 0) {
      const f = body[0]
      expect(typeof f.value).toBe('string')
      expect(typeof f.label).toBe('string')
      expect(typeof f.count).toBe('number')
      expect(Array.isArray(f.samples)).toBe(true)
      expect(f.samples.length).toBeLessThanOrEqual(4)
    }
    await app.close()
  })
  it('GET /api/v1/library/list?by=type&value=… filters to one folder (subset of the zone)', async () => {
    const app = await buildApp()
    const facets = (await app.inject({ method: 'GET', url: '/api/v1/library/facets?zone=raw&by=type' })).json() as Array<{ value: string; count: number }>
    const whole = (await app.inject({ method: 'GET', url: '/api/v1/library/list?zone=raw&pageSize=1' })).json()
    if (facets.length === 0) { await app.close(); return }
    const pick = facets.find((f) => f.value !== '__none__') ?? facets[0]
    const r = await app.inject({ method: 'GET', url: `/api/v1/library/list?zone=raw&pageSize=500&by=type&value=${encodeURIComponent(pick.value)}` })
    expect(r.statusCode).toBe(200)
    const body = r.json()
    // The filtered total must equal the facet's reported count and not exceed the zone total.
    expect(body.total).toBe(pick.count)
    expect(body.total).toBeLessThanOrEqual(whole.total)
    await app.close()
  })
  it('GET /api/v1/library/facets?by=place is single-level (室内/室外; no room drill-down)', async () => {
    // 小区域(roomType) field was removed → place is now a flat 室内/室外 facet.
    const app = await buildApp()
    const lvl1 = (await app.inject({ method: 'GET', url: '/api/v1/library/facets?zone=raw&by=place' })).json() as Array<{ value: string }>
    expect(Array.isArray(lvl1)).toBe(true)
    if (lvl1.length > 0) {
      const parent = lvl1[0].value
      const rooms = await app.inject({ method: 'GET', url: `/api/v1/library/facets?zone=raw&by=place&parent=${encodeURIComponent(parent)}` })
      expect(rooms.statusCode).toBe(200)
      // A drill-in request has no sub-rooms anymore → empty list.
      expect(rooms.json()).toEqual([])
    }
    await app.close()
  })
  it('GET /api/v1/library/rules lists the vendored tilemap rules with normalized fields', async () => {
    const app = await buildApp()
    const r = await app.inject({ method: 'GET', url: '/api/v1/library/rules' })
    expect(r.statusCode).toBe(200)
    const body = r.json()
    expect(Array.isArray(body)).toBe(true)
    const aliases = body.map((x: { alias: string }) => x.alias)
    expect(aliases).toContain('common_16')
    expect(aliases).toContain('floor_1')
    const common = body.find((x: { alias: string }) => x.alias === 'common_16')
    expect(common.schemaVersion).toBe(2)
    expect(common.name).toBe('common_16')
    const floor = body.find((x: { alias: string }) => x.alias === 'floor_1')
    expect(floor.name).toBe('floor_1')
    expect(typeof common.ppu).toBe('number')
    expect(common.spriteCount).toBeGreaterThan(0)
    // v2 nests the lookup under faces.top; the summary must surface it.
    expect(common.faces.top.basePieces).toBeGreaterThan(0)
    expect(common.faces.top.mapEntries).toBeGreaterThan(0)
    expect(Array.isArray(common.regions)).toBe(true)
    await app.close()
  })
  it('GET /api/v1/library/rules includes the three new tile-group rules with grid-correct sprite counts', async () => {
    const app = await buildApp()
    const body = (await app.inject({ method: 'GET', url: '/api/v1/library/rules' })).json() as Array<{
      alias: string
      schemaVersion: number
      ppu: number
      spriteCount: number
      faces: { top?: { basePieces: number; mapEntries: number } }
    }>
    const byAlias = Object.fromEntries(body.map((r) => [r.alias, r]))
    // slope_9 + bridge_horizontal_9: 3×3 = 9 sprites; bridge_vertical_15: 5×3 = 15.
    for (const [alias, sprites] of [['slope_9', 9], ['bridge_horizontal_9', 9], ['bridge_vertical_15', 15]] as const) {
      const rule = byAlias[alias]
      expect(rule, `rule ${alias} should be listed`).toBeTruthy()
      expect(rule.schemaVersion).toBe(2)
      expect(rule.ppu).toBe(16)
      expect(rule.spriteCount).toBe(sprites)
      expect(rule.faces.top?.basePieces).toBe(sprites)
      // Each rule must cover the fully-surrounded interior key plus the boundary keys.
      expect(rule.faces.top?.mapEntries).toBeGreaterThanOrEqual(9)
    }
    await app.close()
  })
  it('GET /api/v1/library/serve/<tile-group rule> streams the vendored JSON for each new rule', async () => {
    const app = await buildApp()
    for (const alias of ['slope_9', 'bridge_horizontal_9', 'bridge_vertical_15']) {
      const r = await app.inject({ method: 'GET', url: `/api/v1/library/serve/${alias}` })
      expect(r.statusCode, `serve ${alias}`).toBe(200)
      expect(r.headers['content-type']).toContain('application/json')
      expect(r.json().name).toBe(alias)
    }
    await app.close()
  })
  it('GET /api/v1/assets returns a safe project asset listing', async () => {
    const app = await buildApp()
    const r = await app.inject({ method: 'GET', url: '/api/v1/assets' })
    expect(r.statusCode).toBe(200)
    const body = r.json()
    expect(Array.isArray(body.items)).toBe(true)
    for (const item of body.items) {
      expect(item).not.toHaveProperty('absPath')
    }
    await app.close()
  })
})

describe('library service (read-only)', () => {
  it('does not throw and returns arrays for list methods', () => {
    const svc = getLibraryService()
    expect(Array.isArray(svc.listAliases('raw'))).toBe(true)
    expect(Array.isArray(svc.listAliasesWithMeta('raw'))).toBe(true)
  })
  it('resolves a real image alias from the shared db to a record', () => {
    const svc = getLibraryService()
    const aliases = svc.listAliases('raw')
    if (aliases.length === 0) { console.warn('no raw-zone aliases; db may be empty'); return }
    const rec = svc.getByAlias(aliases[0], 'raw')
    expect(rec).not.toBeNull()
    expect(typeof rec!.blobSha256 === 'string').toBe(true)
  })
  it('derives tileType from the alias type field (idx 7 = rule alias)', () => {
    const meta = deriveAliasMeta({
      alias: '[外]_[室外]_[草]_[]_[无]_[自然]_[正常]_[common_16]_[16]_[静态]_[]_[0].png',
      anchor_x: null,
      anchor_y: null,
      width_px: 16,
      height_px: 16,
      geometry_json: null,
    })
    expect(meta.tileType).toBe('common_16')
  })
  it('binds the three new tile-group assets to their rule aliases via the type field', () => {
    const cases: Array<{ alias: string; assetKind: string }> = [
      { alias: '[—]_[]_[坡面]_[]_[]_[国风仙侠]_[未裁剪]_[slope_9]_[9]_[静态]_[]_[].png', assetKind: 'slope_9' },
      { alias: '[—]_[]_[桥梁]_[]_[水平]_[国风仙侠]_[未裁剪]_[bridge_horizontal_9]_[9]_[静态]_[]_[].png', assetKind: 'bridge_horizontal_9' },
      { alias: '[—]_[]_[桥面]_[]_[竖直]_[国风仙侠]_[未裁剪]_[bridge_vertical_15]_[15]_[静态]_[]_[].png', assetKind: 'bridge_vertical_15' },
    ]
    for (const { alias, assetKind } of cases) {
      const meta = deriveAliasMeta({
        alias,
        anchor_x: null,
        anchor_y: null,
        width_px: 48,
        height_px: assetKind === 'bridge_vertical_15' ? 80 : 48,
        geometry_json: null,
      })
      expect(meta.tileType, `${assetKind} binding`).toBe(assetKind)
    }
  })
  it('derives object placement metadata from imported geometry', () => {
    expect(deriveAliasMeta({
      alias: '[室内]_[室内]_[床]_[]_[无]_[现代]_[正常]_[asset]_[32]_[静态]_[]_[0].png',
      anchor_x: 0.5,
      anchor_y: 0,
      width_px: 48,
      height_px: 64,
      geometry_json: JSON.stringify({
        object_height: 33,
        collision_mask: {
          type: 'rectangle',
          x: 4,
          y: 16,
          width: 32,
          height: 30,
        },
      }),
    })).toEqual({
      alias: '[室内]_[室内]_[床]_[]_[无]_[现代]_[正常]_[asset]_[32]_[静态]_[]_[0].png',
      anchorX: 0.5,
      anchorY: 0,
      widthPx: 48,
      heightPx: 64,
      ppu: 16,
      objectHeightPx: 33,
      geometry: {
        collisionMask: {
          kind: 'rectangle',
          x: 4,
          y: 16,
          width: 32,
          height: 30,
        },
      },
    })
  })
  it('exposes normalized rectangle collision geometry from aliases-meta', () => {
    const meta = deriveAliasMeta({
      alias: '[城市街区-商业区-医疗区]_[室外]_[医院]_[]_[靠上]_[赛博朋克]_[正常]_[asset]_[512]_[静态]_[]_[0].png',
      anchor_x: null,
      anchor_y: null,
      width_px: 455,
      height_px: 453,
      geometry_json: JSON.stringify({
        collision_category: 'Rectangler',
        collision_mask: [[0.007780612413150489, 0.003361485743427206], [0.9665404081938844, 0.49266223718680435]],
        object_height: 230,
        pivot: [0.4871605103035175, 0.24801186146511578],
      }),
    })

    expect(meta.objectHeightPx).toBe(230)
    const mask = meta.geometry?.collisionMask
    expect(mask?.kind).toBe('rectangle')
    if (mask?.kind !== 'rectangle') throw new Error('expected rectangle collision mask')
    expect(mask.x).toBeCloseTo(3.5401786479834723)
    expect(mask.y).toBeCloseTo(229.82400655437763)
    expect(mask.width).toBeCloseTo(436.23570708023396)
    expect(mask.height).toBeCloseTo(221.65324040384985)
    expect(computeTestFootprint(meta.geometry?.collisionMask, meta.ppu)).toEqual({ width: 28, height: 15 })
  })
  it('exposes the real hospital DB row with a non-fallback aliases-meta footprint when present', () => {
    const svc = getLibraryService()
    const aliases = svc.listAliasesWithMeta('raw')
    const hospital = aliases.find((x) => x.alias.includes('_[医院]_[]_[靠上]_[赛博朋克]_'))
    if (!hospital) return

    expect(hospital.objectHeightPx).toBe(230)
    expect(hospital.geometry?.collisionMask?.kind).toBe('rectangle')
    expect(computeTestFootprint(hospital.geometry?.collisionMask, hospital.ppu)).toEqual({ width: 28, height: 14 })
  })
  it('derives normalized polygon collision geometry from exported metadata', () => {
    const meta = deriveAliasMeta({
      alias: '[城市-城镇-街道-社区]_[室外]_[医院]_[]_[靠上]_[日式和风]_[正常]_[asset]_[128]_[静态]_[]_[0].png',
      anchor_x: null,
      anchor_y: null,
      width_px: 171,
      height_px: 175,
      geometry_json: JSON.stringify({
        collision_category: 'Polygon',
        collision_mask: [[0.01904494393559607, 0.11601603167017216], [0.9837283263280452, 0.46212335565842877], [0.01904494393559607, 0.47230298283455396]],
        object_height: 92,
      }),
    })

    expect(meta.objectHeightPx).toBe(92)
    const mask = meta.geometry?.collisionMask
    expect(mask?.kind).toBe('polygon')
    if (mask?.kind !== 'polygon') throw new Error('expected polygon collision mask')
    expect(mask.points).toHaveLength(3)
    expect(mask.points[0].x).toBeCloseTo(3.2566854129869283)
    expect(mask.points[0].y).toBeCloseTo(154.69719445771986)
    expect(mask.points[1].x).toBeCloseTo(168.21754380209572)
    expect(mask.points[1].y).toBeCloseTo(94.12841275977496)
    expect(mask.points[2].x).toBeCloseTo(3.2566854129869283)
    expect(mask.points[2].y).toBeCloseTo(92.34697800395305)
    expect(computeTestFootprint(meta.geometry?.collisionMask, meta.ppu)).toEqual({ width: 11, height: 5 })
  })
  it('maps a legacy type-field token to its rule alias (tilemap → common_16)', () => {
    expect(deriveAliasMeta({
      alias: '[外]_[室外]_[草]_[]_[无]_[自然]_[正常]_[tilemap]_[16]_[静态]_[]_[0].png',
      anchor_x: null,
      anchor_y: null,
      width_px: 16,
      height_px: 16,
      geometry_json: null,
    })).toMatchObject({
      tileType: 'common_16',
    })
  })
  it('maps taxonomy junk 瓦片组 / wa_inner to vendored stitch rules', () => {
    expect(deriveAliasMeta({
      alias: '[]_[]_[草地]_[]_[]_[中式国风]_[未裁剪]_[瓦片组]_[64]_[]_[]_[]_[].png',
      anchor_x: null,
      anchor_y: null,
      width_px: 64,
      height_px: 64,
      geometry_json: null,
    })).toMatchObject({ tileType: 'common_16' })
    expect(deriveAliasMeta({
      alias: '[T地形块-人造结构-墙]_[室内]_[墙体]_[]_[]_[中式国风]_[]_[wa_inner]_[64]_[]_[无]_[0]_[客厅].png',
      anchor_x: null,
      anchor_y: null,
      width_px: 64,
      height_px: 64,
      geometry_json: null,
    })).toMatchObject({ tileType: 'wall_outer_16' })
  })
  it('exposes a tile asset with rule alias from the type field (f7)', () => {
    const svc = getLibraryService()
    const aliases = svc.listAliasesWithMeta('raw')
    const tile = aliases.find((x) => x.alias.includes('_[bridge_horizontal_9]_'))

    expect(tile).toBeDefined()
    expect(tile?.tileType).toBe('bridge_horizontal_9')
  })
  it('does not mark cutout object rows as tile metadata', () => {
    const meta = deriveAliasMeta({
      alias: '[办公室]_[室内]_[椅子]_[]_[无]_[现代日常]_[正常]_[asset]_[32]_[静态]_[]_[0].png',
      anchor_x: null,
      anchor_y: null,
      width_px: 32,
      height_px: 32,
      geometry_json: null,
    })

    expect(meta.tileType).toBeUndefined()
  })
  it('reopens the shared DB when library.db mtime changes', () => {
    __resetSharedDbForTests()
    const first = getSharedDb()
    if (!first) return

    const dbPath = join(ASSET_STORE_DIR, 'library.db')
    const nextTime = new Date(Date.now() + 10_000)
    utimesSync(dbPath, nextTime, nextTime)

    const second = getSharedDb()
    expect(second).not.toBe(first)
    __resetSharedDbForTests()
  })
})

describe('library index facet (f0 hierarchy)', () => {
  it('listFacets by index returns root-level path segments', () => {
    const svc = getLibraryService()
    const facets = svc.listFacets({ zone: 'raw', by: 'index' })
    if (facets.length === 0) {
      console.warn('no raw assets; skip index facet test')
      return
    }
    expect(facets[0]).toMatchObject({ value: expect.any(String), label: expect.any(String), count: expect.any(Number) })
    const building = facets.find((f) => f.value.startsWith('A场景资产-建筑') || f.label === 'A场景资产')
    if (building) {
      const children = svc.listFacets({ zone: 'raw', by: 'index', parent: building.value })
      expect(children.length).toBeGreaterThan(0)
      expect(children.every((c) => c.value.startsWith(`${building.value}-`))).toBe(true)
    }
  })

  it('listRecords by index filters a whole subtree', () => {
    const svc = getLibraryService()
    const facets = svc.listFacets({ zone: 'raw', by: 'index' })
    const node = facets.find((f) => f.value.includes('A场景资产'))
    if (!node) {
      console.warn('no A场景资产 subtree; skip')
      return
    }
    const page = svc.listRecords({ zone: 'raw', by: 'index', value: node.value, pageSize: 5 })
    expect(page.total).toBeGreaterThan(0)
    for (const item of page.items) {
      const f0 = item.alias.match(/\[([^\]]*)\]/)?.[1] ?? ''
      expect(f0 === node.value || f0.startsWith(`${node.value}-`)).toBe(true)
    }
  })
})

function computeTestFootprint(mask: CollisionMask | undefined, ppu = 16): { width: number; height: number } {
  if (!mask || ppu <= 0) return { width: 1, height: 1 }
  const bounds = mask.kind === 'rectangle'
    ? { minX: mask.x, minY: mask.y, maxX: mask.x + mask.width, maxY: mask.y + mask.height }
    : mask.points.reduce(
        (acc, point) => ({
          minX: Math.min(acc.minX, point.x),
          minY: Math.min(acc.minY, point.y),
          maxX: Math.max(acc.maxX, point.x),
          maxY: Math.max(acc.maxY, point.y),
        }),
        { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
      )
  if (!Number.isFinite(bounds.minX)) return { width: 1, height: 1 }
  return {
    width: Math.max(1, Math.ceil(bounds.maxX / ppu) - Math.floor(bounds.minX / ppu)),
    height: Math.max(1, Math.ceil(bounds.maxY / ppu) - Math.floor(bounds.minY / ppu)),
  }
}
