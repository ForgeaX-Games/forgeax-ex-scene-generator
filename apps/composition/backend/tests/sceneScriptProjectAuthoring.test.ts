import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildApp } from '../src/main.js'

const workspaceRoot = mkdtempSync(join(tmpdir(), 'scene-project-authoring-'))
process.env.FORGEAX_PROJECT_ROOT = workspaceRoot

describe('Scene Script project authoring transactions', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  let projectId: string

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { name: 'Multi-module authoring' },
    })
    projectId = (created.json() as { id: string }).id
    const module = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scene-script/files`,
      payload: {
        file: 'parts/deep.scene.ts',
        source: `// @scene-module-id module.deep
// @scene-id deep-root
export const root = basePlane({ origin: [0, 0], width: 12, height: 8 })
`,
      },
    })
    expect(module.statusCode, module.body).toBe(201)
    const authored = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${projectId}/scene-script`,
      payload: {
        source: `// @scene-module-id module.main
import { root } from "./parts/deep.scene.ts"
const plane = basePlane({ origin: [0, 0], width: 12, height: 8 })
`,
      },
    })
    expect(authored.statusCode).toBe(200)
  })

  afterAll(async () => {
    await app.close()
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  async function module(file = 'main.scene.ts') {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/scene-script?file=${encodeURIComponent(file)}`,
    })
    expect(response.statusCode, response.body).toBe(200)
    return response.json() as {
      source: string
      revision: string
      state: {
        projectRevision: string
        moduleRevisions: Record<string, { moduleId: string; revision: string }>
      }
    }
  }

  it('commits commands for two modules atomically and reports module revisions', async () => {
    const before = await module()
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scene-script/commands`,
      payload: {
        expectedProjectRevision: before.state.projectRevision,
        expectedModuleRevisions: Object.fromEntries(
          Object.entries(before.state.moduleRevisions).map(([file, item]) => [file, item.revision]),
        ),
        commands: [
          { type: 'addCall', moduleId: 'module.deep', statementId: 'deep-added', binding: 'deepAdded', functionName: 'basePlane' },
          { type: 'addCall', file: 'main.scene.ts', statementId: 'main-added', binding: 'mainAdded', functionName: 'basePlane' },
        ],
      },
    })

    expect(response.statusCode, response.body).toBe(200)
    const body = response.json()
    expect(body).toEqual(expect.objectContaining({
      status: 'ok',
      projectRevision: expect.any(String),
      moduleRevisions: expect.objectContaining({
        'main.scene.ts': expect.objectContaining({ moduleId: 'module.main' }),
        'parts/deep.scene.ts': expect.objectContaining({ moduleId: 'module.deep' }),
      }),
      applied: 2,
    }))
    expect((await module()).source).toContain('@scene-id main-added')
    expect((await module('parts/deep.scene.ts')).source).toContain('@scene-id deep-added')
  })

  it('returns module and statement conflicts without changing sources', async () => {
    const beforeMain = await module()
    const beforeDeep = await module('parts/deep.scene.ts')
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scene-script/commands`,
      payload: {
        expectedProjectRevision: beforeMain.state.projectRevision,
        expectedModuleRevisions: { 'module.deep': 'stale-module-revision' },
        commands: [{ type: 'removeCall', statementId: 'deep-added' }],
      },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual(expect.objectContaining({
      conflict: expect.objectContaining({
        modules: [expect.objectContaining({ moduleId: 'module.deep' })],
        statements: ['deep-added'],
      }),
    }))
    expect((await module()).source).toBe(beforeMain.source)
    expect((await module('parts/deep.scene.ts')).source).toBe(beforeDeep.source)
  })

  it('rejects leftover group-compile commands; reuse is another .scene.ts import', async () => {
    const before = await module()
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scene-script/commands`,
      payload: {
        expectedProjectRevision: before.state.projectRevision,
        commands: [{ type: 'wrapInGroup', statementIds: ['main-added'] }],
      },
    })
    expect(response.statusCode, response.body).toBe(422)
    expect((response.json() as { reason?: string }).reason ?? response.body).toMatch(/Import another \.scene\.ts/)
    expect((await module()).source).toBe(before.source)
  })

  it('saves a non-entry module and compiles the stored entry', async () => {
    const before = await module('parts/deep.scene.ts')
    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${projectId}/scene-script`,
      payload: {
        file: 'parts/deep.scene.ts',
        source: `${before.source}\n// factory-reset\n`,
        expectedRevision: before.revision,
        canonicalize: false,
      },
    })
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toEqual(expect.objectContaining({
      status: 'ok',
      transaction: expect.objectContaining({ applied: true, rolledBack: false }),
    }))
    expect((await module('parts/deep.scene.ts')).source).toContain('factory-reset')
    expect((await module()).source).toContain('basePlane')
  })

  it('saves a project again after its local Definition was registered', async () => {
    const before = await module()
    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${projectId}/scene-script`,
      payload: {
        file: 'main.scene.ts',
        source: before.source.replace('const mainAdded', 'const mainAddedRenamed'),
        expectedRevision: before.revision,
      },
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toEqual(expect.objectContaining({
      status: 'ok',
      transaction: expect.objectContaining({ applied: true, rolledBack: false }),
    }))
  })

  it('rolls back a valid module edit when another command fails', async () => {
    const beforeMain = await module()
    const beforeDeep = await module('parts/deep.scene.ts')
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scene-script/commands`,
      payload: {
        expectedProjectRevision: beforeMain.state.projectRevision,
        commands: [
          { type: 'addCall', moduleId: 'module.deep', statementId: 'must-rollback', binding: 'rollback', functionName: 'basePlane' },
          { type: 'removeCall', moduleId: 'module.main', statementId: 'missing-statement' },
        ],
      },
    })

    expect(response.statusCode).toBe(422)
    expect((await module()).source).toBe(beforeMain.source)
    expect((await module('parts/deep.scene.ts')).source).toBe(beforeDeep.source)
  })
})
