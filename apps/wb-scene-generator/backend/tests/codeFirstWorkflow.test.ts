import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildApp } from '../src/main.js'
import { resetRendererStatusForTests } from '../src/agent/rendererStatus.js'

const workspaceRoot = mkdtempSync(join(tmpdir(), 'wb-scene-code-first-'))
process.env.FORGEAX_PROJECT_ROOT = workspaceRoot

const VALID_MAIN = `// @scene-module-id module.main
import { ground } from "./terrain.scene.ts"
sceneOutput({ scene: ground })
`

const VALID_TERRAIN = `// @scene-module-id module.terrain
export const ground = emptyScene({})
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

  it('returns compact, topic-scoped Coastal metadata without dumping source', async () => {
    const missing = await app.inject({
      method: 'GET',
      url: '/api/v1/scene-script/references',
    })
    expect(missing.statusCode).toBe(400)

    const terrain = await app.inject({
      method: 'GET',
      url: '/api/v1/scene-script/references?topic=terrain',
    })
    expect(terrain.statusCode, terrain.body).toBe(200)
    const body = terrain.json() as {
      topic: string
      invariants: string[]
      referenceManifest: {
        roots: string[]
        files: Array<{ path: string; dependencyCount: number }>
        fileCount: number
        closureFileCount: number
        closureVerified: boolean
        sourceIncluded: boolean
        maxRoots: number
      }
      starterManifest: { included: boolean; tool: string }
    }
    expect(body.topic).toBe('terrain')
    expect(body.invariants.length).toBeGreaterThan(0)
    expect(body.referenceManifest.files.some((file) => file.path.endsWith('terrain.scene.ts'))).toBe(true)
    expect(body.referenceManifest.files.some((file) => file.path.endsWith('geom.generator-lib.ts'))).toBe(false)
    expect(body.referenceManifest.roots.some((file) => file.endsWith('main.scene.ts'))).toBe(false)
    expect(body.referenceManifest.closureVerified).toBe(true)
    expect(body.referenceManifest.closureFileCount).toBeGreaterThan(body.referenceManifest.fileCount)
    expect(body.referenceManifest.fileCount).toBeLessThanOrEqual(body.referenceManifest.maxRoots)
    expect(body.referenceManifest.sourceIncluded).toBe(false)
    expect(body.starterManifest).toEqual(expect.objectContaining({
      included: false,
      tool: 'scene:script.scaffold',
    }))
    expect(JSON.stringify(body)).not.toContain('"excerpt"')
    expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThan(12 * 1024)

    const roads = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/scene-script/references?topic=roads`,
    })
    expect(roads.statusCode, roads.body).toBe(200)
    const roadsBody = roads.json() as { topic: string; referenceManifest: { roots: string[] } }
    expect(roadsBody.topic).toBe('roads')
    expect(roadsBody.referenceManifest.roots).not.toEqual(body.referenceManifest.roots)
    expect(roadsBody.referenceManifest.roots.every((root) => !root.endsWith('districts.scene.ts'))).toBe(true)
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
    expect((current.json() as { source: string }).source).toContain('emptyScene')
  })

  it('binds execute evidence to the committed project revision', async () => {
    const before = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/scene-agent/resume`,
    })
    const resume = before.json() as {
      checkpoint: unknown
      revisionState: {
        sourceRevision: string | null
        artifactRevision: string | null
        lastCommitKind: string | null
        evidenceAligned: boolean
      }
      note: string
    }
    expect(resume.checkpoint).toBeNull()
    expect(resume.revisionState.sourceRevision).toBeTruthy()
    expect(resume.revisionState.artifactRevision).toBe(resume.revisionState.sourceRevision)
    expect(resume.revisionState.lastCommitKind).toBe('commit-project')
    expect(resume.note).toMatch(/current project revision/)

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
