// Containment term: each child circle should sit INSIDE its parent circle (regions
// are nested). slack = d + r_child − r_parent measures how far the child pokes past
// the parent boundary; one-sided penalty E = ½ slack² when slack > 0. Pulls the
// child inward (and nudges the parent to cover it). Direct parent→child only;
// nesting is transitive enough through the chain.

import type { Term, Vec2, ProblemModel, SolverState } from '../types.ts'

const EPS = 1e-9

export function containmentTerm(weight: number): Term {
  return {
    name: 'containment',
    energyAndGradient(state: SolverState, model: ProblemModel, grad: Vec2[]): number {
      if (weight <= 0) return 0
      const { positions: pos, radii, logRadiusGradients } = state
      let energy = 0
      for (let p = 0; p < model.nodes.length; p += 1) {
        const parent = model.nodes[p]
        if (parent.childIds.length === 0) continue
        const rP = radii[p]
        for (const cid of parent.childIds) {
          const c = model.index.get(cid)
          if (c === undefined) continue
          const dx = pos[c].x - pos[p].x
          const dy = pos[c].y - pos[p].y
          const d = Math.hypot(dx, dy) || EPS
          const slack = d + radii[c] - rP
          if (slack <= 0) continue
          energy += 0.5 * weight * slack * slack
          // E'(d) = weight·slack ; û = p→c ; dE/dpc = +E'·û, dE/dpp = -E'·û
          const g = (weight * slack) / d
          grad[c].x += g * dx
          grad[c].y += g * dy
          grad[p].x -= g * dx
          grad[p].y -= g * dy
          if (model.nodes[p].isContainer) logRadiusGradients[p] -= weight * slack * radii[p]
          if (model.nodes[c].isContainer) logRadiusGradients[c] += weight * slack * radii[c]
        }
      }
      return energy
    },
  }
}
