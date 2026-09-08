// Shared types for the keypoint layout solver. Everything downstream (model,
// terms, optimizer) speaks these. Kept dependency-free so each piece can be unit
// tested in isolation.

export interface Vec2 {
  x: number
  y: number
}

export type RelationKind = 'clearance' | 'orientation' | 'peripheral'

/** One node in the optimization problem (a free 2D variable). */
export interface SolverNode {
  id: string
  name: string
  /** square meters */
  area: number
  /** circle radius derived from area: sqrt(area / π), meters */
  radius: number
  /** Containers may resize during solve; leaf node radii stay fixed. */
  isContainer: boolean
  parentId: string | null
  childIds: string[]
}

/** A constraint between two nodes, resolved from the keypoint `relations`. */
export interface SolverRelation {
  from: string
  to: string
  kind: RelationKind
  /** clearance only: net gap between circle boundaries, meters */
  distance?: number
  /** orientation only: target bearing in radians (math convention, CCW from +x/east) */
  angle?: number
  /** peripheral: from=parent, to=child — push child toward parent rim */
}

/** The full problem the optimizer minimizes over. `nodes` index order is the
 *  canonical variable order; `index` maps id → that order. */
export interface ProblemModel {
  nodes: SolverNode[]
  index: Map<string, number>
  relations: SolverRelation[]
  warnings: string[]
}

/** Mutable continuous solver state passed to every energy term. */
export interface SolverState {
  positions: Vec2[]
  radii: number[]
  /** Gradient with respect to each node's log-radius. Leaves always remain zero. */
  logRadiusGradients: Float64Array
}

/**
 * A single energy term. It owns its own weight (folded in by the factory) so the
 * optimizer can simply sum every term's energy and gradient. `energyAndGradient`
 * MUST accumulate ∂E/∂p (already weighted) into `grad` and return the (weighted)
 * energy it contributed.
 */
export interface Term {
  name: string
  energyAndGradient(state: SolverState, model: ProblemModel, grad: Vec2[]): number
}

export interface SolveResult {
  /** final positions, one per `model.nodes` entry, meters */
  positions: Vec2[]
  /** final circle radii, one per `model.nodes` entry, meters */
  radii: number[]
  /** total weighted energy at the final step */
  energy: number
  /** weighted energy contributed by each term at the final step */
  perTerm: Record<string, number>
  iterations: number
}
