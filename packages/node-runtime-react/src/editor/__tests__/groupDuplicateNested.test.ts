// Regression: duplicating (Ctrl+V / Ctrl+drag) a group that CONTAINS a nested
// child group must duplicate the whole tree. Duplicating with a bare
// `remapGroupIds` gave the nested `__group__` member an unrelated `node-…` id
// while its params.groupId still pointed at the SOURCE's child, so the persist
// diff emitted a `createGroup` whose member was never created. The kernel
// rejects the WHOLE batch on `member X does not exist`, which is why every node
// in that paste vanished on refresh and never participated in execution.

import { describe, expect, it } from 'vitest'

import type { Op, OpSpec } from '@forgeax/node-runtime'

import { createMockApiClient } from '../../test/mockApiClient.js'
import { duplicateGroupTree } from '../components/canvas/groupViewUtils.js'
import { diffPipelineToOps } from '../transport/mappers.js'
import type { NodeGroup, Pipeline } from '../types.js'

function spec(id: string, name: string): OpSpec {
  return { id, name, inputs: [], outputs: [], params: [], execute: () => null }
}

function childGroup(): NodeGroup {
  return {
    id: 'C',
    name: 'Child',
    position: { x: 0, y: 0 },
    nodes: [{ id: 'leaf', batteryId: 'a.io', name: 'IO', position: { x: 0, y: 0 }, params: {} }],
    edges: [],
    exposedInputs: [{ portName: 'in_0', portType: 'scene', sourceNodeId: 'leaf', sourcePortName: 'in' }],
    exposedOutputs: [{ portName: 'out_0', portType: 'scene', sourceNodeId: 'leaf', sourcePortName: 'out' }],
  }
}

function parentGroup(): NodeGroup {
  return {
    id: 'P',
    name: 'Parent',
    position: { x: 10, y: 10 },
    nodes: [{ id: 'C', batteryId: '__group__', name: 'Child', position: { x: 0, y: 0 }, params: { groupId: 'C' } }],
    edges: [],
    exposedInputs: [{ portName: 'in_0', portType: 'scene', sourceNodeId: 'C', sourcePortName: 'in_0' }],
    exposedOutputs: [{ portName: 'out_0', portType: 'scene', sourceNodeId: 'C', sourcePortName: 'out_0' }],
  }
}

function pipelineWith(groups: NodeGroup[], shadowIds: Array<{ id: string; name: string; position: { x: number; y: number } }>): Pipeline {
  const now = '1970-01-01T00:00:00.000Z'
  return {
    id: 'p',
    name: 'p',
    description: '',
    nodes: shadowIds.map((s) => ({ id: s.id, batteryId: '__group__', name: s.name, position: s.position, params: { groupId: s.id } })),
    edges: [],
    groups,
    viewport: { x: 0, y: 0, zoom: 1 },
    status: 'idle',
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Replay the kernel's op-validation rule for group members (apply-batch
 * `createGroup`: every memberNodeId must be a live top-level node when the op
 * runs; creating a group consumes its members and mints the shadow).
 */
function unmaterializedGroupMembers(ops: readonly Op[], liveNodeIds: Set<string>): string[] {
  const live = new Set(liveNodeIds)
  const missing: string[] = []
  for (const op of ops) {
    if (op.type === 'createNode') live.add(op.nodeId)
    else if (op.type === 'deleteNode') live.delete(op.nodeId)
    else if (op.type === 'createGroup') {
      for (const id of op.memberNodeIds) {
        if (!live.has(id)) missing.push(id)
        live.delete(id)
      }
      live.add(op.groupId)
    }
  }
  return missing
}

describe('duplicating a group with a nested child group', () => {
  it('remaps the whole tree so the nested member id stays the child group id', () => {
    const parent = parentGroup()
    const { root, deps } = duplicateGroupTree(parent, { x: 200, y: 200 }, [parent, childGroup()])

    expect(deps).toHaveLength(1)
    expect(root.id).not.toBe('P')
    expect(deps[0]!.id).not.toBe('C')

    const nested = root.nodes.find((n) => n.batteryId === '__group__')!
    // The kernel invariant: a nested member's shadow id IS its group id.
    expect(nested.id).toBe(deps[0]!.id)
    expect(nested.params.groupId).toBe(deps[0]!.id)
    // The child's own members get fresh ids too (no collision with the source).
    expect(deps[0]!.nodes[0]!.id).not.toBe('leaf')
  })

  it('persists cleanly: every createGroup member is materialised by an earlier op', async () => {
    const client = createMockApiClient({ ops: [spec('a.io', 'IO')] })

    // Seed the kernel with a dropped nested template (parent P holding child C).
    const dropped = pipelineWith([parentGroup(), childGroup()], [{ id: 'P', name: 'Parent', position: { x: 10, y: 10 } }])
    await client.applyBatch(diffPipelineToOps(dropped, await client.getPipeline(), await client.listGroups()))

    const current = await client.getPipeline()
    const currentGroups = await client.listGroups()
    expect(currentGroups.map((g) => g.id).sort()).toEqual(['C', 'P'])

    // Ctrl+V the parent.
    const source = dropped.groups!.find((g) => g.id === 'P')!
    const { root, deps } = duplicateGroupTree(source, { x: 200, y: 200 }, dropped.groups)

    const desired = pipelineWith(
      [...dropped.groups!, root, ...deps],
      [
        { id: 'P', name: 'Parent', position: { x: 10, y: 10 } },
        { id: root.id, name: root.name, position: { x: 200, y: 200 } },
      ],
    )

    const ops = diffPipelineToOps(desired, current, currentGroups)

    // THE BUG: the copy's nested member was never created, so the kernel
    // rejected the whole batch and the paste was lost on refresh.
    expect(unmaterializedGroupMembers(ops, new Set(Object.keys(current!.nodes)))).toEqual([])
    // Child-first: the duplicated child group is created before its parent.
    const idxChild = ops.findIndex((o) => o.type === 'createGroup' && o.groupId === deps[0]!.id)
    const idxRoot = ops.findIndex((o) => o.type === 'createGroup' && o.groupId === root.id)
    expect(idxChild).toBeGreaterThanOrEqual(0)
    expect(idxRoot).toBeGreaterThan(idxChild)
    // The source group must not be touched by the copy.
    expect(ops.some((o) => o.type === 'deleteGroup' || o.type === 'ungroup')).toBe(false)

    const res = await client.applyBatch(ops)
    expect(res.status).toBe('ok')
    const idsAfter = (await client.listGroups()).map((g) => g.id)
    expect(idsAfter).toContain(root.id)
    expect(idsAfter).toContain(deps[0]!.id)
  })
})
