import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { applySceneSourceEdits, runSceneModule } from '@forgeax/scene'
import { createRuntime, getPipeline } from '@forgeax/node-runtime'

import { canonicalEmptySceneSource, readSceneModule, sceneRoot, writeSceneModule } from '../persist/store.js'
import { firstBatchImplementations } from './hostImplementations.js'
import { runSceneProject, sceneRunExecutedHash, writeTraceOutputs } from './runProject.js'

const here = dirname(fileURLToPath(import.meta.url))
const firstBatchExample = resolve(here, '../../../../examples/scene-script/first-batch-terrain')

const projects: string[] = []

afterEach(async () => {
  await Promise.all(projects.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('runSceneModule scene root', () => {
  it('loads the entry from projectDir/scene, not the project root', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'scene-run-root-'))
    projects.push(projectDir)
    await mkdir(join(projectDir, 'scene'), { recursive: true })
    await writeFile(
      join(projectDir, 'scene', 'main.scene.ts'),
      `import { basePlane } from '@forgeax/scene'\nexport const world = basePlane({ width: 12, height: 8 })\n`,
    )

    const missing = await runSceneModule({
      projectDir,
      entryFile: 'main.scene.ts',
      implementations: await firstBatchImplementations(),
    })
    expect(missing.diagnostics.some((item) => item.code === 'SCENE_SOURCE_MISSING')).toBe(true)
    expect(missing.files['main.scene.ts']).toBeUndefined()

    const ran = await runSceneModule({
      projectDir: sceneRoot(projectDir),
      entryFile: 'main.scene.ts',
      implementations: await firstBatchImplementations(),
    })
    expect(ran.diagnostics.some((item) => item.code === 'SCENE_SOURCE_MISSING')).toBe(false)
    expect(ran.files['main.scene.ts']).toContain('basePlane')
  })

  it('weaves a Heightfield packet into a SceneTree from the first-batch default scene', async () => {
    const ran = await runSceneModule({
      projectDir: firstBatchExample,
      entryFile: 'main.scene.ts',
      implementations: await firstBatchImplementations(),
    })
    expect(ran.diagnostics.filter((item) => item.severity === 'error')).toEqual([])
    expect(ran.ok).toBe(true)
    expect(ran.trace.some((call) => call.functionName === 'heightfieldMesh')).toBe(true)
    expect(ran.trace.some((call) => call.functionName === 'composeHeightfield')).toBe(false)
    const field = ran.trace.find((call) => call.functionName === 'heightfield')?.result as { type?: string; mask?: unknown } | undefined
    expect(field?.type).toBe('heightfield')
    expect(Array.isArray(field?.mask)).toBe(true)
    const woven = ran.trace.find((call) => call.functionName === 'heightfieldMesh')?.result as { kind?: string; positions?: number[]; indices?: number[] } | undefined
    expect(woven?.kind).toBe('mesh')
    expect((woven?.positions?.length ?? 0) > 0).toBe(true)
    expect((woven?.indices?.length ?? 0) > 0).toBe(true)
    expect(ran.trace.some((call) => call.functionName === 'sceneNode')).toBe(true)
    expect(ran.trace.some((call) => call.functionName === 'sceneOutput')).toBe(true)
    expect(ran.diagnostics.some((item) => item.code === 'SCENE_OUTPUT_INCOMPLETE')).toBe(false)
    expect(await readFile(join(firstBatchExample, 'main.scene.ts'), 'utf8')).toContain('from \'@forgeax/scene\'')
    const width = Object.values(ran.graph.nodes).find((node) => node.opId === 'number_const' && node.params.value === 120)
    expect(width).toBeDefined()
    expect(Object.values(ran.graph.edges).some((edge) => (
      edge.source.nodeId === width?.id && edge.target.port === 'width'
    ))).toBe(true)
    const sampled = (await firstBatchImplementations()).sampleHeight({ heightfield: field, x: 60, y: 40 }) as { z: number | null }
    expect(sampled.z).toEqual(expect.any(Number))
  })
})

