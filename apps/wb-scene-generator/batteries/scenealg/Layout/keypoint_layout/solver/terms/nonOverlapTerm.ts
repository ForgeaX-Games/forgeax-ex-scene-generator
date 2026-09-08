// Non-overlap term: a one-sided penalty over node pairs that are NOT in an
// ancestor–descendant relationship (siblings, cousins, unrelated). Only active
// when the two circles overlap (overlap = r_a + r_b - d > 0), pushing them apart
// to at most tangency. Nested regions are intentionally excluded — a parent is
// meant to contain its children (see containmentTerm). O(n²); n is small.

import type { Term, Vec2, ProblemModel, SolverState } from '../types.ts'
import { ancestorSets, isNested } from '../model.ts'

const EPS = 1e-9

export function nonOverlapTerm(weight: number): Term {
  return {
    name: 'nonOverlap',
    energyAndGradient(state: SolverState, model: ProblemModel, grad: Vec2[]): number {
      if (weight <= 0) return 0
      const { positions: pos, radii, logRadiusGradients } = state
      const n = model.nodes.length
      const anc = ancestorSets(model)
      let energy = 0
      for (let a = 0; a < n; a += 1) {
        for (let b = a + 1; b < n; b += 1) {
          if (isNested(anc, a, b)) continue
          const dx = pos[b].x - pos[a].x
          const dy = pos[b].y - pos[a].y
          const d = Math.hypot(dx, dy) || EPS
          const overlap = radii[a] + radii[b] - d
          if (overlap <= 0) continue
          energy += 0.5 * weight * overlap * overlap
          // E(d) = ½w(r_a+r_b-d)² ; E'(d) = -w·overlap
          // dE/dpa = -E'·û = +w·overlap·û ; dE/dpb = -w·overlap·û  (û = a→b)
          const g = (weight * overlap) / d
          grad[a].x += g * dx
          grad[a].y += g * dy
          grad[b].x -= g * dx
          grad[b].y -= g * dy
          if (model.nodes[a].isContainer) logRadiusGradients[a] += weight * overlap * radii[a]
          if (model.nodes[b].isContainer) logRadiusGradients[b] += weight * overlap * radii[b]
        }
      }
      return energy
    },
  }
}
