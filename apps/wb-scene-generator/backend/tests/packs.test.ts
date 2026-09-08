import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { buildApp } from '../src/main.js'
import {
  __resetPackRegistryForTests,
  __setStubPackLoaderForTests,
  listPacks,
} from '../src/packs/registry.js'
import { getSceneContractRegistry } from '../src/scene-script/contracts/contracts.js'

afterEach(() => {
  __resetPackRegistryForTests()
})

describe('domain pack registry', () => {
  it('lists world as active and geometry/image as stubs', async () => {
    const packs = await listPacks()
    expect(packs.map((p) => p.id)).toEqual(['world', 'geometry', 'image'])
    expect(packs[0]).toMatchObject({ status: 'active', kind: 'world' })
    expect(packs[0].batteryCount).toBeGreaterThan(300)
    expect(packs[1]).toMatchObject({
      status: 'stub',
      livesIn: 'wb-3d-lowpoly',
    })
    expect(packs[1].diagnostic).toMatch(/not connected/i)
    expect(packs[2]).toMatchObject({
      status: 'stub',
      livesIn: 'wb-2d-scene-asset-generator',
    })
  })

  it('keeps world contracts when the geometry pack loader throws', async () => {
    __setStubPackLoaderForTests('geometry', async () => {
      throw new Error('geometry contract boom')
    })
    const packs = await listPacks()
    const world = packs.find((p) => p.id === 'world')
    const geometry = packs.find((p) => p.id === 'geometry')
    expect(world?.status).toBe('active')
    expect(geometry?.status).toBe('error')
    expect(geometry?.diagnostic).toContain('geometry contract boom')
    const registry = await getSceneContractRegistry()
    expect(registry.get('addBaseGrid')).toBeTruthy()
  })
})

describe('GET /api/v1/packs', () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'wb-packs-'))
  process.env.FORGEAX_PROJECT_ROOT = workspaceRoot
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
  })
  afterAll(async () => {
    await app.close()
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  it('returns the three host packs and keeps World /ops at 200', async () => {
    const packsRes = await app.inject({ method: 'GET', url: '/api/v1/packs' })
    expect(packsRes.statusCode).toBe(200)
    const body = packsRes.json() as { packs: Array<{ id: string; status: string }> }
    expect(body.packs.map((p) => p.id)).toEqual(['world', 'geometry', 'image'])
    expect(body.packs[0].status).toBe('active')
    expect(body.packs[1].status).toBe('stub')
    expect(body.packs[2].status).toBe('stub')

    const opsRes = await app.inject({ method: 'GET', url: '/api/v1/ops' })
    expect(opsRes.statusCode).toBe(200)
    expect(Array.isArray(opsRes.json())).toBe(true)
  })

  it('does not 500 World /ops when the geometry pack loader throws', async () => {
    __setStubPackLoaderForTests('geometry', async () => {
      throw new Error('geometry contract boom')
    })
    const packsRes = await app.inject({ method: 'GET', url: '/api/v1/packs' })
    expect(packsRes.statusCode).toBe(200)
    const geometry = (packsRes.json() as { packs: Array<{ id: string; status: string; diagnostic?: string }> })
      .packs.find((p) => p.id === 'geometry')
    expect(geometry?.status).toBe('error')
    expect(geometry?.diagnostic).toContain('geometry contract boom')

    const opsRes = await app.inject({ method: 'GET', url: '/api/v1/ops' })
    expect(opsRes.statusCode).toBe(200)
  })
})
