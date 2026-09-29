import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildApp } from '../src/main.js'
import { getProjectDir } from '../src/runtime.js'
import { writeSceneModule } from '../src/scene-script/persist/store.js'

const workspaceRoot = mkdtempSync(join(tmpdir(), 'scene-diagnostics-'))
process.env.FORGEAX_PROJECT_ROOT = workspaceRoot

describe('Scene Script unified diagnostics', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  let projectId: string
  let revision: string
  let sealedStatementId: string
  const aiHeaders = {
    'x-forgeax-caller-kind': 'ai',
    'x-forgeax-caller-agent-id': 'diagnostics-test-agent',
    'x-forgeax-caller-session-id': 'diagnostics-test-session',
  }

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { name: 'Diagnostic Contract' },
    })
    projectId = (created.json() as { id: string }).id
    const authored = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${projectId}/scene-script`,
      headers: aiHeaders,
      payload: { source: 'const plane = basePlane({ origin: [0, 0], width: 12, height: 8 })\n' },
    })
    expect(authored.statusCode).toBe(200)
    const instantiated = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scene-script/definitions/addBaseGrid/instantiate`,
      headers: aiHeaders,
      payload: {},
    })
    expect(instantiated.statusCode).toBe(200)
    const body = instantiated.json() as { revision: string; statementId: string }
    revision = body.revision
    sealedStatementId = body.statementId
  })

  afterAll(async () => {
    await app.close()
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  async function pipeline(): Promise<unknown> {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/pipeline`,
    })
    expect(response.statusCode).toBe(200)
    return response.json()
  }

  function expectNotApplied(body: {
    transaction?: { applied?: boolean; rolledBack?: boolean }
    diagnostics?: Array<Record<string, unknown>>
  }): void {
    expect(body.transaction).toEqual({ applied: false, rolledBack: false })
    expect(body.diagnostics?.[0]).toEqual(expect.objectContaining({
      code: expect.any(String),
      phase: expect.any(String),
      severity: 'error',
      title: expect.any(String),
      message: expect.any(String),
      retryable: expect.any(Boolean),
      escalation: expect.any(String),
      transaction: { applied: false, rolledBack: false },
    }))
  }

  it('reports a stable revision conflict without changing the Runtime Graph', async () => {
    const before = await pipeline()
    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${projectId}/scene-script`,
      headers: aiHeaders,
      payload: {
        source: 'const replacement = emptyScene({})\n',
        expectedRevision: 'stale-revision',
      },
    })
    expect(response.statusCode).toBe(409)
    const body = response.json()
    expect(body).toEqual(expect.objectContaining({
      code: 'scene-source-revision-conflict',
      expectedRevision: 'stale-revision',
      actualRevision: revision,
    }))
    expectNotApplied(body)
    expect(body.diagnostics[0]).toEqual(expect.objectContaining({
      expected: { revision: 'stale-revision' },
      actual: { revision },
    }))
    expect(await pipeline()).toEqual(before)
  })

  it('returns bounded parse diagnostics and no Runtime projection', async () => {
    const before = await pipeline()
    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${projectId}/scene-script`,
      headers: aiHeaders,
      payload: { source: 'const broken = emptyScene({', expectedRevision: revision },
    })
    expect(response.statusCode).toBe(422)
    const body = response.json()
    expectNotApplied(body)
    expect(body.diagnostics[0]).toEqual(expect.objectContaining({
      phase: 'parse',
      source: expect.objectContaining({ file: 'main.scene.ts', line: 1, column: expect.any(Number) }),
      expected: expect.any(String),
      actual: expect.any(Object),
    }))
    expect(body.sourceMap).toBeUndefined()
    expect(await pipeline()).toEqual(before)
  })

  it('rejects compile failures before applying the Runtime Graph', async () => {
    const before = await pipeline()
    const source = 'import { missing } from "./does-not-exist.scene.ts"\n'
    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${projectId}/scene-script`,
      headers: aiHeaders,
      payload: { source, expectedRevision: revision },
    })
    expect(response.statusCode).toBe(422)
    const body = response.json()
    expectNotApplied(body)
    expect(body.diagnostics.some((item: { phase: string }) => item.phase === 'compile')).toBe(true)
    expect(await pipeline()).toEqual(before)
  })

  it('allows validate and put of Geometry-only BasePlane without sceneOutput', async () => {
    const source = 'const plane = basePlane({ origin: [0, 0], width: 12, height: 8 })\n'
    const validated = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scene-script/validate`,
      payload: { source },
    })
    expect(validated.statusCode).toBe(200)
    expect(validated.json()).toEqual(expect.objectContaining({
      valid: true,
    }))
    expect(validated.json().diagnostics.filter((item: { code: string }) => item.code.startsWith('SCENE_RESULT_CAPTURE'))).toEqual([])

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { name: 'Geometry-only BasePlane commit' },
    })
    const otherId = (created.json() as { id: string }).id
    const current = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${otherId}/scene-script`,
    })
    const committed = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${otherId}/scene-script`,
      headers: aiHeaders,
      payload: { source, expectedRevision: (current.json() as { revision: string }).revision },
    })
    expect(committed.statusCode).not.toBe(422)
  })

  it('rejects leftover meshSceneNode; first-batch Scene ops are emptyScene / sceneNode / addChild', async () => {
    const source = 'import { meshSceneNode } from \'@forgeax/scene\'\nconst root = meshSceneNode({ name: \'terrain\' })\n'
    const validated = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scene-script/validate`,
      payload: { source },
    })
    expect(validated.statusCode).toBe(200)
    expect(validated.json().valid).toBe(false)
    expect(JSON.stringify(validated.json().diagnostics)).toMatch(/meshSceneNode/)
  })

  it('allows /execute/summary for Geometry-only BasePlane without sceneOutput', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { name: 'Geometry-only BasePlane' },
    })
    const capturelessProjectId = (created.json() as { id: string }).id
    const projectDir = await getProjectDir(capturelessProjectId)
    expect(projectDir).toBeTruthy()
    await writeSceneModule(
      projectDir!,
      'main.scene.ts',
      'const plane = basePlane({ origin: [0, 0], width: 12, height: 8 })\n',
      [],
    )

    const executed = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${capturelessProjectId}/execute/summary`,
      payload: {},
    })
    expect(executed.statusCode).not.toBe(422)
    expect(executed.json()).not.toEqual(expect.objectContaining({
      code: 'scene-script-result-capture-required',
    }))

    const preview = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${capturelessProjectId}/execute`,
      payload: {},
    })
    expect(preview.statusCode).not.toBe(422)
    expect(preview.json()).not.toEqual(expect.objectContaining({
      code: 'scene-script-result-capture-required',
    }))
  })

  it('returns capability policy for sealed internals without applying commands', async () => {
    const before = await pipeline()
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scene-script/commands`,
      headers: aiHeaders,
      payload: {
        expectedRevision: revision,
        commands: [{
          type: 'editSealedInternal',
          statementId: sealedStatementId,
          runtimeNodeId: 'sealed-inner-node',
          patch: { payload: 'x'.repeat(20_000) },
        }],
      },
    })
    expect(response.statusCode).toBe(422)
    const body = response.json()
    expectNotApplied(body)
    expect(body.diagnostics[0]).toEqual(expect.objectContaining({
      code: 'SCENE_CAPABILITY_SEALED_INTERNAL',
      phase: 'capability',
      retryable: false,
      escalation: 'none',
      graph: { authoringNodeId: sealedStatementId },
    }))
    expect(JSON.stringify(body).length).toBeLessThan(10_000)
    expect(await pipeline()).toEqual(before)
  })
})
