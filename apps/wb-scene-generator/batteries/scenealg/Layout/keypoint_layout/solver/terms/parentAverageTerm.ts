// Parent-average term (soft): each parent is pulled toward the area-weighted mean
// of its children. m = Σ(areaᵢ·pᵢ)/Σareaᵢ ; E = ½ |p_parent − m|². If all child
// areas are zero, falls back to an equal-weight mean.

import type { Term, Vec2, ProblemModel, SolverState } from '../types.ts'

export function parentAverageTerm(weight: number): Term {
  return {
    name: 'parentAverage',
    energyAndGradient(state: SolverState, model: ProblemModel, grad: Vec2[]): number {
      if (weight <= 0) return 0
      const { positions: pos } = state
      let energy = 0
      for (let p = 0; p < model.nodes.length; p += 1) {
        const parent = model.nodes[p]
        if (parent.childIds.length === 0) continue

        const childIdx: number[] = []
        const childW: number[] = []
        let total = 0
        for (const cid of parent.childIds) {
          const ci = model.index.get(cid)
          if (ci === undefined) continue
          const w = Math.max(0, model.nodes[ci].area)
          childIdx.push(ci)
          childW.push(w)
          total += w
        }
        if (childIdx.length === 0) continue
        if (total <= 0) {
          // Degenerate: equal weights.
          for (let k = 0; k < childW.length; k += 1) childW[k] = 1
          total = childIdx.length
        }

        let mx = 0
        let my = 0
        for (let k = 0; k < childIdx.length; k += 1) {
          mx += (childW[k] / total) * pos[childIdx[k]].x
          my += (childW[k] / total) * pos[childIdx[k]].y
        }
        const diffx = pos[p].x - mx
        const diffy = pos[p].y - my
        energy += 0.5 * weight * (diffx * diffx + diffy * diffy)

        grad[p].x += weight * diffx
        grad[p].y += weight * diffy
        for (let k = 0; k < childIdx.length; k += 1) {
          const frac = childW[k] / total
          grad[childIdx[k]].x -= weight * diffx * frac
          grad[childIdx[k]].y -= weight * diffy * frac
        }
      }
      return energy
    },
  }
}
