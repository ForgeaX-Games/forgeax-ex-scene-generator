import { describe, it, expect } from 'vitest'
import { buildTopFaceKey, lookupWithWildcard } from '../neighborKey'

describe('lookupWithWildcard', () => {
  it('prefers an exact match over a wildcard', () => {
    expect(lookupWithWildcard({ '1,1,1,1': 6, '1,1,1,*': 99 }, '1,1,1,1')).toBe(6)
  })
  it('falls back to the most specific wildcard (fewest *)', () => {
    expect(lookupWithWildcard({ '1,1,*,*': 4, '*,*,*,*': 0 }, '1,1,0,1')).toBe(4)
  })
  it('returns undefined when nothing matches', () => {
    expect(lookupWithWildcard({ '0,0,0,0': 1 }, '1,1,1,1')).toBeUndefined()
  })
})

describe('buildTopFaceKey', () => {
  const occ = (cells: Array<[number, number]>) => {
    const set = new Set(cells.map(([x, y]) => `${x},${y}`))
    return (dx: number, dy: number) => set.has(`${dx},${dy}`)
  }

  it('adjacent4 (default) is a 4-tuple of orthogonal neighbours', () => {
    expect(buildTopFaceKey(occ([[0, -1], [1, 0]]))).toBe('1,0,0,1')
  })

  it('adjacent8 appends four diagonal bits (ul,ur,dl,dr)', () => {
    // orthogonal: u+r; diagonals: ur only
    expect(buildTopFaceKey(occ([[0, -1], [1, 0], [1, -1]]), 'adjacent8')).toBe('1,0,0,1,0,1,0,0')
  })

  it('edgeDist2 appends vertical dist-2 probes', () => {
    expect(buildTopFaceKey(occ([[0, -1], [0, 1], [0, -2]]), 'edgeDist2')).toBe('1,1,0,0,1,0')
  })

  it('edgeDist4 appends vertical + horizontal dist-2 probes', () => {
    // orthogonal: u,d,l,r all set; dist-2: u2 + l2 set, d2 + r2 clear
    expect(
      buildTopFaceKey(occ([[0, -1], [0, 1], [-1, 0], [1, 0], [0, -2], [-2, 0]]), 'edgeDist4'),
    ).toBe('1,1,1,1,1,0,1,0')
  })
})
