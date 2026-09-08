import { describe, expect, it } from 'vitest'

import { assignCreatedNodeLayouts } from '../src/scene-script/adapter/runtimeBatchAdapter.js'
import { layoutKey } from '../src/scene-script/persist/store.js'

describe('assignCreatedNodeLayouts', () => {
  it('stamps the canvas drop position onto the newly compiled public statement', () => {
    const layout: Record<string, { x: number; y: number }> = {
      [layoutKey('module.main', 'stmt-empty')]: { x: 0, y: 0 },
    }
    assignCreatedNodeLayouts({
      previousSourceMap: [{ statementId: 'stmt-empty' }],
      compiledSourceMap: [
        { statementId: 'stmt-empty', moduleId: 'module.main', entityId: 'empty', runtimeNodeIds: [] },
        { statementId: 'stmt-noise', moduleId: 'module.main', entityId: 'compiled-noise', runtimeNodeIds: [] },
      ],
      compiledNodes: [
        { id: 'empty', opId: 'empty_scene' },
        { id: 'compiled-noise', opId: 'relu' },
      ],
      created: [{ opId: 'relu', position: { x: 480, y: 240 } }],
      layout,
    })
    expect(layout[layoutKey('module.main', 'stmt-noise')]).toEqual({ x: 480, y: 240 })
    expect(layout[layoutKey('module.main', 'stmt-empty')]).toEqual({ x: 0, y: 0 })
  })

  it('pairs multiple drops of the same op in statement order', () => {
    const layout: Record<string, { x: number; y: number }> = {}
    assignCreatedNodeLayouts({
      previousSourceMap: [],
      compiledSourceMap: [
        { statementId: 'a', moduleId: 'module.main', entityId: 'n1', runtimeNodeIds: [] },
        { statementId: 'b', moduleId: 'module.main', entityId: 'n2', runtimeNodeIds: [] },
      ],
      compiledNodes: [
        { id: 'n1', opId: 'relu' },
        { id: 'n2', opId: 'relu' },
      ],
      created: [
        { opId: 'relu', position: { x: 10, y: 20 } },
        { opId: 'relu', position: { x: 30, y: 40 } },
      ],
      layout,
    })
    expect(layout[layoutKey('module.main', 'a')]).toEqual({ x: 10, y: 20 })
    expect(layout[layoutKey('module.main', 'b')]).toEqual({ x: 30, y: 40 })
  })
})
