import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import type { ExecutionResult } from '@forgeax/node-runtime'
import type { SourceMapEntry } from '@forgeax/scene-authoring'
import {
  addChildren,
  emptyScene,
  makeScenePort,
} from '../../../../vendor/dist/shared/types/scene/index.js'
import { attachBakedLayers, buildExecutionLineage, queryResultLineage } from './lineage.js'
import { readAuthoringState, writeResultLineage, writeSceneModule } from '../persist/store.js'

const temporary: string[] = []
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

const sourceMap: SourceMapEntry[] = [{
  moduleId: 'scene.main',
  file: 'main.scene.ts',
  statementId: 'stmt.atomic',
  source: { file: 'main.scene.ts', start: 10, end: 30, line: 2, column: 1, statementId: 'stmt.atomic' },
  entityId: 'runtime.group',
  runtimeNodeIds: ['runtime.group', 'runtime.inner'],
  runtimeEdgeIds: ['edge.a'],
  runtimeOrigins: { 'runtime.group': 'template.root', 'runtime.inner': 'template.inner' },
  definitionId: 'definition.house',
  definitionVersion: '1',
  instancePath: 'runtime.group',
}]

function result(value: unknown): ExecutionResult {
  return {
    executionId: 'execution-1',
    status: 'completed',
    outputs: { 'runtime.inner': { scene: value } },
    resultMetadata: {
      'runtime.inner': {
        scene: {
          producerNodeId: 'runtime.inner',
          producerPort: 'scene',
          outputType: 'scene',
          value: { inline: true },
        },
      },
    },
    durationMs: 1,
  }
}

describe('result lineage', () => {
  it('indexes nested and multiple SceneGraph nodes without payloads', () => {
    let first = emptyScene()
    const parents = addChildren(first.graph, first.focus, [{ name: 'House' }, { name: 'Garden' }])
    first = { graph: parents.graph, focus: first.focus }
    const nested = addChildren(first.graph, parents.ids[0]!, [{ name: 'Roof' }])
    const second = emptyScene()
    const tower = addChildren(second.graph, second.focus, [{ name: 'Tower' }])
    const wire = [{
      path: [0],
      items: [
        makeScenePort(nested.graph, first.focus),
        makeScenePort(tower.graph, second.focus),
      ],
    }]

    const lineage = buildExecutionLineage(result(wire), sourceMap, () => undefined)

    expect(lineage).toHaveLength(1)
    expect(lineage[0]?.authoring.runtimeOrigin).toBe('template.inner')
    expect(lineage[0]?.sceneNodes.map((node) => node.path)).toEqual([
      '/',
      '/Garden',
      '/House',
      '/House/Roof',
      '/',
      '/Tower',
    ])
    expect(lineage[0]?.summary).toEqual({
      sceneNodeCount: 6,
      bakedLayerCount: 0,
      payload: 'reference-only',
    })
    expect(JSON.stringify(lineage)).not.toContain('items')
    expect(JSON.stringify(lineage)).not.toContain('cells')
  })

  it('attaches baked layer references by source path', () => {
    const base = [{
      ...buildExecutionLineage(result(undefined), sourceMap, () => undefined)[0]!,
      sceneNodes: [{ id: 'scene.house', path: '/House' }],
    }]
    const next = attachBakedLayers(base, [{ sourcePath: '/House', bakedPath: '/House 2' }])
    expect(next[0]?.bakedLayers).toEqual([{
      id: '/House 2',
      path: '/House 2',
      sourceSceneNodeId: 'scene.house',
      sourceScenePath: '/House',
      cellSource: { kind: 'scene-node-content', ref: 'scene-node:scene.house/content' },
    }])
    expect(next[0]?.summary.bakedLayerCount).toBe(1)
  })

  it('persists bounded lineage across a state refresh', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'scene-lineage-'))
    temporary.push(projectDir)
    await writeSceneModule(projectDir, 'main.scene.ts', 'const x = 1\n', sourceMap)
    const lineage = buildExecutionLineage(result(undefined), sourceMap, () => undefined)
    await writeResultLineage(projectDir, lineage)

    expect((await readAuthoringState(projectDir))?.resultLineage).toEqual(lineage)
    expect(await readFile(join(projectDir, 'state', 'authoring.json'), 'utf8')).toContain('"payload": "reference-only"')
  })

  it('returns no lineage for an unknown id', () => {
    const lineage = buildExecutionLineage(result(undefined), sourceMap, () => undefined)
    expect(queryResultLineage(lineage, { sceneNodeId: 'unknown' })).toEqual([])
    expect(queryResultLineage(lineage, { bakedLayerId: 'unknown' })).toEqual([])
  })
})
