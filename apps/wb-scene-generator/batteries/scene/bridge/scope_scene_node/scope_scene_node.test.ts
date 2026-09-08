import { describe, expect, it } from 'vitest'
import { scopeSceneNode } from './index.js'
import { getNode, parseScenePort } from '../../../../vendor/shared/types/index.js'

describe('scopeSceneNode', () => {
  it('creates a named grouping prim', () => {
    const res = scopeSceneNode({ name: 'Houses', schema: 'houses' })
    expect(res.error).toBeUndefined()
    const port = parseScenePort(res.scene)
    const node = getNode(port!.graph, port!.focus)
    expect(node?.name).toBe('Houses')
    expect(node?.schema).toBe('houses')
    expect(node?.content).toBeUndefined()
  })
})
