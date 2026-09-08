import { describe, it, expect } from 'vitest'
import { keypointLayout } from './index.ts'

const sample = {
  hierarchy: {
    id: 'root',
    name: '公寓',
    area: 85,
    extra: 'keep-me',
    children: [
      { id: 'living', name: '客厅', area: 30, children: [] },
      {
        id: 'bedroom',
        name: '卧室',
        area: 18,
        children: [{ id: 'closet', name: '衣柜', area: 3, children: [] }],
      },
    ],
  },
  relations: [
    { from: 'living', to: 'bedroom', kind: 'clearance', distance: 2.5 },
    { from: 'bedroom', to: 'living', kind: 'orientation', direction: 'E' },
  ],
}

function collectPositions(node: any, out: Record<string, { x: number; y: number }>): void {
  if (node.id && node.position) out[node.id] = node.position
  for (const c of node.children ?? []) collectPositions(c, out)
}

describe('keypointLayout', () => {
  it('attaches a finite position to every node and preserves other fields', () => {
    const out = keypointLayout({ keypoint: sample }) as { keypoint: any }
    const positions: Record<string, { x: number; y: number }> = {}
    collectPositions(out.keypoint.hierarchy, positions)
    expect(Object.keys(positions).sort()).toEqual(['bedroom', 'closet', 'living', 'root'])
    for (const p of Object.values(positions)) {
      expect(Number.isFinite(p.x)).toBe(true)
      expect(Number.isFinite(p.y)).toBe(true)
    }
    // unknown fields preserved, relations passed through
    expect(out.keypoint.hierarchy.extra).toBe('keep-me')
    expect(out.keypoint.relations).toHaveLength(2)
  })

  it('does not mutate the input', () => {
    const input = { keypoint: sample }
    keypointLayout(input)
    expect(input.keypoint.hierarchy).not.toHaveProperty('position')
  })

  it('accepts a JSON string and returns raw when unparseable / empty', () => {
    const out = keypointLayout({ keypoint: JSON.stringify(sample) }) as { keypoint: any }
    const positions: Record<string, { x: number; y: number }> = {}
    collectPositions(out.keypoint.hierarchy, positions)
    expect(Object.keys(positions)).toHaveLength(4)

    expect(keypointLayout({ keypoint: 'garbage' })).toEqual({ keypoint: 'garbage' })
    expect(keypointLayout({})).toEqual({ keypoint: undefined })
  })
})
