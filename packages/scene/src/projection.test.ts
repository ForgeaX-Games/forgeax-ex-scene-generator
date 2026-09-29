import { describe, expect, it } from 'vitest'

import { projectTraceToDisplayGraph } from './projection.js'
import type { SceneCallRecord } from './host.js'

function call(partial: Partial<SceneCallRecord> & Pick<SceneCallRecord, 'id' | 'functionName' | 'result'>): SceneCallRecord {
  return {
    args: {},
    argRefs: [],
    reused: false,
    ...partial,
  }
}

describe('projectTraceToDisplayGraph', () => {
  it('tags List / ShapeTree / SceneTree and rows nested modules', () => {
    const { graph } = projectTraceToDisplayGraph({
      trace: [
        call({
          id: 'grids',
          functionName: 'createGrid',
          result: [1, 2, 3],
          source: { file: 'grid.scene.ts' },
        }),
        call({
          id: 'tree',
          functionName: 'heightfieldExplode',
          result: [{ path: [0], items: [1] }],
          source: { file: 'grid.scene.ts' },
        }),
        call({
          id: 'out',
          functionName: 'sceneOutput',
          result: {
            graph: { root: { id: 'root', name: '', parent: null, children: {} } },
            focus: 'root',
          },
          source: { file: 'main.scene.ts' },
          argRefs: [{ from: 'tree', port: 'heightfield', arg: 'scene' }],
        }),
      ],
    })

    expect(graph.nodes.grids?.valueShape).toBe('list')
    expect(graph.nodes.tree?.valueShape).toBe('tree')
    expect(graph.nodes.out?.valueShape).toBe('scene')
    expect(graph.nodes.grids?.moduleFile).toBe('grid.scene.ts')
    expect(graph.nodes.out?.moduleFile).toBe('main.scene.ts')
    expect(graph.nodes.out?.position.y).toBeGreaterThan(graph.nodes.grids?.position.y ?? 0)
  })

  it('fans one named number const out to every referencing slot', () => {
    const { graph } = projectTraceToDisplayGraph({
      trace: [
        call({
          id: 'world',
          functionName: 'basePlane',
          args: { width: 120, height: 80 },
          result: { geometry: { kind: 'plane' } },
        }),
        call({
          id: 'pad',
          functionName: 'basePlane',
          args: { width: 120, height: 18 },
          result: { geometry: { kind: 'plane' } },
        }),
      ],
      sites: [
        {
          id: 'width',
          binding: 'worldWidth',
          kind: 'literal',
          span: { start: 0, end: 1, line: 2, column: 1 },
          args: {},
          value: 120,
        },
        {
          id: 'world',
          binding: 'world',
          functionName: 'basePlane',
          kind: 'call',
          span: { start: 2, end: 3, line: 3, column: 1 },
          args: {
            width: { kind: 'reference', binding: 'worldWidth' },
            height: { kind: 'literal', value: 80 },
          },
        },
        {
          id: 'pad',
          binding: 'pad',
          functionName: 'basePlane',
          kind: 'call',
          span: { start: 4, end: 5, line: 4, column: 1 },
          args: {
            width: { kind: 'reference', binding: 'worldWidth' },
            height: { kind: 'literal', value: 18 },
          },
        },
      ],
    })

    expect(graph.nodes.width?.opId).toBe('number_const')
    expect(graph.nodes.width?.params).toEqual({ value: 120 })
    expect(Object.values(graph.edges).filter((edge) => edge.source.nodeId === 'width')).toEqual([
      expect.objectContaining({
        source: { nodeId: 'width', port: 'value' },
        target: { nodeId: 'world', port: 'width' },
      }),
      expect.objectContaining({
        source: { nodeId: 'width', port: 'value' },
        target: { nodeId: 'pad', port: 'width' },
      }),
    ])
    expect(graph.nodes.world?.params.width).toBeUndefined()
    expect(graph.nodes.world?.params.height).toBeUndefined()
    expect(Object.values(graph.edges).some((edge) => (
      edge.target.nodeId === 'world' && edge.target.port === 'height' && edge.source.port === 'value'
    ))).toBe(true)
  })

  it('draws one edge per referenced site into a list points port', () => {
    const { graph } = projectTraceToDisplayGraph({
      trace: [
        call({ id: 'origin', functionName: 'point2d', result: { geometry: { kind: 'point2d' } } }),
        call({ id: 'plaza', functionName: 'point2d', result: { geometry: { kind: 'point2d' } } }),
        call({
          id: 'road',
          functionName: 'polyline2d',
          argRefs: [
            { from: 'origin', port: 'geometry', arg: 'points' },
            { from: 'plaza', port: 'geometry', arg: 'points' },
          ],
          result: { geometry: { kind: 'polyline' } },
        }),
      ],
      sites: [
        {
          id: 'origin',
          binding: 'origin',
          functionName: 'point2d',
          kind: 'call',
          span: { start: 0, end: 1, line: 1, column: 1 },
          args: {},
        },
        {
          id: 'plaza',
          binding: 'plaza',
          functionName: 'point2d',
          kind: 'call',
          span: { start: 2, end: 3, line: 2, column: 1 },
          args: {},
        },
        {
          id: 'road',
          binding: 'road',
          functionName: 'polyline2d',
          kind: 'call',
          span: { start: 4, end: 5, line: 3, column: 1 },
          args: {
            points: {
              kind: 'other',
              items: [
                { kind: 'reference', binding: 'origin', output: 'geometry' },
                { kind: 'reference', binding: 'plaza', output: 'geometry' },
              ],
            },
          },
        },
      ],
    })
    expect(Object.values(graph.edges).filter((edge) => edge.target.port === 'points')).toEqual([
      expect.objectContaining({
        source: { nodeId: 'origin', port: 'geometry' },
        target: { nodeId: 'road', port: 'points' },
      }),
      expect.objectContaining({
        source: { nodeId: 'plaza', port: 'geometry' },
        target: { nodeId: 'road', port: 'points' },
      }),
    ])
  })

  it('wires a bare site binding to the producer primary output handle', () => {
    const { graph } = projectTraceToDisplayGraph({
      trace: [
        call({
          id: 'origin',
          functionName: 'point2d',
          result: { kind: 'point2d', x: 0, y: 0 },
        }),
        call({
          id: 'road',
          functionName: 'polyline2d',
          result: { kind: 'polyline', points: [[0, 0], [10, 0]] },
        }),
      ],
      sites: [
        {
          id: 'origin',
          binding: 'origin',
          functionName: 'point2d',
          kind: 'call',
          span: { start: 0, end: 1, line: 1, column: 1 },
          args: {},
        },
        {
          id: 'road',
          binding: 'road',
          functionName: 'polyline2d',
          kind: 'call',
          span: { start: 2, end: 3, line: 2, column: 1 },
          args: {
            points: {
              kind: 'other',
              items: [{ kind: 'reference', binding: 'origin' }],
            },
          },
        },
      ],
    })
    expect(Object.values(graph.edges).some((edge) => (
      edge.source.nodeId === 'origin'
      && edge.source.port === 'geometry'
      && edge.target.port === 'points'
    ))).toBe(true)
  })

  it('keeps runtime array refs on addChild.nodes', () => {
    const { graph } = projectTraceToDisplayGraph({
      trace: [
        call({
          id: 'terrainNode',
          functionName: 'sceneNode',
          result: { scene: { focus: 'terrain' } },
        }),
        call({
          id: 'root',
          functionName: 'addChild',
          argRefs: [{ from: 'terrainNode', port: 'scene', arg: 'nodes' }],
          result: { scene: { focus: 'root' } },
        }),
      ],
    })
    expect(Object.values(graph.edges)).toEqual([
      expect.objectContaining({
        source: { nodeId: 'terrainNode', port: 'scene' },
        target: { nodeId: 'root', port: 'nodes' },
      }),
    ])
  })

  it('projects inspect call sites when the run produced no trace', () => {
    const { graph } = projectTraceToDisplayGraph({
      trace: [],
      file: 'main.scene.ts',
      sites: [
        {
          id: 'field',
          binding: 'field',
          functionName: 'heightfield',
          kind: 'call',
          span: { start: 0, end: 10, line: 1, column: 1 },
          args: { geometry: { kind: 'reference', binding: 'world', output: 'geometry' } },
        },
        {
          id: 'grid',
          binding: 'grid',
          functionName: 'createGrid',
          kind: 'call',
          span: { start: 20, end: 30, line: 3, column: 1 },
          args: {},
        },
        {
          id: 'world',
          binding: 'world',
          functionName: 'basePlane',
          kind: 'call',
          span: { start: 40, end: 50, line: 5, column: 1 },
          args: {},
        },
      ],
    })
    expect(graph.nodes.field?.opId).toBe('heightfield')
    expect(graph.nodes.field?.status).toBe('error')
    expect(graph.nodes.grid?.opId).toBe('create_grid')
    expect(graph.nodes.world?.opId).toBe('base_plane')
    expect(Object.values(graph.edges)).toEqual([
      expect.objectContaining({
        source: { nodeId: 'world', port: 'geometry' },
        target: { nodeId: 'field', port: 'geometry' },
      }),
    ])
  })

  it('keeps an inline enum kind on the battery instead of minting a Panel', () => {
    const { graph } = projectTraceToDisplayGraph({
      trace: [
        call({
          id: 'ramp',
          functionName: 'gridGradient',
          args: { columns: 16, rows: 16, kind: 'radial' },
          result: { grid: [[0]] },
        }),
      ],
      sites: [
        {
          id: 'ramp',
          binding: 'ramp',
          functionName: 'gridGradient',
          kind: 'call',
          span: { start: 0, end: 20, line: 1, column: 1 },
          args: {
            columns: { kind: 'literal', value: 16 },
            rows: { kind: 'literal', value: 16 },
            kind: { kind: 'literal', value: 'radial' },
          },
        },
      ],
    })
    expect(graph.nodes.ramp?.params.kind).toBe('radial')
    expect(Object.values(graph.nodes).some((node) => node.opId === 'text_panel')).toBe(false)
    expect(Object.values(graph.edges).some((edge) => edge.target.port === 'kind')).toBe(false)
    expect(Object.values(graph.nodes).filter((node) => node.opId === 'number_const')).toHaveLength(2)
  })

  it('still exposes an inline free-text name as a Panel', () => {
    const { graph } = projectTraceToDisplayGraph({
      trace: [
        call({
          id: 'node',
          functionName: 'sceneNode',
          args: { name: 'terrain' },
          result: { scene: { focus: 'terrain' } },
        }),
      ],
      sites: [
        {
          id: 'node',
          binding: 'node',
          functionName: 'sceneNode',
          kind: 'call',
          span: { start: 0, end: 20, line: 1, column: 1 },
          args: {
            name: { kind: 'literal', value: 'terrain' },
          },
        },
      ],
    })
    const panel = Object.values(graph.nodes).find((node) => node.opId === 'text_panel')
    expect(panel?.params).toEqual({ text: 'terrain' })
    expect(graph.nodes.node?.params.name).toBeUndefined()
  })

  it('fans a named string const onto kind', () => {
    const { graph } = projectTraceToDisplayGraph({
      trace: [
        call({
          id: 'ramp',
          functionName: 'gridGradient',
          args: { kind: 'row' },
          result: { grid: [[0]] },
        }),
      ],
      sites: [
        {
          id: 'direction',
          binding: 'direction',
          kind: 'literal',
          span: { start: 0, end: 8, line: 1, column: 1 },
          args: {},
          value: 'row',
        },
        {
          id: 'ramp',
          binding: 'ramp',
          functionName: 'gridGradient',
          kind: 'call',
          span: { start: 10, end: 30, line: 2, column: 1 },
          args: {
            kind: { kind: 'reference', binding: 'direction' },
          },
        },
      ],
    })
    expect(graph.nodes.direction?.opId).toBe('text_panel')
    expect(graph.nodes.direction?.params).toEqual({ text: 'row' })
    expect(graph.nodes.ramp?.params.kind).toBeUndefined()
    expect(Object.values(graph.edges)).toEqual([
      expect.objectContaining({
        source: { nodeId: 'direction', port: 'output' },
        target: { nodeId: 'ramp', port: 'kind' },
      }),
    ])
  })

  it('projects an unused named number when the run has no trace', () => {
    const { graph } = projectTraceToDisplayGraph({
      trace: [],
      file: 'main.scene.ts',
      sites: [
        {
          id: 'n',
          binding: 'n',
          kind: 'literal',
          span: { start: 0, end: 12, line: 2, column: 1 },
          args: {},
          value: 16,
        },
      ],
    })
    expect(graph.nodes.n?.opId).toBe('number_const')
    expect(graph.nodes.n?.params).toEqual({ value: 16 })
  })

  it('keeps a host { error } call on the graph as an error node', () => {
    const { graph } = projectTraceToDisplayGraph({
      trace: [
        call({
          id: 'field',
          functionName: 'heightfield',
          result: { error: 'heightfield requires a Geometry plane and a height Grid' },
        }),
      ],
    })
    expect(graph.nodes.field?.opId).toBe('heightfield')
    expect(graph.nodes.field?.status).toBe('error')
  })

  it('layers unpinned hosts left-to-right and stacks sibling sites', () => {
    const { graph } = projectTraceToDisplayGraph({
      trace: [
        call({
          id: 'origin',
          functionName: 'point2d',
          result: { geometry: { kind: 'point2d' } },
        }),
        call({
          id: 'gate',
          functionName: 'point2d',
          result: { geometry: { kind: 'point2d' } },
        }),
        call({
          id: 'path',
          functionName: 'polyline2d',
          result: { geometry: { kind: 'polyline' } },
        }),
        call({
          id: 'field',
          functionName: 'heightfield',
          argRefs: [{ from: 'path', port: 'geometry', arg: 'geometry' }],
          result: { geometry: { kind: 'mesh' } },
        }),
      ],
    })
    expect(graph.nodes.origin?.position.x).toBe(graph.nodes.gate?.position.x)
    expect(graph.nodes.gate?.position.y).toBeGreaterThan(graph.nodes.origin?.position.y ?? 0)
    expect(graph.nodes.path?.position.x).toBeGreaterThan(graph.nodes.origin?.position.x ?? 0)
    expect(graph.nodes.field?.position.x).toBeGreaterThan(graph.nodes.path?.position.x ?? 0)
  })

  it('sits a wired polyline beside its sites instead of skipping a column', () => {
    const { graph } = projectTraceToDisplayGraph({
      trace: [
        call({ id: 'origin', functionName: 'point2d', result: { geometry: { kind: 'point2d' } } }),
        call({ id: 'plaza', functionName: 'point2d', result: { geometry: { kind: 'point2d' } } }),
        call({
          id: 'road',
          functionName: 'polyline2d',
          argRefs: [
            { from: 'origin', port: 'geometry', arg: 'points' },
            { from: 'plaza', port: 'geometry', arg: 'points' },
          ],
          result: { geometry: { kind: 'polyline' } },
        }),
      ],
    })
    const gap = (graph.nodes.road?.position.x ?? 0) - (graph.nodes.origin?.position.x ?? 0)
    expect(gap).toBeGreaterThan(200)
    expect(gap).toBeLessThan(620)
    expect(graph.nodes.plaza?.position.y).toBeGreaterThan((graph.nodes.origin?.position.y ?? 0) + 140)
    const mid = ((graph.nodes.origin?.position.y ?? 0) + (graph.nodes.plaza?.position.y ?? 0)) / 2
    expect(Math.abs((graph.nodes.road?.position.y ?? 0) - mid)).toBeLessThan(80)
  })

  it('projects a JSON record as a Basic/input json_panel', () => {
    const { graph } = projectTraceToDisplayGraph({
      trace: [
        call({
          id: 'paths',
          functionName: 'network2d',
          result: { geometry: { kind: 'network' } },
        }),
      ],
      sites: [
        {
          id: 'edges',
          binding: 'edges',
          kind: 'literal',
          span: { start: 0, end: 1, line: 2, column: 1 },
          args: {},
          value: [{ from: 0, to: 1 }],
        },
        {
          id: 'paths',
          binding: 'paths',
          functionName: 'network2d',
          kind: 'call',
          span: { start: 2, end: 3, line: 3, column: 1 },
          args: {
            edges: { kind: 'reference', binding: 'edges' },
          },
        },
      ],
    })
    expect(graph.nodes.edges?.opId).toBe('json_panel')
    expect(graph.nodes.edges?.params.value).toEqual([{ from: 0, to: 1 }])
    expect(Object.values(graph.edges).some((edge) => (
      edge.source.nodeId === 'edges' && edge.source.port === 'value' && edge.target.port === 'edges'
    ))).toBe(true)
  })

  it('keeps unpinned host boxes from overlapping', () => {
    const { graph } = projectTraceToDisplayGraph({
      trace: [
        call({ id: 'a', functionName: 'point2d', result: { geometry: { kind: 'point2d' } } }),
        call({ id: 'b', functionName: 'point2d', result: { geometry: { kind: 'point2d' } } }),
        call({ id: 'c', functionName: 'point2d', result: { geometry: { kind: 'point2d' } } }),
      ],
      sites: [
        {
          id: 'ax',
          binding: 'ax',
          kind: 'literal',
          span: { start: 0, end: 1, line: 1, column: 1 },
          args: {},
          value: 0,
        },
        {
          id: 'a',
          binding: 'a',
          functionName: 'point2d',
          kind: 'call',
          span: { start: 2, end: 3, line: 2, column: 1 },
          args: { x: { kind: 'reference', binding: 'ax' } },
        },
        {
          id: 'b',
          binding: 'b',
          functionName: 'point2d',
          kind: 'call',
          span: { start: 4, end: 5, line: 3, column: 1 },
          args: { x: { kind: 'reference', binding: 'ax' } },
        },
        {
          id: 'c',
          binding: 'c',
          functionName: 'point2d',
          kind: 'call',
          span: { start: 6, end: 7, line: 4, column: 1 },
          args: { x: { kind: 'reference', binding: 'ax' } },
        },
      ],
    })
    const boxes = Object.values(graph.nodes).map((node) => ({
      id: node.id,
      x: node.position.x,
      y: node.position.y,
      w: node.opId === 'number_const' ? 200 : 280,
      h: node.opId === 'number_const' ? 80 : 156,
    }))
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]!
        const b = boxes[j]!
        const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
        expect({ a: a.id, b: b.id, overlap }).toEqual({ a: a.id, b: b.id, overlap: false })
      }
    }
  })

  it('sits a named number left of its first consumer', () => {
    const { graph } = projectTraceToDisplayGraph({
      trace: [
        call({
          id: 'world',
          functionName: 'basePlane',
          args: { width: 80 },
          result: { geometry: { kind: 'plane' } },
        }),
      ],
      sites: [
        {
          id: 'width',
          binding: 'worldWidth',
          kind: 'literal',
          span: { start: 0, end: 1, line: 2, column: 1 },
          args: {},
          value: 80,
        },
        {
          id: 'world',
          binding: 'world',
          functionName: 'basePlane',
          kind: 'call',
          span: { start: 2, end: 3, line: 3, column: 1 },
          args: {
            width: { kind: 'reference', binding: 'worldWidth' },
          },
        },
      ],
    })
    expect(graph.nodes.width?.position.x).toBeLessThan(graph.nodes.world?.position.x ?? 0)
    expect(Math.abs((graph.nodes.width?.position.y ?? 0) - (graph.nodes.world?.position.y ?? 0))).toBeLessThan(8)
  })

  it('keeps a stored layout pin and only auto-places the rest', () => {
    const { graph } = projectTraceToDisplayGraph({
      layout: { pinned: { x: 12, y: 34 } },
      trace: [
        call({
          id: 'pinned',
          functionName: 'point2d',
          result: { geometry: { kind: 'point2d' } },
        }),
        call({
          id: 'free',
          functionName: 'point2d',
          result: { geometry: { kind: 'point2d' } },
        }),
      ],
    })
    expect(graph.nodes.pinned?.position).toEqual({ x: 12, y: 34 })
    expect(graph.nodes.free?.position).not.toEqual({ x: 12, y: 34 })
    expect(graph.nodes.free?.position.x).toBeGreaterThan(80)
  })
})
