import { describe, expect, it } from 'vitest'
import type { GraphEdge } from '../layer1/types/graph.js'
import { deriveGroupPorts } from '../layer2/derive-group-ports.js'

function edge(id: string, sn: string, sp: string, tn: string, tp: string): GraphEdge {
  return { id, source: { nodeId: sn, port: sp }, target: { nodeId: tn, port: tp } }
}

describe('deriveGroupPorts', () => {
  const nodes = new Map([
    ['a', { id: 'a', opId: 'demo.echo' }],
    ['b', { id: 'b', opId: 'demo.echo' }],
  ])
  const edges = [edge('e_ab', 'a', 'out', 'b', 'in'), edge('e_db', 'd', 'out', 'b', 'aux'), edge('e_bc', 'b', 'out', 'c', 'in')]
  const resolvePortTier = (_n: string, _p: string, _d: 'in' | 'out') => ({ portType: 'scene' as const })

  it('classifies boundary edges and mints stable sequential port names', () => {
    const r = deriveGroupPorts({ memberNodeIds: ['a', 'b'], nodes, edges, resolvePortTier })
    expect(r.internalEdgeIds).toEqual(['e_ab'])
    expect(r.exposedInputs).toEqual([
      { portName: 'in_0', portType: 'scene', sourceNodeId: 'b', sourcePortName: 'aux' },
    ])
    expect(r.exposedOutputs).toEqual([
      { portName: 'out_0', portType: 'scene', sourceNodeId: 'b', sourcePortName: 'out' },
    ])
    expect(r.boundaryRewrites).toEqual([
      { edgeId: 'e_db', endpoint: 'target', portName: 'in_0' },
      { edgeId: 'e_bc', endpoint: 'source', portName: 'out_0' },
    ])
  })

  it('dedupes a fan-out boundary-out into one exposed output', () => {
    const fan = [edge('e_bc', 'b', 'out', 'c', 'in'), edge('e_bc2', 'b', 'out', 'c2', 'in')]
    const r = deriveGroupPorts({ memberNodeIds: ['b'], nodes: new Map([['b', { id: 'b', opId: 'demo.echo' }]]), edges: fan, resolvePortTier })
    expect(r.exposedOutputs).toHaveLength(1)
    expect(r.boundaryRewrites.filter((w) => w.endpoint === 'source')).toHaveLength(2)
  })
})
