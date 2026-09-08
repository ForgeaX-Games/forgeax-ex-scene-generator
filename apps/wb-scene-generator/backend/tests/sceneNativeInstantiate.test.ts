import { mkdtempSync, rmSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildApp } from '../src/main.js'
import { getProjectDir } from '../src/runtime.js'

const workspaceRoot = mkdtempSync(join(tmpdir(), 'wb-native-definition-'))
process.env.FORGEAX_PROJECT_ROOT = workspaceRoot

describe('native Scene Definition instantiation', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  let projectId: string

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { name: 'Native Definition Drop' },
    })
    expect(created.statusCode).toBe(201)
    projectId = (created.json() as { id: string }).id
    const authored = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${projectId}/scene-script`,
      payload: {
        source: 'const root = emptyScene({})\nsceneOutput({ scene: root })\n',
      },
    })
    expect(authored.statusCode).toBe(200)
  })

  afterAll(async () => {
    await app.close()
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  it('adds a public function call and persists the drop position as authoring layout', async () => {
    const instantiated = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scene-script/definitions/addBaseGrid/instantiate`,
      payload: { position: { x: 321, y: 654 } },
    })
    expect(instantiated.statusCode).toBe(200)
    const result = instantiated.json() as {
      status: string
      entityId: string
      statementId: string
      revision: string
    }
    expect(result).toEqual(expect.objectContaining({
      status: 'ok',
      entityId: expect.any(String),
      statementId: expect.any(String),
      revision: expect.any(String),
    }))

    const source = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/scene-script`,
    })
    expect((source.json() as { source: string }).source).toContain('addBaseGrid({})')

    const projectDir = await getProjectDir(projectId)
    expect(projectDir).toBeTruthy()
    const state = JSON.parse(await readFile(join(projectDir!, 'state', 'authoring.json'), 'utf8')) as {
      layout: Record<string, { x: number; y: number }>
    }
    expect(state.layout[result.entityId]).toEqual({ x: 321, y: 654 })

    const pipeline = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/pipeline`,
    })
    const nodes = (pipeline.json() as { nodes: Record<string, { position: { x: number; y: number } }> }).nodes
    expect(nodes[result.entityId]?.position).toEqual({ x: 321, y: 654 })
  })

  it('clearly rejects a legacy project instead of falling back to raw createGroup', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { name: 'Legacy Graph' },
    })
    const legacyId = (created.json() as { id: string }).id
    const legacyDir = await getProjectDir(legacyId)
    await rm(join(legacyDir!, 'scene', 'main.scene.ts'), { force: true })
    await rm(join(legacyDir!, 'state', 'authoring.json'), { force: true })
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${legacyId}/scene-script/definitions/addBaseGrid/instantiate`,
      payload: { position: { x: 1, y: 2 } },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual(expect.objectContaining({ code: 'scene-script-not-canonical' }))
  })

  it('writes and deterministically replays the stable Scene artifact bundle', async () => {
    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scene-script/artifact`,
    })
    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scene-script/artifact`,
    })
    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(200)
    const firstBody = first.json() as { model: { hashes: { artifact: string } }; reviewManifest: { deterministicReplay: boolean } }
    const secondBody = second.json() as { model: { hashes: { artifact: string } } }
    expect(firstBody.model.hashes.artifact).toBe(secondBody.model.hashes.artifact)
    expect(firstBody.reviewManifest.deterministicReplay).toBe(true)

    const stored = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/scene-script/artifact`,
    })
    expect(stored.statusCode).toBe(200)
    expect((stored.json() as typeof firstBody).model.hashes.artifact).toBe(firstBody.model.hashes.artifact)
  })

  it('returns 410 for the removed Runtime Graph import authoring path', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/pipeline/import`,
      payload: { graph: { nodes: [], edges: [] } },
    })
    expect(response.statusCode).toBe(410)
    expect(response.json()).toEqual(expect.objectContaining({ code: 'runtime-graph-authoring-removed' }))
  })
})
