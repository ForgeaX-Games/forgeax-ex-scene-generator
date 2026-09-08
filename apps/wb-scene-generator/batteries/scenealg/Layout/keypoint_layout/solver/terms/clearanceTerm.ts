// Clearance term: each `clearance` relation wants the NET gap between two circle
// boundaries to equal `distance`. Residual s = d - r_a - r_b - distance, E = ½ s².
// (distance = 0 ⇒ circles tangent.)

import type { Term, Vec2, ProblemModel, SolverState } from '../types.ts'

const EPS = 1e-9

export function clearanceTerm(weight: number): Term {
  return {
    name: 'clearance',
    energyAndGradient(state: SolverState, model: ProblemModel, grad: Vec2[]): number {
      if (weight <= 0) return 0
      const { positions: pos, radii, logRadiusGradients } = state
      let energy = 0
      for (const rel of model.relations) {
        if (rel.kind !== 'clearance' || rel.distance === undefined) continue
        const a = model.index.get(rel.from)
        const b = model.index.get(rel.to)
        if (a === undefined || b === undefined) continue
        const dx = pos[b].x - pos[a].x
        const dy = pos[b].y - pos[a].y
        const d = Math.hypot(dx, dy) || EPS
        const s = d - radii[a] - radii[b] - rel.distance
        energy += 0.5 * weight * s * s
        // E'(d) = weight·s ; dE/dpa = -E'·û, dE/dpb = +E'·û  (û = a→b)
        const g = (weight * s) / d
        grad[a].x -= g * dx
        grad[a].y -= g * dy
        grad[b].x += g * dx
        grad[b].y += g * dy
        if (model.nodes[a].isContainer) logRadiusGradients[a] -= weight * s * radii[a]
        if (model.nodes[b].isContainer) logRadiusGradients[b] -= weight * s * radii[b]
      }
      return energy
    },
  }
}
