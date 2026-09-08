// Regression: a NESTED group's exposed ports must show the real inner port name,
// not the child's opaque stable id (`in_1`/`out_0`). The human `portLabel` is
// presentation-only and is dropped on persistence, so after a reload the parent
// port's `sourcePortName` is the child's stable id. `getGroupPortDisplayLabel`
// must descend into the child group (sourceNodeId === child group id) to resolve
// a readable label. See groupViewUtils.resolveNestedSourceLabel.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { usePipelineStore } from '../stores/pipelineStore.js'
import { getGroupPortDisplayLabel } from '../components/canvas/groupViewUtils.js'
import type { NodeGroup, Pipeline } from '../types.js'

// Child group (e.g. dragged from the library): stable ids + real leaf port names.
const childGroup: NodeGroup = {
  id: 'group_child',
  name: 'Child',
  nameEn: 'Child',
  position: { x: 0, y: 0 },
  nodes: [{ id: 'leaf', batteryId: 'demo.echo', name: 'Echo', position: { x: 0, y: 0 }, params: {} }],
  exposedInputs: [
    { portName: 'in_0', portType: 'image', sourceNodeId: 'leaf', sourcePortName: 'image' },
    { portName: 'in_1', portType: 'number', sourceNodeId: 'leaf', sourcePortName: 'k_colors' },
  ],
  exposedOutputs: [
    { portName: 'out_0', portType: 'image', sourceNodeId: 'leaf', sourcePortName: 'image' },
  ],
}

// Parent group nesting the child: its exposed ports reference the child group's
// shadow node (id === child group id) via the child's stable port ids, WITHOUT a
// persisted portLabel (the post-reload state).
const parentGroup: NodeGroup = {
  id: 'group_parent',
  name: 'Parent',
  nameEn: 'Parent',
  position: { x: 0, y: 0 },
  nodes: [{ id: 'group_child', batteryId: '__group__', name: 'Child', position: { x: 0, y: 0 }, params: { groupId: 'group_child' } }],
  exposedInputs: [
    { portName: 'in_0', portType: 'image', sourceNodeId: 'group_child', sourcePortName: 'in_0' },
    { portName: 'in_1', portType: 'number', sourceNodeId: 'group_child', sourcePortName: 'in_1' },
  ],
  exposedOutputs: [
    { portName: 'out_0', portType: 'image', sourceNodeId: 'group_child', sourcePortName: 'out_0' },
  ],
}

function pipeline(): Pipeline {
  const now = new Date().toISOString()
  return {
    id: 'p', name: 'p', description: '',
    nodes: [{ id: 'group_parent', batteryId: '__group__', name: 'Parent', position: { x: 0, y: 0 }, params: { groupId: 'group_parent' } }],
    edges: [],
    groups: [parentGroup, childGroup],
    viewport: { x: 0, y: 0, zoom: 1 },
    status: 'idle', createdAt: now, updatedAt: now,
  }
}

beforeEach(() => {
  usePipelineStore.setState({ currentPipeline: pipeline() })
})

afterEach(() => {
  usePipelineStore.setState({ currentPipeline: null })
})

describe('nested group exposed-port labels', () => {
  it('resolves the real inner port name through the nested child group', () => {
    expect(getGroupPortDisplayLabel(parentGroup.exposedInputs[0], false)).toBe('image')
    expect(getGroupPortDisplayLabel(parentGroup.exposedInputs[1], false)).toBe('k_colors')
    expect(getGroupPortDisplayLabel(parentGroup.exposedOutputs[0], false)).toBe('image')
  })

  it('does not regress non-nested ports (plain sourcePortName fallback)', () => {
    expect(getGroupPortDisplayLabel(childGroup.exposedInputs[1], false)).toBe('k_colors')
  })

  it('still honours an explicit portLabel / customLabel override', () => {
    expect(getGroupPortDisplayLabel({ ...parentGroup.exposedInputs[1], portLabel: '颜色数' }, false)).toBe('颜色数')
    expect(getGroupPortDisplayLabel({ ...parentGroup.exposedInputs[1], customLabel: 'My Port' }, false)).toBe('My Port')
  })
})
