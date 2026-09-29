import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { buildApp } from '../src/main.js'
import {
  __resetPackRegistryForTests,
  listPacks,
} from '../src/packs/registry.js'
import { getSceneContractRegistry } from '../src/scene-script/contracts/contracts.js'

afterEach(() => {
  __resetPackRegistryForTests()
})

describe('scene library pack', () => {
  it('lists one active scene library', async () => {
    const packs = await listPacks()
    expect(packs.map((p) => p.id)).toEqual(['scene'])
    expect(packs[0]).toMatchObject({ status: 'active', kind: 'scene' })
    expect(packs[0].batteryCount).toBe(9)
    const registry = await getSceneContractRegistry()
    expect(registry.get('basePlane')).toBeTruthy()
  })
})

describe('GET /api/v1/packs', () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'packs-'))
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

  it('returns the scene library and keeps /ops at 200', async () => {
    const packsRes = await app.inject({ method: 'GET', url: '/api/v1/packs' })
    expect(packsRes.statusCode).toBe(200)
    const body = packsRes.json() as { packs: Array<{ id: string; status: string }> }
    expect(body.packs.map((p) => p.id)).toEqual(['scene'])
    expect(body.packs[0].status).toBe('active')

    const opsRes = await app.inject({ method: 'GET', url: '/api/v1/ops' })
    expect(opsRes.statusCode).toBe(200)
    expect(Array.isArray(opsRes.json())).toBe(true)
  })
})
