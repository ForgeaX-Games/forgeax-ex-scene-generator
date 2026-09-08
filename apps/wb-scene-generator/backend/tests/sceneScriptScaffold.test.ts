import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildApp } from '../src/main.js'

const workspaceRoot = mkdtempSync(join(tmpdir(), 'wb-scene-scaffold-'))
process.env.FORGEAX_PROJECT_ROOT = workspaceRoot

describe('Scene Script scaffold', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  const aiHeaders = {
    'x-forgeax-caller-kind': 'ai',
    'x-forgeax-caller-agent-id': 'scaffold-agent',
    'x-forgeax-caller-session-id': 'scaffold-session',
  }

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  async function createEmptyProject(name: string): Promise<{ id: string; projectRevision: string }> {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { name },
    })
    const id = (created.json() as { id: string }).id
    const info = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}/scene-script/project-info`,
    })
    return {
      id,
      projectRevision: (info.json() as { projectRevision: string }).projectRevision,
    }
  }

  it('writes a closed, compilable minimal package into an empty project', async () => {
    const project = await createEmptyProject('Scaffold Target')
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/scene-script/scaffold`,
      headers: aiHeaders,
      payload: {
        template: 'minimal-terrain',
        expectedProjectRevision: project.projectRevision,
      },
    })
    expect(response.statusCode, response.body).toBe(201)
    const result = response.json() as {
      status: string
      projectRevision: string
      files: string[]
      scaffold: {
        entryFile: string
        files: Array<{ path: string; imports: string[] }>
        closedImports: boolean
      }
      starterFiles: Array<{ file: string; source: string }>
      starterOnly: boolean
      nextAction: { tool: string }
    }
    expect(result.status).toBe('ok')
    expect(result.projectRevision).not.toBe(project.projectRevision)
    expect(result.files).toEqual([
      'main.scene.ts',
      'terrain.scene.ts',
      'generators/starter-terrain.generator.ts',
    ])
    expect(result.scaffold.entryFile).toBe('main.scene.ts')
    expect(result.scaffold.closedImports).toBe(true)
    expect(result.scaffold.files.map((file) => file.path)).toEqual(result.files)
    expect(result.starterFiles.map((file) => file.file)).toEqual(result.files)
    expect(result.starterFiles.find((file) => file.file === 'terrain.scene.ts')?.source).toContain('width: 2000')
    expect(result.starterOnly).toBe(true)
    expect(result.nextAction).toEqual(expect.objectContaining({
      tool: 'scene:script.commitProject',
    }))

    for (const file of result.files) {
      const source = await app.inject({
        method: 'GET',
        url: `/api/v1/projects/${project.id}/scene-script?file=${encodeURIComponent(file)}`,
      })
      expect(source.statusCode, source.body).toBe(200)
      expect((source.json() as { source: string }).source.trim()).not.toBe('')
    }

    const compile = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/scene-script/validate`,
      payload: {
        file: 'main.scene.ts',
        source: (await app.inject({
          method: 'GET',
          url: `/api/v1/projects/${project.id}/scene-script?file=main.scene.ts`,
        }).then((item) => item.json() as { source: string })).source,
      },
    })
    expect(compile.statusCode, compile.body).toBe(200)
    expect((compile.json() as { valid: boolean }).valid).toBe(true)

    const firstDraft = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/scene-script/draft`,
      headers: aiHeaders,
      payload: {
        draftId: `first-author-${project.id}`,
        generation: 1,
        files: result.starterFiles,
        entryFile: 'main.scene.ts',
        expectedProjectRevision: result.projectRevision,
        execute: true,
      },
    })
    expect(firstDraft.statusCode, firstDraft.body).toBe(200)
    expect(firstDraft.json()).toEqual(expect.objectContaining({
      valid: true,
      status: 'visible',
      projectRevision: result.projectRevision,
      sync: expect.objectContaining({
        aligned: true,
        executionStatus: 'completed',
      }),
    }))

    const refused = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/scene-script/scaffold`,
      headers: aiHeaders,
      payload: {
        expectedProjectRevision: result.projectRevision,
      },
    })
    expect(refused.statusCode).toBe(409)
    expect(refused.json()).toEqual(expect.objectContaining({ code: 'scaffold-would-overwrite' }))
  })

  it('requires and enforces expectedProjectRevision', async () => {
    const project = await createEmptyProject('Scaffold OCC')
    const missing = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/scene-script/scaffold`,
      payload: {},
    })
    expect(missing.statusCode).toBe(400)

    const stale = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/scene-script/scaffold`,
      payload: { expectedProjectRevision: 'stale-project-revision' },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toEqual(expect.objectContaining({ code: 'scene-project-revision-conflict' }))
  })
})
