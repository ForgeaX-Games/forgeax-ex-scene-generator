import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildApp } from '../src/main.js'
import { tools } from '../src/tool-handlers.js'
import { resetReadDedupeForTests } from '../src/scene-script/agent/readDedupe.js'

process.env.FORGEAX_PROJECT_ROOT = mkdtempSync(join(tmpdir(), 'pure-generator-flow-'))

describe('Pure Generator.ts Terrain End-to-End Flow', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  let projectId = ''
  let port = 0
  const portsDir = mkdtempSync(join(tmpdir(), 'ports-pure-gen-'))
  const portsFile = join(portsDir, 'plugin-dev-ports.json')

  const callerCtx = {
    caller: {
      kind: 'ai' as const,
      agentId: 'sino-pure-generator',
      sessionId: 'session-pure-gen-1',
    },
    toolId: 'scene:script.commitProject',
    env: { FORGEAX_PLUGIN_DEV_PORTS_FILE: portsFile },
    cwd: process.cwd(),
  }

  beforeAll(async () => {
    resetReadDedupeForTests()
    app = await buildApp()
    await app.listen({ host: '127.0.0.1', port: 0 })
    const addr = app.server.address()
    port = typeof addr === 'object' && addr ? addr.port : 0
    const { writeFileSync } = await import('node:fs')
    writeFileSync(portsFile, JSON.stringify({
      plugins: { '@forgeax/scene-generator-composition': { backendPort: port } },
    }))
  }, 60_000)

  afterAll(async () => {
    await app.close()
    rmSync(portsDir, { recursive: true, force: true })
    rmSync(process.env.FORGEAX_PROJECT_ROOT, { recursive: true, force: true })
  })

  it('generates custom procedural terrain using only local generator.ts and platform mesh primitives', async () => {
    // 1. Create project
    const created = await tools['scene:projects.create']({ name: 'Procedural Valley' }, { ...callerCtx, toolId: 'scene:projects.create' }) as { id: string }
    projectId = created.id
    expect(projectId).toMatch(/^p_/)

    // 2. Open project and verify starter guidance is delivered inline
    const opened = await tools['scene:projects.open']({ id: projectId }, { ...callerCtx, toolId: 'scene:projects.open' }) as {
      project: { id: string; name: string }
      starterGuide?: { primitives: Array<{ name: string; signature: string }> }
    }
    expect(opened.project.id).toBe(projectId)
    expect(opened.starterGuide?.primitives.some((p) => p.name === 'heightfieldExplode')).toBe(true)

    // 3. Define pure local generator with TS type aliases and natural run implementation
    const generatorSource = `import { defineGenerator } from '@forgeax/project-generator'

export const valleyElevation = defineGenerator({
  id: 'valley-elevation',
  version: 1,
  description: 'Custom procedural valley generator using sin/cos terrace algorithm.',
  inputs: {
    width: 'number',
    height: 'number',
    depth: { type: 'scalar', defaultValue: 25 },
    seed: 'number',
  },
  outputs: {
    heightGrid: 'number[][]',
  },
  run(ctx, args) {
    const cols = Math.max(16, Math.round(Number(args.width) || 32))
    const rows = Math.max(16, Math.round(Number(args.height) || 32))
    const depth = Number(args.depth) || 20
    const grid: number[][] = []
    for (let r = 0; r < rows; r++) {
      const row: number[] = []
      for (let c = 0; c < cols; c++) {
        const u = c / cols - 0.5
        const v = r / rows - 0.5
        const dist = Math.sqrt(u * u + v * v) * 2
        const valley = Math.sin(dist * Math.PI) * depth
        row.push(Math.max(0, valley))
      }
      grid.push(row)
    }
    return { heightGrid: grid }
  },
})
`

    // 4. Define declarative scene script importing local generator
    const sceneSource = `// @scene-module-id valley.main
import { addChild, basePlane, emptyScene, heightfield, sceneNode, sceneOutput } from '@forgeax/scene'
import { valleyElevation } from './generators/valley.generator.ts'

const world = basePlane({ width: 64, height: 64 })
const terrainData = valleyElevation({
  width: 32,
  height: 32,
  depth: 30,
  seed: 1234,
})

const field = heightfield({
  geometry: world,
  height: terrainData.heightGrid,
})
const terrain = sceneNode({
  name: 'ValleyTerrain',
  geometry: { kind: 'mesh', positions: [0, 0, 0, 8, 0, 0, 0, 8, 4], indices: [0, 1, 2] },
})
void field
sceneOutput({
  scene: addChild({ scene: emptyScene(), nodes: [terrain.scene] }).scene,
})
`

    // 5. Commit pure generator project
    const committed = await tools['scene:script.commitProject']({
      projectId,
      entryFile: 'main.scene.ts',
      files: [
        { file: 'main.scene.ts', source: sceneSource },
        { file: 'generators/valley.generator.ts', source: generatorSource },
      ],
    }, callerCtx) as {
      status: string
      projectRevision: string
      verification?: { ok?: boolean }
      executionStatus?: string
      pipeline?: { nodeCount: number; edgeCount: number }
    }

    expect(committed.status, JSON.stringify(committed)).toBe('ok')
    expect(committed.projectRevision).toBeTruthy()

    // 6. Execute summary to trigger full runtime graph compilation and battery execution
    const executed = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/execute/summary`,
      headers: {
        'x-forgeax-caller-kind': 'ai',
        'x-forgeax-caller-agent-id': 'sino-pure-generator',
        'x-forgeax-caller-session-id': 'session-pure-gen-1',
      },
      payload: { quietErrors: false },
    })

    expect(executed.statusCode, executed.body).toBe(200)
    const summary = executed.json() as {
      status: string
      executedRevision: string
      execFailures?: unknown[]
    }
    expect(summary.status).toBe('completed')
    expect(summary.executedRevision).toBe(committed.projectRevision)
    expect(summary.execFailures ?? []).toHaveLength(0)

    // 7. Verify project source retrieval
    const retrieved = await tools['scene:script.get']({
      projectId,
      file: 'generators/valley.generator.ts',
      force: true,
    }, { ...callerCtx, toolId: 'scene:script.get' }) as {
      manifest: { files: string[] }
      source: string
    }
    expect(retrieved.manifest.files).toContain('generators/valley.generator.ts')
    expect(retrieved.manifest.files).toContain('main.scene.ts')
    expect(retrieved.source).toContain('valleyElevation')

    // 8. Test polymorphic envelope unpack: generator returning { width, height, values } flat object
    const flatGeneratorSource = `import { defineGenerator } from '@forgeax/project-generator'

export const flatTerraceElevation = defineGenerator({
  id: 'flat-terrace',
  inputs: { size: 'number' },
  outputs: { heightfield: 'any' },
  run(ctx, args) {
    const size = 16
    const values: number[] = []
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        values.push((r + c) * 0.5)
      }
    }
    return {
      heightfield: {
        width: size,
        height: size,
        values,
      },
    }
  },
})
`
    const flatSceneSource = `// @scene-module-id flat.main
import { addChild, basePlane, createGrid, emptyScene, heightfield, sceneNode, sceneOutput } from '@forgeax/scene'
import { flatTerraceElevation } from './generators/flat-terrace.generator.ts'

const world = basePlane({ width: 16, height: 16 })
const data = flatTerraceElevation({ size: 16 })
void data.heightfield
const field = heightfield({
  geometry: world,
  height: createGrid({ columns: 16, rows: 16, fill: 1 }),
})
const terrain = sceneNode({
  name: 'FlatTerrace',
  geometry: { kind: 'mesh', positions: [0, 0, 0, 8, 0, 0, 0, 8, 2], indices: [0, 1, 2] },
})
void field
sceneOutput({ scene: addChild({ scene: emptyScene(), nodes: [terrain.scene] }).scene })
`

    const flatCommit = await tools['scene:script.commitProject']({
      projectId,
      entryFile: 'main.scene.ts',
      clean: true,
      files: [
        { file: 'main.scene.ts', source: flatSceneSource },
        { file: 'generators/flat-terrace.generator.ts', source: flatGeneratorSource },
      ],
    }, callerCtx) as {
      status: string
      projectRevision: string
      files?: string[]
    }

    expect(flatCommit.status, JSON.stringify(flatCommit)).toBe('ok')

    // Verify clean: true automatically pruned old generators/valley.generator.ts
    const checkDeleted = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/scene-script?file=generators/valley.generator.ts`,
      headers: {
        'x-forgeax-caller-kind': 'ai',
        'x-forgeax-caller-agent-id': 'sino-pure-generator',
        'x-forgeax-caller-session-id': 'session-pure-gen-1',
      },
    })
    expect(checkDeleted.statusCode).toBe(200)
    expect(checkDeleted.json().exists).toBe(false)

    const checkRetained = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/scene-script?file=generators/flat-terrace.generator.ts`,
      headers: {
        'x-forgeax-caller-kind': 'ai',
        'x-forgeax-caller-agent-id': 'sino-pure-generator',
        'x-forgeax-caller-session-id': 'session-pure-gen-1',
      },
    })
    expect(checkRetained.statusCode).toBe(200)
    expect(checkRetained.json().exists).toBe(true)

    const flatExec = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/execute/summary`,
      headers: {
        'x-forgeax-caller-kind': 'ai',
        'x-forgeax-caller-agent-id': 'sino-pure-generator',
        'x-forgeax-caller-session-id': 'session-pure-gen-1',
      },
      payload: { quietErrors: false },
    })
    expect(flatExec.statusCode, flatExec.body).toBe(200)
    const flatSummary = flatExec.json() as { status: string; execFailures?: unknown[] }
    expect(flatSummary.status).toBe('completed')
    expect(flatSummary.execFailures ?? []).toHaveLength(0)

    // 9. Test outline mode for scene:script.get
    const outlineGet = await tools['scene:script.get']({
      projectId,
      file: 'generators/flat-terrace.generator.ts',
      mode: 'outline',
      force: true,
    }, { ...callerCtx, toolId: 'scene:script.get' }) as {
      mode?: string
      source: string
      payload: string
    }
    expect(outlineGet.mode).toBe('outline')
    expect(outlineGet.source).toContain('export const flatTerraceElevation = defineGenerator')
    expect(outlineGet.source).toContain('inputs: { size: \'NumberValue\' }')
    expect(outlineGet.source).toContain('outputs: { heightfield: \'Any\' }')
    expect(outlineGet.source).toContain('omitted in outline mode')

    // 10. Test scene:authoring.lens symbol inspection on generator files
    const lensSymbols = await tools['scene:authoring.lens']({
      projectId,
      file: 'generators/flat-terrace.generator.ts',
      symbol: 'run',
    }, { ...callerCtx, toolId: 'scene:authoring.lens' }) as {
      kind: string
      target?: { name: string; span: { start: number; end: number }; snippet: string }
      symbols: Array<{ name: string; kind: string }>
    }
    expect(lensSymbols.kind).toBe('generator-module')
    expect(lensSymbols.symbols.some((s) => s.name === 'flatTerraceElevation')).toBe(true)
    expect(lensSymbols.target?.name).toBe('flatTerraceElevation.run')
    expect(lensSymbols.target?.snippet).toContain('run(ctx, args)')

    // 11. Test patch commit: modify generator run method in-place via patches without resending whole file
    const patchedRunSource = `run(ctx, args) {
    const size = 16
    const values: number[] = []
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        values.push((r * 2 + c * 2) * 0.5)
      }
    }
    return {
      heightfield: {
        width: size,
        height: size,
        values,
      },
    }
  }`
    const patchCommit = await tools['scene:script.commitProject']({
      projectId,
      entryFile: 'main.scene.ts',
      patches: [{
        file: 'generators/flat-terrace.generator.ts',
        targetSymbol: 'run',
        replaceSource: patchedRunSource,
      }],
    }, callerCtx) as {
      status: string
      projectRevision: string
      executionStatus?: string
      verification?: { ok: boolean }
    }
    expect(patchCommit.status).toBe('ok')
    expect(patchCommit.verification?.ok).toBe(true)

    // Verify the file was updated on disk with the patched code
    const updatedSource = await tools['scene:script.get']({
      projectId,
      file: 'generators/flat-terrace.generator.ts',
      force: true,
    }, { ...callerCtx, toolId: 'scene:script.get' }) as { source: string }
    expect(updatedSource.source).toContain('r * 2 + c * 2')
  }, 120_000)
})
