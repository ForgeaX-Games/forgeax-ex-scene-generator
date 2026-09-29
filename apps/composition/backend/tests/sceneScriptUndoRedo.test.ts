import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildApp } from '../src/main.js'

const workspaceRoot = mkdtempSync(join(tmpdir(), 'scene-undo-redo-'))
process.env.FORGEAX_PROJECT_ROOT = workspaceRoot

describe('canonical Scene Script undo/redo', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  let projectId: string

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { name: 'Canonical history' },
    })
    projectId = (created.json() as { id: string }).id
    const authored = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${projectId}/scene-script`,
      payload: {
        source: `// @scene-module-id module.main
// @scene-id value
const plane = basePlane({ origin: [0, 0], width: 12, height: 8 })
`,
      },
    })
    expect(authored.statusCode, authored.body).toBe(200)
  })

  afterAll(async () => {
    await app.close()
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  async function sample(file = 'main.scene.ts') {
    const [module, pipeline, info] = await Promise.all([
      app.inject({
        method: 'GET',
        url: `/api/v1/projects/${projectId}/scene-script?file=${encodeURIComponent(file)}`,
      }),
      app.inject({ method: 'GET', url: `/api/v1/projects/${projectId}/pipeline` }),
      app.inject({ method: 'GET', url: `/api/v1/projects/${projectId}/scene-script/project-info` }),
    ])
    expect(module.statusCode, module.body).toBe(200)
    expect(pipeline.statusCode, pipeline.body).toBe(200)
    return {
      module: module.json() as {
        source: string
        exists: boolean
        state: {
          projectRevision: string
          compiledGraphHash: string
          sourceMap: unknown[]
          layout?: Record<string, { x: number; y: number }>
        }
      },
      pipeline: pipeline.json() as {
        hash: string
        nodes: Record<string, unknown>
        edges: Record<string, unknown>
        metadata?: Record<string, unknown>
      },
      info: info.json() as {
        projectRevision: string
        history: { cursor: number; length: number; canUndo: boolean; canRedo: boolean }
      },
    }
  }

  async function history(direction: 'undo' | 'redo', expectedProjectRevision: string) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scene-script/${direction}`,
      payload: { expectedProjectRevision },
    })
  }

  function graphProjection(pipeline: {
    nodes: Record<string, unknown>
    edges: Record<string, unknown>
    metadata?: Record<string, unknown>
  }) {
    const nodes = Object.fromEntries(Object.entries(pipeline.nodes).map(([id, node]) => {
      if (!node || typeof node !== 'object') return [id, node]
      const record = node as { params?: Record<string, unknown> }
      if (!record.params) return [id, node]
      const { min: _min, max: _max, precision: _precision, ...params } = record.params
      return [id, { ...record, params }]
    }))
    return { nodes, edges: pipeline.edges, metadata: pipeline.metadata }
  }

  it('undoes and redoes a single-module parameter edit with identical projections', async () => {
    const before = await sample()
    const saved = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${projectId}/scene-script`,
      payload: {
        source: before.module.source.replace('width: 12', 'width: 20'),
        expectedRevision: (await app.inject({
          method: 'GET',
          url: `/api/v1/projects/${projectId}/scene-script`,
        })).json().revision,
        label: 'Change number parameter',
      },
    })
    expect(saved.statusCode, saved.body).toBe(200)
    const changed = await sample()
    expect(changed.module.source).toContain('width: 20')
    expect(changed.module.state.compiledGraphHash).toBe(changed.pipeline.hash)

    const undone = await history('undo', changed.info.projectRevision)
    expect(undone.statusCode, undone.body).toBe(200)
    const afterUndo = await sample()
    expect(afterUndo.module.source).toBe(before.module.source)
    expect(graphProjection(afterUndo.pipeline)).toEqual(graphProjection(before.pipeline))
    expect(afterUndo.module.state.compiledGraphHash).toBe(afterUndo.pipeline.hash)
    expect(afterUndo.module.state.sourceMap).toEqual(before.module.state.sourceMap)
    expect(afterUndo.module.state.layout ?? {}).toEqual(before.module.state.layout ?? {})

    const redone = await history('redo', afterUndo.info.projectRevision)
    expect(redone.statusCode, redone.body).toBe(200)
    const afterRedo = await sample()
    expect(afterRedo.module.source).toBe(changed.module.source)
    expect(graphProjection(afterRedo.pipeline)).toEqual(graphProjection(changed.pipeline))
    expect(afterRedo.module.state.compiledGraphHash).toBe(afterRedo.pipeline.hash)
    expect(afterRedo.module.state.sourceMap).toEqual(changed.module.state.sourceMap)
  })

  it('rejects leftover extractDefinition; reuse is another .scene.ts import', async () => {
    const before = await sample()
    const extracted = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scene-script/commands`,
      payload: {
        expectedProjectRevision: before.info.projectRevision,
        commands: [{
          type: 'extractDefinition',
          statementIds: ['value'],
          meta: {
            name: 'ExtractedNumber',
            file: 'groups/extracted-number.scene.ts',
            seal: true,
            confirmed: true,
          },
        }],
        label: 'Extract number Definition',
      },
    })
    expect(extracted.statusCode, extracted.body).toBe(422)
    expect((await sample()).module.source).toBe(before.module.source)
  })

  it('rejects stale undo without polluting source, graph, hash, or SourceMap', async () => {
    const before = await sample()
    const response = await history('undo', 'stale-project-revision')
    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual(expect.objectContaining({
      code: 'SCENE_REVISION_CONFLICT',
      transaction: { applied: false, rolledBack: true },
    }))
    const after = await sample()
    expect(after.module.source).toBe(before.module.source)
    expect(after.pipeline).toEqual(before.pipeline)
    expect(after.module.state.sourceMap).toEqual(before.module.state.sourceMap)
    expect(after.module.state.layout ?? {}).toEqual(before.module.state.layout ?? {})
    expect(after.info.history).toEqual(before.info.history)
  })
})
