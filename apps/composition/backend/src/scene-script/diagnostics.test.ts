import { describe, expect, it } from 'vitest'

import {
  collectSceneExecutionDiagnostics,
  executionOutputDiagnostics,
  executionResultDiagnostics,
  isActualGridStretch,
} from './diagnostics.js'

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
      failures: [{ nodeId: 'runtime-grid', message: 'createGrid requires columns > 0' }],
      error: { nodeId: 'runtime-grid', message: 'createGrid requires columns > 0' },
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
      ],
      bakedLayers: [],
      summary: { sceneNodeCount: 1, bakedLayerCount: 0, payload: 'reference-only' },
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

  it('keeps every runtime failure, not a 3-item cap', () => {
    const diagnostics = executionResultDiagnostics({
      executionId: 'exec-many',
      status: 'error',
      outputs: {},
      failures: [
        { nodeId: 'a', message: 'one' },
        { nodeId: 'b', message: 'two' },
        { nodeId: 'c', message: 'three' },
        { nodeId: 'd', message: 'four' },
      ],
      durationMs: 1,
    }, [])
    expect(diagnostics).toHaveLength(4)
  })
})

describe('collectSceneExecutionDiagnostics', () => {
  it('keeps host errors and warnings instead of dropping them', () => {
    const collected = collectSceneExecutionDiagnostics({
      executionId: 'exec-host',
      status: 'error',
      outputs: {},
      failures: [{ nodeId: 'canvas-minted-heightfield', message: 'heightfield: heightfield requires a Geometry plane and a height Grid' }],
      durationMs: 1,
    }, [], [], [{
      code: 'SCENE_HOST_FAILED',
      phase: 'execute',
      severity: 'error',
      message: 'heightfield: heightfield requires a Geometry plane and a height Grid',
      statementId: 'canvas-minted-heightfield',
      graph: { authoringNodeId: 'canvas-minted-heightfield', runtimeNodeIds: ['canvas-minted-heightfield'] },
    }, {
      code: 'SCENE_OUTPUT_INCOMPLETE',
      phase: 'execute',
      severity: 'warning',
      message: 'Entry finished without sceneOutput',
    }])
    expect(collected.map((item) => item.code)).toEqual([
      'SCENE_HOST_FAILED',
      'SCENE_OUTPUT_INCOMPLETE',
    ])
  })
})

describe('executionOutputDiagnostics', () => {
  it('lifts SCENE_GRID_STRETCH from heightfield stretch metrics', () => {
    const diagnostics = executionOutputDiagnostics({
      executionId: 'exec-stretch',
      status: 'completed',
      outputs: {
        'runtime-grid': {
          heightfield: [{
            path: [],
            items: [{
              stretch: [{ code: 'SCENE_GRID_STRETCH', columns: 8, rows: 4, planeWidth: 120, planeHeight: 40 }],
            }],
          }],
        },
      },
      durationMs: 1,
    }, sourceMap)
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'SCENE_GRID_STRETCH',
        severity: 'warning',
        statementId: 'grid',
      }),
    ])
  })

  it('does not lift isotropic SCENE_GRID_STRETCH metrics', () => {
    expect(isActualGridStretch({
      code: 'SCENE_GRID_STRETCH',
      columns: 16,
      rows: 16,
      planeWidth: 10,
      planeHeight: 10,
      stretchRatio: 1,
      anisotropic: false,
    })).toBe(false)
    const diagnostics = executionOutputDiagnostics({
      executionId: 'exec-square',
      status: 'completed',
      outputs: {
        'runtime-grid': {
          heightfield: [{
            path: [],
            items: [{
              stretch: {
                code: 'SCENE_GRID_STRETCH',
                columns: 16,
                rows: 16,
                planeWidth: 10,
                planeHeight: 10,
                stretchRatio: 1,
                anisotropic: false,
                message: 'Height grid 16×16 covers plane 10.0×10.0 m; stretch ratio 1.000',
              },
            }],
          }],
        },
      },
      durationMs: 1,
    }, sourceMap)
    expect(diagnostics).toEqual([])
  })
})
