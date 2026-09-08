import { describe, expect, it } from 'vitest'
import { pointsToNode } from '../../batteries/scene/bridge/points_to_node/index.ts'
import { contentSchema } from '../../vendor/shared/types/scene/content.ts'

describe('points_to_node', () => {
  it('hangs a point2d list as content.schema=points and echoes the list', () => {
    const out = pointsToNode({
      name: 'Guide',
      points: [[6, 24], [18, 20], [30, 26], [42, 22]],
    })
    expect(out.error).toBeUndefined()
    expect(out.pointCount).toBe(4)
    expect(out.points).toEqual([[6, 24], [18, 20], [30, 26], [42, 22]])
    expect(out.scene).toBeDefined()
    const node = out.scene!.graph.get(out.scene!.focus)
    expect(contentSchema(node?.content)).toBe('points')
  })
})
