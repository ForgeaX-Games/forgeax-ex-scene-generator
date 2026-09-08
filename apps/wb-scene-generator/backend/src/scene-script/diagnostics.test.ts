import { describe, expect, it } from 'vitest'

import { executionResultDiagnostics } from './diagnostics.js'

const sourceMap = [{
  moduleId: 'main',
  file: 'main.scene.ts',
  statementId: 'grid',
  source: { file: 'main.scene.ts', start: 20, end: 50, line: 2, column: 1, statementId: 'grid' },
  entityId: 'entity-grid',
  runtimeNodeIds: ['runtime-grid'],
  runtimeEdgeIds: [],
}] as const

describe('executionResultDiagnostics', () => {
  it('projects bounded runtime failures to the authored statement without a stack', () => {
    const diagnostics = executionResultDiagnostics({
      executionId: 'exec-1',
      status: 'error',
      outputs: {},
      failures: [{ nodeId: 'runtime-grid', message: 'workGrid requires a Plane' }],
      error: { nodeId: 'runtime-grid', message: 'workGrid requires a Plane' },
      durationMs: 1,
    }, sourceMap, [{
      lineageId: 'result:grid',
      runtime: { nodeId: 'runtime-grid', port: 'scene' },
      authoring: {
        moduleId: 'main',
        file: 'main.scene.ts',
        statementId: 'grid',
        entityId: 'entity-grid',
        source: { file: 'main.scene.ts', start: 20, end: 50, line: 2, column: 1, statementId: 'grid' },
      },
      sceneNodes: [
        { id: 'shared', path: '/Terrain', graphIndex: 0 },
        { id: 'shared', path: '/Road', graphIndex: 1 },
      ],
      bakedLayers: [],
      summary: { sceneNodeCount: 2, bakedLayerCount: 0, payload: 'reference-only' },
    }])

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'SCENE_EXECUTE_NODE',
        phase: 'execute',
        statementId: 'grid',
        graph: expect.objectContaining({
          authoringNodeId: 'grid',
          runtimeNodeIds: ['runtime-grid'],
          sceneNodeIds: ['shared'],
        }),
      }),
    ])
    expect(diagnostics[0]?.repairSlip).toContain('How to fix:')
    expect(JSON.stringify(diagnostics)).not.toContain('stack')
  })

  it('keeps the authored pointer without sceneNodeIds when lineage is absent', () => {
    const diagnostics = executionResultDiagnostics({
      executionId: 'exec-2',
      status: 'error',
      outputs: {},
      failures: [{ nodeId: 'runtime-grid', message: 'failed' }],
      durationMs: 1,
    }, sourceMap)
    expect(diagnostics[0]?.graph?.sceneNodeIds).toBeUndefined()
    expect(diagnostics[0]?.graph?.runtimeNodeIds).toEqual(['runtime-grid'])
  })
})
