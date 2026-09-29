import { describe, expect, it } from 'vitest'
import { applySpatialVerification, summarizeExecutionResult } from '../src/execution-summary.js'
import {
  emptyGraph,
  ensurePath,
  makeScenePort,
  setContent,
  volumeFromCells,
  ROOT_ID,
  type Cell,
  type NodeId,
  type ScenePortValue,
  type SceneGraph,
} from '../../vendor/dist/shared/types/index.js'

// Build a fake scene graph with a heavy cell list so we can assert the summary
// strips it down to a count instead of carrying the voxel payload.
function bigCells(n: number): Cell[] {
  return Array.from({ length: n }, (_, i) => ({ x: i, y: 0, z: 0, token: 'wall' }))
}

function putContent(graph: SceneGraph, rootId: NodeId, relPath: string, cells: readonly Cell[]): { graph: SceneGraph; id: NodeId } {
  const segs = relPath.split('/').filter(Boolean)
  const { graph: g1, id } = ensurePath(graph, rootId, segs)
  return { graph: cells.length > 0 ? setContent(g1, id, volumeFromCells(cells)) : g1, id }
}

// Mirrors the old fixture's shape:
//   '' (50 cells) -> block_ground (1600 cells) -> architecture_0 (200 cells), rest (0 cells)
function makeSceneTreePort(): ScenePortValue {
  let g = emptyGraph()
  const root = putContent(g, ROOT_ID, '', bigCells(50))
  g = root.graph
  const blockGround = putContent(g, ROOT_ID, 'block_ground', bigCells(1600))
  g = blockGround.graph
  g = putContent(g, blockGround.id, 'architecture_0', bigCells(200)).graph
  g = ensurePath(g, blockGround.id, ['rest']).graph
  return makeScenePort(g, ROOT_ID)
}

function makeMeshTreePort(): ScenePortValue {
  const { graph, id } = ensurePath(emptyGraph(), ROOT_ID, ['terrain'])
  const withMesh = setContent(graph, id, {
    schema: 'mesh',
    mesh: {
      positions: [0, 0, 0, 10, 0, 0, 0, 10, 2],
      indices: [0, 1, 2],
    },
  } as any)
  return makeScenePort(withMesh, ROOT_ID)
}

const fullResult = {
  executionId: 'exec_1',
  status: 'completed' as const,
  durationMs: 1234,
  outputs: {
    g_arch: {
      // scene port: DataTreeEntry[] whose items are ScenePortValue { graph, focus }
      out_0: [
        {
          path: [0],
          items: [makeSceneTreePort()],
        },
      ],
      // string port: small scalar should pass through
      out_1: [{ path: [0], items: ['石路'] }],
    },
    size_node: {
      // number port
      value: [{ path: [0], items: [50] }],
    },
  },
}

