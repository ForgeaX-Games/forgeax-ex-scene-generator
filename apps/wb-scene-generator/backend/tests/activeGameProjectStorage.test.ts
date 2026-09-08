import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildApp } from '../src/main.js'

const instanceRoot = mkdtempSync(join(tmpdir(), 'wb-scene-active-game-'))
const gameSlug = 'river-town'
const workbenchRoot = join(instanceRoot, '.forgeax', 'workbench', 'wb-scene-generator')
const gameRoot = join(instanceRoot, '.forgeax', 'games', gameSlug)
process.env.FORGEAX_PROJECT_ROOT = workbenchRoot

describe('active-game Scene Project storage', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeAll(async () => {
    mkdirSync(workbenchRoot, { recursive: true })
    mkdirSync(gameRoot, { recursive: true })
    writeFileSync(join(instanceRoot, '.forgeax', 'active-game.json'), JSON.stringify({ slug: gameSlug }))
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
    rmSync(instanceRoot, { recursive: true, force: true })
  })

  it('creates a project in the active game and binds its metadata', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { name: 'River Town Map' },
    })

    expect(response.statusCode, response.body).toBe(201)
    const project = response.json() as { id: string; gameSlug?: string }
    expect(project.gameSlug).toBe(gameSlug)
    expect(existsSync(join(gameRoot, '.forgeax', 'workbench', 'wb-scene-generator', 'projects', project.id))).toBe(true)
    expect(existsSync(join(workbenchRoot, 'projects', project.id))).toBe(false)
  })

  it('creates a named-by-game empty project when name is omitted', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: {},
    })

    expect(response.statusCode, response.body).toBe(201)
    const project = response.json() as { id: string; name: string; gameSlug?: string }
    expect(project.name).toBe(`${gameSlug} Scene`)
    expect(project.gameSlug).toBe(gameSlug)
    expect(existsSync(join(gameRoot, '.forgeax', 'workbench', 'wb-scene-generator', 'projects', project.id))).toBe(true)
  })

  it('rejects a project requested for a non-active game', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { name: 'Wrong Game', gameSlug: 'other-game' },
    })

    expect(response.statusCode).toBe(400)
  })
})
