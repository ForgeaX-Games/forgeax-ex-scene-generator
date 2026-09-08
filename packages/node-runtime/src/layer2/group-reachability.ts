// Reachability GC for the flat group registry. A sub-group is kept alive only
// while some top-level __group__ shadow node reaches it through the
// params.groupId reference closure. ungroup/deleteGroup may strand a sub-group;
// applyBatch sweeps the orphans before persisting.

import type { GraphFileV1 } from '../layer1/storage/types.js'
import type { NodeGroup } from '../layer1/types/graph.js'
import { GROUP_OP_ID } from './apply-batch.js'

function childGroupIds(group: NodeGroup): string[] {
  return group.nodes
    .filter((n) => n.opId === GROUP_OP_ID)
    .map((n) => (typeof n.params?.groupId === 'string' ? n.params.groupId : ''))
    .filter((id): id is string => id.length > 0)
}

export function collectReachableGroupIds(graph: GraphFileV1): Set<string> {
  const groups = graph.groups ?? {}
  const reachable = new Set<string>()
  const stack: string[] = []
  for (const node of Object.values(graph.nodes)) {
    if (node.opId === GROUP_OP_ID) {
      const gid = typeof node.params?.groupId === 'string' ? node.params.groupId : ''
      if (gid && groups[gid]) stack.push(gid)
    }
  }
  while (stack.length > 0) {
    const gid = stack.pop()!
    if (reachable.has(gid)) continue
    reachable.add(gid)
    const g = groups[gid]
    if (!g) continue
    for (const child of childGroupIds(g)) {
      if (groups[child] && !reachable.has(child)) stack.push(child)
    }
  }
  return reachable
}

/** Delete every group entry not in the reachable set. Mutates graph.groups. */
export function gcOrphanGroups(graph: GraphFileV1): void {
  if (!graph.groups) return
  const reachable = collectReachableGroupIds(graph)
  for (const gid of Object.keys(graph.groups)) {
    if (!reachable.has(gid)) delete graph.groups[gid]
  }
}
