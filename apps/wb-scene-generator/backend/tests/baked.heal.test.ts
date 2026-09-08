import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'

// Reproduce the "+ Layer overwrote an existing layer" corruption and assert the
// store heals + prevents it. Root cause: earlier builds reordered the children
// ARRAY directly (overloading array order / version for display order), which
// broke the vendored tree's name-sorted invariant that readNode/upsertCells
// binary-search relies on — letting dedup miss a collision and create a second
// same-name node that clobbered the first in the panel.
//
// We seed a baked-scene.json whose root children are NOT name-sorted and contain
// TWO "Layer" nodes (one rich, one empty), exactly the on-disk shape we found in
// the corrupted project, then boot the app (which loads + heals on first read).

const ws = mkdtempSync(join(tmpdir(), 'baked-heal-test-'))
process.env.FORGEAX_PROJECT_ROOT = ws

const corrupted = {
  name: '',
  path: '/',
  version: 84,
  children: [
    { name: 'Layer', path: '/Layer', version: 82, children: [], cells: [], attributes: {} },
    { name: 'Layer 2', path: '/Layer 2', version: 79, children: [], cells: [{ x: 0, y: 0, z: 0, token: 'grass' }], attributes: { asset_name: '草地' } },
    { name: 'Layer', path: '/Layer', version: 80, children: [], cells: [{ x: 1, y: 1, z: 0, token: 'stone' }, { x: 2, y: 2, z: 0, token: 'stone' }], attributes: { asset_name: '石质地砖' } },
    { name: 'Layer 3', path: '/Layer 3', version: 83, children: [], cells: [], attributes: {} },
    { name: 'Layer 4', path: '/Layer 4', version: 84, children: [], cells: [], attributes: {} },
  ],
}
writeFileSync(join(ws, 'baked-scene.json'), JSON.stringify(corrupted), 'utf-8')

interface BakedLayer {
  nodePath: string
  nodeName: string
  assetName: string
  cells: { x: number; y: number; z: number; token?: string }[]
}

async function layers(app: FastifyInstance): Promise<BakedLayer[]> {
  const r = await app.inject({ method: 'GET', url: '/api/v1/baked/layers' })
  expect(r.statusCode).toBe(200)
  return r.json().layers as BakedLayer[]
}

describe('baked store heals corrupted (duplicate-name, mis-sorted) trees', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    const { buildApp } = await import('../src/main.js')
    app = await buildApp()
  })

  it('merges the duplicate "Layer" into ONE node, keeping the one with cells/asset', async () => {
    const ls = await layers(app)
    const named = ls.filter((l) => l.nodePath === '/Layer')
    expect(named).toHaveLength(1) // the empty placeholder is gone, not the painted one
    expect(named[0]!.cells).toHaveLength(2) // the rich (石质地砖, 2 cells) survivor
    expect(named[0]!.assetName).toBe('石质地砖')
  })

  it('preserves the pre-merge display order (草地 "Layer 2" first, then the surviving Layer)', async () => {
    const order = (await layers(app)).map((l) => l.nodePath)
    // No duplicates in the projection.
    expect(new Set(order).size).toBe(order.length)
    // Original version-based order had Layer 2(v79) before Layer(v80); preserved.
    expect(order.indexOf('/Layer 2')).toBeLessThan(order.indexOf('/Layer'))
  })

  it('a fresh "+ Layer" no longer collides — it appends a uniquely-named node', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/baked/layers', payload: { name: 'Layer' } })
    expect(r.statusCode).toBe(200)
    // Must NOT reuse an existing /Layer path (that was the clobber bug).
    expect(r.json().path).not.toBe('/Layer')
    const ls = await layers(app)
    // Still exactly one node per path — no clobbering, no duplicates.
    const paths = ls.map((l) => l.nodePath)
    expect(new Set(paths).size).toBe(paths.length)
    // The painted survivor is intact.
    const survivor = ls.find((l) => l.nodePath === '/Layer')!
    expect(survivor.cells).toHaveLength(2)
  })

  it('repeated "+ Layer" clicks each create a distinct node (never overwrite)', async () => {
    const before = (await layers(app)).length
    const created: string[] = []
    for (let i = 0; i < 3; i++) {
      const r = await app.inject({ method: 'POST', url: '/api/v1/baked/layers', payload: { name: 'Layer' } })
      created.push(r.json().path)
    }
    expect(new Set(created).size).toBe(3) // all distinct paths
    const ls = await layers(app)
    expect(ls.length).toBe(before + 3) // every click added a node, none clobbered
    const paths = ls.map((l) => l.nodePath)
    expect(new Set(paths).size).toBe(paths.length)
  })
})
