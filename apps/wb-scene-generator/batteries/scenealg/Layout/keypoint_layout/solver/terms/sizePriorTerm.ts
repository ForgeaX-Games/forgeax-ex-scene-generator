import type { ProblemModel, SolverState, Term, Vec2 } from '../types.ts'

/**
 * Keeps resizable containers near their input scale while strongly resisting
 * shrinkage below the semantic reference. Geometry terms may enlarge them.
 */
export function sizePriorTerm(priorWeight: number, undersizeWeight: number, areaWeight: number): Term {
  return {
    name: 'sizePrior',
    energyAndGradient(state: SolverState, model: ProblemModel, _grad: Vec2[]): number {
      if (priorWeight <= 0 && undersizeWeight <= 0 && areaWeight <= 0) return 0
      let energy = 0
      for (let i = 0; i < model.nodes.length; i += 1) {
        const node = model.nodes[i]
        if (!node.isContainer) continue
        const radius = state.radii[i]
        const referenceRadius = Math.max(node.radius, 1e-9)
        const delta = Math.log(radius / referenceRadius)
        energy += 0.5 * priorWeight * delta * delta
        if (delta < 0) energy += 0.5 * undersizeWeight * delta * delta
        energy += 0.5 * areaWeight * radius * radius
        state.logRadiusGradients[i] += priorWeight * delta
          + (delta < 0 ? undersizeWeight * delta : 0)
          + areaWeight * radius * radius
      }
      return energy
    },
  }
}
