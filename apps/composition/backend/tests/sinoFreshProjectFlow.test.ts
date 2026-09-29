import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { resetReadDedupeForTests } from '../src/scene-script/agent/readDedupe.js'
import { MINIMAL_SCENE_SCAFFOLD_FILES } from '../src/scene-script/scaffold/minimal.js'
import { tools } from '../src/tool-handlers.js'
import { buildApp } from '../src/main.js'

process.env.FORGEAX_PROJECT_ROOT = mkdtempSync(join(tmpdir(), 'scene-sino-flow-'))

function ctx(toolId: string) {
  return {
    caller: {
      kind: 'ai' as const,
      agentId: 'sino-flow',
      sessionId: 'sino-flow-session',
    },
    toolId,
    env: { FORGEAX_PLUGIN_DEV_PORTS_FILE: portsFile },
    cwd: process.cwd(),
  }
}

const root = mkdtempSync(join(tmpdir(), 'scene-sino-flow-ports-'))
const portsFile = join(root, 'plugin-dev-ports.json')
const evidence = {
  projectId: '',
  calls: [] as Array<{ tool: string; bytes: number; unchanged?: boolean }>,
  entryFile: '',
  projectRevision: '',
  executedRevision: '',
  verify: {} as Record<string, unknown>,
  voxelVerify: {} as Record<string, unknown>,
}

async function call(toolId: keyof typeof tools, args: Record<string, unknown>): Promise<unknown> {
  const result = await tools[toolId](args, ctx(toolId))
  const serialized = JSON.stringify(result)
  evidence.calls.push({
    tool: toolId,
    bytes: Buffer.byteLength(serialized),
    unchanged: Boolean(result && typeof result === 'object' && (result as { unchanged?: unknown }).unchanged),
  })
  return result
}

