import { describe, it, expect } from 'vitest'
import { buildModel, radiusFromArea, coerceKeypointObject } from './model.ts'

describe('radiusFromArea', () => {
  it('inverts area = π r²', () => {
    expect(radiusFromArea(Math.PI * 4)).toBeCloseTo(2, 10)
    expect(radiusFromArea(0)).toBe(0)
    expect(radiusFromArea(-5)).toBe(0)
  })
})

describe('coerceKeypointObject', () => {
  it('accepts objects and JSON strings, rejects others', () => {
    expect(coerceKeypointObject({ a: 1 })).toEqual({ a: 1 })
    expect(coerceKeypointObject('{"a":1}')).toEqual({ a: 1 })
    expect(coerceKeypointObject('not json')).toBeNull()
    expect(coerceKeypointObject(42)).toBeNull()
    expect(coerceKeypointObject([1, 2])).toBeNull()
  })
})

describe('buildModel', () => {
  const sample = {
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

  it('flattens the hierarchy with radius from area and parent/child links', () => {
    const m = buildModel(sample)
    expect(m.nodes.map((n) => n.id).sort()).toEqual(['bedroom', 'closet', 'living', 'root'])
    const root = m.nodes[m.index.get('root')!]
    expect(root.childIds.sort()).toEqual(['bedroom', 'living'])
    const living = m.nodes[m.index.get('living')!]
    expect(living.parentId).toBe('root')
    expect(living.radius).toBeCloseTo(radiusFromArea(30), 10)
    const bedroom = m.nodes[m.index.get('bedroom')!]
    expect(bedroom.childIds).toEqual(['closet'])
  })

  it('resolves clearance + orientation relations (direction → angle)', () => {
    const m = buildModel(sample)
    const clr = m.relations.find((r) => r.kind === 'clearance')
    expect(clr).toMatchObject({ from: 'living', to: 'bedroom', distance: 2.5 })
    const ori = m.relations.find((r) => r.kind === 'orientation')
    expect(ori?.angle).toBeCloseTo(0, 10) // E = 0 rad
  })

  it('resolves peripheral relations (parent → child rim bias)', () => {
    const m = buildModel({
      hierarchy: {
        id: 'town',
        area: 100,
        children: [{ id: 'cliff', area: 10, children: [] }],
      },
      relations: [{ from: 'town', to: 'cliff', kind: 'peripheral' }],
    })
    expect(m.relations).toEqual([{ from: 'town', to: 'cliff', kind: 'peripheral' }])
  })

  it('drops relations referencing unknown nodes or bad direction, with warnings', () => {
    const m = buildModel({
      hierarchy: { id: 'a', area: 1, children: [{ id: 'b', area: 1, children: [] }] },
      relations: [
        { from: 'a', to: 'ghost', kind: 'clearance', distance: 1 },
        { from: 'a', to: 'b', kind: 'orientation', direction: 'sideways' },
        { from: 'a', to: 'b', kind: 'clearance' },
      ],
    })
    expect(m.relations).toHaveLength(0)
    expect(m.warnings.length).toBeGreaterThanOrEqual(3)
  })

  it('never throws on malformed input', () => {
    expect(buildModel(undefined).nodes).toHaveLength(0)
    expect(buildModel('garbage').warnings.length).toBeGreaterThan(0)
    expect(buildModel({ hierarchy: 5 }).warnings.length).toBeGreaterThan(0)
  })
})
