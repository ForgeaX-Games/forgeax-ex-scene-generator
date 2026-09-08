// Orientation term: each `orientation` relation wants (b - a) to fall inside a cone
// centered on the target bearing. With c = û·t (û = a→b unit, t = target unit) and
// cone half-angle h: if c ≥ cos h the relation is satisfied (E = 0); otherwise
// E = ½ (cos h − c)². Angle is not pinned exactly, so it does not fight clearance.

import type { Term, Vec2, ProblemModel, SolverState } from '../types.ts'

const EPS = 1e-9

export function orientationTerm(weight: number, halfAngleDeg: number): Term {
  const cosH = Math.cos((halfAngleDeg * Math.PI) / 180)
  return {
    name: 'orientation',
    energyAndGradient(state: SolverState, model: ProblemModel, grad: Vec2[]): number {
      if (weight <= 0) return 0
      const { positions: pos } = state
      let energy = 0
      for (const rel of model.relations) {
        if (rel.kind !== 'orientation' || rel.angle === undefined) continue
        const a = model.index.get(rel.from)
        const b = model.index.get(rel.to)
        if (a === undefined || b === undefined) continue
        const dx = pos[b].x - pos[a].x
        const dy = pos[b].y - pos[a].y
        const d = Math.hypot(dx, dy) || EPS
        const ux = dx / d
        const uy = dy / d
        const tx = Math.cos(rel.angle)
        const ty = Math.sin(rel.angle)
        const c = ux * tx + uy * ty
        if (c >= cosH) continue
        const gap = cosH - c
        energy += 0.5 * weight * gap * gap
        // perpendicular component of t relative to û, scaled by 1/d
        const perpx = tx - c * ux
        const perpy = ty - c * uy
        const f = (-weight * gap) / d
        grad[b].x += f * perpx
        grad[b].y += f * perpy
        grad[a].x -= f * perpx
        grad[a].y -= f * perpy
      }
      return energy
    },
  }
}
