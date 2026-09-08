import { describe, expect, it } from 'vitest'

import type { SceneResultLineage, SceneScriptDiagnostic } from '../../api/HttpApiClient.js'
import { useRenderStore } from '../../renderer/store.js'
import {
  focusSceneScriptDiagnostic,
  registerSceneScriptDiagnosticDisplayIndex,
  sceneNodePointersForDiagnostic,
} from '../sceneScriptDiagnosticBridge.js'

const diagnostic: SceneScriptDiagnostic = {
  code: 'SCENE_EXECUTE_NODE',
  phase: 'execute',
  severity: 'error',
  message: 'failed',
  graph: {
    authoringNodeId: 'stmt.road',
    runtimeNodeIds: ['runtime.road'],
    sceneNodeIds: ['shared'],
  },
}

const lineage: SceneResultLineage[] = [{
  lineageId: 'result:road',
  runtime: { nodeId: 'runtime.road', port: 'scene' },
  authoring: {
    moduleId: 'main',
    file: 'main.scene.ts',
    statementId: 'stmt.road',
    entityId: 'entity.road',
    source: { file: 'main.scene.ts', start: 0, end: 10, line: 1, column: 1 },
  },
  sceneNodes: [
    { id: 'shared', path: '/Terrain', graphIndex: 0 },
    { id: 'shared', path: '/Road', graphIndex: 1 },
    { id: 'other', path: '/Ignored', graphIndex: 1 },
  ],
  bakedLayers: [],
  summary: { sceneNodeCount: 3, bakedLayerCount: 0, payload: 'reference-only' },
}]

describe('sceneScriptDiagnosticBridge', () => {
  it('joins bounded diagnostic ids to lineage path and graph index references', () => {
    expect(sceneNodePointersForDiagnostic(diagnostic, lineage)).toEqual([
      { id: 'shared', path: '/Terrain', graphIndex: 0 },
      { id: 'shared', path: '/Road', graphIndex: 1 },
    ])
    expect(JSON.stringify(sceneNodePointersForDiagnostic(diagnostic, lineage))).not.toContain('content')
  })

  it('degrades safely when no lineage entry matches', () => {
    expect(sceneNodePointersForDiagnostic(
      { ...diagnostic, graph: { sceneNodeIds: ['unknown'] } },
      lineage,
    )).toEqual([])
  })

  it('focuses a resolved drawable through the existing stage selection bridge', () => {
    useRenderStore.getState().reset()
    registerSceneScriptDiagnosticDisplayIndex({
      drawables: [{
        id: 'road',
        schema: 'road',
        source: 'mesh',
        layerKey: 'runtime.road:mesh',
        path: '/Road',
        label: 'Road',
        sceneNodeId: 'shared',
        graphIndex: 1,
      }],
    })
    expect(focusSceneScriptDiagnostic(diagnostic, lineage)).toBe('runtime.road:mesh')
    expect(useRenderStore.getState().selectedEditorNodeIds).toEqual(['runtime.road:mesh'])
  })
})
