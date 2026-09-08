// Single source of truth for solver tuning. Change weights / hyperparameters here;
// `buildTerms` assembles the term list the optimizer minimizes. Callers may pass a
// partial override that is merged over these defaults.

import type { Term } from './types.ts'
import { clearanceTerm } from './terms/clearanceTerm.ts'
import { orientationTerm } from './terms/orientationTerm.ts'
import { parentAverageTerm } from './terms/parentAverageTerm.ts'
import { nonOverlapTerm } from './terms/nonOverlapTerm.ts'
import { containmentTerm } from './terms/containmentTerm.ts'
import { compactnessTerm } from './terms/compactnessTerm.ts'
import { peripheralTerm } from './terms/peripheralTerm.ts'
import { sizePriorTerm } from './terms/sizePriorTerm.ts'

export interface SolverWeights {
  clearance: number
  orientation: number
  parentAverage: number
  /** sibling/unrelated circles should not overlap */
  nonOverlap: number
  /** child circles should stay inside their parent circle */
  containment: number
  compactness: number
  /** layoutHint.peripheral: push child toward parent rim */
  peripheral: number
  /** Keep resizable container radii near their input reference. */
  sizePrior: number
  /** Strongly resist shrinking a container below its semantic input reference. */
  undersize: number
  /** Optional linear-area regularizer; disabled because sizePrior bounds growth. */
  areaCost: number
}

export interface SolverConfig {
  weights: SolverWeights
  /** orientation cone half-angle (degrees) */
  orientationHalfAngleDeg: number
  iterations: number
  /** Adam step size, in NORMALIZED units (problem is scaled to ~unit before solving) */
  learningRate: number
  adam: { beta1: number; beta2: number; epsilon: number }
  /** overrides the id-hash seed (mainly for tests) */
  seed?: number
}

export const DEFAULT_CONFIG: SolverConfig = {
  weights: {
    clearance: 1,
    orientation: 0.6,
    parentAverage: 0.5,
    nonOverlap: 1.2,
    containment: 4,
    compactness: 0.02,
    // Must outrank demoted adjacent(中) residual and compactness so 镇外 nodes
    // finish at the parent rim (not the pocket between hub buildings).
    peripheral: 20,
    sizePrior: 20,
    undersize: 20,
    areaCost: 0,
  },
  orientationHalfAngleDeg: 30,
  iterations: 1200,
  learningRate: 0.02,
  adam: { beta1: 0.9, beta2: 0.999, epsilon: 1e-8 },
}

export type SolverConfigOverride = {
  weights?: Partial<SolverWeights>
} & Partial<Omit<SolverConfig, 'weights'>>

export function mergeConfig(override?: SolverConfigOverride): SolverConfig {
  if (!override) return DEFAULT_CONFIG
  return {
    ...DEFAULT_CONFIG,
    ...override,
    weights: { ...DEFAULT_CONFIG.weights, ...override.weights },
    adam: { ...DEFAULT_CONFIG.adam, ...override.adam },
  }
}

/** Assemble the active term list from a (merged) config. */
export function buildTerms(config: SolverConfig): Term[] {
  return [
    parentAverageTerm(config.weights.parentAverage),
    clearanceTerm(config.weights.clearance),
    orientationTerm(config.weights.orientation, config.orientationHalfAngleDeg),
    nonOverlapTerm(config.weights.nonOverlap),
    containmentTerm(config.weights.containment),
    peripheralTerm(config.weights.peripheral),
    sizePriorTerm(config.weights.sizePrior, config.weights.undersize, config.weights.areaCost),
    compactnessTerm(config.weights.compactness),
  ]
}
