import { describe, expect, it } from 'vitest'
import { pipelineHashOnly, summarizePipeline } from '../src/pipeline-summary.js'

const snap = {
  id: 'p_test',
  hash: 'abc',
  createdAt: '',
  updatedAt: '',
  nodes: {
    g1: { id: 'g1', opId: 'tree_merge', name: 'merge', position: { x: 0, y: 0 }, params: { portCount: 3, huge: 'x'.repeat(500) } },
    n1: { id: 'n1', opId: 'text_panel', name: '望江客栈', position: { x: 0, y: 0 }, params: { text: '望江客栈' } },
    o1: { id: 'o1', opId: 'scene_output', name: 'out', position: { x: 0, y: 0 }, params: {} },
  },
  edges: {
    e1: { id: 'e1', source: { nodeId: 'g1', port: 'out_0' }, target: { nodeId: 'o1', port: 'in_0' } },
    e2: { id: 'e2', source: { nodeId: 'n1', port: 'out_0' }, target: { nodeId: 'g1', port: 'in_0' } },
  },
}

describe('pipeline-summary', () => {
  it('strips params and marks summarized', () => {
    const s = summarizePipeline(snap)!
    expect(s.summarized).toBe(true)
    expect(s.nodeCount).toBe(3)
    expect(JSON.stringify(s)).not.toContain('portCount')
    expect(s.nodes.find((n) => n.id === 'n1')?.name).toBe('望江客栈')
    expect(s.exportChain?.treeMerge).toBe('g1')
    expect(s.exportChain?.sceneOutput).toBe('o1')
  })

  it('scopes to groupId neighborhood', () => {
    const s = summarizePipeline(snap, { groupId: 'g1' })!
    expect(s.nodes.map((n) => n.id).sort()).toEqual(['g1', 'n1', 'o1'])
    expect(s.edges).toHaveLength(2)
  })

  it('hashOnly mode is tiny', () => {
    const h = pipelineHashOnly(snap)!
    expect(h.hashOnly).toBe(true)
    expect(h.nodeCount).toBe(3)
    expect(Object.keys(h)).not.toContain('nodes')
  })

  // P0-3 (2026-07-15 tool 升级方案): grep 式模糊过滤。
  describe('nameContains / opIdIn fuzzy filter (P0-3)', () => {
    it('nameContains matches case-insensitively and expands to neighbors (same nodeTouchesSet behavior as groupId/nodeIds)', () => {
      const s = summarizePipeline(snap, { nameContains: '望江' })!
      // n1 直接命中；g1 是 n1 的一跳邻居（e2）；o1 又是 g1 的邻居（e1）——这跟已有
      // groupId/nodeIds 的邻居展开算法完全一致（filter 用的是同一个 nodeTouchesSet），
      // 这里只验证新的命中源（name 子串）接入了同一套既有展开逻辑，不是重新发明。
      expect(s.nodes.map((n) => n.id).sort()).toEqual(['g1', 'n1', 'o1'])
      expect(s.search).toEqual({ matchCount: 1 })
    })

    it('opIdIn matches by exact opId and reports matchCount', () => {
      const s = summarizePipeline(snap, { opIdIn: ['tree_merge', 'scene_output'] })!
      expect(s.search).toEqual({ matchCount: 2 })
      expect(s.nodes.map((n) => n.id).sort()).toEqual(['g1', 'n1', 'o1'])
    })

    it('returns an EMPTY node list (not a silent fallback to the full graph) when the filter matches nothing', () => {
      const s = summarizePipeline(snap, { nameContains: 'no-such-name-anywhere' })!
      expect(s.search).toEqual({ matchCount: 0 })
      expect(s.nodes).toEqual([])
      expect(s.edges).toEqual([])
    })

    /** Production: agent searched nameContains=p1d_ for PlaceOne groups whose
     *  battery name is PlaceOneDecoration but id is p1d_gate — matchCount 0
     *  made it think the groups vanished and burn turns on raw full-graph. */
    it('nameContains also matches node id substrings (instantiate groupIds)', () => {
      const s = summarizePipeline(snap, { nameContains: 'n1' })!
      expect(s.search?.matchCount).toBeGreaterThanOrEqual(1)
      expect(s.nodes.some((n) => n.id === 'n1')).toBe(true)
    })

    it('unions with groupId/nodeIds when combined', () => {
      const s = summarizePipeline(snap, { groupId: 'o1', nameContains: '望江' })!
      // o1's neighborhood (g1) ∪ n1's neighborhood (g1) — g1 links both, so this
      // still converges on {g1, n1, o1}, but matchCount only counts the search hit (n1).
      expect(s.nodes.map((n) => n.id).sort()).toEqual(['g1', 'n1', 'o1'])
      expect(s.search).toEqual({ matchCount: 1 })
    })

    it('omits `search` entirely when neither filter is passed (no regression for groupId/nodeIds-only callers)', () => {
      const s = summarizePipeline(snap, { groupId: 'g1' })!
      expect(s.search).toBeUndefined()
    })
  })
})
