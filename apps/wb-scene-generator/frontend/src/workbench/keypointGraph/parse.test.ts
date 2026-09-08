import { describe, expect, it } from 'vitest'

import { parseKeypoint } from './parse.js'

const VALID = {
  hierarchy: {
    id: 'root',
    name: '公寓',
    area: 85,
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

describe('parseKeypoint', () => {
  it('parses a valid keypoint into nodes, parent edges and relation edges', () => {
    const m = parseKeypoint(VALID)
    expect(m.warnings).toEqual([])
    expect(m.rootId).toBe('root')
    expect(m.nodes.map((n) => n.id).sort()).toEqual(['bedroom', 'closet', 'living', 'root'])

    const closet = m.nodes.find((n) => n.id === 'closet')!
    expect(closet.depth).toBe(2)
    expect(closet.parentId).toBe('bedroom')
    expect(closet.area).toBe(3)

    // root → living, root → bedroom, bedroom → closet
    expect(m.parentEdges).toHaveLength(3)
    expect(m.parentEdges).toContainEqual({ from: 'root', to: 'living' })
    expect(m.parentEdges).toContainEqual({ from: 'bedroom', to: 'closet' })

    expect(m.relationEdges).toHaveLength(2)
    expect(m.relationEdges[0]).toMatchObject({ kind: 'clearance', distance: 2.5, from: 'living', to: 'bedroom' })
    expect(m.relationEdges[1]).toMatchObject({ kind: 'orientation', direction: 'E' })
  })

  it('accepts a JSON string and rejects malformed JSON gracefully', () => {
    expect(parseKeypoint(JSON.stringify(VALID)).nodes).toHaveLength(4)
    const bad = parseKeypoint('{not json')
    expect(bad.nodes).toHaveLength(0)
    expect(bad.warnings.length).toBeGreaterThan(0)
  })

  it('warns on missing fields without throwing', () => {
    const m = parseKeypoint({ hierarchy: { id: 'a', children: [{ id: 'b' }] } })
    expect(m.nodes.find((n) => n.id === 'a')!.name).toBe('a') // name defaults to id
    expect(m.nodes.find((n) => n.id === 'b')!.area).toBe(0)
    expect(m.warnings.some((w) => w.includes('area'))).toBe(true)
  })

  it('drops duplicate ids with a warning', () => {
    const m = parseKeypoint({
      hierarchy: { id: 'a', area: 1, children: [{ id: 'a', area: 2, children: [] }] },
    })
    expect(m.nodes).toHaveLength(1)
    expect(m.warnings.some((w) => w.includes('重复'))).toBe(true)
  })

  it('drops relations referencing unknown nodes', () => {
    const m = parseKeypoint({
      hierarchy: { id: 'a', area: 1, children: [] },
      relations: [{ from: 'a', to: 'ghost', kind: 'clearance', distance: 1 }],
    })
    expect(m.relationEdges).toHaveLength(0)
    expect(m.warnings.some((w) => w.includes('不存在'))).toBe(true)
  })

  it('drops clearance edges without a numeric distance and unsupported kinds', () => {
    const m = parseKeypoint({
      hierarchy: { id: 'a', area: 1, children: [{ id: 'b', area: 1, children: [] }] },
      relations: [
        { from: 'a', to: 'b', kind: 'clearance' },
        { from: 'a', to: 'b', kind: 'wormhole' },
      ],
    })
    expect(m.relationEdges).toHaveLength(0)
    expect(m.warnings.length).toBeGreaterThanOrEqual(2)
  })

  it('returns an empty model for non-object input', () => {
    expect(parseKeypoint(42).nodes).toHaveLength(0)
    expect(parseKeypoint(null).warnings.length).toBeGreaterThan(0)
  })

  it('parses optional node position as {x,y} or [x,y]', () => {
    const m = parseKeypoint({
      hierarchy: {
        id: 'a',
        area: 1,
        position: { x: 1.5, y: -2 },
        children: [
          { id: 'b', area: 1, position: [3, 4], children: [] },
          { id: 'c', area: 1, position: { x: 'nope', y: 2 }, children: [] },
          { id: 'd', area: 1, children: [] },
        ],
      },
    })
    expect(m.nodes.find((n) => n.id === 'a')!.position).toEqual({ x: 1.5, y: -2 })
    expect(m.nodes.find((n) => n.id === 'b')!.position).toEqual({ x: 3, y: 4 })
    expect(m.nodes.find((n) => n.id === 'c')!.position).toBeUndefined()
    expect(m.nodes.find((n) => n.id === 'd')!.position).toBeUndefined()
  })
})
