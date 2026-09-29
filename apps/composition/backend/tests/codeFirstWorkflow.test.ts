import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildApp } from '../src/main.js'
import { resetRendererStatusForTests } from '../src/agent/rendererStatus.js'

const workspaceRoot = mkdtempSync(join(tmpdir(), 'scene-code-first-'))
process.env.FORGEAX_PROJECT_ROOT = workspaceRoot

const VALID_MAIN = `// @scene-module-id module.main
import { ground } from "./terrain.scene.ts"
`

const VALID_TERRAIN = `// @scene-module-id module.terrain
export const ground = basePlane({ origin: [0, 0], width: 12, height: 8 })
`

const BROKEN_TERRAIN = `// @scene-module-id module.terrain
export const ground = thisIsNotAFunction({})
`

describe('code-first Scene Script workflow', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  let projectId: string
  const aiHeaders = {
    'x-forgeax-caller-kind': 'ai',
    'x-forgeax-caller-agent-id': 'code-first-agent',
    'x-forgeax-caller-session-id': 'code-first-session',
  }

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { name: 'Code First City' },
    })
    projectId = (created.json() as { id: string }).id
  })

  afterAll(async () => {
    await app.close()
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  it('atomically commits a multi-file project and rolls back a failing increment', async () => {
    const committed = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scene-script/commit`,
      headers: aiHeaders,
      payload: {
        entryFile: 'main.scene.ts',
        label: 'Terrain',
        files: [
          { file: 'terrain.scene.ts', source: VALID_TERRAIN },
          { file: 'main.scene.ts', source: VALID_MAIN },
        ],
      },
    })
    expect(committed.statusCode, committed.body).toBe(200)
    const ok = committed.json() as {
      projectRevision: string
      files: string[]
      revision: string
      runtimeImpact: { changedOperationCount: number; invalidatedNodeCount: number }
    }
    expect(ok.files).toEqual(expect.arrayContaining(['main.scene.ts', 'terrain.scene.ts']))
    expect(ok.projectRevision).toMatch(/^[a-f0-9]+$/)
    expect(ok.runtimeImpact.changedOperationCount).toBeGreaterThan(0)

    const unchanged = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scene-script/commit`,
      headers: aiHeaders,
      payload: {
        entryFile: 'main.scene.ts',
        expectedProjectRevision: ok.projectRevision,
        files: [
          { file: 'terrain.scene.ts', source: VALID_TERRAIN },
          { file: 'main.scene.ts', source: VALID_MAIN },
        ],
      },
    })
    expect(unchanged.statusCode, unchanged.body).toBe(200)
    expect(unchanged.json()).toMatchObject({
      projectRevision: ok.projectRevision,
      runtimeImpact: { changedOperationCount: 0, invalidatedNodeCount: 0 },
    })

    const failed = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scene-script/commit`,
      headers: aiHeaders,
      payload: {
        entryFile: 'main.scene.ts',
        expectedProjectRevision: ok.projectRevision,
        files: [
          { file: 'terrain.scene.ts', source: BROKEN_TERRAIN },
          { file: 'main.scene.ts', source: VALID_MAIN },
        ],
      },
    })
    expect(failed.statusCode).toBe(422)

    const current = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/scene-script?file=terrain.scene.ts`,
    })
    expect(current.json()).toEqual(expect.objectContaining({
      file: 'terrain.scene.ts',
    }))
    expect((current.json() as { source: string }).source).not.toContain('thisIsNotAFunction')
    expect((current.json() as { source: string }).source).toContain('basePlane')
  })

  it('binds execute evidence to the committed project revision', async () => {
    const before = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/scene-script/completion`,
    })
    const readiness = before.json() as {
      evidence: {
        revisionState: {
          sourceRevision: string | null
          artifactRevision: string | null
          lastCommitKind: string | null
        }
      }
    }
    expect(readiness.evidence.revisionState.sourceRevision).toBeTruthy()
    expect(readiness.evidence.revisionState.artifactRevision).toBe(
      readiness.evidence.revisionState.sourceRevision,
    )
    expect(readiness.evidence.revisionState.lastCommitKind).toBe('commit-project')

    const executed = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/execute/summary`,
      headers: aiHeaders,
      payload: { quietErrors: true },
    })
    expect(executed.statusCode, executed.body).toBe(200)
    const summary = executed.json() as {
      executedRevision: string
      lastCommittedRevision: string
      evidenceAligned: boolean
      executionId: string
    }
    expect(summary.executedRevision).toBe(summary.lastCommittedRevision)
    expect(summary.evidenceAligned).toBe(true)
    expect(summary.executionId).toBeTruthy()
  })

  it('keeps recovery tools available after repeated diagnostics', async () => {
    const broken = 'const root = emptyScene({})\nsceneOutput({ scene: missingBinding })\n'
    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scene-script/validate`,
      headers: aiHeaders,
      payload: { source: broken, file: 'main.scene.ts' },
    })
    expect(first.statusCode).toBe(200)
    expect((first.json() as { valid: boolean }).valid).toBe(false)

    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scene-script/validate`,
      headers: aiHeaders,
      payload: { source: broken, file: 'main.scene.ts' },
    })
    expect(second.statusCode).toBe(200)
    expect((second.json() as { valid: boolean }).valid).toBe(false)

    const inspect = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/scene-script`,
      headers: aiHeaders,
    })
    expect(inspect.statusCode).toBe(200)

    const contracts = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/scene-script/contracts?audience=sino&mode=summary`,
      headers: aiHeaders,
    })
    expect(contracts.statusCode).toBe(200)

    const rejectedCommit = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scene-script/commit`,
      headers: aiHeaders,
      payload: {
        entryFile: 'main.scene.ts',
        files: [{ file: 'main.scene.ts', source: broken }],
      },
    })
    expect(rejectedCommit.statusCode).toBe(422)
    expect(rejectedCommit.json()).toEqual(expect.objectContaining({
      status: 'rejected',
      diagnostics: expect.any(Array),
    }))
    expect(rejectedCommit.json()).not.toHaveProperty('circuitOpen')
  })

  it('reports renderer sync instead of a blank preview', async () => {
    resetRendererStatusForTests()
    const posted = await app.inject({
      method: 'POST',
      url: '/api/v1/renderer/status',
      payload: {
        viewingProjectId: projectId,
        openProjectId: projectId,
        executionStatus: 'completed',
        voxelLayers: 0,
        gridLayers: 0,
        meshLayers: 0,
        guideLayers: 0,
        frameDigest: '0:0:0:0',
      },
    })
    expect(posted.statusCode).toBe(200)
    const info = await app.inject({ method: 'GET', url: '/api/v1/agent/renderer/info' })
    expect(info.statusCode).toBe(200)
    const sync = (info.json() as { sync: { staleReasons: string[]; aligned: boolean } }).sync
    expect(sync.staleReasons).toContain('no-visible-output')
    expect(sync.aligned).toBe(false)
  })
})
