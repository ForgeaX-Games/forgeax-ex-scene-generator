import { describe, expect, it } from 'vitest'
import { refSceneNode } from './index.js'
import { contentSchema, getNode, parseScenePort } from '../../../../vendor/shared/types/index.js'

describe('refSceneNode', () => {
  it('keeps a Ref prim when mesh is missing', () => {
    const res = refSceneNode({
      name: 'HouseBox',
      module: 'modules/house-box.scene.ts',
      exportName: 'HouseBox',
    })
    expect(res.error).toBeUndefined()
    expect(res.triangleCount).toBe(0)
    const port = parseScenePort(res.scene)
    expect(port).toBeTruthy()
    const node = getNode(port!.graph, port!.focus)
    expect(node?.schema).toBe('ref')
    expect(contentSchema(node?.content)).toBe('ref')
    expect((node?.content as { module?: string }).module).toBe('modules/house-box.scene.ts')
  })

  it('attaches mesh when provided', () => {
    const mesh = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2], role: 'houses' as const }
    const res = refSceneNode({
      name: 'HouseBox',
      module: 'modules/house-box.scene.ts',
      mesh,
    })
    expect(res.triangleCount).toBe(1)
    const port = parseScenePort(res.scene)
    const node = getNode(port!.graph, port!.focus)
    expect((node?.content as { mesh?: { role?: string } }).mesh?.role).toBe('houses')
  })

  it('rejects an empty name', () => {
    expect(refSceneNode({ module: 'modules/house-box.scene.ts' }).error).toBeDefined()
  })
})
