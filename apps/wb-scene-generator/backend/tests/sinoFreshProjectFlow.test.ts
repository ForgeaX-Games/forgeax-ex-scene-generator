import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TERRAIN_MESH_REQUIRED_ACTION } from '../src/agent/rendererStatus.js'
import { resetReadDedupeForTests } from '../src/scene-script/agent/readDedupe.js'
import { tools } from '../src/tool-handlers.js'
import { buildApp } from '../src/main.js'

process.env.FORGEAX_PROJECT_ROOT = mkdtempSync(join(tmpdir(), 'wb-scene-sino-flow-'))

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

const root = mkdtempSync(join(tmpdir(), 'wb-scene-sino-flow-ports-'))
const portsFile = join(root, 'plugin-dev-ports.json')
const evidence = {
  projectId: '',
  calls: [] as Array<{ tool: string; bytes: number; unchanged?: boolean }>,
  entryFile: '',
  projectRevision: '',
  executedRevision: '',
  verify: {} as Record<string, unknown>,
  occupancyVerify: {} as Record<string, unknown>,
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
      plugins: { '@forgeax-plugin/wb-scene-generator': { backendPort: port } },
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

  it('creates, scaffolds, verifies mesh terrain, then authors locally without bootstrap loops', async () => {
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

    const scaffolded = await call('scene:script.scaffold', {
      projectId,
      expectedProjectRevision: current.projectRevision,
    }) as { status: string; projectRevision: string }
    expect(scaffolded.status).toBe('ok')

    const afterScaffold = await call('scene:script.get', {
      projectId,
      file: 'main.scene.ts',
    }) as {
      projectRevision: string
      manifest: { entryFile: string; files: string[] }
      source?: string
      unchanged?: boolean
    }
    expect(afterScaffold.unchanged).not.toBe(true)
    expect(afterScaffold.manifest.entryFile).toBe('main.scene.ts')
    expect(afterScaffold.manifest.files[0]).toBe('generators/starter-terrain.generator.ts')
    evidence.entryFile = afterScaffold.manifest.entryFile
    evidence.projectRevision = afterScaffold.projectRevision

    const openedAfterScaffold = await call('scene:projects.open', { id: projectId }) as {
      unchanged?: boolean
      projectRevision?: string
      project: { id: string }
    }
    expect(openedAfterScaffold.unchanged).not.toBe(true)
    expect(openedAfterScaffold.project.id).toBe(projectId)
    expect(openedAfterScaffold.projectRevision).toBe(afterScaffold.projectRevision)

    const unchangedGet = await call('scene:script.get', {
      projectId,
      file: 'main.scene.ts',
      ifRevision: afterScaffold.projectRevision,
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
    expect(execution.executedRevision).toBe(afterScaffold.projectRevision)

    await app.inject({
      method: 'POST',
      url: '/api/v1/renderer/status',
      payload: {
        viewingProjectId: projectId,
        openProjectId: projectId,
        projectRevision: afterScaffold.projectRevision,
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
    expect(verified.ok).toBe(true)
    expect(verified.reasons).not.toContain('renderer-no-terrain-mesh')

    const terrain = await call('scene:script.get', {
      projectId,
      file: 'terrain.scene.ts',
      force: true,
    }) as {
      projectRevision: string
      outline: Array<{ statementId: string; functionName: string }>
    }
    const heights = terrain.outline.find((item) => item.functionName === 'valleyHeightfield')
    expect(heights?.statementId).toBeTruthy()

    const lens = await call('scene:authoring.lens', {
      projectId,
      file: 'terrain.scene.ts',
      statementId: heights!.statementId,
    }) as { file: string; target: { functionName: string } }
    expect(lens.target.functionName).toBe('valleyHeightfield')

    const applied = await call('scene:authoring.applyCommands', {
      projectId,
      file: 'terrain.scene.ts',
      expectedProjectRevision: terrain.projectRevision,
      commands: [{
        type: 'renameBinding',
        statementId: heights!.statementId,
        binding: 'basinHeights',
      }],
    }) as { status: string; projectRevision?: string; diagnostics?: unknown }
    expect(applied.status, JSON.stringify(applied)).toBe('ok')

    await app.inject({
      method: 'POST',
      url: '/api/v1/renderer/status',
      payload: {
        viewingProjectId: projectId,
        openProjectId: projectId,
        projectRevision: afterScaffold.projectRevision,
        executionStatus: 'completed',
        voxelLayers: 9,
        meshLayers: 0,
        frameDigest: 'flow-occupancy',
      },
    })
    const occupancy = await call('scene:script.verify', { projectId }) as {
      ok: boolean
      reasons: string[]
      nextAction: string
    }
    evidence.occupancyVerify = occupancy
    expect(occupancy.ok).toBe(false)
    expect(occupancy.reasons).toContain('renderer-no-terrain-mesh')
    expect(occupancy.nextAction).toBe(TERRAIN_MESH_REQUIRED_ACTION)

    const bootstrapReads = evidence.calls.filter((item) =>
      item.unchanged && (item.tool === 'scene:projects.list' || item.tool === 'scene:projects.open' || item.tool === 'scene:script.get'))
    expect(bootstrapReads.length).toBeGreaterThan(0)
    expect(evidence.calls.some((item) => item.tool === 'scene:projects.list')).toBe(false)
  }, 180_000)
})
