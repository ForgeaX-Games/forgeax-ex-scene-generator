// Peripheral term: child should sit near the parent's rim (still inside), away
// from the parent center. Used for layoutHint.peripheral=true (镇外/边缘节点).
//
// Target center distance: d* = max(0, r_parent − r_child − margin).
// One-sided: when d < d*, E = ½ w (d* − d)² and push the child outward along
// the parent→child ray (or a deterministic angle if coincident with parent).

import type { Term, Vec2, ProblemModel, SolverState } from '../types.ts'

const EPS = 1e-9
/** Keep a small inset so containment still has room (fraction of parent radius). */
const MARGIN_FRAC = 0.08
/** A peripheral child center must sit visibly outside the parent's central zone. */
export const MIN_PERIPHERAL_CENTER_FRACTION = 0.55

function hashAngle(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  // map to [0, 2π)
  return ((h >>> 0) % 360) * (Math.PI / 180)
}

export function peripheralTerm(weight: number): Term {
  return {
    name: 'peripheral',
    energyAndGradient(state: SolverState, model: ProblemModel, grad: Vec2[]): number {
      if (weight <= 0) return 0
      const { positions: pos, radii, logRadiusGradients } = state
      let energy = 0
      for (const rel of model.relations) {
        if (rel.kind !== 'peripheral') continue
        const pi = model.index.get(rel.from)
        const ci = model.index.get(rel.to)
        if (pi === undefined || ci === undefined) continue
        const rP = radii[pi]
        const rC = radii[ci]
        const margin = rP * MARGIN_FRAC
        const rimTarget = Math.max(0, rP - rC - margin)
        const centerTarget = rP * MIN_PERIPHERAL_CENTER_FRACTION
        const dTarget = Math.max(rimTarget, centerTarget)

        // A rim target alone rewards shrinking the parent, because the target
        // shrinks with it. Require enough radial capacity for a visibly
        // peripheral center before optimizing its location.
        const capacity = rP * (1 - MIN_PERIPHERAL_CENTER_FRACTION) - rC - margin
        if (capacity < 0) {
          const capacitySlack = -capacity
          energy += 0.5 * weight * capacitySlack * capacitySlack
          if (model.nodes[pi].isContainer) {
            logRadiusGradients[pi] -= weight
              * capacitySlack
              * (1 - MIN_PERIPHERAL_CENTER_FRACTION - MARGIN_FRAC)
              * rP
          }
        }

        let dx = pos[ci].x - pos[pi].x
        let dy = pos[ci].y - pos[pi].y
        let d = Math.hypot(dx, dy)
        let ux: number
        let uy: number
        if (d < EPS) {
          const a = hashAngle(rel.to)
          ux = Math.cos(a)
          uy = Math.sin(a)
          d = EPS
          dx = ux * EPS
          dy = uy * EPS
        } else {
          ux = dx / d
          uy = dy / d
        }

        if (d >= dTarget) continue
        const slack = dTarget - d
        energy += 0.5 * weight * slack * slack
        // E = ½ w (d*−d)² → ∂E/∂d = −w·slack → ∂E/∂pc = (−w·slack)·û
        const g = -weight * slack
        grad[ci].x += g * ux
        grad[ci].y += g * uy
        grad[pi].x -= g * ux
        grad[pi].y -= g * uy
        if (model.nodes[pi].isContainer) {
          const targetRadiusDerivative = rimTarget >= centerTarget
            ? 1 - MARGIN_FRAC
            : MIN_PERIPHERAL_CENTER_FRACTION
          logRadiusGradients[pi] += weight * slack * targetRadiusDerivative * rP
        }
        if (model.nodes[ci].isContainer) logRadiusGradients[ci] -= weight * slack * rC
      }
      return energy
    },
  }
}
