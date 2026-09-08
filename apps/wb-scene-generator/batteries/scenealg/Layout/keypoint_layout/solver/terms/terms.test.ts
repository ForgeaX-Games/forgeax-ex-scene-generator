import { describe, it, expect } from 'vitest'
import type { ProblemModel, SolverNode, SolverRelation, SolverState, Term, Vec2 } from '../types.ts'
import { clearanceTerm } from './clearanceTerm.ts'
import { nonOverlapTerm } from './nonOverlapTerm.ts'
import { containmentTerm } from './containmentTerm.ts'
import { orientationTerm } from './orientationTerm.ts'
import { peripheralTerm } from './peripheralTerm.ts'
import { parentAverageTerm } from './parentAverageTerm.ts'
import { compactnessTerm } from './compactnessTerm.ts'

function makeModel(nodes: Partial<SolverNode>[], relations: SolverRelation[] = []): ProblemModel {
  const full: SolverNode[] = nodes.map((n, i) => ({
    id: n.id ?? `n${i}`,
    name: n.name ?? n.id ?? `n${i}`,
    area: n.area ?? 1,
    radius: n.radius ?? 1,
    isContainer: n.isContainer ?? (n.childIds?.length ?? 0) > 0,
    parentId: n.parentId ?? null,
    childIds: n.childIds ?? [],
  }))
  const index = new Map<string, number>()
  full.forEach((n, i) => index.set(n.id, i))
  return { nodes: full, index, relations, warnings: [] }
}

function makeState(model: ProblemModel, pos: Vec2[]): SolverState {
  return {
    positions: pos,
    radii: model.nodes.map((node) => node.radius),
    logRadiusGradients: new Float64Array(pos.length),
  }
}

function energyOnly(term: Term, model: ProblemModel, pos: Vec2[]): number {
  const scratch: Vec2[] = pos.map(() => ({ x: 0, y: 0 }))
  return term.energyAndGradient(makeState(model, pos), model, scratch)
}

// Compare analytic gradient (accumulated by the term) with central finite diffs.
function checkGradient(term: Term, model: ProblemModel, pos: Vec2[]): void {
  const analytic: Vec2[] = pos.map(() => ({ x: 0, y: 0 }))
  term.energyAndGradient(makeState(model, pos), model, analytic)

  const h = 1e-6
  for (let i = 0; i < pos.length; i += 1) {
    for (const axis of ['x', 'y'] as const) {
      const saved = pos[i][axis]
      pos[i][axis] = saved + h
      const ep = energyOnly(term, model, pos)
      pos[i][axis] = saved - h
      const em = energyOnly(term, model, pos)
      pos[i][axis] = saved
      const numeric = (ep - em) / (2 * h)
      expect(analytic[i][axis]).toBeCloseTo(numeric, 4)
    }
  }
}

describe('clearanceTerm', () => {
  const model = makeModel([{ id: 'a', radius: 1 }, { id: 'b', radius: 1 }], [
    { from: 'a', to: 'b', kind: 'clearance', distance: 2 },
  ])

  it('is zero when the net gap equals distance', () => {
    // centers 4 apart, radii 1+1=2, distance target 2 → residual 0
    const pos = [{ x: 0, y: 0 }, { x: 4, y: 0 }]
    expect(energyOnly(clearanceTerm(1), model, pos)).toBeCloseTo(0, 10)
  })

  it('is positive otherwise and gradient matches finite differences', () => {
    const pos = [{ x: 0, y: 0 }, { x: 2.3, y: 1.1 }]
    expect(energyOnly(clearanceTerm(1), model, pos)).toBeGreaterThan(0)
    checkGradient(clearanceTerm(0.7), model, pos)
  })
})

describe('nonOverlapTerm', () => {
  const model = makeModel([{ id: 'a', radius: 1.5 }, { id: 'b', radius: 1 }])

  it('is zero when circles do not overlap', () => {
    const pos = [{ x: 0, y: 0 }, { x: 5, y: 0 }]
    expect(energyOnly(nonOverlapTerm(1), model, pos)).toBe(0)
  })

  it('is positive when overlapping and gradient matches finite differences', () => {
    const pos = [{ x: 0, y: 0 }, { x: 1.2, y: 0.4 }]
    expect(energyOnly(nonOverlapTerm(1), model, pos)).toBeGreaterThan(0)
    checkGradient(nonOverlapTerm(1.3), model, pos)
  })

  it('ignores ancestor–descendant pairs (parent may contain child)', () => {
    const nested = makeModel([
      { id: 'p', radius: 5, childIds: ['c'] },
      { id: 'c', radius: 1, parentId: 'p' },
    ])
    const pos = [{ x: 0, y: 0 }, { x: 0.5, y: 0 }] // child well inside parent → overlapping
    expect(energyOnly(nonOverlapTerm(1), nested, pos)).toBe(0)
  })

  it('still separates siblings', () => {
    const sibs = makeModel([
      { id: 'p', radius: 5, childIds: ['a', 'b'] },
      { id: 'a', radius: 1, parentId: 'p' },
      { id: 'b', radius: 1, parentId: 'p' },
    ])
    const pos = [{ x: 0, y: 20 }, { x: 0, y: 0 }, { x: 1, y: 0 }] // a,b overlap
    expect(energyOnly(nonOverlapTerm(1), sibs, pos)).toBeGreaterThan(0)
  })
})