describe('summarizeExecutionResult', () => {
  it('strips full voxel cells but keeps status, child names and cell counts', () => {
    const summary = summarizeExecutionResult(fullResult) as Record<string, any>

    // status / executionId / durationMs preserved verbatim — sino judges on these.
    expect(summary.status).toBe('completed')
    expect(summary.executionId).toBe('exec_1')
    expect(summary.durationMs).toBe(1234)
    expect(summary.summarized).toBe(true)

    const scenePort = summary.outputs.g_arch.out_0
    expect(scenePort.branchCount).toBe(1)
    expect(scenePort.itemCount).toBe(1)
    // direct child NAMES are kept — sino's primary "what did this group produce" signal.
    expect(scenePort.items[0].tree.childNames).toEqual(['block_ground'])
    // descendant names surface NESTED asset names (real graphs nest them a level down).
    expect(scenePort.items[0].tree.descendantNames).toEqual(
      expect.arrayContaining(['block_ground', 'architecture_0', 'rest']),
    )
    // cell COUNTS, not the cells themselves.
    expect(scenePort.items[0].tree.cellCount).toBe(50) // self only
    expect(scenePort.items[0].tree.subtreeCellCount).toBe(50 + 1600 + 200)
    expect(scenePort.totalCellCount).toBe(50 + 1600 + 200)

    // string / number ports pass through their small scalar value.
    expect(summary.outputs.g_arch.out_1.items[0].value).toBe('石路')
    expect(summary.outputs.size_node.value.items[0].value).toBe(50)

    // Crucially: the serialized summary must NOT contain any raw cell object.
    const serialized = JSON.stringify(summary)
    expect(serialized).not.toContain('"token"')
    // KB-scale, not MB: 1850 fake cells would be ~tens of KB if leaked.
    expect(serialized.length).toBeLessThan(2000)
  })

  it('inlines generator/audit metric object scalars for agent introspection without throwing', () => {
    const metricsResult = {
      executionId: 'exec_metrics',
      status: 'completed' as const,
      durationMs: 50,
      outputs: {
        audit_node: {
          report: [{
            path: [0],
            items: [{
              walkableRatio: 0.406,
              routeMaxSlopeDeg: 6.4,
              peakHeight: 233,
              passed: true,
              largeGrid: [[1, 2], [3, 4]],
            }],
          }],
        },
      },
    }
    const summary = summarizeExecutionResult(metricsResult) as Record<string, any>
    const reportItem = summary.outputs.audit_node.report.items[0]
    expect(reportItem.kind).toBe('object')
    expect(reportItem.walkableRatio).toBe(0.406)
    expect(reportItem.routeMaxSlopeDeg).toBe(6.4)
    expect(reportItem.peakHeight).toBe(233)
    expect(reportItem.passed).toBe(true)
    expect(reportItem.keys).toContain('walkableRatio')
    expect(reportItem.keys).toContain('largeGrid')
  })

  it('is defensive: malformed ports collapse to a note instead of throwing', () => {
    const weird = {
      executionId: 'exec_2',
      status: 'completed' as const,
      durationMs: 1,
      outputs: {
        n: {
          p_array_notentries: [1, 2, 3],
          p_obj: { unexpected: true },
          p_null: null,
        },
      },
    }
    expect(() => summarizeExecutionResult(weird)).not.toThrow()
    const summary = summarizeExecutionResult(weird) as Record<string, any>
    expect(summary.status).toBe('completed')
    expect(summary.outputs.n).toBeDefined()
  })

  it('preserves error verbatim', () => {
    const errored = {
      executionId: 'exec_3',
      status: 'error' as const,
      durationMs: 0,
      error: { nodeId: 'x', message: 'boom' },
      outputs: {},
    }
    const summary = summarizeExecutionResult(errored) as Record<string, any>
    expect(summary.status).toBe('error')
    expect(summary.error).toEqual({ nodeId: 'x', message: 'boom' })
  })

  it('adds verification hints when completed without voxel or mesh geometry', () => {
    const empty = {
      executionId: 'exec_empty',
      status: 'completed' as const,
      durationMs: 10,
      outputs: {
        g: {
          out_0: [{ path: [0], items: [makeScenePort(emptyGraph(), ROOT_ID)] }],
        },
      },
    }
    const summary = summarizeExecutionResult(empty) as Record<string, any>
    expect(summary.verification.ok).toBe(false)
    expect(summary.verification.totalSceneCells).toBe(0)
    expect(summary.verification.totalSceneMeshes).toBe(0)
    expect(summary.verification.hints[0]).toMatch(/operating geometry/)
  })

  it('verification ok when completed with cells', () => {
    const summary = summarizeExecutionResult(fullResult) as Record<string, any>
    expect(summary.verification.ok).toBe(true)
    expect(summary.verification.totalSceneCells).toBeGreaterThan(0)
    expect(summary.verification.hints).toBeUndefined()
  })

  it('fails canonical verification when intermediate ports have cells but compiled final output is empty', () => {
    const result = {
      ...fullResult,
      outputs: {
        ...fullResult.outputs,
        final_capture: {
          layers: [{ path: [0], items: [[]] }],
        },
      },
    }
    const summary = summarizeExecutionResult(result, undefined, undefined, ['final_capture']) as Record<string, any>
    expect(summary.verification.totalSceneCells).toBeGreaterThan(0)
    expect(summary.verification.finalOutput).toEqual(expect.objectContaining({
      ok: false,
      resultEntityIds: ['final_capture'],
      totalSceneCells: 0,
      emptyResultEntityIds: ['final_capture'],
    }))
    expect(summary.verification.ok).toBe(false)
    expect(summary.verification.hints).toEqual(expect.arrayContaining([
      expect.stringMatching(/Intermediate output does not satisfy acceptance/),
    ]))
  })

  it('accepts a compiled sceneOutput capture when its voxel layers contain cells', () => {
    const result = {
      ...fullResult,
      outputs: {
        final_capture: {
          layers: [{
            path: [0],
            items: [[{
              nodePath: '/ground',
              nodeName: 'ground',
              value: 1,
              cells: bigCells(3),
            }]],
          }],
        },
      },
    }
    const summary = summarizeExecutionResult(result, undefined, undefined, ['final_capture']) as Record<string, any>
    expect(summary.verification.ok).toBe(true)
    expect(summary.verification.finalOutput).toEqual(expect.objectContaining({
      ok: true,
      totalSceneCells: 3,
    }))
  })

  it('accepts a compiled sceneOutput capture with visible mesh geometry', () => {
    const result = {
      executionId: 'exec_mesh',
      status: 'completed' as const,
      durationMs: 8,
      outputs: {
        final_capture: {
          layers: [{ path: [0], items: [[]] }],
          scene: [{ path: [0], items: [makeMeshTreePort()] }],
        },
      },
    }
    const summary = summarizeExecutionResult(result, undefined, undefined, ['final_capture']) as Record<string, any>
    expect(summary.verification.ok).toBe(true)
    expect(summary.verification.finalOutput).toEqual(expect.objectContaining({
      ok: true,
      totalSceneCells: 0,
      totalSceneMeshes: 1,
      totalSceneTriangles: 1,
    }))
  })

  it('accepts mesh-only terrain when sceneOutput omits the passthrough scene port', () => {
    const result = {
      executionId: 'exec_mesh_names',
      status: 'completed' as const,
      durationMs: 8,
      outputs: {
        final_capture: {
          layers: [{ path: [0], items: [[]] }],
          names: [{
            path: [0],
            items: [[{ id: 1, name: 'Terrain', type: 'mesh', meshCount: 1, triangleCount: 2048 }]],
          }],
        },
      },
    }
    const summary = summarizeExecutionResult(result, undefined, undefined, ['final_capture']) as Record<string, any>
    expect(summary.verification.ok).toBe(true)
    expect(summary.verification.finalOutput).toEqual(expect.objectContaining({
      ok: true,
      totalSceneMeshes: 1,
      totalSceneTriangles: 2048,
    }))
  })

  it('fails completed execution when execFailures is non-empty and exposes bounded structured diagnostics', () => {
    const summary = summarizeExecutionResult({
      ...fullResult,
      execFailures: ['areaPartition (node area_1): required input region is empty'],
    }) as Record<string, any>
    expect(summary.status).toBe('completed')
    expect(summary.verification.ok).toBe(false)
    expect(summary.verification.primaryFailure).toBe('execution')
    expect(summary.verification.executionFailures).toEqual({
      ok: false,
      count: 1,
      failures: [{
        index: 0,
        message: 'areaPartition (node area_1): required input region is empty',
      }],
    })
  })

  it('prefers structured runtime failures without parsing legacy strings', () => {
    const summary = summarizeExecutionResult({
      ...fullResult,
      execFailures: ['legacy text should not win'],
      failures: [{ nodeId: 'local-solver', message: 'Generator timed out' }],
    }) as Record<string, any>
    expect(summary.verification.primaryFailure).toBe('execution')
    expect(summary.verification.executionFailures.failures[0].message).toBe(
      'local-solver: Generator timed out',
    )
    expect(summary.failures).toEqual([{ nodeId: 'local-solver', message: 'Generator timed out' }])
  })

  it('accepts canonical Scene Script without sceneOutput resultEntityIds', () => {
    const summary = summarizeExecutionResult(fullResult, undefined, undefined, []) as Record<string, any>
    expect(summary.verification.ok).toBe(true)
    expect(summary.verification.finalOutput.resultEntityIds).toEqual([])
    expect(summary.verification.finalOutput.ok).toBe(true)
    expect(summary.verification.hints ?? []).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/sceneOutput\/resultEntityIds/),
    ]))
  })

  // 2026-07-01: 硬门控 stage3.location_names — narrativeLocationNames 是可选的，
  // 不传时完全不跑（上面所有既有用例都印证了这点：不受影响）。
  describe('stage3.location_names alignment (expectedLocationNames)', () => {
    it('does nothing when expectedLocationNames is omitted (default-off, no regression)', () => {
      const summary = summarizeExecutionResult(fullResult) as Record<string, any>
      expect(summary.verification.locationNameAlignment).toBeUndefined()
    })

    it('passes when every narrative location name is found (possibly as a prefix/suffix) among scene node names', () => {
      // fullResult's scene graph has names: '', 'block_ground', 'architecture_0', 'rest'.
      const summary = summarizeExecutionResult(fullResult, ['block_ground', 'architecture_0']) as Record<string, any>
      expect(summary.verification.locationNameAlignment).toEqual({ ok: true, missing: [] })
      expect(summary.verification.hints).toBeUndefined()
    })

    it('fails and reports the missing narrative name when it truly is not in the scene graph', () => {
      const summary = summarizeExecutionResult(fullResult, ['block_ground', '望江客栈']) as Record<string, any>
      expect(summary.verification.ok).toBe(false)
      expect(summary.verification.locationNameAlignment.ok).toBe(false)
      expect(summary.verification.locationNameAlignment.missing).toEqual([
        expect.objectContaining({ name: '望江客栈' }),
      ])
      expect(summary.verification.hints[0]).toMatch(/stage3\.location_names/)
      expect(summary.verification.hints[0]).toContain('望江客栈')
    })

    // 2026-07-10 复盘：命名对齐失败时必须把实际场景节点名一并回传，agent 才能一次
    // summary 调用比对"预期 vs 实际"，不必再反复调用 raw execute 摸黑翻找输出名。
    it('surfaces actualNodeNames on failure so the agent never has to fall back to raw execute', () => {
      const summary = summarizeExecutionResult(fullResult, ['block_ground', '望江客栈']) as Record<string, any>
      const alignment = summary.verification.locationNameAlignment
      expect(alignment.ok).toBe(false)
      expect(alignment.actualNodeNames).toEqual(
        expect.arrayContaining(['block_ground', 'architecture_0', 'rest']),
      )
      expect(alignment.actualNodeNamesTruncated).toBeUndefined()
      expect(summary.verification.hints[0]).toMatch(/actualNodeNames/)
    })

    it('does not include actualNodeNames when alignment passes (nothing to look up)', () => {
      const summary = summarizeExecutionResult(fullResult, ['block_ground', 'architecture_0']) as Record<string, any>
      expect(summary.verification.locationNameAlignment).toEqual({ ok: true, missing: [] })
    })

    it('prefers structural failure over location-name failure when both are present', () => {
      const emptyPickOne = {
        executionId: 'exec_dual_fail',
        status: 'completed' as const,
        durationMs: 10,
        outputs: {
          pob: {
            out_0: [{ path: [0], items: [makeScenePort(emptyGraph(), ROOT_ID)] }],
            out_1: [{ path: [0], items: [makeScenePort(emptyGraph(), ROOT_ID)] }],
          },
        },
      }
      const summary = summarizeExecutionResult(emptyPickOne, ['望江客栈', '市集', '清水镇']) as Record<string, any>
      expect(summary.verification.ok).toBe(false)
      expect(summary.verification.primaryFailure).toBe('structural')
      expect(summary.verification.locationNameAlignment.ok).toBe(false)
      expect(summary.verification.locationNameAlignment.missing).toHaveLength(3)
    })

    it('fuzzy match tolerates a scene node name that embeds the narrative name as a substring', () => {
      let g = emptyGraph()
      g = putContent(g, ROOT_ID, '望江客栈_主楼', [{ x: 0, y: 0, z: 0, token: 'wall' }]).graph
      const withSuffix = {
        executionId: 'exec_fuzzy',
        status: 'completed' as const,
        durationMs: 5,
        outputs: {
          g: {
            out_0: [
              {
                path: [0],
                items: [makeScenePort(g, ROOT_ID)],
              },
            ],
          },
        },
      }
      const summary = summarizeExecutionResult(withSuffix, ['望江客栈']) as Record<string, any>
      expect(summary.verification.locationNameAlignment).toEqual({ ok: true, missing: [] })
    })
  })

  describe('spatial telemetry computation', () => {
    it('computes spatial bounds, elevation relief, slope, and sampling metrics for mesh outputs', () => {
      const meshPayload = {
        positions: [
          0, 0, 0,
          100, 0, 50,
          0, 100, 30,
          100, 100, 20,
        ],
        indices: [0, 1, 2, 1, 3, 2],
      }
      const result = {
        executionId: 'exec_mesh_telemetry',
        status: 'completed' as const,
        durationMs: 120,
        outputs: {
          ground_mesh: {
            mesh: [{ path: [0, 0], items: [meshPayload] }],
          },
        },
      }
      const summary = summarizeExecutionResult(result) as Record<string, any>
      expect(summary.telemetry).toBeDefined()
      expect(summary.telemetry.worldBounds.min).toEqual([0, 0, 0])
      expect(summary.telemetry.worldBounds.max).toEqual([100, 100, 50])
      expect(summary.telemetry.worldBounds.size).toEqual([100, 100, 50])
      expect(summary.telemetry.elevation.min).toBe(0)
      expect(summary.telemetry.elevation.max).toBe(50)
      expect(summary.telemetry.elevation.relief).toBe(50)
      expect(summary.telemetry.elevation.verticalAspect).toContain('50.0%')
      expect(summary.telemetry.sampling.vertexCount).toBe(4)
      expect(summary.telemetry.sampling.triangleCount).toBe(2)
      expect(summary.verification.spatialTelemetry).toEqual(summary.telemetry)
    })
  })
})

describe('applySpatialVerification', () => {
  it('fails verification.ok when placement diagnostics fire', () => {
    const summary = applySpatialVerification(
      { verification: { ok: true, hints: [] } },
      [{ code: 'SCENE_MESH_INTERSECTS', message: '1 hung mesh pair(s) occupy the same volume.' }],
    )
    expect(summary.verification?.ok).toBe(false)
    expect(summary.verification?.primaryFailure).toBe('spatial')
    expect(summary.verification?.hints).toEqual([
      '[scene-script.placement] 1 hung mesh pair(s) occupy the same volume.',
    ])
  })
})
