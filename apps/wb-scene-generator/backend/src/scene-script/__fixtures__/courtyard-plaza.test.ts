import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { compileStoredSceneProject } from '../compile/projectCompiler.js'
import { projectSinoContractCatalog } from '../contracts/agentContractCatalog.js'
import { getSceneContractRegistry } from '../contracts/contracts.js'
import { executionResultDiagnostics } from '../diagnostics.js'

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), 'courtyard-plaza')
const projects: string[] = []

afterEach(async () => {
  await Promise.all(projects.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function loadFixture(relative: string): Promise<string> {
  return readFile(join(fixtureRoot, relative), 'utf8')
}

async function fixtureSources(): Promise<Record<string, string>> {
  return {
    'main.scene.ts': await loadFixture('main.scene.ts'),
    'generators/grow-plot.generator.ts': await loadFixture('generators/grow-plot.generator.ts'),
    'generators/solve-courtyard.generator.ts': await loadFixture('generators/solve-courtyard.generator.ts'),
    'generators/regions.generator.ts': await loadFixture('generators/regions.generator.ts'),
  }
}

describe('courtyard-plaza architecture fixture', () => {
  it('compiles Plane→WorkGrid, repeat, choose, and discloses the project Generator', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'courtyard-plaza-'))
    projects.push(projectDir)
    const sources = await fixtureSources()
    const result = await compileStoredSceneProject(projectDir, {
      entryFile: 'main.scene.ts',
      entrySource: sources['main.scene.ts']!,
      sourceOverrides: sources,
      projectId: 'courtyard-plaza',
      registry: await getSceneContractRegistry(),
    })

    const errors = result.diagnostics.filter((item) => item.severity === 'error')
    expect(errors).toEqual([])
    expect(result.compiled.ops).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'createNode', opId: 'base_plane' }),
      expect.objectContaining({ type: 'createNode', opId: 'work_grid' }),
      expect.objectContaining({ type: 'createNode', opId: 'scene_choose' }),
      expect.objectContaining({ type: 'createNode', opId: 'toggle' }),
      expect.objectContaining({ type: 'createNode', opId: 'local/grow-plot' }),
      expect.objectContaining({ type: 'createNode', opId: 'local/solve-courtyard' }),
      expect.objectContaining({ type: 'createGroup' }),
    ]))
    expect(result.compiled.ops.filter((op) => op.type === 'createNode' && op.opId === 'local/grow-plot')).toHaveLength(2)

    const catalog = projectSinoContractCatalog(result.registry.list(), { mode: 'summary' })
    expect(catalog.functions.some((item) => item.functionName === 'basePlane')).toBe(true)
    expect(catalog.functions.some((item) => item.functionName === 'workGrid')).toBe(true)
    expect(catalog.functions.some((item) => item.functionName === 'booleanValue')).toBe(true)
    expect(catalog.functions).toEqual(expect.arrayContaining([
      expect.objectContaining({ functionName: 'solveCourtyard', category: 'project-generator' }),
      expect.objectContaining({ functionName: 'growPlot', category: 'project-generator' }),
    ]))
    expect(catalog.functions.some((item) => item.functionName === 'cellularNoise')).toBe(false)
    expect(JSON.stringify(catalog)).not.toContain('bundle')
  })

  it('rejects a RegionSet wired into workGrid.plane with a stable protocol diagnostic', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'courtyard-mismatch-'))
    projects.push(projectDir)
    const sources = await fixtureSources()
    const mismatched = `// @scene-module-id module.courtyardMismatch
import { courtyardRegions } from "./generators/regions.generator.ts"
const regions = courtyardRegions({})
const grid = workGrid({ plane: regions.value })
`
    const result = await compileStoredSceneProject(projectDir, {
      entryFile: 'main.scene.ts',
      entrySource: mismatched,
      sourceOverrides: { ...sources, 'main.scene.ts': mismatched },
      projectId: 'courtyard-mismatch',
      registry: await getSceneContractRegistry(),
    })
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'SCENE_TYPE_PROTOCOL_MISMATCH',
        expected: { type: 'any', runtimeType: 'plane' },
        actual: { type: 'any', runtimeType: 'region-set' },
      }),
    ]))
    expect(result.diagnostics.find((item) => item.code === 'SCENE_TYPE_PROTOCOL_MISMATCH')?.repairSlip)
      .toContain('How to fix:')
  })

  it('maps a local Generator execution failure back to the authored call and scene node ids', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'courtyard-execute-'))
    projects.push(projectDir)
    const sources = await fixtureSources()
    const result = await compileStoredSceneProject(projectDir, {
      entryFile: 'main.scene.ts',
      entrySource: sources['main.scene.ts']!,
      sourceOverrides: sources,
      projectId: 'courtyard-execute',
      registry: await getSceneContractRegistry(),
    })
    const source = result.compiled.sourceMap.find((item) =>
      result.compiled.ops.some((op) =>
        op.type === 'createNode'
        && op.opId === 'local/solve-courtyard'
        && item.runtimeNodeIds.includes(op.nodeId)))
    expect(source?.file).toBe('main.scene.ts')
    const runtimeNodeId = source?.runtimeNodeIds[0]
    expect(runtimeNodeId).toBeTruthy()
    const diagnostics = executionResultDiagnostics({
      executionId: 'exec-courtyard',
      status: 'error',
      outputs: {},
      failures: [{ nodeId: runtimeNodeId, message: 'courtyard solver rejected the work grid' }],
      error: { nodeId: runtimeNodeId, message: 'courtyard solver rejected the work grid' },
      durationMs: 1,
    }, result.compiled.sourceMap, [{
      lineageId: 'result:courtyard',
      runtime: { nodeId: runtimeNodeId!, port: 'scene' },
      authoring: {
        moduleId: source!.moduleId,
        file: source!.file,
        statementId: source!.statementId,
        entityId: source!.entityId,
        source: source!.source,
      },
      sceneNodes: [{ id: 'courtyard-root', path: '/Courtyard', graphIndex: 0 }],
      bakedLayers: [],
      summary: { sceneNodeCount: 1, bakedLayerCount: 0, payload: 'reference-only' },
    }])
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'SCENE_EXECUTE_NODE',
        phase: 'execute',
        statementId: source?.statementId,
        graph: expect.objectContaining({
          runtimeNodeIds: [runtimeNodeId],
          sceneNodeIds: ['courtyard-root'],
        }),
      }),
    ])
    expect(JSON.stringify(diagnostics)).not.toContain('stack')
    expect(diagnostics[0]?.repairSlip).toContain('How to fix:')
  })
})