describe('Sino fresh-project flow', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  let projectId = ''

  beforeAll(async () => {
    resetReadDedupeForTests()
    app = await buildApp()
    await app.listen({ host: '127.0.0.1', port: 0 })
    const addr = app.server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    writeFileSync(portsFile, JSON.stringify({
      plugins: { '@forgeax/scene-generator-composition': { backendPort: port } },
    }))
  }, 60_000)

  afterAll(async () => {
    await app.close()
    rmSync(root, { recursive: true, force: true })
    rmSync(process.env.FORGEAX_PROJECT_ROOT, { recursive: true, force: true })
    const evidenceDir = process.env.ACCEPTANCE_EVIDENCE_DIR
    if (evidenceDir) {
      mkdirSync(evidenceDir, { recursive: true })
      writeFileSync(join(evidenceDir, 'sino-self.json'), `${JSON.stringify(evidence, null, 2)}\n`)
    }
  })

  it('creates, commits mesh terrain, verifies, then authors locally without bootstrap loops', async () => {
    const created = await call('scene:projects.create', { name: 'Sino Flow Lake' }) as { id: string }
    projectId = created.id
    evidence.projectId = projectId
    expect(projectId).toMatch(/^p_/)

    const opened = await call('scene:projects.open', { id: projectId }) as {
      project: { id: string; name: string }
      pipeline: { nodeCount: number; edgeCount: number }
      projectRevision?: string
    }
    expect(opened.project).toEqual(expect.objectContaining({ id: projectId }))
    expect(opened.project).not.toEqual({})
    expect(opened.pipeline.nodeCount).toBe(0)
    expect(opened.pipeline.edgeCount).toBe(0)

    const current = await call('scene:script.get', { projectId }) as {
      projectRevision: string
      manifest: { entryFile: string }
      source?: string
    }
    expect(current.manifest.entryFile).toBe('main.scene.ts')

    const committed = await call('scene:script.commitProject', {
      projectId,
      entryFile: 'main.scene.ts',
      expectedProjectRevision: current.projectRevision,
      files: MINIMAL_SCENE_SCAFFOLD_FILES.map((file) => ({ ...file })),
    }) as { status: string; projectRevision: string; verification?: { ok?: boolean }; executionStatus?: string }
    expect(committed.status, JSON.stringify(committed)).toBe('ok')

    const afterCommit = await call('scene:script.get', {
      projectId,
      file: 'main.scene.ts',
    }) as {
      projectRevision: string
      manifest: { entryFile: string; files: string[] }
      source?: string
      unchanged?: boolean
    }
    expect(afterCommit.unchanged).not.toBe(true)
    expect(afterCommit.manifest.entryFile).toBe('main.scene.ts')
    expect(afterCommit.manifest.files.sort()).toEqual([
      'generators/basin-heights.generator.ts',
      'main.scene.ts',
      'terrain.scene.ts',
    ])
    evidence.entryFile = afterCommit.manifest.entryFile
    evidence.projectRevision = afterCommit.projectRevision

    const openedAfterCommit = await call('scene:projects.open', { id: projectId }) as {
      unchanged?: boolean
      projectRevision?: string
      project: { id: string }
    }
    expect(openedAfterCommit.unchanged).not.toBe(true)
    expect(openedAfterCommit.project.id).toBe(projectId)
    expect(openedAfterCommit.projectRevision).toBe(afterCommit.projectRevision)

    const unchangedGet = await call('scene:script.get', {
      projectId,
      file: 'main.scene.ts',
      ifRevision: afterCommit.projectRevision,
    }) as { unchanged: boolean; source?: string }
    expect(unchangedGet.unchanged).toBe(true)
    expect(unchangedGet).not.toHaveProperty('source')

    const repeatedGet = await call('scene:script.get', {
      projectId,
      file: 'main.scene.ts',
    }) as { unchanged: boolean; source?: string }
    expect(repeatedGet.unchanged).toBe(true)
    expect(JSON.stringify(repeatedGet)).not.toContain('sceneOutput')

    const repeatedOpen = await call('scene:projects.open', { id: projectId }) as { unchanged?: boolean }
    expect(repeatedOpen.unchanged).toBe(true)

    const executed = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/execute/summary`,
      headers: {
        'x-forgeax-caller-kind': 'ai',
        'x-forgeax-caller-agent-id': 'sino-flow',
        'x-forgeax-caller-session-id': 'sino-flow-session',
      },
      payload: { quietErrors: true },
    })
    expect(executed.statusCode, executed.body).toBe(200)
    const execution = executed.json() as { executedRevision: string; evidenceAligned: boolean }
    evidence.executedRevision = execution.executedRevision
    expect(execution.executedRevision).toBe(afterCommit.projectRevision)

    await app.inject({
      method: 'POST',
      url: '/api/v1/renderer/status',
      payload: {
        viewingProjectId: projectId,
        openProjectId: projectId,
        projectRevision: afterCommit.projectRevision,
        executionStatus: 'completed',
        meshLayers: 1,
        voxelLayers: 1,
        frameDigest: 'flow-mesh',
      },
    })

    const verified = await call('scene:script.verify', { projectId }) as {
      ok: boolean
      reasons: string[]
      evidence: { renderer?: { representation?: { meshLayers?: number } } }
    }
    evidence.verify = verified
    expect(verified.ok, JSON.stringify(verified)).toBe(true)

    await app.inject({
      method: 'POST',
      url: '/api/v1/renderer/status',
      payload: {
        viewingProjectId: projectId,
        openProjectId: projectId,
        projectRevision: afterCommit.projectRevision,
        executionStatus: 'completed',
        voxelLayers: 9,
        meshLayers: 0,
        frameDigest: 'flow-voxel',
      },
    })
    const voxelOnly = await call('scene:script.verify', { projectId }) as {
      ok: boolean
      reasons: string[]
      evidence: { renderer?: { representation?: { hasVoxelContent?: boolean; hasVisibleSceneContent?: boolean } } }
    }
    evidence.voxelVerify = voxelOnly
    expect(voxelOnly.ok, JSON.stringify(voxelOnly)).toBe(true)
    expect(voxelOnly.evidence.renderer?.representation?.hasVoxelContent).toBe(true)
    expect(voxelOnly.evidence.renderer?.representation?.hasVisibleSceneContent).toBe(true)

    const terrain = await call('scene:script.get', {
      projectId,
      file: 'terrain.scene.ts',
      force: true,
    }) as {
      projectRevision: string
      outline: Array<{ statementId: string; functionName: string }>
    }
    const heights = terrain.outline.find((item) => item.functionName === 'basinHeights')
    expect(heights?.statementId).toBeTruthy()

    const lens = await call('scene:authoring.lens', {
      projectId,
      file: 'terrain.scene.ts',
      statementId: heights!.statementId,
    }) as { file: string; target: { functionName: string } }
    expect(lens.target.functionName).toBe('basinHeights')

    const applied = await call('scene:authoring.applyCommands', {
      projectId,
      file: 'terrain.scene.ts',
      expectedProjectRevision: terrain.projectRevision,
      commands: [{
        type: 'renameBinding',
        statementId: heights!.statementId,
        binding: 'lakeHeights',
      }],
    }) as { status: string; projectRevision?: string; diagnostics?: unknown }
    expect(applied.status, JSON.stringify(applied)).toBe('ok')

    const bootstrapReads = evidence.calls.filter((item) =>
      item.unchanged && (item.tool === 'scene:projects.list' || item.tool === 'scene:projects.open' || item.tool === 'scene:script.get'))
    expect(bootstrapReads.length).toBeGreaterThan(0)
    expect(evidence.calls.some((item) => item.tool === 'scene:projects.list')).toBe(false)
  }, 180_000)
})
