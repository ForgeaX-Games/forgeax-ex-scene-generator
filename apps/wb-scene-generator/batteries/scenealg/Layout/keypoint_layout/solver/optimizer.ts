// Deterministic Adam gradient descent over all node coordinates. Solver-agnostic:
// it only knows the Term interface (energy + accumulated gradient). Operates in
// whatever units the model is given (solve.ts normalizes first).

import type { ProblemModel, SolverState, Term, Vec2, SolveResult } from './types.ts'

export interface OptimizeOptions {
  iterations: number
  learningRate: number
  adam: { beta1: number; beta2: number; epsilon: number }
  seed: number
}

// FNV-1a hash of the node ids → stable seed.
function hashSeed(ids: string[]): number {
  let h = 2166136261
  for (const id of ids) {
    for (let i = 0; i < id.length; i += 1) {
      h ^= id.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    h ^= 0x2c
  }
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export { hashSeed }

/** Deterministic initial placement on a jittered circle (normalized units). */
function initPositions(model: ProblemModel, seed: number): Vec2[] {
  const n = model.nodes.length
  const rand = mulberry32(seed)
  const spread = Math.max(1, Math.sqrt(n))
  const positions: Vec2[] = []
  for (let i = 0; i < n; i += 1) {
    const angle = (i / Math.max(1, n)) * Math.PI * 2 + rand() * 0.5
    const r = spread * (0.5 + rand() * 0.5)
    positions.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r })
  }
  return positions
}

export function optimize(model: ProblemModel, terms: Term[], options: OptimizeOptions): SolveResult {
  const n = model.nodes.length
  if (n === 0) return { positions: [], energy: 0, perTerm: {}, iterations: 0 }

  const seed = options.seed || hashSeed(model.nodes.map((nd) => nd.id))
  const pos = initPositions(model, seed)
  const logRadii = model.nodes.map((node) => Math.log(Math.max(node.radius, 1e-9)))
  const radii = model.nodes.map((node) => node.radius)

  // Adam moment buffers for x/y coordinates and container log-radii.
  const mX = new Float64Array(n)
  const mY = new Float64Array(n)
  const vX = new Float64Array(n)
  const vY = new Float64Array(n)
  const mR = new Float64Array(n)
  const vR = new Float64Array(n)
  const grad: Vec2[] = Array.from({ length: n }, () => ({ x: 0, y: 0 }))
  const logRadiusGradients = new Float64Array(n)
  const state: SolverState = { positions: pos, radii, logRadiusGradients }

  const { beta1, beta2, epsilon } = options.adam
  const lr = options.learningRate

  let energy = 0
  let perTerm: Record<string, number> = {}

  for (let iter = 1; iter <= options.iterations; iter += 1) {
    for (let i = 0; i < n; i += 1) {
      grad[i].x = 0
      grad[i].y = 0
      logRadiusGradients[i] = 0
    }
    energy = 0
    perTerm = {}
    for (const term of terms) {
      const e = term.energyAndGradient(state, model, grad)
      perTerm[term.name] = (perTerm[term.name] ?? 0) + e
      energy += e
    }

    const bc1 = 1 - Math.pow(beta1, iter)
    const bc2 = 1 - Math.pow(beta2, iter)
    for (let i = 0; i < n; i += 1) {
      // x
      mX[i] = beta1 * mX[i] + (1 - beta1) * grad[i].x
      vX[i] = beta2 * vX[i] + (1 - beta2) * grad[i].x * grad[i].x
      pos[i].x -= (lr * (mX[i] / bc1)) / (Math.sqrt(vX[i] / bc2) + epsilon)
      // y
      mY[i] = beta1 * mY[i] + (1 - beta1) * grad[i].y
      vY[i] = beta2 * vY[i] + (1 - beta2) * grad[i].y * grad[i].y
      pos[i].y -= (lr * (mY[i] / bc1)) / (Math.sqrt(vY[i] / bc2) + epsilon)
      if (model.nodes[i].isContainer) {
        mR[i] = beta1 * mR[i] + (1 - beta1) * logRadiusGradients[i]
        vR[i] = beta2 * vR[i] + (1 - beta2) * logRadiusGradients[i] * logRadiusGradients[i]
        logRadii[i] -= (lr * (mR[i] / bc1)) / (Math.sqrt(vR[i] / bc2) + epsilon)
        radii[i] = Math.exp(logRadii[i])
      }
    }
  }

  return { positions: pos, radii, energy, perTerm, iterations: options.iterations }
}
