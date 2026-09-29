import { expect, it, vi } from 'vitest'
import { applyAutomaticDisplayLayout } from './projection-layout.js'
import { projectTraceToDisplayGraph } from './projection.js'

it('does not rescan the full graph for helper heights inside pairwise collision checks', () => {
  const { graph } = projectTraceToDisplayGraph({
    trace: Array.from({ length: 40 }, (_, i) => ({
      id: `point-${i}`, functionName: 'point2d', args: { x: i, y: i },
      argRefs: [], reused: false, result: { kind: 'point2d', x: i, y: i },
      source: { file: 'main.scene.ts' },
    })),
  })
  const values = Object.values
  let fullGraphScans = 0
  const spy = vi.spyOn(Object, 'values').mockImplementation((object) => {
    if (object === graph.nodes) fullGraphScans++
    return values(object)
  })
  try {
    applyAutomaticDisplayLayout(graph.nodes, graph.edges)
    // At most one helper scan per host plus fixed module-level passes.
    expect(fullGraphScans).toBeLessThan(60)
  } finally {
    spy.mockRestore()
  }
})
