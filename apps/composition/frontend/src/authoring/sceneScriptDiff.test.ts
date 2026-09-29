import { describe, expect, it } from 'vitest'

import { diffSemanticGraph, diffTextLines, digestPngDataUrl } from './sceneScriptDiff.js'

describe('sceneScriptDiff', () => {
  it('produces a minimal line edit script', () => {
    const diff = diffTextLines('one\ntwo\nthree', 'one\nchanged\nthree')
    expect(diff.filter((line) => line.kind !== 'unchanged')).toEqual([
      { kind: 'added', text: 'changed', newLine: 2 },
      { kind: 'removed', text: 'two', oldLine: 2 },
    ])
  })

  it('classifies semantic entity, edge, and group changes with source-map ownership', () => {
    const node = (id: string, size: number) => ({
      id,
      opId: 'grid',
      position: { x: 0, y: 0 },
      params: { size },
    })
    const edge = {
      id: 'e1',
      source: { nodeId: 'n1', port: 'grid' },
      target: { nodeId: 'n2', port: 'scene' },
    }
    const before = {
      pipeline: {
        id: 'main',
        hash: 'h1',
        createdAt: '',
        updatedAt: '',
        nodes: { n1: node('n1', 8) },
        edges: {},
      },
      groups: [{
        id: 'g1',
        name: 'Before',
        nodes: [],
        edges: [],
        position: { x: 0, y: 0 },
        exposedInputs: [],
        exposedOutputs: [],
      }],
    }
    const after = {
      pipeline: {
        id: 'main',
        hash: 'h2',
        createdAt: '',
        updatedAt: '',
        nodes: { n1: node('n1', 12), n2: node('n2', 1) },
        edges: { e1: edge },
      },
      groups: [{
        ...before.groups[0],
        name: 'After',
      }],
    }
    const sourceMap = [{
      statementId: 'stmt-1',
      entityId: 'n1',
      runtimeNodeIds: ['n1', 'n2'],
      source: { file: 'main.scene.ts', start: 0, end: 10, line: 1, column: 1 },
    }]

    const result = diffSemanticGraph(before, after, sourceMap)
    expect(result.counts).toEqual({
      entity: { added: 1, removed: 0, modified: 1 },
      edge: { added: 1, removed: 0, modified: 0 },
      group: { added: 0, removed: 0, modified: 1 },
    })
    expect(result.changes.every((change) => change.kind === 'group' || change.statementId === 'stmt-1')).toBe(true)
  })

  it('uses actual PNG content for stable changed/unchanged digests', () => {
    expect(digestPngDataUrl('data:image/png;base64,same')).toBe(digestPngDataUrl('data:image/png;base64,same'))
    expect(digestPngDataUrl('data:image/png;base64,before')).not.toBe(
      digestPngDataUrl('data:image/png;base64,after'),
    )
  })
})
