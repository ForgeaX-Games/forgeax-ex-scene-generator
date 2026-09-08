import { describe, expect, it } from 'vitest'

import { collectReachableGroupIds } from '../layer2/group-reachability.js'
import { GROUP_OP_ID } from '../layer2/apply-batch.js'

function graphWith(
  nodes: Record<string, { opId: string; params?: Record<string, unknown> }>,
  groups: Record<string, { nodes: { id: string; opId: string; params?: Record<string, unknown> }[] }>,
) {
  return { nodes, groups } as never
}

describe('collectReachableGroupIds', () => {
  it('marks a top-level group and its nested child reachable', () => {
    const g = graphWith(
      { g_outer: { opId: GROUP_OP_ID, params: { groupId: 'g_outer' } } },
      {
        g_outer: { nodes: [{ id: 'g_inner', opId: GROUP_OP_ID, params: { groupId: 'g_inner' } }] },
        g_inner: { nodes: [] },
      },
    )
    expect(collectReachableGroupIds(g)).toEqual(new Set(['g_outer', 'g_inner']))
  })

  it('excludes an orphan group with no top-level reference', () => {
    const g = graphWith(
      { g_a: { opId: GROUP_OP_ID, params: { groupId: 'g_a' } } },
      { g_a: { nodes: [] }, g_orphan: { nodes: [] } },
    )
    expect(collectReachableGroupIds(g)).toEqual(new Set(['g_a']))
  })
})
