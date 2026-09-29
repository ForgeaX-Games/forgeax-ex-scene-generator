import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { buildApp } from '../src/main.js'

let app: Awaited<ReturnType<typeof buildApp>>
let instanceRoot: string
let previousProjectRoot: string | undefined

beforeAll(async () => {
  previousProjectRoot = process.env.FORGEAX_PROJECT_ROOT
  instanceRoot = mkdtempSync(resolve(tmpdir(), 'scene-binding-'))
  const authoringRoot = resolve(instanceRoot, '.forgeax/extension-runtime/scene-generator')
  mkdirSync(authoringRoot, { recursive: true })
  process.env.FORGEAX_PROJECT_ROOT = authoringRoot
  app = await buildApp()
})

afterAll(async () => {
  await app.close()
  if (previousProjectRoot === undefined) delete process.env.FORGEAX_PROJECT_ROOT
  else process.env.FORGEAX_PROJECT_ROOT = previousProjectRoot
  rmSync(instanceRoot, { recursive: true, force: true })
})

describe('Studio active-game binding', () => {
  it('starts healthy while unbound and returns a retryable project error', async () => {
    const health = await app.inject({ method: 'GET', url: '/health' })
    expect(health.statusCode).toBe(200)
    expect(health.json()).toMatchObject({
      status: 'ok',
      mode: 'studio',
      binding: 'unbound',
      activeGameSlug: null,
      code: 'ACTIVE_GAME_REQUIRED',
    })

    const projects = await app.inject({ method: 'GET', url: '/api/v1/projects' })
    expect(projects.statusCode).toBe(409)
    expect(projects.json()).toEqual({
      status: 'waiting',
      code: 'ACTIVE_GAME_REQUIRED',
      message: 'Create or select a game before using Scene Generator.',
      retryable: true,
    })
  })

  it('recovers without restart when Studio creates an active game', async () => {
    mkdirSync(resolve(instanceRoot, '.forgeax/games/first-game'), { recursive: true })
    writeFileSync(
      resolve(instanceRoot, '.forgeax/active-game.json'),
      JSON.stringify({ version: 1, slug: 'first-game' }),
    )

    const projects = await app.inject({ method: 'GET', url: '/api/v1/projects' })
    expect(projects.statusCode).toBe(200)
    expect(projects.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'main' }),
    ]))

    const health = await app.inject({ method: 'GET', url: '/health' })
    expect(health.json()).toMatchObject({
      status: 'ok',
      mode: 'studio',
      binding: 'ready',
      activeGameSlug: 'first-game',
    })
  })

  it('switches registry roots without leaking projects between games', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { name: 'First game only' },
    })
    expect(created.statusCode).toBe(201)

    mkdirSync(resolve(instanceRoot, '.forgeax/games/second-game'), { recursive: true })
    writeFileSync(
      resolve(instanceRoot, '.forgeax/active-game.json'),
      JSON.stringify({ version: 1, slug: 'second-game' }),
    )

    const projects = await app.inject({ method: 'GET', url: '/api/v1/projects' })
    expect(projects.statusCode).toBe(200)
    expect(projects.json()).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'First game only' }),
    ]))
  })
})
