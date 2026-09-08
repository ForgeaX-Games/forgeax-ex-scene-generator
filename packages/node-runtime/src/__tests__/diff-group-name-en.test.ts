// Regression: a group carrying an English name must not diff as "changed" on
// every persist. The old condition was `nameEn !== undefined` (is it set at
// all) instead of a value comparison, so every autosave/drag/preview-toggle
// batch shipped one no-op `updateGroup` per named group — and each of those
// invalidated the group's output cache plus its whole downstream, which is why
// port probes flipped back to "—" a few seconds after a run.
import { describe, expect, it } from 'vitest'

import { diffPipelineToOps } from '../layer2/diff-pipeline.js'
import type { DesiredPipelineInput } from '../layer2/diff-pipeline.js'

const GROUP_OP_ID = '__group__'

function makeGroup(nameEn: string) {
  return {
    id: 'g1',
    name: 'AddBaseGrid',
    nameEn,
    position: { x: 0, y: 0 },
    nodes: [],
    edges: [],
    exposedInputs: [],
    exposedOutputs: [],
  }
}

function makeDesired(nameEn: string): DesiredPipelineInput {
  return {
    nodes: [
      {
        id: 'g1',
        opId: GROUP_OP_ID,
        name: 'AddBaseGrid',
        params: { groupId: 'g1' },
        position: { x: 0, y: 0 },
      },
    ],
    edges: [],
    groups: [makeGroup(nameEn)],
  } as unknown as DesiredPipelineInput
}

const snapshot = {
  nodes: {
    g1: { id: 'g1', opId: GROUP_OP_ID, name: 'AddBaseGrid', params: {}, position: { x: 0, y: 0 } },
  },
  edges: {},
} as never

describe('diffPipelineToOps — group nameEn', () => {
  it('emits no op when the English name is unchanged', () => {
    const ops = diffPipelineToOps(makeDesired('AddBaseGrid'), snapshot, [
      makeGroup('AddBaseGrid') as never,
    ])
    expect(ops.filter((op) => op.type === 'updateGroup')).toEqual([])
  })

  it('emits updateGroup when the English name actually changes', () => {
    const ops = diffPipelineToOps(makeDesired('BaseGrid'), snapshot, [
      makeGroup('AddBaseGrid') as never,
    ])
    expect(ops.filter((op) => op.type === 'updateGroup')).toEqual([
      { type: 'updateGroup', groupId: 'g1', nameEn: 'BaseGrid' },
    ])
  })
})
