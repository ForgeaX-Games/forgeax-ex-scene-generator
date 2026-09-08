import { describe, expect, it } from 'vitest'
import { buildBakeLayersFromExecutionResult, collectTerminalPorts } from '../src/baked/snapshot-from-execute.js'
import {
  addChildren,
  emptyGraph,
  makeScenePort,
  volumeFromCells,
  ROOT_ID,
  type Cell,
  type SceneGraph,
} from '../../vendor/dist/shared/types/index.js'

// Mirrors execution-summary.test.ts's fixture shape: outputs[nodeId][port] =
// DataTreeEntry[] whose items are ScenePortValue { graph: SceneGraph, focus: NodeId }.
function cells(n: number, token = 'wall'): Cell[] {
  return Array.from({ length: n }, (_, i) => ({ x: i, y: 0, z: 0, token }))
}

/** Single top-level child under root, with N cells and optional attributes. */
function oneChildGraph(name: string, n: number, attributes?: Record<string, unknown>): SceneGraph {
  const { graph } = addChildren(emptyGraph(), ROOT_ID, [
    { name, content: n > 0 ? volumeFromCells(cells(n)) : undefined, attributes },
  ])
  return graph
}

describe('buildBakeLayersFromExecutionResult', () => {
  it('projects a scene port item into DFS-ordered bake layers with asset metadata', () => {
    let g = emptyGraph()
    const houseAdd = addChildren(g, ROOT_ID, [
      {
        name: 'House',
        content: volumeFromCells([
          { x: 0, y: 0, z: 0, token: 'wall', state: { instanceId: 'house-1', role: 'anchor' } },
          ...cells(3, 'wall').map((cell, i) => ({ ...cell, x: i + 1 })),
        ]),
        attributes: {
          asset_name: '橡木屋',
          asset_alias: '[武侠][建筑][橡木屋][][][][asset][16]',
          asset_type: 'object',
        },
      },
    ])
    g = houseAdd.graph
    const houseId = houseAdd.ids[0]!
    const roofAdd = addChildren(g, houseId, [
      { name: 'Roof', content: volumeFromCells(cells(2, 'roof')), attributes: { asset_name: '屋顶' } },
    ])
    g = roofAdd.graph

    const full = {
      executionId: 'exec_1',
      status: 'completed' as const,
      durationMs: 10,
      outputs: {
        g_arch: {
          out_0: [
            {
              path: [0],
              items: [makeScenePort(g, ROOT_ID)],
            },
          ],
          // Non-scene port (plain string) must be skipped, never throw.
          out_1: [{ path: [0], items: ['石路'] }],
        },
      },
    }

    const layers = buildBakeLayersFromExecutionResult(full)
    expect(layers).toHaveLength(2)
    // Parent (House) before child (Roof) — bakeLayersForProject relies on this order.
    expect(layers[0]).toMatchObject({
      nodePath: '/House',
      nodeName: 'House',
      assetName: '橡木屋',
      assetAlias: '[武侠][建筑][橡木屋][][][][asset][16]',
      assetType: 'object',
    })
    expect(layers[0]!.cells).toEqual([
      { x: 0, y: 0, z: 0, token: 'wall', state: { instanceId: 'house-1', role: 'anchor' } },
      { x: 1, y: 0, z: 0, token: 'wall' },
      { x: 2, y: 0, z: 0, token: 'wall' },
      { x: 3, y: 0, z: 0, token: 'wall' },
    ])
    expect(layers[1]).toMatchObject({ nodePath: '/House/Roof', nodeName: 'Roof', assetName: '屋顶' })
  })

  it('is defensive: unexpected outputs/ports/items shapes yield no layers instead of throwing', () => {
    expect(buildBakeLayersFromExecutionResult({ outputs: {} })).toEqual([])
    expect(
      buildBakeLayersFromExecutionResult({
        outputs: { n: { p: [{ path: [0], items: [42, 'x', null, { foo: 'bar' }] }] } },
      }),
    ).toEqual([])
    // Malformed port (not an array) is skipped, not thrown.
    expect(
      buildBakeLayersFromExecutionResult({ outputs: { n: { p: { not: 'an array' } } } }),
    ).toEqual([])
  })

  it('whitelist-scoped to graph edges: only bakes the port(s) directly feeding scene_output, even across nested-group boundaries the edge list never sees', () => {
    const full = {
      executionId: 'exec_3',
      status: 'completed' as const,
      durationMs: 1,
      outputs: {
        step1: { scene: [{ path: [0], items: [makeScenePort(oneChildGraph('A', 1), ROOT_ID)] }] },
        step2: { scene: [{ path: [0], items: [makeScenePort(oneChildGraph('B', 1), ROOT_ID)] }] },
        dangling: { scene: [{ path: [0], items: [makeScenePort(oneChildGraph('C', 1), ROOT_ID)] }] },
      },
    }
    // step1.scene -> step2.scene (intermediate composition, must be excluded — this
    // is exactly the shape a __group__'s internal wiring takes, invisible here too)
    // step2.scene -> sink.scene (the ONE edge feeding scene_output — the whitelist)
    // dangling.scene has NO outgoing edge at all — not wired to scene_output, so it
    // is NOT part of the final scene and must be excluded too (unlike the old
    // blacklist approach, which had no way to distinguish "not yet wired" from
    // "the terminal output").
    const nodes = [
      { id: 'step1', opId: 'grid2node' },
      { id: 'step2', opId: 'add_child' },
      { id: 'dangling', opId: 'grid2node' },
      { id: 'sink', opId: 'scene_output' },
    ]
    const edges = [
      { source: { nodeId: 'step1', port: 'scene' }, target: { nodeId: 'step2', port: 'nodes' } },
      { source: { nodeId: 'step2', port: 'scene' }, target: { nodeId: 'sink', port: 'scene' } },
    ]
    const terminal = collectTerminalPorts(nodes, edges)
    expect(terminal).toEqual(new Set(['step2:scene']))

    const layers = buildBakeLayersFromExecutionResult(full, terminal)
    const paths = layers.map((l) => l.nodePath).sort()
    expect(paths).toEqual(['/B'])
  })

  it('falls back to bake-all when there is no wired scene_output (empty terminal set)', () => {
    const full = {
      executionId: 'exec_4',
      status: 'completed' as const,
      durationMs: 1,
      outputs: {
        step1: { scene: [{ path: [0], items: [makeScenePort(oneChildGraph('A', 1), ROOT_ID)] }] },
      },
    }
    const nodes = [{ id: 'step1', opId: 'grid2node' }]
    const terminal = collectTerminalPorts(nodes, [])
    expect(terminal.size).toBe(0)

    const layers = buildBakeLayersFromExecutionResult(full, terminal)
    expect(layers.map((l) => l.nodePath)).toEqual(['/A'])
  })

  // v3 的 parseScenePort 只认 { graph, focus } 形态（见 vendor port.ts）——旧
  // tree.ts 版本这里额外兜底"裸 SceneNodeSnapshot（无 {tree,focus} 包装）"，但
  // 实际管线里 scene 产出电池永远通过 makeScenePort 输出包装值，这条兜底路径
  // 从未在真实调用中触发过。v3 不再假装支持它——不是回归，是跟随 parseScenePort
  // 的显式契约（同一份 parseScenePort 在其它所有消费端也是这个行为）。
  it('ignores a bare (non-ScenePortValue) item instead of throwing', () => {
    const full = {
      executionId: 'exec_2',
      status: 'completed' as const,
      durationMs: 5,
      outputs: {
        n: {
          out: [
            {
              path: [0],
              items: [
                { name: 'Wall', path: '/Wall', cells: cells(1, 'wall') },
              ],
            },
          ],
        },
      },
    }
    const layers = buildBakeLayersFromExecutionResult(full)
    expect(layers).toEqual([])
  })
})
