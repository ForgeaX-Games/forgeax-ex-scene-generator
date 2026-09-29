import { describe, expect, it } from 'vitest'

import type { SceneCallRecord } from './host.js'
import { diagnoseSceneSemantics } from './semantics.js'

function call(
  functionName: string,
  result: unknown,
  args: Record<string, unknown> = {},
  id = functionName,
): SceneCallRecord {
  return {
    id,
    functionName,
    args,
    result,
    source: { file: 'main.scene.ts', line: 3, column: 1 },
    argRefs: [],
    reused: false,
  }
}

const emptyTree = {
  graph: {
    root: { id: 'root', name: '', parent: null, children: {} },
  },
  focus: 'root',
}

const meshTree = {
  graph: {
    n: {
      id: 'n',
      name: 'range',
      parent: null,
      children: {},
      schema: 'mesh',
      content: { schema: 'mesh', mesh: { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] } },
    },
  },
  focus: 'n',
}

const voxelTree = {
  graph: {
    v: {
      id: 'v',
      name: 'mass',
      parent: null,
      children: {},
      schema: 'voxel',
      content: { schema: 'voxel', volume: { kind: 'sparse' } },
    },
  },
  focus: 'v',
}

const heightfieldPacket = {
  type: 'heightfield',
  geometry: { kind: 'plane', width: 10, height: 8 },
  columns: 2,
  rows: 2,
  height: [[0, 1], [1, 2]],
  mask: [[1, 1], [1, 1]],
  attributes: {},
}

describe('diagnoseSceneSemantics', () => {
  it('warns SCENE_OUTPUT_INCOMPLETE when sceneOutput assembles an empty tree', () => {
    const diagnostics = diagnoseSceneSemantics({
      files: { 'main.scene.ts': '' },
      entryFile: 'main.scene.ts',
      trace: [
        call('emptyScene', emptyTree),
        call('sceneOutput', { scene: emptyTree }, { scene: emptyTree }, 'out'),
      ],
    })
    expect(diagnostics.some((item) => item.code === 'SCENE_OUTPUT_INCOMPLETE')).toBe(true)
    expect(diagnostics.find((item) => item.code === 'SCENE_OUTPUT_INCOMPLETE')?.source?.statementId).toBe('out')
  })

  it('does not warn SCENE_OUTPUT_INCOMPLETE when the assembled tree has hangable mesh', () => {
    const diagnostics = diagnoseSceneSemantics({
      files: { 'main.scene.ts': '' },
      entryFile: 'main.scene.ts',
      trace: [
        call('sceneNode', { scene: meshTree, schema: 'mesh' }),
        call('sceneOutput', { scene: meshTree }, { scene: meshTree }),
      ],
    })
    expect(diagnostics.some((item) => item.code === 'SCENE_OUTPUT_INCOMPLETE')).toBe(false)
    expect(diagnostics.some((item) => item.code === 'SCENE_HEIGHTFIELD_NOT_IN_SCENE')).toBe(false)
  })

  it('warns SCENE_HEIGHTFIELD_NOT_IN_SCENE when a packet is never woven or hung', () => {
    const diagnostics = diagnoseSceneSemantics({
      files: { 'main.scene.ts': '' },
      entryFile: 'main.scene.ts',
      trace: [
        call('basePlane', { kind: 'plane', width: 10, height: 8 }, {}, 'world'),
        call('heightfield', heightfieldPacket, {}, 'field'),
        call('emptyScene', emptyTree),
        call('sceneOutput', { scene: emptyTree }, { scene: emptyTree }, 'out'),
      ],
    })
    expect(diagnostics.some((item) => item.code === 'SCENE_OUTPUT_INCOMPLETE')).toBe(true)
    const unused = diagnostics.find((item) => item.code === 'SCENE_HEIGHTFIELD_NOT_IN_SCENE')
    expect(unused).toBeDefined()
    expect(unused?.source?.statementId).toBe('field')
  })

  it('locates SCENE_HEIGHTFIELD_NOT_IN_SCENE on heightfieldMesh when woven but not hung', () => {
    const diagnostics = diagnoseSceneSemantics({
      files: { 'main.scene.ts': '' },
      entryFile: 'main.scene.ts',
      trace: [
        call('heightfield', heightfieldPacket, {}, 'field'),
        call('heightfieldMesh', { kind: 'mesh', positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] }, {}, 'woven'),
        call('sceneOutput', { scene: emptyTree }, { scene: emptyTree }, 'out'),
      ],
    })
    expect(diagnostics.find((item) => item.code === 'SCENE_HEIGHTFIELD_NOT_IN_SCENE')?.source?.statementId).toBe('woven')
  })

  it('keeps SCENE_HEIGHTFIELD_NOT_IN_SCENE when voxels are hung but the packet is unused', () => {
    const diagnostics = diagnoseSceneSemantics({
      files: { 'main.scene.ts': '' },
      entryFile: 'main.scene.ts',
      trace: [
        call('heightfield', heightfieldPacket, {}, 'field'),
        call('sceneNode', { scene: voxelTree, schema: 'voxel' }),
        call('sceneOutput', { scene: voxelTree }, { scene: voxelTree }),
      ],
    })
    expect(diagnostics.some((item) => item.code === 'SCENE_OUTPUT_INCOMPLETE')).toBe(false)
    expect(diagnostics.some((item) => item.code === 'SCENE_HEIGHTFIELD_NOT_IN_SCENE')).toBe(true)
  })

  it('does not warn SCENE_HEIGHTFIELD_NOT_IN_SCENE after weave + hang + sceneOutput', () => {
    const diagnostics = diagnoseSceneSemantics({
      files: { 'main.scene.ts': '' },
      entryFile: 'main.scene.ts',
      trace: [
        call('basePlane', { kind: 'plane', width: 10, height: 8 }, {}, 'world'),
        call('heightfield', heightfieldPacket, {}, 'field'),
        call('heightfieldMesh', { kind: 'mesh', positions: [0, 0, 0], indices: [0, 1, 2] }, {}, 'woven'),
        call('sceneNode', { scene: meshTree, schema: 'mesh' }),
        call('sceneOutput', { scene: meshTree }, { scene: meshTree }),
      ],
    })
    expect(diagnostics).toEqual([])
  })
})
