// Compactness regularizer: pull every node toward the common centroid.
// g = mean(p) ; E = ½ Σ |pᵢ − g|² ; ∂E/∂pₖ = (pₖ − g) (centroid terms cancel).
// Small weight → keeps the layout from drifting/spreading, without collapsing it
// (clearance + non-overlap resist).

import type { Term, Vec2, ProblemModel, SolverState } from '../types.ts'

export function compactnessTerm(weight: number): Term {
  return {
    name: 'compactness',
    energyAndGradient(state: SolverState, model: ProblemModel, grad: Vec2[]): number {
      if (weight <= 0) return 0
      const { positions: pos } = state
      const n = model.nodes.length
      if (n === 0) return 0
      let gx = 0
      let gy = 0
      for (let i = 0; i < n; i += 1) {
        gx += pos[i].x
        gy += pos[i].y
      }
      gx /= n
      gy /= n
      let energy = 0
      for (let i = 0; i < n; i += 1) {
        const dx = pos[i].x - gx
        const dy = pos[i].y - gy
        energy += 0.5 * weight * (dx * dx + dy * dy)
        grad[i].x += weight * dx
        grad[i].y += weight * dy
      }
      return energy
    },
  }
}
