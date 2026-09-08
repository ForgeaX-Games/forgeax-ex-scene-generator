import { describe, expect, it } from 'vitest'
import { summarizeExecutionResult } from '../src/execution-summary.js'
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
    expect(summary.verification.hints[0]).toMatch(/disconnected/)
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

  it('fails canonical verification when compilation exposes no sceneOutput resultEntityIds', () => {
    const summary = summarizeExecutionResult(fullResult, undefined, undefined, []) as Record<string, any>
    expect(summary.verification.ok).toBe(false)
    expect(summary.verification.finalOutput.resultEntityIds).toEqual([])
    expect(summary.verification.hints[0]).toMatch(/sceneOutput\/resultEntityIds/)
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

  // P0-1 (2026-07-15 tool 升级方案): 三项拓扑检测原本只活在 aw-support 的续作
  // 消息里，现在顺带在 execute 里跑一次，通过可选的第三个参数 currentGraph 接入。
  describe('topology checks (currentGraph)', () => {
    it('does nothing when currentGraph is omitted (default-off, no regression)', () => {
      const summary = summarizeExecutionResult(fullResult) as Record<string, any>
      expect(summary.verification.topologyIssues).toBeUndefined()
    })

    it('reports [] (not omitted) when currentGraph is supplied but clean', () => {
      const nodeById = new Map([
        ['grid', { id: 'grid', opId: '__group__', name: 'AddBaseGrid', params: {} }],
        ['island', { id: 'island', opId: '__group__', name: 'IslandRegions', params: {} }],
      ])
      const edges = [{ id: 'e1', source: { nodeId: 'grid', port: 'out_1' }, target: { nodeId: 'island', port: 'in_0' } }]
      const summary = summarizeExecutionResult(fullResult, undefined, { edges, nodeById }) as Record<string, any>
      expect(summary.verification.topologyIssues).toEqual([])
    })

    it('flags a Rest fan-out from AddBaseGrid.out_1 into two template groups', () => {
      const nodeById = new Map([
        ['grid', { id: 'grid', opId: '__group__', name: 'AddBaseGrid', params: {} }],
        ['a', { id: 'a', opId: '__group__', name: 'IslandRegions', params: {} }],
        ['b', { id: 'b', opId: '__group__', name: 'LakeRegions', params: {} }],
      ])
      const edges = [
        { id: 'e1', source: { nodeId: 'grid', port: 'out_1' }, target: { nodeId: 'a', port: 'in_0' } },
        { id: 'e2', source: { nodeId: 'grid', port: 'out_1' }, target: { nodeId: 'b', port: 'in_0' } },
      ]
      const summary = summarizeExecutionResult(fullResult, undefined, { edges, nodeById }) as Record<string, any>
      expect(summary.verification.topologyIssues).toHaveLength(1)
      expect(summary.verification.topologyIssues[0].kind).toBe('rest-fan-out')
      expect(summary.verification.topologyIssues[0].reason).toContain('fan-out')
      // 非阻断:不参与 ok 判定(见 execution-summary.ts 的注释)。
      expect(summary.verification.ok).toBe(true)
    })

    it('repairs an illegal local merge through semantic Scene ports instead of replaying domain ports', () => {
      const nodeById = new Map([
        ['a', { id: 'a', opId: '__group__', name: 'IslandRegions', params: {} }],
        ['b', { id: 'b', opId: '__group__', name: 'LakeRegions', params: {} }],
        ['local_merge', { id: 'local_merge', opId: 'tree_merge', params: { portCount: 2 } }],
        ['root_merge', { id: 'root_merge', opId: 'tree_merge', params: { portCount: 1 } }],
        ['flatten', { id: 'flatten', opId: 'tree_flatten', params: {} }],
      ])
      const edges = [
        { id: 'e1', source: { nodeId: 'a', port: 'out_1' }, target: { nodeId: 'local_merge', port: 'item_0' } },
        { id: 'e2', source: { nodeId: 'b', port: 'out_4' }, target: { nodeId: 'local_merge', port: 'item_1' } },
        { id: 'e3', source: { nodeId: 'local_merge', port: 'out_0' }, target: { nodeId: 'root_merge', port: 'item_0' } },
        { id: 'e4', source: { nodeId: 'root_merge', port: 'out_0' }, target: { nodeId: 'flatten', port: 'in_0' } },
      ]
      const summary = summarizeExecutionResult(fullResult, undefined, { edges, nodeById }) as Record<string, any>
      expect(summary.verification.topologyIssues).toHaveLength(1)
      const issue = summary.verification.topologyIssues[0]
      expect(issue.kind).toBe('illegal-local-merge')
      expect(issue.suggestedOps).toEqual([
        { type: 'deleteNode', nodeId: 'local_merge' },
        { type: 'appendMergeItem', mergeNodeId: 'root_merge', source: { nodeId: 'a', port: { label: 'Scene' } } },
        { type: 'appendMergeItem', mergeNodeId: 'root_merge', source: { nodeId: 'b', port: { label: 'Scene' } } },
      ])
    })

    it('flags a domain output connected directly to the root merge', () => {
      const nodeById = new Map([
        ['island', {
          id: 'island',
          opId: '__group__',
          name: 'IslandRegions',
          params: {},
          exposedOutputs: [
            { portName: 'out_0', customLabelEn: 'Scene' },
            { portName: 'out_1', customLabelEn: 'Island' },
            { portName: 'out_2', customLabelEn: 'Rest' },
          ],
        }],
        ['root_merge', { id: 'root_merge', opId: 'tree_merge', params: { portCount: 1 } }],
        ['flatten', { id: 'flatten', opId: 'tree_flatten', params: {} }],
      ])
      const edges = [
        { id: 'e1', source: { nodeId: 'island', port: 'out_1' }, target: { nodeId: 'root_merge', port: 'item_0' } },
        { id: 'e2', source: { nodeId: 'root_merge', port: 'tree' }, target: { nodeId: 'flatten', port: 'tree' } },
      ]
      const summary = summarizeExecutionResult(fullResult, undefined, { edges, nodeById }) as Record<string, any>
      const issue = summary.verification.topologyIssues.find((item: any) => item.kind === 'domain-merge-violation')
      expect(issue).toBeDefined()
      expect(issue.reason).toContain('Island')
      expect(issue.fix).toContain('out_0')
    })

    it('flags a wired manual_points node whose x/y are both left at the silent zero default', () => {
      const nodeById = new Map([
        ['grid', { id: 'grid', opId: '__group__', name: 'AddBaseGrid', params: {} }],
        ['pts', { id: 'pts', opId: 'manual_points', params: {} }],
        ['a', { id: 'a', opId: '__group__', name: 'IslandRegions', params: {} }],
      ])
      const edges = [{ id: 'e1', source: { nodeId: 'pts', port: 'point' }, target: { nodeId: 'a', port: 'in_1' } }]
      const summary = summarizeExecutionResult(fullResult, undefined, { edges, nodeById }) as Record<string, any>
      const issue = summary.verification.topologyIssues.find((i: any) => i.kind === 'manual-points-zero-default')
      expect(issue).toBeDefined()
      expect(issue.reason).toContain('pts')
    })

    it('does not flag manual_points when x AND y are both explicitly wired via edges', () => {
      const nodeById = new Map([
        ['pts', { id: 'pts', opId: 'manual_points', params: {} }],
        ['xsrc', { id: 'xsrc', opId: 'number', params: { value: 12 } }],
        ['ysrc', { id: 'ysrc', opId: 'number', params: { value: 34 } }],
        ['a', { id: 'a', opId: '__group__', name: 'IslandRegions', params: {} }],
      ])
      const edges = [
        { id: 'e1', source: { nodeId: 'xsrc', port: 'out_0' }, target: { nodeId: 'pts', port: 'x' } },
        { id: 'e2', source: { nodeId: 'ysrc', port: 'out_0' }, target: { nodeId: 'pts', port: 'y' } },
        { id: 'e3', source: { nodeId: 'pts', port: 'point' }, target: { nodeId: 'a', port: 'in_1' } },
      ]
      const summary = summarizeExecutionResult(fullResult, undefined, { edges, nodeById }) as Record<string, any>
      expect(summary.verification.topologyIssues).toEqual([])
    })

    it('does not flag manual_points when x/y params are explicit non-zero literals', () => {
      const nodeById = new Map([
        ['pts', { id: 'pts', opId: 'manual_points', params: { x: 5, y: -3 } }],
        ['a', { id: 'a', opId: '__group__', name: 'IslandRegions', params: {} }],
      ])
      const edges = [{ id: 'e1', source: { nodeId: 'pts', port: 'point' }, target: { nodeId: 'a', port: 'in_1' } }]
      const summary = summarizeExecutionResult(fullResult, undefined, { edges, nodeById }) as Record<string, any>
      expect(summary.verification.topologyIssues).toEqual([])
    })
  })

  describe('orphan / off-merge empty groups must not fail concurrent tasks', () => {
    it('ignores completely unwired explore orphans (no edges) for verification.ok', () => {
      const result = {
        ...fullResult,
        outputs: {
          ...fullResult.outputs,
          _explore_only: {}, // no ports — classic abandoned instantiate
        },
      }
      const nodeById = new Map([
        ['_explore_only', { id: '_explore_only', opId: '__group__', name: 'PlaceOneDecoration', params: {} }],
        ['g_arch', { id: 'g_arch', opId: '__group__', name: 'IslandRegions', params: {} }],
        ['root_merge', { id: 'root_merge', opId: 'tree_merge', params: { portCount: 1 } }],
      ])
      const edges = [
        { id: 'e1', source: { nodeId: 'g_arch', port: 'out_0' }, target: { nodeId: 'root_merge', port: 'item_0' } },
      ]
      const summary = summarizeExecutionResult(result, undefined, { edges, nodeById }) as Record<string, any>
      expect(summary.verification.ok).toBe(true)
      expect(summary.verification.primaryFailure).toBeUndefined()
      expect(JSON.stringify(summary.verification.hints ?? [])).not.toContain('_explore_only')
    })

    it('treats empty decoration WIP not yet on merge as advisory only', () => {
      // Real incomplete groups often land as {} (no ports) in the execute summary —
      // same shape as "_explore_only has no output ports", but WITH Rest edges.
      const result = {
        ...fullResult,
        outputs: {
          ...fullResult.outputs,
          p1d_gate: {},
        },
      }
      const nodeById = new Map([
        ['p1d_gate', { id: 'p1d_gate', opId: '__group__', name: 'PlaceOneDecoration', params: {} }],
        ['island', { id: 'island', opId: '__group__', name: 'IslandRegions', params: {} }],
        ['g_arch', { id: 'g_arch', opId: '__group__', name: 'IslandRegions', params: {} }],
        ['root_merge', { id: 'root_merge', opId: 'tree_merge', params: { portCount: 1 } }],
      ])
      // Decoration Rest-chained but NOT appendMergeItem'd yet — other phase / WIP.
      const edges = [
        { id: 'e_rest', source: { nodeId: 'island', port: 'out_2' }, target: { nodeId: 'p1d_gate', port: 'in_1' } },
        { id: 'e_merge', source: { nodeId: 'g_arch', port: 'out_0' }, target: { nodeId: 'root_merge', port: 'item_0' } },
      ]
      const summary = summarizeExecutionResult(result, undefined, { edges, nodeById }) as Record<string, any>
      expect(summary.verification.ok).toBe(true)
      expect(summary.verification.primaryFailure).toBeUndefined()
      expect(JSON.stringify(summary.verification.hints ?? [])).toContain('advisory')
      expect(JSON.stringify(summary.verification.hints ?? [])).toContain('禁止 deleteNode')
    })
  })
})
