import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { applySceneSourceEdits } from '@forgeax/scene'
import { createRuntime, getPipeline } from '@forgeax/node-runtime'

import { canonicalEmptySceneSource, ensureCanonicalSceneProject, writeSceneModule } from '../persist/store.js'
import { hydrateRuntimeGraphFromScene } from './hydrateRuntimeGraph.js'
import { clearSceneProjection, noteSceneProjection } from './projectionRevision.js'

const projects: string[] = []

afterEach(async () => {
  await Promise.all(projects.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('hydrateRuntimeGraphFromScene', () => {
  it('projects .scene.ts onto an empty in-memory graph that already exists()', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'scene-hydrate-'))
    projects.push(projectDir)
    const projectId = 'hydrate-from-source'
    clearSceneProjection(projectId)

    const seed = applySceneSourceEdits(canonicalEmptySceneSource(projectId), [
      { type: 'insertCall', functionName: 'basePlane', id: 'canvas-world', binding: 'world', args: { width: 12, height: 8 } },
      { type: 'insertCall', functionName: 'heightfield', id: 'canvas-field', binding: 'field', args: {} },
    ], 'main.scene.ts')
    expect(seed.diagnostics).toEqual([])
    await writeSceneModule(projectDir, 'main.scene.ts', seed.source, [])

    const runtime = createRuntime({
      projectRoot: projectDir,
      pipelineId: projectId,
      pluginId: 'scene-test',
      layout: { persistGraph: false },
    })
    runtime.graph.hydrate({
      schemaVersion: 1,
      id: projectId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodes: {},
      edges: {},
    })
    expect(runtime.graph.exists()).toBe(true)
    expect(Object.keys(getPipeline(runtime)?.nodes ?? {})).toHaveLength(0)

    await hydrateRuntimeGraphFromScene({ projectId, projectDir, runtime })

    const nodes = getPipeline(runtime)?.nodes ?? {}
    expect(nodes['canvas-world']?.opId).toBe('base_plane')
    expect(nodes['canvas-world']?.name).toBe('basePlane')
    expect(nodes['canvas-field']?.opId).toBe('heightfield')
    expect(nodes['canvas-field']?.name).toBe('heightfield')
  })

  it('projects a leftover named number even when this revision was marked projected onto an empty canvas', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'scene-hydrate-n-'))
    projects.push(projectDir)
    const projectId = 'hydrate-unused-number'
    clearSceneProjection(projectId)

    await writeSceneModule(
      projectDir,
      'main.scene.ts',
      `import { createGrid } from '@forgeax/scene'

// @scene-id n
const n = 16
`,
      [],
    )

    const runtime = createRuntime({
      projectRoot: projectDir,
      pipelineId: projectId,
      pluginId: 'scene-test',
      layout: { persistGraph: false },
    })
    runtime.graph.hydrate({
      schemaVersion: 1,
      id: projectId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodes: {},
      edges: {},
    })

    const stored = await ensureCanonicalSceneProject(projectDir, projectId)
    noteSceneProjection(projectId, stored.projectRevision ?? stored.revision)

    await hydrateRuntimeGraphFromScene({ projectId, projectDir, runtime })

    expect(getPipeline(runtime)?.nodes.n?.opId).toBe('number_const')
    expect(getPipeline(runtime)?.nodes.n?.params).toEqual(expect.objectContaining({ value: 16 }))
    expect(getPipeline(runtime)?.nodes.n?.name).toBe('n')

    await writeSceneModule(projectDir, 'main.scene.ts', '// @scene-id n\nconst count = 16\n', [])
    await hydrateRuntimeGraphFromScene({ projectId, projectDir, runtime })
    expect(getPipeline(runtime)?.nodes.n?.name).toBe('count')
    expect(getPipeline(runtime)?.nodes.n?.params.value).toBe(16)
  })
})