describe('containmentTerm', () => {
  const model = makeModel([
    { id: 'p', radius: 5, childIds: ['c'] },
    { id: 'c', radius: 1, parentId: 'p' },
  ])

  it('is zero when the child circle is fully inside the parent', () => {
    const pos = [{ x: 0, y: 0 }, { x: 2, y: 0 }] // d=2, rc=1 → 3 ≤ rp=5
    expect(energyOnly(containmentTerm(1), model, pos)).toBe(0)
  })

  it('is positive when the child pokes outside and gradient matches finite differences', () => {
    const pos = [{ x: 0, y: 0 }, { x: 5, y: 1 }] // d≈5.1, +rc=6.1 > rp=5
    expect(energyOnly(containmentTerm(1), model, pos)).toBeGreaterThan(0)
    checkGradient(containmentTerm(0.8), model, pos)
  })
})

describe('orientationTerm', () => {
  const model = makeModel([{ id: 'a', radius: 1 }, { id: 'b', radius: 1 }], [
    { from: 'a', to: 'b', kind: 'orientation', angle: 0 }, // east
  ])

  it('is zero when b is within the cone (due east)', () => {
    const pos = [{ x: 0, y: 0 }, { x: 3, y: 0 }]
    expect(energyOnly(orientationTerm(1, 30), model, pos)).toBeCloseTo(0, 10)
  })

  it('is positive when outside the cone and gradient matches finite differences', () => {
    const pos = [{ x: 0, y: 0 }, { x: 1, y: 3 }] // mostly north → outside an east cone
    expect(energyOnly(orientationTerm(1, 30), model, pos)).toBeGreaterThan(0)
    checkGradient(orientationTerm(0.6, 30), model, pos)
  })
})

describe('peripheralTerm', () => {
  // rP=10, rC=1, margin=max(0.5, 0.8)=0.8 → d*=8.2
  const model = makeModel(
    [
      { id: 'p', radius: 10, childIds: ['c'] },
      { id: 'c', radius: 1, parentId: 'p' },
    ],
    [{ from: 'p', to: 'c', kind: 'peripheral' }],
  )

  it('is zero when child is already near the parent rim', () => {
    const pos = [{ x: 0, y: 0 }, { x: 8.2, y: 0 }]
    expect(energyOnly(peripheralTerm(1), model, pos)).toBeCloseTo(0, 10)
  })

  it('is positive when child is too close to parent center and gradient matches', () => {
    const pos = [{ x: 0, y: 0 }, { x: 2, y: 0 }]
    expect(energyOnly(peripheralTerm(1), model, pos)).toBeGreaterThan(0)
    checkGradient(peripheralTerm(0.7), model, pos)
  })

  it('pushes child outward (negative ∂E/∂x_child when child is east of parent but too close)', () => {
    const pos = [{ x: 0, y: 0 }, { x: 2, y: 0 }]
    const grad: Vec2[] = pos.map(() => ({ x: 0, y: 0 }))
    peripheralTerm(1).energyAndGradient(makeState(model, pos), model, grad)
    // E decreases as child moves further east → ∂E/∂x_c < 0
    expect(grad[1].x).toBeLessThan(0)
  })
})

describe('parentAverageTerm', () => {
  const model = makeModel([
    { id: 'p', area: 1, childIds: ['c1', 'c2'] },
    { id: 'c1', area: 3 },
    { id: 'c2', area: 1 },
  ])

  it('is zero when parent sits at the area-weighted mean of children', () => {
    // weights 3:1 → mean = (3*(0,0) + 1*(8,0))/4 = (2,0)
    const pos = [{ x: 2, y: 0 }, { x: 0, y: 0 }, { x: 8, y: 0 }]
    expect(energyOnly(parentAverageTerm(1), model, pos)).toBeCloseTo(0, 10)
  })

  it('is positive otherwise and gradient matches finite differences', () => {
    const pos = [{ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 8, y: 2 }]
    expect(energyOnly(parentAverageTerm(1), model, pos)).toBeGreaterThan(0)
    checkGradient(parentAverageTerm(0.5), model, pos)
  })
})

describe('compactnessTerm', () => {
  const model = makeModel([{ id: 'a' }, { id: 'b' }, { id: 'c' }])

  it('is zero when all nodes coincide', () => {
    const pos = [{ x: 2, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 2 }]
    expect(energyOnly(compactnessTerm(1), model, pos)).toBeCloseTo(0, 10)
  })

  it('gradient matches finite differences', () => {
    const pos = [{ x: 0, y: 0 }, { x: 4, y: 1 }, { x: -2, y: 3 }]
    checkGradient(compactnessTerm(0.3), model, pos)
  })
})
