import { describe, it, expect } from 'vitest'
import type { ProblemModel, SolverNode, SolverRelation } from './types.ts'
import { optimize } from './optimizer.ts'
import { clearanceTerm } from './terms/clearanceTerm.ts'
import { nonOverlapTerm } from './terms/nonOverlapTerm.ts'
import { compactnessTerm } from './terms/compactnessTerm.ts'

function makeModel(nodes: Partial<SolverNode>[], relations: SolverRelation[] = []): ProblemModel {
  const full: SolverNode[] = nodes.map((n, i) => ({
    id: n.id ?? `n${i}`,
    name: n.id ?? `n${i}`,
    area: n.area ?? 1,
    radius: n.radius ?? 1,
    parentId: null,
    childIds: [],
  }))
  const index = new Map<string, number>()
  full.forEach((n, i) => index.set(n.id, i))
  return { nodes: full, index, relations, warnings: [] }
}

const ADAM = { beta1: 0.9, beta2: 0.999, epsilon: 1e-8 }
const terms = [clearanceTerm(1), nonOverlapTerm(1.2), compactnessTerm(0.02)]

describe('optimize', () => {
  const model = makeModel(
    [{ id: 'a', radius: 1 }, { id: 'b', radius: 1 }, { id: 'c', radius: 1 }],
    [{ from: 'a', to: 'b', kind: 'clearance', distance: 2 }],
  )

  it('is deterministic for a fixed seed', () => {
    const r1 = optimize(model, terms, { iterations: 200, learningRate: 0.02, adam: ADAM, seed: 123 })
    const r2 = optimize(model, terms, { iterations: 200, learningRate: 0.02, adam: ADAM, seed: 123 })
    expect(r2.positions).toEqual(r1.positions)
  })

  it('lowers the total energy as iterations increase', () => {
    const few = optimize(model, terms, { iterations: 1, learningRate: 0.02, adam: ADAM, seed: 7 })
    const many = optimize(model, terms, { iterations: 400, learningRate: 0.02, adam: ADAM, seed: 7 })
    expect(many.energy).toBeLessThan(few.energy)
  })

  it('returns an empty result for an empty model', () => {
    const empty = optimize(makeModel([]), terms, { iterations: 10, learningRate: 0.02, adam: ADAM, seed: 1 })
    expect(empty.positions).toEqual([])
    expect(empty.iterations).toBe(0)
  })
})
