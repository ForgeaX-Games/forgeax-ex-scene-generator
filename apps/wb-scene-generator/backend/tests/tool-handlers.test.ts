import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/main.js'
import {
  boundedSceneScriptMutationResult,
  COMPACT_SOURCE_MAX_BYTES,
  formatExecuteVerificationFailure,
  summarizeProjectList,
  summarizeProjectOpen,
  summarizeSceneScriptSource,
  tools,
} from '../src/tool-handlers.js'
import { resetReadDedupeForTests } from '../src/scene-script/agent/readDedupe.js'
import {
  SINO_COMPOSITION_FUNCTIONS,
  SINO_SPATIAL_FUNCTIONS,
  SINO_UTILITY_FUNCTIONS,
} from '../src/scene-script/contracts/agentContractCatalog.js'
import { MINIMAL_SCENE_SCAFFOLD_FILES } from '../src/scene-script/scaffold/minimal.js'
import { applyBatch } from '@forgeax/node-runtime'
import { getRuntimeForProject } from '../src/runtime.js'

// 复盘(2026-07-01):runtime.ts 的 ProjectRegistry 是模块级单例，`resolveWorkspaceRoot()`
// 只在它首次被 buildApp() 触发初始化时读一次 FORGEAX_PROJECT_ROOT——本文件之前从未设置，
// 于是每次跑测试都会在 REPO 里真实的 `.forgeax-runtime`（而不是每个 test 的 tmp root）
// 下创建一个个"Lock Drift Test" project 且永不清理，长期跑测试会真实累积磁盘占用，还会
// 污染 scene:projects.list 让下游依赖"只有 main 项目"的测试随机失败。这里在模块加载时
// （即本文件任何 buildApp() 调用之前）设一次隔离 tmpdir，与 scene-export-routes.test.ts
// 等文件的既有约定一致（单例只在整个文件第一次用到时读一次，per-test 重设不生效）。
process.env.FORGEAX_PROJECT_ROOT = mkdtempSync(join(tmpdir(), 'wb-scene-tools-runtime-'))

let root: string
let portsFile: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'wb-scene-tools-'))
  portsFile = join(root, 'plugin-dev-ports.json')
})

afterEach(() => {
  resetReadDedupeForTests()
  rmSync(root, { recursive: true, force: true })
})

function ctx(toolId: string, agentId?: string, kind: 'ai' | 'user' = 'ai') {
  return {
    caller: { kind, ...(agentId ? { agentId } : {}) },
    toolId,
    env: { FORGEAX_PLUGIN_DEV_PORTS_FILE: portsFile },
    cwd: process.cwd(),
  }
}