describe('writeTraceOutputs', () => {
  it('persists intermediate Grids as deferred stubs and keeps Heightfield / mesh eager', () => {
    const written: Array<{ nodeId: string; port: string; rec: Record<string, unknown> }> = []
    const runtime = {
      outputs: {
        write(nodeId: string, port: string, rec: Record<string, unknown>) {
          written.push({ nodeId, port, rec })
        },
      },
    }
    writeTraceOutputs(runtime as never, [
      { id: 'n-grid', functionName: 'createGrid', args: {}, result: [[1, 2], [3, 4]] },
      { id: 'n-mask', functionName: 'geometryMask', args: {}, result: [[1, 0], [0, 1]] },
      {
        id: 'n-field',
        functionName: 'heightfield',
        args: {},
        result: { type: 'heightfield', height: [[1, 2], [3, 4]] },
      },
      {
        id: 'n-mesh',
        functionName: 'heightfieldMesh',
        args: {},
        result: { kind: 'mesh', positions: [0, 0, 1], indices: [0, 1, 2] },
      },
    ] as never, 'hash-1')
    const grid = written.find((item) => item.nodeId === 'n-grid')
    const mask = written.find((item) => item.nodeId === 'n-mask')
    const field = written.find((item) => item.nodeId === 'n-field')
    const mesh = written.find((item) => item.nodeId === 'n-mesh')
    expect(JSON.stringify(grid?.rec.data)).toContain('"deferred":true')
    expect(JSON.stringify(mask?.rec.data)).toContain('"deferred":true')
    expect(JSON.stringify(field?.rec.data)).not.toContain('"deferred":true')
    expect(JSON.stringify(mesh?.rec.data)).not.toContain('"deferred":true')
    expect(mesh?.rec.type).toBe('geometry')
  })
})

