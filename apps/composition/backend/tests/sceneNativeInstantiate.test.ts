import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildApp } from '../src/main.js'
import { getProjectDir } from '../src/runtime.js'

const workspaceRoot = mkdtempSync(join(tmpdir(), 'native-definition-'))
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
    // A complete scene: the artifact-bundle and no-disk-graph.json cases below
    // both need a real run, and a bare `basePlane` call with no import fails
    // the run (SCENE_RUN) so the PUT would 422 and skip the whole suite.
    const authored = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${projectId}/scene-script`,
      payload: {
        source: [
          "import { addChild, basePlane, emptyScene, sceneNode, sceneOutput } from '@forgeax/scene'",
          '',
          'export const world = basePlane({ origin: [0, 0], width: 12, height: 8 })',
          'const ground = sceneNode({',
          "  name: 'native-definition-ground',",
          "  geometry: { kind: 'mesh', positions: [0, 0, 0, 10, 0, 0, 0, 10, 5], indices: [0, 1, 2] },",
          '})',
          'sceneOutput({ scene: addChild({ scene: emptyScene(), nodes: [ground.scene] }).scene })',
          '',
        ].join('\n'),
      },
    })
    expect(authored.statusCode, authored.body).toBe(200)
  })

  afterAll(async () => {
    await app.close()
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  it('rejects defineGroup instantiate; reuse is another .scene.ts import', async () => {
    const instantiated = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scene-script/definitions/addBaseGrid/instantiate`,
      payload: { position: { x: 321, y: 654 } },
    })
    expect(instantiated.statusCode).toBe(410)
    expect(instantiated.json()).toEqual(expect.objectContaining({
      code: 'scene-define-group-removed',
    }))
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

  it('executes from compiled Scene Script without a disk graph.json', async () => {
    const projectDir = await getProjectDir(projectId)
    expect(projectDir).toBeTruthy()
    rmSync(join(projectDir!, 'state', 'graph.json'), { force: true })
    expect(existsSync(join(projectDir!, 'state', 'graph.json'))).toBe(false)

    const executed = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/execute`,
      payload: {},
    })
    expect(executed.statusCode, executed.body).toBe(200)
    const body = executed.json() as { status: string; error?: { message: string } }
    expect(body.status, executed.body).not.toBe('error')
    expect(body.error?.message ?? '').not.toMatch(/graph\.json/)
    expect(existsSync(join(projectDir!, 'state', 'graph.json'))).toBe(false)
  })

  it('returns 404 for the removed Scene Script lift path', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scene-script/lift`,
      payload: {},
    })
    expect(response.statusCode).toBe(404)
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
