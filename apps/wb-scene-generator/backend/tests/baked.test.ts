import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'

// Isolated workspace so we assert an empty initial baked tree + file creation.
// Set before any getRuntime() call (which only happens inside buildApp()).
const ws = mkdtempSync(join(tmpdir(), 'baked-test-'))
process.env.FORGEAX_PROJECT_ROOT = ws

interface BakedLayer {
  nodePath: string
  nodeName: string
  assetName: string
  assetType?: string
  assetAlias?: string
  cells: { x: number; y: number; z: number; token?: string; state?: Record<string, unknown> }[]
  attributes?: Record<string, unknown>
}

async function layers(app: FastifyInstance): Promise<BakedLayer[]> {
  const r = await app.inject({ method: 'GET', url: '/api/v1/baked/layers' })
  expect(r.statusCode).toBe(200)
  return r.json().layers as BakedLayer[]
}

describe('baked scene-layer service', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    const { buildApp } = await import('../src/main.js')
    app = await buildApp()
  })

  it('starts empty', async () => {
    expect(await layers(app)).toEqual([])
  })

  it('starts with empty baked edit history', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/baked/history' })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({
      canUndo: false,
      canRedo: false,
      entries: [],
    })
  })

  it('adds an empty editable layer (visible in the panel even with no cells) + persists to the project folder', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/baked/layers', payload: { name: 'Floor' } })
    expect(r.statusCode).toBe(200)
    expect(r.json().path).toBe('/Floor')
    const ls = await layers(app)
    expect(ls).toHaveLength(1)
    expect(ls[0]).toMatchObject({ nodePath: '/Floor', nodeName: 'Floor', assetName: '', cells: [] })
    // Legacy 'main' project dir == workspaceRoot, so the file lands at ws/baked-scene.json.
    expect(existsSync(join(ws, 'baked-scene.json'))).toBe(true)
  })

  it('paints cells (whole-layer overwrite) and binds the asset', async () => {
    const r = await app.inject({
      method: 'PATCH',
      url: '/api/v1/baked/layers/cells',
      payload: { path: '/Floor', cells: [{ x: 1, y: 2, z: 0, token: 'grass' }], asset: { name: 'grass', type: 'tile' } },
    })
    expect(r.statusCode).toBe(200)
    const floor = (await layers(app)).find((l) => l.nodePath === '/Floor')!
    expect(floor.cells).toHaveLength(1)
    expect(floor.cells[0]).toMatchObject({ x: 1, y: 2, z: 0 })
    expect(floor.assetName).toBe('grass')
    expect(floor.assetType).toBe('tile')
  })

  it('records paint history and restores baked-scene snapshots with undo and redo', async () => {
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/baked/layers/cells',
      payload: {
        path: '/HistoryPaint',
        cells: [{ x: 1, y: 1, z: 0, token: 'grass' }],
        asset: { name: 'grass', type: 'tile', alias: 'grass-alias' },
      },
    })
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/baked/layers/cells',
      payload: {
        path: '/HistoryPaint',
        cells: [
          { x: 1, y: 1, z: 0, token: 'grass' },
          { x: 2, y: 1, z: 0, token: 'grass' },
        ],
        asset: { name: 'grass', type: 'tile', alias: 'grass-alias' },
      },
    })

    const undo = await app.inject({ method: 'POST', url: '/api/v1/baked/history/undo' })
    expect(undo.statusCode).toBe(200)
    expect((await layers(app)).find((l) => l.nodePath === '/HistoryPaint')!.cells).toEqual([
      { x: 1, y: 1, z: 0, token: 'grass' },
    ])

    const redo = await app.inject({ method: 'POST', url: '/api/v1/baked/history/redo' })
    expect(redo.statusCode).toBe(200)
    expect((await layers(app)).find((l) => l.nodePath === '/HistoryPaint')!.cells).toHaveLength(2)
  })

  it('clears redo when a new baked mutation happens after undo', async () => {
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/baked/layers/cells',
      payload: {
        path: '/RedoClear',
        cells: [{ x: 0, y: 0, z: 0 }],
        asset: { name: 'stone', type: 'tile' },
      },
    })
    await app.inject({ method: 'POST', url: '/api/v1/baked/history/undo' })
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/baked/layers/cells',
      payload: {
        path: '/RedoClear',
        cells: [{ x: 9, y: 9, z: 0 }],
        asset: { name: 'stone', type: 'tile' },
      },
    })
    const h = await app.inject({ method: 'GET', url: '/api/v1/baked/history' })
    expect(h.json().canRedo).toBe(false)
  })

  it('does not record history for no-op whole-layer cell writes', async () => {
    const payload = {
      path: '/NoopHistory',
      cells: [{ x: 3, y: 3, z: 0, token: 'x' }],
      asset: { name: 'x', type: 'tile' },
    }
    await app.inject({ method: 'PATCH', url: '/api/v1/baked/layers/cells', payload })
    const before = (await app.inject({ method: 'GET', url: '/api/v1/baked/history' })).json().entries.length
    await app.inject({ method: 'PATCH', url: '/api/v1/baked/layers/cells', payload })
    const after = (await app.inject({ method: 'GET', url: '/api/v1/baked/history' })).json().entries.length
    expect(after).toBe(before)
  })

  it('undo and redo preserve multi-cell object instance state', async () => {
    const cells = [
      { x: 4, y: 7, z: 2, token: 'Tree', state: { instanceId: 'inst_erase_1', role: 'anchor', footprintDx: 0, footprintDy: 0, columnDz: 0, columnHeight: 2, footprintOrigin: { x: 4, y: 7, z: 2 } } },
      { x: 4, y: 7, z: 3, token: 'Tree', state: { instanceId: 'inst_erase_1', role: 'column', footprintDx: 0, footprintDy: 0, columnDz: 1, columnHeight: 2, footprintOrigin: { x: 4, y: 7, z: 2 } } },
    ]
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/baked/layers/cells',
      payload: {
        path: '/HistoryObjects',
        cells,
        asset: { name: 'Tree', type: 'object', alias: 'tree-alias' },
      },
    })
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/baked/layers/cells',
      payload: {
        path: '/HistoryObjects',
        cells: [],
        asset: { name: 'Tree', type: 'object', alias: 'tree-alias' },
      },
    })
    await app.inject({ method: 'POST', url: '/api/v1/baked/history/undo' })
    expect((await layers(app)).find((l) => l.nodePath === '/HistoryObjects')!.cells).toEqual(cells)
  })

  it('round-trips object cell state through baked cells', async () => {
    const cells = [{
      x: 4,
      y: 7,
      z: 2,
      token: 'Tree',
      state: {
        instanceId: 'inst_test_1',
        role: 'anchor',
        footprintDx: 1,
        footprintDy: 0,
        columnDz: 0,
        columnHeight: 3,
        footprintOrigin: { x: 3, y: 7, z: 2 },
      },
    }]

    const r = await app.inject({
      method: 'PATCH',
      url: '/api/v1/baked/layers/cells',
      payload: { path: '/Objects', cells, asset: { name: 'Tree', type: 'object' } },
    })
    expect(r.statusCode).toBe(200)

    const objects = (await layers(app)).find((l) => l.nodePath === '/Objects')!
    expect(objects.cells).toEqual(cells)
  })

  it('persists exact asset aliases separately from duplicate display names', async () => {
    const alias = '[school][室内]__[学校]_[办公室]_[盆栽]_[无]_[现代日常]_[正常]_[抠图]_[32]__[静态]_[]_[0]'
    const r = await app.inject({
      method: 'PATCH',
      url: '/api/v1/baked/layers/cells',
      payload: {
        path: '/AliasObject',
        cells: [{ x: 2, y: 3, z: 0, token: '盆栽' }],
        asset: { name: '盆栽', type: 'object', alias },
      },
    })
    expect(r.statusCode).toBe(200)

    const layer = (await layers(app)).find((l) => l.nodePath === '/AliasObject')!
    expect(layer.assetName).toBe('盆栽')
    expect(layer.assetAlias).toBe(alias)
    expect(layer.attributes?.asset_alias).toBe(alias)
  })

  it('adds a sub-layer as a tree child', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/baked/sublayer', payload: { parentPath: '/Floor', name: 'Detail' } })
    expect(r.statusCode).toBe(200)
    expect(r.json().path).toBe('/Floor/Detail')
    expect((await layers(app)).some((l) => l.nodePath === '/Floor/Detail')).toBe(true)
  })

  it('rejects a sub-layer with no parentPath', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/baked/sublayer', payload: { name: 'x' } })
    expect(r.statusCode).toBe(400)
  })

  it('bakes transient layers into editable copies', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/baked/bake',
      payload: { layers: [{ nodePath: '/Snapshot', nodeName: 'Snapshot', cells: [{ x: 0, y: 0, z: 0 }], assetName: 'wall', assetType: 'tile' }] },
    })
    expect(r.statusCode).toBe(200)
    expect(r.json().paths).toEqual(['/Snapshot'])
    const baked = (await layers(app)).find((l) => l.nodePath === '/Snapshot')!
    expect(baked.cells).toHaveLength(1)
    expect(baked.assetName).toBe('wall')
  })

  it('bake preserves the selection\'s parent/child hierarchy and order', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/baked/bake',
      payload: { layers: [
        { nodePath: '/House', nodeName: 'House', cells: [{ x: 0, y: 0, z: 0 }], assetName: 'wall' },
        { nodePath: '/House/Roof', nodeName: 'Roof', cells: [{ x: 0, y: 0, z: 1 }], assetName: 'roof' },
        { nodePath: '/House/Wall', nodeName: 'Wall', cells: [{ x: 1, y: 0, z: 0 }], assetName: 'wall' },
      ] },
    })
    expect(r.statusCode).toBe(200)
    expect(r.json().paths).toEqual(['/House', '/House/Roof', '/House/Wall'])
    const ls = await layers(app)
    // Hierarchy preserved: parent + both children exist at nested paths.
    expect(ls.some((l) => l.nodePath === '/House')).toBe(true)
    expect(ls.some((l) => l.nodePath === '/House/Roof')).toBe(true)
    expect(ls.some((l) => l.nodePath === '/House/Wall')).toBe(true)
    // Order preserved: /House (parent) projects before its children.
    const order = ls.map((l) => l.nodePath)
    expect(order.indexOf('/House')).toBeLessThan(order.indexOf('/House/Roof'))
  })

  it('re-baking a colliding root remaps the whole subtree (keeps internal nesting, no clobber)', async () => {
    // /House already exists from the previous test → second bake shifts to "/House 2".
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/baked/bake',
      payload: { layers: [
        { nodePath: '/House', nodeName: 'House', cells: [{ x: 5, y: 5, z: 0 }], assetName: 'wall' },
        { nodePath: '/House/Roof', nodeName: 'Roof', cells: [{ x: 5, y: 5, z: 1 }], assetName: 'roof' },
      ] },
    })
    expect(r.statusCode).toBe(200)
    expect(r.json().paths).toEqual(['/House 2', '/House 2/Roof'])
    const ls = await layers(app)
    // Original /House/Roof untouched; new subtree nested under the remapped root.
    expect(ls.some((l) => l.nodePath === '/House/Roof')).toBe(true)
    expect(ls.some((l) => l.nodePath === '/House 2/Roof')).toBe(true)
  })

  it('move reparents a layer subtree under a new parent', async () => {
    // Set up two top-level layers.
    await app.inject({ method: 'POST', url: '/api/v1/baked/layers', payload: { name: 'A' } })
    await app.inject({ method: 'POST', url: '/api/v1/baked/layers', payload: { name: 'B' } })
    const r = await app.inject({ method: 'PATCH', url: '/api/v1/baked/move', payload: { path: '/B', destParentPath: '/A' } })
    expect(r.statusCode).toBe(200)
    expect(r.json().path).toBe('/A/B')
    const ls = await layers(app)
    expect(ls.some((l) => l.nodePath === '/A/B')).toBe(true)
    expect(ls.some((l) => l.nodePath === '/B')).toBe(false) // moved, not duplicated
  })

  it('move with beforeName reorders siblings', async () => {
    // Fresh siblings X, Y, Z at root (created in that order).
    for (const n of ['X', 'Y', 'Z']) await app.inject({ method: 'POST', url: '/api/v1/baked/layers', payload: { name: n } })
    // Move Z before X → order among {X,Y,Z} becomes Z, X, Y.
    const r = await app.inject({ method: 'PATCH', url: '/api/v1/baked/move', payload: { path: '/Z', destParentPath: '/', beforeName: 'X' } })
    expect(r.statusCode).toBe(200)
    const paths = (await layers(app)).map((l) => l.nodePath)
    expect(paths.indexOf('/Z')).toBeLessThan(paths.indexOf('/X'))
    expect(paths.indexOf('/X')).toBeLessThan(paths.indexOf('/Y'))
  })

  it('move without beforeName appends the node last (drag-to-bottom)', async () => {
    // Three siblings created in order → display order M1, M2, M3.
    for (const n of ['M1', 'M2', 'M3']) await app.inject({ method: 'POST', url: '/api/v1/baked/layers', payload: { name: n } })
    const order0 = (await layers(app)).map((l) => l.nodePath).filter((p) => p.startsWith('/M'))
    expect(order0).toEqual(['/M1', '/M2', '/M3'])
    // Drag the MIDDLE one (M2) to the bottom — beforeName omitted = append last.
    const r = await app.inject({ method: 'PATCH', url: '/api/v1/baked/move', payload: { path: '/M2', destParentPath: '/' } })
    expect(r.statusCode).toBe(200)
    expect(r.json().path).toBe('/M2') // not reparented, stays at root
    const order1 = (await layers(app)).map((l) => l.nodePath).filter((p) => p.startsWith('/M'))
    expect(order1).toEqual(['/M1', '/M3', '/M2']) // M2 is now truly last
  })

  it('move into own descendant is rejected (no cycle)', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/baked/layers', payload: { name: 'P' } })
    await app.inject({ method: 'POST', url: '/api/v1/baked/sublayer', payload: { parentPath: '/P', name: 'Q' } })
    const r = await app.inject({ method: 'PATCH', url: '/api/v1/baked/move', payload: { path: '/P', destParentPath: '/P/Q' } })
    expect(r.statusCode).toBe(200)
    expect(r.json().path).toBeNull()
    // P stays at root with its child intact.
    const ls = await layers(app)
    expect(ls.some((l) => l.nodePath === '/P/Q')).toBe(true)
  })

  it('renames a layer without dropping children or accepting an empty name', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/baked/layers', payload: { name: 'RenameMe' } })
    await app.inject({ method: 'POST', url: '/api/v1/baked/sublayer', payload: { parentPath: '/RenameMe', name: 'Child' } })
    const empty = await app.inject({ method: 'PATCH', url: '/api/v1/baked/rename', payload: { path: '/RenameMe', name: '   ' } })
    expect(empty.statusCode).toBe(400)

    const r = await app.inject({ method: 'PATCH', url: '/api/v1/baked/rename', payload: { path: '/RenameMe', name: 'Renamed' } })
    expect(r.statusCode).toBe(200)
    expect(r.json().path).toBe('/Renamed')
    const ls = await layers(app)
    expect(ls.some((l) => l.nodePath === '/Renamed')).toBe(true)
    expect(ls.some((l) => l.nodePath === '/Renamed/Child')).toBe(true)
    expect(ls.some((l) => l.nodePath === '/RenameMe')).toBe(false)
  })

  it('adding a sub-layer does not reorder the parent among its siblings', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/baked/layers', payload: { name: 'OrdA' } })
    await app.inject({ method: 'POST', url: '/api/v1/baked/layers', payload: { name: 'OrdB' } })
    const before = (await layers(app)).map((l) => l.nodePath)
    expect(before.indexOf('/OrdA')).toBeLessThan(before.indexOf('/OrdB'))
    // Adding a child under OrdA previously bumped OrdA's version to the end.
    await app.inject({ method: 'POST', url: '/api/v1/baked/sublayer', payload: { parentPath: '/OrdA', name: 'Sub' } })
    const after = (await layers(app)).map((l) => l.nodePath)
    expect(after.indexOf('/OrdA')).toBeLessThan(after.indexOf('/OrdB')) // parent order stable
    expect(after.indexOf('/OrdA')).toBeLessThan(after.indexOf('/OrdA/Sub')) // child after parent
  })

  it('painting an existing layer does not move it among its siblings', async () => {
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/baked/layers/cells',
      payload: { path: '/OrdA', cells: [{ x: 0, y: 0, z: 0 }], asset: { name: 'x', type: 'tile' } },
    })
    const after = (await layers(app)).map((l) => l.nodePath)
    expect(after.indexOf('/OrdA')).toBeLessThan(after.indexOf('/OrdB'))
  })

  it('routes paint: an empty layer binds to the asset (target = the layer itself)', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/baked/layers', payload: { name: 'RT' } })
    const r = await app.inject({ method: 'POST', url: '/api/v1/baked/target', payload: { parentPath: '/RT', asset: { name: 'grass', type: 'tile' } } })
    expect(r.statusCode).toBe(200)
    expect(r.json().path).toBe('/RT')
    const rt = (await layers(app)).find((l) => l.nodePath === '/RT')!
    expect(rt.assetName).toBe('grass')
    expect(rt.assetType).toBe('tile')
  })

  it('routes paint: the same asset reuses the active layer', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/baked/target', payload: { parentPath: '/RT', asset: { name: 'grass', type: 'tile' } } })
    expect(r.json().path).toBe('/RT')
  })

  it('routes paint: a different asset auto-creates a layer-n sub-layer (object type), parent order stable', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/baked/target', payload: { parentPath: '/RT', asset: { name: 'tree', type: 'object' } } })
    expect(r.json().path).toBe('/RT/layer-1')
    const ls = await layers(app)
    const sub = ls.find((l) => l.nodePath === '/RT/layer-1')!
    expect(sub.assetName).toBe('tree')
    expect(sub.assetType).toBe('object')
    const paths = ls.map((l) => l.nodePath)
    expect(paths.indexOf('/RT')).toBeLessThan(paths.indexOf('/RT/layer-1')) // parent before its new child
  })

  it('routes paint: reuses the existing same-asset sub-layer (no layer-2)', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/baked/target', payload: { parentPath: '/RT', asset: { name: 'tree', type: 'object' } } })
    expect(r.json().path).toBe('/RT/layer-1')
    expect((await layers(app)).some((l) => l.nodePath === '/RT/layer-2')).toBe(false)
  })

  it('routes paint by exact alias when duplicate display names differ', async () => {
    const aliasA = '[a][1][2][3][盆栽][5][6][7][抠图][16][10][11][v]'
    const aliasB = '[b][1][2][3][盆栽][5][6][7][抠图][32][10][11][v]'
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/baked/layers/cells',
      payload: { path: '/AliasRoute', cells: [], asset: { name: '盆栽', type: 'object', alias: aliasA } },
    })

    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/baked/target',
      payload: { parentPath: '/AliasRoute', asset: { name: '盆栽', type: 'object', alias: aliasB } },
    })
    expect(r.statusCode).toBe(200)
    expect(r.json().path).toBe('/AliasRoute/layer-1')
    const sub = (await layers(app)).find((l) => l.nodePath === '/AliasRoute/layer-1')!
    expect(sub.assetName).toBe('盆栽')
    expect(sub.assetAlias).toBe(aliasB)
  })

  it('rejects a paint target with missing parentPath/asset', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/baked/target', payload: { asset: { name: 'x' } } })
    expect(r.statusCode).toBe(400)
  })

  it('deletes a layer (and its sub-layers)', async () => {
    const r = await app.inject({ method: 'DELETE', url: '/api/v1/baked/layers', payload: { path: '/Floor' } })
    expect(r.statusCode).toBe(200)
    const ls = await layers(app)
    expect(ls.some((l) => l.nodePath.startsWith('/Floor'))).toBe(false)
  })

  it('patches custom attributes on one layer and rejects reserved keys', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/baked/layers', payload: { name: 'AttrLayer' } })
    const ok = await app.inject({
      method: 'PATCH',
      url: '/api/v1/baked/layers/attributes',
      payload: { path: '/AttrLayer', attributes: { biome: 'forest', walkable: true } },
    })
    expect(ok.statusCode).toBe(200)
    const layer = (await layers(app)).find((l) => l.nodePath === '/AttrLayer')!
    expect(layer.attributes?.biome).toBe('forest')
    expect(layer.attributes?.walkable).toBe(true)

    const bad = await app.inject({
      method: 'PATCH',
      url: '/api/v1/baked/layers/attributes',
      payload: { path: '/AttrLayer', attributes: { asset_name: 'hijack' } },
    })
    expect(bad.statusCode).toBe(400)
  })

  it('batch-patches attributes without overwriting existing keys by default', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/baked/layers', payload: { name: 'A1' } })
    await app.inject({ method: 'POST', url: '/api/v1/baked/layers', payload: { name: 'A2' } })
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/baked/layers/attributes',
      payload: { path: '/A1', attributes: { biome: 'desert' } },
    })
    const r = await app.inject({
      method: 'PATCH',
      url: '/api/v1/baked/layers/attributes',
      payload: { paths: ['/A1', '/A2'], attributes: { biome: 'tundra', area_id: 'z1' } },
    })
    expect(r.statusCode).toBe(200)
    const ls = await layers(app)
    expect(ls.find((l) => l.nodePath === '/A1')!.attributes?.biome).toBe('desert')
    expect(ls.find((l) => l.nodePath === '/A2')!.attributes?.biome).toBe('tundra')
    expect(ls.find((l) => l.nodePath === '/A1')!.attributes?.area_id).toBe('z1')
  })

  it('GET /baked/layers?mode=summary omits cells but includes cellCount', async () => {
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/baked/layers/cells',
      payload: {
        path: '/SummaryLayer',
        cells: [{ x: 0, y: 0, z: 0, token: 'grass' }],
        asset: { name: 'grass', type: 'tile' },
      },
    })
    const r = await app.inject({ method: 'GET', url: '/api/v1/baked/layers?mode=summary' })
    expect(r.statusCode).toBe(200)
    const body = r.json() as { layers: Array<{ nodePath: string; cellCount?: number; cells?: unknown[] }> }
    const layer = body.layers.find((l) => l.nodePath === '/SummaryLayer')
    expect(layer).toBeDefined()
    expect(layer!.cellCount).toBe(1)
    expect(layer!.cells).toBeUndefined()
  })

  it('bake replace overwrites prior layers instead of appending /ground 2', async () => {
    const {
      clearBakedSceneForProjectDir,
      bakeLayersForProject,
      listBakedLayersForProjectDir,
    } = await import('../src/baked/store.js')
    const { getActiveProjectDir } = await import('../src/runtime.js')
    const projDir = await getActiveProjectDir()
    clearBakedSceneForProjectDir(projDir)
    const wsRes = await app.inject({ method: 'GET', url: '/api/v1/workspace' })
    const projectId = (wsRes.json() as { viewingProjectId?: string }).viewingProjectId
    expect(projectId).toBeTruthy()

    await bakeLayersForProject(
      projectId!,
      [
        { nodePath: '/ground', nodeName: 'ground', cells: [{ x: 0, y: 0, z: 0 }], assetName: 'grass' },
        { nodePath: '/trees', nodeName: 'trees', cells: [{ x: 1, y: 1, z: 0 }], assetName: 'tree' },
      ],
      { recordHistory: false },
    )
    expect(listBakedLayersForProjectDir(projDir).map((l) => l.nodePath).sort()).toEqual(['/ground', '/trees'])

    await bakeLayersForProject(
      projectId!,
      [{ nodePath: '/ground', nodeName: 'ground', cells: [{ x: 5, y: 5, z: 0 }], assetName: 'sand' }],
      { replace: true, recordHistory: false },
    )
    const after = listBakedLayersForProjectDir(projDir)
    expect(after.map((l) => l.nodePath)).toEqual(['/ground'])
    expect(after[0]!.cells).toEqual([{ x: 5, y: 5, z: 0, token: 'sand' }])
  })
})