describe('runSceneProject lastGood', () => {
  it('projects an unwired heightfield instead of reusing the previous empty graph', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'scene-run-lastgood-'))
    projects.push(projectDir)
    const projectId = 'drop-heightfield'
    await writeSceneModule(projectDir, 'main.scene.ts', canonicalEmptySceneSource(projectId), [])
    const runtime = createRuntime({
      projectRoot: projectDir,
      pipelineId: projectId,
      pluginId: 'scene-test',
    })

    const empty = await runSceneProject({
      projectId,
      projectDir,
      runtime,
      persistProjection: false,
    })
    expect(empty.reusedLastGood).toBe(false)
    expect(Object.values(empty.graph.nodes).some((node) => node.opId === 'heightfield')).toBe(false)

    const stored = await readSceneModule(projectDir)
    const written = applySceneSourceEdits(stored.source, [{
      type: 'insertCall',
      functionName: 'heightfield',
      id: 'canvas-minted-heightfield',
      binding: 'field',
      args: {},
    }], stored.file)
    expect(written.diagnostics).toEqual([])
    await writeSceneModule(projectDir, stored.file, written.source, [])

    const dropped = await runSceneProject({
      projectId,
      projectDir,
      runtime,
      persistProjection: false,
    })
    expect(dropped.reusedLastGood).toBe(false)
    expect(dropped.trace.some((call) => call.functionName === 'heightfield')).toBe(true)
    expect(dropped.graph.nodes['canvas-minted-heightfield']?.opId).toBe('heightfield')
    expect(dropped.diagnostics.some((item) => item.code === 'SCENE_HOST_FAILED')).toBe(true)
  })

  it('reorders leftover TDZ and projects the three calls from source', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'scene-run-tdz-'))
    projects.push(projectDir)
    const projectId = 'repair-tdz-source'
    await writeSceneModule(
      projectDir,
      'main.scene.ts',
      `import { heightfield, createGrid, basePlane } from '@forgeax/scene'
const field = heightfield({ geometry: world.geometry })
const grid = createGrid({})
const world = basePlane({})
`,
      [],
    )
    const runtime = createRuntime({
      projectRoot: projectDir,
      pipelineId: projectId,
      pluginId: 'scene-test',
      layout: { persistGraph: false },
    })
    const ran = await runSceneProject({ projectId, projectDir, runtime })
    const stored = await readSceneModule(projectDir)
    expect(stored.source.indexOf('const world = basePlane')).toBeLessThan(stored.source.indexOf('const field = heightfield'))
    expect(Object.values(ran.graph.nodes).some((node) => node.opId === 'base_plane')).toBe(true)
    expect(Object.values(ran.graph.nodes).some((node) => node.opId === 'create_grid')).toBe(true)
    expect(Object.values(ran.graph.nodes).some((node) => node.opId === 'heightfield')).toBe(true)
    expect(Object.keys(getPipeline(runtime)?.nodes ?? {}).length).toBeGreaterThanOrEqual(3)
  })

  it('replaces a leftover canvas when this source has no host calls', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'scene-run-empty-wipe-'))
    projects.push(projectDir)
    const projectId = 'keep-canvas-on-empty-run'
    await writeSceneModule(
      projectDir,
      'main.scene.ts',
      `throw new Error('source cannot record any host call')\n`,
      [],
    )
    const runtime = createRuntime({
      projectRoot: projectDir,
      pipelineId: projectId,
      pluginId: 'scene-test',
      layout: { persistGraph: false },
    })
    const { importDisplayGraphIncrementally } = await import('../display/runtimeImport.js')
    await importDisplayGraphIncrementally(runtime, {
      nodes: {
        'keep-me': {
          id: 'keep-me',
          opId: 'base_plane',
          name: 'world',
          position: { x: 0, y: 0 },
          params: {},
        },
      },
      edges: {},
    }, { actor: 'test', label: 'seed canvas' })
    expect(getPipeline(runtime)?.nodes['keep-me']?.opId).toBe('base_plane')

    const failed = await runSceneProject({
      projectId,
      projectDir,
      runtime,
    })
    expect(failed.reusedLastGood).toBe(false)
    expect(failed.trace).toHaveLength(0)
    expect(getPipeline(runtime)?.nodes['keep-me']).toBeUndefined()
  })

  it('clears leftover canvas nodes when .scene.ts has no calls', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'scene-run-clear-ghosts-'))
    projects.push(projectDir)
    const projectId = 'clear-ghosts'
    await writeSceneModule(
      projectDir,
      'main.scene.ts',
      `import { heightfield, createGrid, basePlane } from '@forgeax/scene'\n`,
      [],
    )
    const runtime = createRuntime({
      projectRoot: projectDir,
      pipelineId: projectId,
      pluginId: 'scene-test',
      layout: { persistGraph: false },
    })
    const { importDisplayGraphIncrementally } = await import('../display/runtimeImport.js')
    await importDisplayGraphIncrementally(runtime, {
      nodes: {
        'node-ghost': {
          id: 'node-ghost',
          opId: 'heightfield',
          name: 'field',
          position: { x: 0, y: 0 },
          params: {},
        },
      },
      edges: {},
    }, { actor: 'test', label: 'ghost canvas' })
    expect(getPipeline(runtime)?.nodes['node-ghost']?.opId).toBe('heightfield')

    await runSceneProject({ projectId, projectDir, runtime })
    expect(getPipeline(runtime)?.nodes['node-ghost']).toBeUndefined()
  })

  it('keeps an unused named number on the canvas after the last host call is gone', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'scene-run-unused-n-'))
    projects.push(projectDir)
    const projectId = 'unused-number'
    await writeSceneModule(
      projectDir,
      'main.scene.ts',
      `import { createGrid } from '@forgeax/scene'

// @scene-id n
const n = 16

// @scene-id grid
const grid = createGrid({ columns: n, rows: n })
`,
      [],
    )
    const runtime = createRuntime({
      projectRoot: projectDir,
      pipelineId: projectId,
      pluginId: 'scene-test',
      layout: { persistGraph: false },
    })
    const seeded = await runSceneProject({ projectId, projectDir, runtime })
    expect(seeded.graph.nodes.n?.opId).toBe('number_const')
    expect(Object.values(seeded.graph.nodes).some((node) => node.opId === 'create_grid')).toBe(true)

    const stored = await readSceneModule(projectDir)
    const written = applySceneSourceEdits(stored.source, [{ type: 'removeCall', id: 'grid' }], stored.file)
    expect(written.diagnostics).toEqual([])
    expect(written.source).toContain('const n = 16')
    await writeSceneModule(projectDir, stored.file, written.source, [])

    const leftover = await runSceneProject({ projectId, projectDir, runtime })
    expect(leftover.reusedLastGood).toBe(false)
    expect(leftover.graph.nodes.n?.opId).toBe('number_const')
    expect(leftover.graph.nodes.n?.params).toEqual(expect.objectContaining({ value: 16 }))
    expect(leftover.graph.nodes.grid).toBeUndefined()
    expect(getPipeline(runtime)?.nodes.n?.opId).toBe('number_const')
    expect(getPipeline(runtime)?.nodes.grid).toBeUndefined()
  })
})

describe('sceneRunExecutedHash', () => {
  it('changes when only a number literal moves the plane', () => {
    const before = [
      'import { basePlane, heightfield, point2d, valueNoise } from \'@forgeax/scene\'',
      'const n4 = 0',
      'const site = point2d({ x: 0, y: n4 })',
      'const world = basePlane({ origin: site.geometry })',
      'const field = heightfield({ geometry: world.geometry, height: valueNoise({ columns: 8, rows: 8 }).grid })',
    ].join('\n')
    const after = before.replace('const n4 = 0', 'const n4 = 9')
    expect(sceneRunExecutedHash(after)).not.toBe(sceneRunExecutedHash(before))
  })
})