describe('ToolRegistry scene handlers', () => {
  it('returns compact source context and deduplicates unchanged revisions', () => {
    const payload = {
      file: 'main.scene.ts',
      source: 'const world = basePlane({ width: 100, height: 100 })',
      revision: 'module-rev',
      exists: true,
      state: {
        projectRevision: 'project-rev',
        modules: ['main.scene.ts', 'terrain.scene.ts'],
        moduleRevisions: {
          'main.scene.ts': { moduleId: 'main', revision: 'module-rev' },
        },
        sourceMap: [{
          file: 'main.scene.ts',
          statementId: 'world',
          entityId: 'scene:world',
          functionName: 'basePlane',
          source: { start: 0, end: 50 },
          runtimeNodeIds: ['runtime-node'],
        }],
      },
    }

    const compact = summarizeSceneScriptSource(payload) as Record<string, unknown>
    expect(compact).not.toHaveProperty('state')
    expect(JSON.stringify(compact)).not.toContain('runtime-node')
    expect(compact).toMatchObject({
      source: payload.source,
      projectRevision: 'project-rev',
      unchanged: false,
      manifest: {
        entryFile: 'main.scene.ts',
        files: ['main.scene.ts', 'terrain.scene.ts'],
      },
    })
    expect(Buffer.byteLength(JSON.stringify(compact))).toBeLessThan(COMPACT_SOURCE_MAX_BYTES)
    expect(summarizeSceneScriptSource(payload, 'project-rev')).toMatchObject({
      projectRevision: 'project-rev',
      unchanged: true,
    })
    expect(summarizeSceneScriptSource(payload, 'project-rev')).not.toHaveProperty('source')
  })

  it('keeps canonical entryFile when generators sort before main.scene.ts', () => {
    const compact = summarizeSceneScriptSource({
      file: 'terrain.scene.ts',
      source: 'export const terrain = emptyScene({})',
      revision: 'module-rev',
      exists: true,
      state: {
        projectRevision: 'project-rev',
        entryFile: 'main.scene.ts',
        modules: ['generators/lake-basin.generator.ts', 'main.scene.ts', 'terrain.scene.ts'],
        moduleRevisions: {},
        sourceMap: [],
      },
    }) as { manifest: { entryFile: string; files: string[] } }
    expect(compact.manifest.entryFile).toBe('main.scene.ts')
    expect(compact.manifest.files[0]).toBe('generators/lake-basin.generator.ts')

    const inferred = summarizeSceneScriptSource({
      file: 'terrain.scene.ts',
      source: 'const heights = valleyHeightfield({ valleyDepth: 18 })\n',
      revision: 'module-rev',
      exists: true,
      state: {
        projectRevision: 'project-rev',
        modules: ['generators/lake-basin.generator.ts', 'main.scene.ts', 'terrain.scene.ts'],
        sourceMap: [{
          file: 'terrain.scene.ts',
          statementId: 'heights',
          entityId: 'scene:heights',
          source: { start: 0, end: 54 },
        }],
      },
    }) as { manifest: { entryFile: string }; outline: Array<{ functionName?: string }> }
    expect(inferred.manifest.entryFile).toBe('main.scene.ts')
    expect(inferred.outline[0]?.functionName).toBe('valleyHeightfield')
  })

  it('bounds Scene Script mutation payloads for Agent context', () => {
    expect(boundedSceneScriptMutationResult({
      valid: true,
      canonicalSource: 'x'.repeat(20_000),
      sourceMap: [{ statementId: 's1' }, { statementId: 's2' }],
      sources: { main: 'large' },
      transaction: { applied: true, undoToken: 'b1' },
      revision: 4,
    })).toEqual({
      valid: true,
      transaction: { applied: true, undoToken: 'b1' },
      revision: 4,
      sourceMapEntries: 2,
    })
  })

  it('keeps AI project-list results to id, name, type, and updatedAt', () => {
    expect(summarizeProjectList([
      {
        id: 'p_old',
        type: 'scene',
        name: 'Inland Metropolis',
        description: 'full inland brief that must not re-enter Sino context',
        createdAt: '2026-08-19T00:00:00.000Z',
        updatedAt: '2026-08-20T08:00:00.000Z',
        gameSlug: 'untitled-2',
      },
      {
        id: 'p_new',
        type: 'scene',
        name: 'Lake City',
        description: 'should be truncated when limit is 1',
        updatedAt: '2026-08-20T09:00:00.000Z',
      },
    ], { limit: 1 })).toEqual({
      projects: [{
        id: 'p_new',
        name: 'Lake City',
        type: 'scene',
        updatedAt: '2026-08-20T09:00:00.000Z',
      }],
      total: 2,
      truncated: true,
      nextAction: 'Open a known projectId. Do not re-list to recover an id you already have.',
    })
  })

  it('never returns an empty project identity from open summaries', () => {
    expect(summarizeProjectOpen({
      project: {},
      pipeline: {},
    }, { projectId: 'p_known' })).toEqual({
      project: { id: 'p_known', name: 'Scene Project', type: 'scene' },
      pipeline: { id: undefined, hash: undefined, nodeCount: 0, edgeCount: 0 },
    })
  })

  it('keeps AI project-open results to project and pipeline state', () => {
    expect(summarizeProjectOpen({
      project: { id: 'p1', name: 'Town', type: 'scene', description: 'large' },
      pipeline: { id: 'pipe1', hash: 'abc', nodes: { a: {}, b: {} }, edges: { e: {} } },
      workspace: { projects: [{ id: 'other' }] },
      openMode: 'shared',
      writeLockedBy: 'other-agent',
    })).toEqual({
      project: { id: 'p1', name: 'Town', type: 'scene' },
      pipeline: { id: 'pipe1', hash: 'abc', nodeCount: 2, edgeCount: 1 },
      openMode: 'shared',
      writeLockedBy: 'other-agent',
    })
  })

  it('uses the Studio plugin dev backendPort override when proxying tool calls', async () => {
    const app = await buildApp()
    await app.listen({ host: '127.0.0.1', port: 0 })
    const addr = app.server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    writeFileSync(
      portsFile,
      JSON.stringify({ plugins: { '@forgeax-plugin/wb-scene-generator': { frontendPort: 5001, backendPort: port } } }),
    )

    try {
      const result = await tools['scene:projects.list']({}, ctx('scene:projects.list')) as {
        projects: Array<Record<string, unknown>>
        total: number
      }

      expect(result).toEqual(expect.objectContaining({
        projects: [expect.objectContaining({ id: 'main', type: 'scene', name: 'Default Scene' })],
        total: expect.any(Number),
      }))
      expect(result.projects[0]).not.toHaveProperty('description')
    } finally {
      await app.close()
    }
  })

  it('returns commit diagnostics as tool data instead of an invoke error', async () => {
    const app = await buildApp()
    await app.listen({ host: '127.0.0.1', port: 0 })
    const addr = app.server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    writeFileSync(
      portsFile,
      JSON.stringify({ plugins: { '@forgeax-plugin/wb-scene-generator': { backendPort: port } } }),
    )

    let projectId: string | undefined
    try {
      const toolCtx = ctx('scene:script.commitProject', 'sino')
      const created = await tools['scene:projects.create'](
        { name: 'Structured Diagnostic City' },
        toolCtx,
      ) as { id: string }
      projectId = created.id
      await tools['scene:projects.open']({ id: created.id }, toolCtx)
      const result = await tools['scene:script.commitProject']({
        projectId: created.id,
        entryFile: 'main.scene.ts',
        files: [{
          file: 'main.scene.ts',
          source: 'sceneOutput({ scene: missingBinding })\n',
        }],
      }, toolCtx) as Record<string, unknown>

      expect(result.status).toBe('rejected')
      expect(result.httpStatus).toBe(422)
      expect(result.diagnostics).toEqual(expect.any(Array))
    } finally {
      if (projectId) {
        await tools['scene:projects.close'](
          { id: projectId },
          ctx('scene:projects.close', 'sino'),
        ).catch(() => undefined)
      }
      await app.close()
    }
  })

  it('proxies revision-guarded Scene scaffolding and returns a bounded manifest', async () => {
    const app = await buildApp()
    await app.listen({ host: '127.0.0.1', port: 0 })
    const addr = app.server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    writeFileSync(
      portsFile,
      JSON.stringify({ plugins: { '@forgeax-plugin/wb-scene-generator': { backendPort: port } } }),
    )

    let projectId: string | undefined
    const toolCtx = ctx('scene:script.scaffold', 'scaffold-tool-agent')
    try {
      const created = await tools['scene:projects.create'](
        { name: 'Scaffold Tool City' },
        toolCtx,
      ) as { id: string }
      projectId = created.id
      await tools['scene:projects.open']({ id: created.id }, toolCtx)
      const current = await tools['scene:script.get'](
        { projectId: created.id },
        toolCtx,
      ) as { projectRevision: string }
      const result = await tools['scene:script.scaffold']({
        projectId: created.id,
        expectedProjectRevision: current.projectRevision,
      }, toolCtx) as {
        status: string
        projectRevision: string
        sourceMapEntries: number
        scaffold: { closedImports: boolean; files: Array<{ path: string }> }
      }
      expect(result.status).toBe('ok')
      expect(result.sourceMapEntries).toBeGreaterThan(0)
      expect(result.scaffold.closedImports).toBe(true)
      expect(result.scaffold.files.map((file) => file.path)).toEqual([
        'main.scene.ts',
        'terrain.scene.ts',
        'generators/starter-terrain.generator.ts',
      ])
      const draftStartedAt = Date.now()
      const draft = await tools['scene:script.draft']({
        projectId: created.id,
        draftId: 'scaffold-preview',
        generation: 1,
        entryFile: 'main.scene.ts',
        expectedProjectRevision: result.projectRevision,
        execute: true,
        files: MINIMAL_SCENE_SCAFFOLD_FILES.map((file) => ({ ...file })),
      }, toolCtx) as {
        valid: boolean
        status: string
        previewRevision: string
        projectRevision: string
      }
      expect(draft).toMatchObject({
        valid: true,
        status: 'visible',
        projectRevision: result.projectRevision,
      })
      expect(draft.previewRevision).toBeTruthy()
      expect(Date.now() - draftStartedAt).toBeLessThan(2_000)
      const afterDraft = await tools['scene:script.get'](
        { projectId: created.id },
        toolCtx,
      ) as { projectRevision: string }
      expect(afterDraft.projectRevision).toBe(result.projectRevision)
      const commitStartedAt = Date.now()
      const committed = await tools['scene:script.commitProject']({
        projectId: created.id,
        entryFile: 'main.scene.ts',
        expectedProjectRevision: result.projectRevision,
        files: MINIMAL_SCENE_SCAFFOLD_FILES.map((file) => ({ ...file })),
      }, toolCtx) as {
        status: string
        projectRevision: string
        executedRevision: string
        verification: { ok: boolean }
      }
      expect(committed.status).toBe('ok')
      expect(committed.executedRevision).toBe(committed.projectRevision)
      expect(committed.verification).toEqual(expect.objectContaining({ ok: true }))
      expect(Date.now() - commitStartedAt).toBeLessThan(180_000)
    } finally {
      if (projectId) {
        await tools['scene:projects.close'](
          { id: projectId },
          ctx('scene:projects.close', 'scaffold-tool-agent'),
        ).catch(() => undefined)
      }
      await app.close()
    }
  })

  it('progressively discloses only Sino-approved Scene Contracts', async () => {
    const app = await buildApp()
    await app.listen({ host: '127.0.0.1', port: 0 })
    const addr = app.server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    writeFileSync(
      portsFile,
      JSON.stringify({ plugins: { '@forgeax-plugin/wb-scene-generator': { backendPort: port } } }),
    )

    try {
      const summary = await tools['scene:script.contracts'](
        { projectId: 'main' },
        ctx('scene:script.contracts'),
      ) as {
        mode: string
        functions: Array<{ functionName: string }>
        total: number
        generatorAbi: { import: string; portTypes: { spatial: string[] } }
        builtins: Array<{ functionName: string }>
      }
      const approvedNames = new Set<string>([
        ...SINO_UTILITY_FUNCTIONS,
        ...SINO_COMPOSITION_FUNCTIONS,
        ...SINO_SPATIAL_FUNCTIONS,
      ])
      expect(summary.mode).toBe('summary')
      expect(summary.total).toBe(summary.functions.length)
      expect(summary.functions.every((item) => approvedNames.has(item.functionName))).toBe(true)
      expect(Buffer.byteLength(JSON.stringify(summary))).toBeLessThan(20 * 1024)
      expect(summary.functions.some((item) => item.functionName === 'scopeSceneNode')).toBe(true)
      expect(summary.functions.some((item) => item.functionName === 'basePlane')).toBe(true)
      expect(summary.functions.some((item) => item.functionName === 'numberValue')).toBe(true)
      expect(summary.functions.some((item) => item.functionName === 'emptyScene')).toBe(true)
      expect(summary.generatorAbi.import).toBe('@forgeax/project-generator')
      expect(summary.generatorAbi.portTypes.spatial).toContain('PlacementSet')
      expect(summary.builtins.map((item) => item.functionName)).toEqual(['choose', 'repeat'])
      expect(summary.functions.some((item) => item.functionName === 'addBaseGrid')).toBe(false)
      expect(summary.functions.some((item) => item.functionName === 'pathConnectionLink')).toBe(false)
      expect(summary.functions.some((item) => item.functionName === 'rectangularGrid')).toBe(true)
      expect(summary.functions.some((item) => item.functionName === 'heightfieldMesh')).toBe(true)
      expect(summary.functions.some((item) => item.functionName === 'gridToBoxes')).toBe(false)
      expect(summary.functions.some((item) => item.functionName === 'cellularNoise')).toBe(false)
      expect(summary.functions.some((item) => item.functionName === 'fieldGrow')).toBe(false)

      const detail = await tools['scene:script.contracts'](
        {
          projectId: 'main',
          mode: 'detail',
          functionNames: ['basePlane', 'workGrid', 'sceneOutput', 'addBaseGrid'],
        },
        ctx('scene:script.contracts'),
      ) as { mode: string; functions: Array<{ functionName: string; inputs: unknown[] }> }
      expect(detail.mode).toBe('detail')
      expect(detail.functions.map((item) => item.functionName)).toEqual([
        'basePlane',
        'workGrid',
        'sceneOutput',
      ])
      expect(detail.functions.every((item) => item.inputs.length > 0)).toBe(true)
    } finally {
      await app.close()
    }
  })

  it('keeps only the human battery catalog and renderer metadata', async () => {
    const app = await buildApp()
    await app.listen({ host: '127.0.0.1', port: 0 })
    const addr = app.server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    writeFileSync(
      portsFile,
      JSON.stringify({ plugins: { '@forgeax-plugin/wb-scene-generator': { backendPort: port } } }),
    )

    try {
      const all = await tools['scene:batteries.list']({}, ctx('scene:batteries.list')) as Array<{ id: string }>
      expect(all.length).toBeGreaterThan(0)

      const one = await tools['scene:batteries.get']({ id: all[0].id }, ctx('scene:batteries.get'))
      expect(one).toEqual(expect.objectContaining({ id: all[0].id }))

      expect(tools).not.toHaveProperty('scene:composerUtilities.list')
      expect(tools).not.toHaveProperty('scene:composerUtilities.get')
      expect(tools).not.toHaveProperty('scene:templates.list')
      expect(tools).not.toHaveProperty('scene:templates.get')
      expect(tools).not.toHaveProperty('scene:pipeline.instantiateTemplate')
      expect(tools).not.toHaveProperty('scene:pipeline.applyBatch')
      expect(tools).not.toHaveProperty('scene:pipeline.import')

      const renderer = await tools['scene:renderer.info']({}, ctx('scene:renderer.info'))
      expect(renderer).toEqual(expect.objectContaining({ pane: 'renderer', paneUrl: '/?pane=renderer' }))
    } finally {
      await app.close()
    }
  })

  it('rejects pipeline.get without projectId for AI when no agent lock is held', async () => {
    const app = await buildApp()
    await app.listen({ host: '127.0.0.1', port: 0 })
    const addr = app.server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    writeFileSync(
      portsFile,
      JSON.stringify({ plugins: { '@forgeax-plugin/wb-scene-generator': { backendPort: port } } }),
    )

    try {
      await expect(tools['scene:pipeline.get']({}, ctx('scene:pipeline.get', 'unlocked-agent')))
        .rejects.toThrow(/missing projectId/i)
    } finally {
      await app.close()
    }
  })

  it('resolves pipeline.get from agent lock, not viewingProjectId', async () => {
    const app = await buildApp()
    await app.listen({ host: '127.0.0.1', port: 0 })
    const addr = app.server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    writeFileSync(
      portsFile,
      JSON.stringify({ plugins: { '@forgeax-plugin/wb-scene-generator': { backendPort: port } } }),
    )

    try {
      const created = await tools['scene:projects.create'](
        { name: 'Lock Drift Test' },
        ctx('scene:projects.create'),
      ) as { id?: string }
      const otherId = created.id
      expect(otherId).toBeTruthy()

      const agentId = 'lock-drift-agent'
      await tools['scene:projects.open']({ id: otherId! }, ctx('scene:projects.open', agentId))
      const graph = await tools['scene:pipeline.get']({}, ctx('scene:pipeline.get', agentId)) as {
        id?: string
        hashOnly?: boolean
        nodes?: unknown[]
      }
      expect(graph?.id).toBe(otherId)
      expect(graph?.hashOnly).toBe(true)
      expect(graph?.nodes).toBeUndefined()
    } finally {
      await app.close()
    }
  })

  it('accepts explicit projectId on pipeline.execute without Director-provided location names', async () => {
    const app = await buildApp()
    await app.listen({ host: '127.0.0.1', port: 0 })
    const addr = app.server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    writeFileSync(
      portsFile,
      JSON.stringify({ plugins: { '@forgeax-plugin/wb-scene-generator': { backendPort: port } } }),
    )

    try {
      const agentId = 'test-agent'
      await tools['scene:projects.open']({ id: 'main' }, ctx('scene:projects.open', agentId))
      const summary = await tools['scene:pipeline.execute'](
        { projectId: 'main' },
        ctx('scene:pipeline.execute', agentId),
      ) as { status?: string; outputs?: unknown }
      expect(summary.status).toBeDefined()
      expect(summary.outputs).toBeUndefined()
    } finally {
      await app.close()
    }
  })

  // 复盘(2026-07-01 sino bake/export 工具缺口):agent 侧路径——不是直接打后端路由，
  // 是走 tool-handlers 的 HTTP 代理，确认两个新工具能正确转发到新路由。
  it('bakeFromExecute + sceneExport.cook: agent-facing M7 bake/export tools proxy correctly', async () => {
    const app = await buildApp()
    await app.listen({ host: '127.0.0.1', port: 0 })
    const addr = app.server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    writeFileSync(
      portsFile,
      JSON.stringify({ plugins: { '@forgeax-plugin/wb-scene-generator': { backendPort: port } } }),
    )

    try {
      const agentId = 'bake-tool-agent'
      // Own project (not 'main') — 'main' may still be locked by an earlier test
      // in this file's shared registry singleton (see FORGEAX_PROJECT_ROOT note above).
      const created = await tools['scene:projects.create'](
        { name: 'Bake Tool Test' },
        ctx('scene:projects.create'),
      ) as { id?: string }
      const projectId = created.id!
      expect(projectId).toBeTruthy()
      await tools['scene:projects.open']({ id: projectId }, ctx('scene:projects.open', agentId))
      await applyBatch(
        await getRuntimeForProject(projectId),
        [
            {
              type: 'createNode',
              nodeId: 'tool_grid',
              opId: 'rect_grid',
              position: { x: -200, y: 0 },
              params: { width: 2, height: 1, fillValue: 1 },
            },
            {
              type: 'createNode',
              nodeId: 'g2n_tool',
              opId: 'grid2node',
              position: { x: 0, y: 0 },
              params: { name: 'ToolHouse' },
            },
            {
              type: 'connect',
              edgeId: 'tool_grid_to_scene',
              source: { nodeId: 'tool_grid', port: 'grid' },
              target: { nodeId: 'g2n_tool', port: 'grid' },
            },
            {
              type: 'createNode',
              nodeId: 'tool_result',
              opId: 'scene_output',
              position: { x: 200, y: 0 },
              params: {},
            },
            {
              type: 'connect',
              edgeId: 'tool_scene_to_result',
              source: { nodeId: 'g2n_tool', port: 'scene' },
              target: { nodeId: 'tool_result', port: 'scene' },
            },
          ],
        { actor: 'test-runtime-fixture' },
      )

      const baked = await tools['scene:baked.bakeFromExecute'](
        { projectId },
        ctx('scene:baked.bakeFromExecute', agentId),
      ) as { paths?: string[]; layerCount?: number }
      expect(baked.layerCount).toBeGreaterThan(0)
      expect(baked.paths).toEqual(expect.arrayContaining(['/ToolHouse']))

      const cooked = await tools['scene:sceneExport.cook'](
        { projectId, sceneName: 'Tool Export Demo' },
        ctx('scene:sceneExport.cook', agentId),
      ) as { bundleId?: string; downloadUrl?: string; warnings?: unknown[] }
      expect(cooked.bundleId).toMatch(/^tool-export-demo-/)
      expect(cooked.downloadUrl).toBeTruthy()
    } finally {
      await app.close()
    }
  })

  // Shared open + write write lock: many agents may open/analyze; only writers queue.
  describe('scene:projects.open shared + write write lock', () => {
    async function withApp(fn: (portsFile: string) => Promise<void>) {
      const app = await buildApp()
      await app.listen({ host: '127.0.0.1', port: 0 })
      const addr = app.server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      writeFileSync(
        portsFile,
        JSON.stringify({ plugins: { '@forgeax-plugin/wb-scene-generator': { backendPort: port } } }),
      )
      try {
        await fn(portsFile)
      } finally {
        await app.close()
      }
    }

    it('two agents can both open the same project for analysis', async () => {
      await withApp(async () => {
        const created = await tools['scene:projects.create'](
          { name: 'Shared Open Test' },
          ctx('scene:projects.create'),
        ) as { id?: string }
        const projectId = created.id!
        const agentA = 'queue-test-a-1'
        const agentB = 'queue-test-b-1'

        const openA = await tools['scene:projects.open']({ id: projectId }, ctx('scene:projects.open', agentA)) as {
          openMode?: string
        }
        const openB = await tools['scene:projects.open']({ id: projectId }, ctx('scene:projects.open', agentB)) as {
          openMode?: string
        }
        expect(openA.openMode).toBe('shared')
        expect(openB.openMode).toBe('shared')

        // Soft open alone does not take the write lock — queue stays empty.
        const status = await tools['scene:projects.queue.status'](
          { id: projectId },
          ctx('scene:projects.queue.status', agentB),
        ) as { queue: unknown[] }
        expect(status.queue).toEqual([])

        await tools['scene:projects.close']({ id: projectId }, ctx('scene:projects.close', agentA))
        await tools['scene:projects.close']({ id: projectId }, ctx('scene:projects.close', agentB))
      })
    })

    it('mutation waits for write lock while peer may keep analyzing via open', async () => {
      await withApp(async () => {
        const created = await tools['scene:projects.create'](
          { name: 'Write Wait Test' },
          ctx('scene:projects.create'),
        ) as { id?: string }
        const projectId = created.id!
        const agentA = 'queue-test-a-2'
        const agentB = 'queue-test-b-2'

        await tools['scene:projects.open']({ id: projectId }, ctx('scene:projects.open', agentA))
        await tools['scene:projects.open']({ id: projectId }, ctx('scene:projects.open', agentB))

        // A claims write via the canonical Scene Script mutation.
        await tools['scene:script.put'](
          { projectId, source: 'const root = emptyScene({})\nsceneOutput({ scene: root.scene })' },
          ctx('scene:script.put', agentA),
        )

        // B can still soft-open / stay attached — open is shared.
        await expect(
          tools['scene:projects.open']({ id: projectId }, ctx('scene:projects.open', agentB)),
        ).resolves.toMatchObject({ openMode: 'shared' })

        const pending = tools['scene:script.put'](
          { projectId, source: 'const root = emptyScene({})\nsceneOutput({ scene: root.scene })' },
          ctx('scene:script.put', agentB),
        )
        await new Promise((r) => setTimeout(r, 120))
        await tools['scene:projects.close']({ id: projectId }, ctx('scene:projects.close', agentA))

        await expect(pending).resolves.toBeTruthy()
        await tools['scene:projects.close']({ id: projectId }, ctx('scene:projects.close', agentB))
      })
    })

    it('non-writer close detaches session without releasing the writer lock', async () => {
      await withApp(async () => {
        const created = await tools['scene:projects.create'](
          { name: 'Detach Non Writer Test' },
          ctx('scene:projects.create'),
        ) as { id?: string }
        const projectId = created.id!
        const agentA = 'queue-test-a-3'
        const agentB = 'queue-test-b-3'

        await tools['scene:projects.open']({ id: projectId }, ctx('scene:projects.open', agentA))
        await tools['scene:projects.open']({ id: projectId }, ctx('scene:projects.open', agentB))
        await tools['scene:script.put'](
          { projectId, source: 'const root = emptyScene({})\nsceneOutput({ scene: root.scene })' },
          ctx('scene:script.put', agentA),
        )

        // B leaves without holding write — A must still be able to mutate.
        await tools['scene:projects.close']({ id: projectId }, ctx('scene:projects.close', agentB))
        await tools['scene:script.put'](
          { projectId, source: 'const root = emptyScene({})\nsceneOutput({ scene: root.scene })' },
          ctx('scene:script.put', agentA),
        )
        await tools['scene:projects.close']({ id: projectId }, ctx('scene:projects.close', agentA))
      })
    })

    it('scene:projects.heartbeat renews the lease for the write-lock holder', async () => {
      await withApp(async () => {
        const created = await tools['scene:projects.create'](
          { name: 'Heartbeat Test' },
          ctx('scene:projects.create'),
        ) as { id?: string }
        const projectId = created.id!
        const agentA = 'queue-test-a-4'
        const agentB = 'queue-test-b-4'

        await tools['scene:projects.open']({ id: projectId }, ctx('scene:projects.open', agentA))
        // Write lock is claimed by the first mutation, not by soft open.
        await tools['scene:script.put'](
          { projectId, source: 'const root = emptyScene({})\nsceneOutput({ scene: root.scene })' },
          ctx('scene:script.put', agentA),
        )
        const res = await tools['scene:projects.heartbeat'](
          { id: projectId },
          ctx('scene:projects.heartbeat', agentA),
        ) as { ok?: boolean }
        expect(res.ok).toBe(true)

        // Some other agent heartbeating a project it doesn't hold is rejected.
        await expect(
          tools['scene:projects.heartbeat']({ id: projectId }, ctx('scene:projects.heartbeat', agentB)),
        ).rejects.toThrow()
        await tools['scene:projects.close']({ id: projectId }, ctx('scene:projects.close', agentA))
      })
    })
  })

  describe('formatExecuteVerificationFailure (root-cause priority)', () => {
    it('treats execFailures as primary even when runtime status says completed', () => {
      const msg = formatExecuteVerificationFailure({
        status: 'completed',
        verification: {
          ok: false,
          primaryFailure: 'execution',
          executionFailures: {
            ok: false,
            count: 1,
            failures: [{ index: 0, message: 'areaPartition failed: empty region' }],
          },
          hints: ['[execution.failures] one node failed'],
        },
        diagnostics: [{ repairSlip: 'Operation: areaPartition\nHow to fix:\n- Repair the region input.' }],
      })
      expect(msg).toMatch(/^\[primaryFailure: execution\]/)
      expect(msg).toContain('status=completed is not acceptance')
      expect(msg).toContain('areaPartition failed')
      expect(msg).toContain('Operation: areaPartition')
      expect(msg).toContain('Repair the region input')
    })

    it('prefers structural over locationNameAlignment when both fail', () => {
      const msg = formatExecuteVerificationFailure({
        status: 'completed',
        verification: {
          ok: false,
          primaryFailure: 'structural',
          hints: [
            'Node pob out_1 is empty after completed execute — check incoming connect',
            '[stage3.location_names] missing 望江客栈、市集、清水镇',
          ],
          locationNameAlignment: {
            ok: false,
            missing: [{ name: '望江客栈' }, { name: '市集' }, { name: '清水镇' }],
            fix: 'Wire Name ports',
            actualNodeNames: ['root'],
          },
        },
      })
      expect(msg).toMatch(/^\[primaryFailure: structural\]/)
      expect(msg).toMatch(/empty\/disconnected group outputs/)
      expect(msg).toMatch(/\[secondary: locationNameAlignment\]/)
      expect(msg).toContain('望江客栈')
      expect(msg).toContain('市集')
      expect(msg).toContain('清水镇')
    })

    it('reports location-names as primary when structural hints are absent', () => {
      const msg = formatExecuteVerificationFailure({
        status: 'completed',
        verification: {
          ok: false,
          primaryFailure: 'location-names',
          hints: ['[stage3.location_names] missing 望江客栈'],
          locationNameAlignment: {
            ok: false,
            missing: [{ name: '望江客栈' }],
            fix: 'Wire Name ports',
          },
        },
      })
      expect(msg).toMatch(/^\[primaryFailure: location-names\]/)
      expect(msg).toMatch(/locationNameAlignment failed/)
    })
  })

  // P0-3 (2026-07-15 tool 升级方案): pipeline.get 的 nameContains/opIdIn grep 式
  // 模糊过滤。
  describe('pipeline.get nameContains/opIdIn (P0-3)', () => {
    it('filters by name substring and reports search.matchCount', async () => {
      const app = await buildApp()
      await app.listen({ host: '127.0.0.1', port: 0 })
      const addr = app.server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      writeFileSync(
        portsFile,
        JSON.stringify({ plugins: { '@forgeax-plugin/wb-scene-generator': { backendPort: port } } }),
      )
      try {
        const agentId = 'search-agent'
        const created = await tools['scene:projects.create']({ name: 'Search Test' }, ctx('scene:projects.create')) as { id?: string }
        const projectId = created.id!
        await tools['scene:projects.open']({ id: projectId }, ctx('scene:projects.open', agentId))
        await applyBatch(
          await getRuntimeForProject(projectId),
          [
              { type: 'createNode', nodeId: 'house_1', opId: 'grid2node', name: '望江客栈_主楼', position: { x: 0, y: 0 }, params: {} },
              { type: 'createNode', nodeId: 'house_2', opId: 'grid2node', name: '望江客栈_偏房', position: { x: 200, y: 0 }, params: {} },
              { type: 'createNode', nodeId: 'unrelated', opId: 'grid2node', name: 'Something Else', position: { x: 400, y: 0 }, params: {} },
            ],
          { actor: 'test-runtime-fixture' },
        )

        const result = await tools['scene:pipeline.get'](
          { projectId, nameContains: '望江客栈' },
          ctx('scene:pipeline.get', agentId),
        ) as { nodes: Array<{ id: string }>; search?: { matchCount: number } }
        expect(result.search?.matchCount).toBe(2)
        expect(result.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['house_1', 'house_2']))
        expect(result.nodes.map((n) => n.id)).not.toContain('unrelated')
      } finally {
        await app.close()
      }
    })

    it('filters by opIdIn and reports matchCount:0 (not the whole graph) when nothing matches', async () => {
      const app = await buildApp()
      await app.listen({ host: '127.0.0.1', port: 0 })
      const addr = app.server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      writeFileSync(
        portsFile,
        JSON.stringify({ plugins: { '@forgeax-plugin/wb-scene-generator': { backendPort: port } } }),
      )
      try {
        const agentId = 'search-opid-agent'
        const created = await tools['scene:projects.create']({ name: 'Search OpId Test' }, ctx('scene:projects.create')) as { id?: string }
        const projectId = created.id!
        await tools['scene:projects.open']({ id: projectId }, ctx('scene:projects.open', agentId))
        await applyBatch(
          await getRuntimeForProject(projectId),
          [{ type: 'createNode', nodeId: 'g1', opId: 'grid2node', position: { x: 0, y: 0 }, params: {} }],
          { actor: 'test-runtime-fixture' },
        )

        const hit = await tools['scene:pipeline.get'](
          { projectId, opIdIn: ['grid2node'] },
          ctx('scene:pipeline.get', agentId),
        ) as { search?: { matchCount: number }; nodes: Array<{ id: string }> }
        expect(hit.search?.matchCount).toBeGreaterThanOrEqual(1)
        expect(hit.nodes.map((n) => n.id)).toContain('g1')

        const miss = await tools['scene:pipeline.get'](
          { projectId, opIdIn: ['no_such_op_anywhere'] },
          ctx('scene:pipeline.get', agentId),
        ) as { search?: { matchCount: number } }
        expect(miss.search?.matchCount).toBe(0)
      } finally {
        await app.close()
      }
    })
  })
})
