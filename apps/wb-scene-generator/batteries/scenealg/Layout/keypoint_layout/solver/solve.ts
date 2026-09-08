// Orchestrates a full solve: normalize the problem to ~unit scale (so Adam's step
// size is scale-invariant), optimize, then scale positions back to meters.

import type { ProblemModel, SolveResult, Vec2 } from './types.ts'
import { buildTerms, mergeConfig, type SolverConfigOverride } from './config.ts'
import { optimize } from './optimizer.ts'
import { ancestorSets, isNested } from './model.ts'
import { MIN_PERIPHERAL_CENTER_FRACTION } from './terms/peripheralTerm.ts'

const GEOMETRY_TOLERANCE = 0.2
const PROJECTION_PASSES = 24
const EPS = 1e-9
/** Direct children may occupy at most this fraction of their parent radius. */
export const PARENT_CONTENT_RADIUS_RATIO = 0.8

/** Characteristic length used to normalize the problem (meters). */
export function characteristicLength(model: ProblemModel): number {
  let max = 1
  for (const node of model.nodes) max = Math.max(max, node.radius)
  for (const rel of model.relations) {
    if (rel.kind === 'clearance' && rel.distance !== undefined) max = Math.max(max, Math.abs(rel.distance))
  }
  return max
}

function normalizeModel(model: ProblemModel, scale: number): ProblemModel {
  return {
    index: model.index,
    warnings: model.warnings,
    nodes: model.nodes.map((n) => ({ ...n, radius: n.radius / scale })),
    relations: model.relations.map((r) =>
      r.kind === 'clearance' && r.distance !== undefined ? { ...r, distance: r.distance / scale } : { ...r },
    ),
  }
}

function peripheralChildKeys(model: ProblemModel): Set<string> {
  const keys = new Set<string>()
  for (const relation of model.relations) {
    if (relation.kind !== 'peripheral') continue
    keys.add(`${relation.from}\u0000${relation.to}`)
  }
  return keys
}

/** Reject layouts that still violate containment, separation, or peripheral placement. */
export function validateSolvedGeometry(
  model: ProblemModel,
  positions: Vec2[],
  radii: number[],
  tolerance = GEOMETRY_TOLERANCE,
): void {
  const violations: string[] = []
  const ancestors = ancestorSets(model)
  const peripheralChildren = peripheralChildKeys(model)

  for (let p = 0; p < model.nodes.length; p += 1) {
    let envelopeRadius = 0
    for (const childId of model.nodes[p].childIds) {
      const c = model.index.get(childId)
      if (c === undefined) continue
      const distance = Math.hypot(
        positions[c].x - positions[p].x,
        positions[c].y - positions[p].y,
      )
      const overflow = distance + radii[c] - radii[p]
      if (overflow > tolerance) {
        violations.push(`containment:${model.nodes[p].id}->${model.nodes[c].id} overflow=${overflow.toFixed(3)}`)
      }
      if (!peripheralChildren.has(`${model.nodes[p].id}\u0000${model.nodes[c].id}`)) {
        envelopeRadius = Math.max(envelopeRadius, distance + radii[c])
      }
    }
    if (envelopeRadius > radii[p] * PARENT_CONTENT_RADIUS_RATIO + tolerance) {
      violations.push(`occupancy:${model.nodes[p].id} envelope=${envelopeRadius.toFixed(3)}`)
    }
  }

  for (let a = 0; a < model.nodes.length; a += 1) {
    for (let b = a + 1; b < model.nodes.length; b += 1) {
      if (isNested(ancestors, a, b)) continue
      const distance = Math.hypot(
        positions[b].x - positions[a].x,
        positions[b].y - positions[a].y,
      )
      const overlap = radii[a] + radii[b] - distance
      if (overlap > tolerance) {
        violations.push(`nonOverlap:${model.nodes[a].id}<->${model.nodes[b].id} overlap=${overlap.toFixed(3)}`)
      }
    }
  }

  for (const relation of model.relations) {
    if (relation.kind !== 'peripheral') continue
    const parent = model.index.get(relation.from)
    const child = model.index.get(relation.to)
    if (parent === undefined || child === undefined) continue
    const distance = Math.hypot(
      positions[child].x - positions[parent].x,
      positions[child].y - positions[parent].y,
    )
    const margin = radii[parent] * 0.08
    const target = Math.max(
      radii[parent] - radii[child] - margin,
      radii[parent] * MIN_PERIPHERAL_CENTER_FRACTION,
    )
    const shortfall = target - distance
    if (shortfall > tolerance) {
      violations.push(`peripheral:${relation.from}->${relation.to} shortfall=${shortfall.toFixed(3)}`)
    }
  }

  if (violations.length > 0) {
    throw new Error(`keypoint layout constraints unsatisfied: ${violations.join(', ')}`)
  }
}

function hashAngle(id: string): number {
  let hash = 2166136261
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) % 360) * (Math.PI / 180)
}

function translateSubtree(model: ProblemModel, positions: Vec2[], index: number, dx: number, dy: number): void {
  positions[index].x += dx
  positions[index].y += dy
  for (const childId of model.nodes[index].childIds) {
    const child = model.index.get(childId)
    if (child !== undefined) translateSubtree(model, positions, child, dx, dy)
  }
}

/**
 * The Adam objective plans the layout; this deterministic feasibility pass
 * removes its remaining soft-constraint residuals before artifacts are written.
 */
function projectFeasibleGeometry(model: ProblemModel, positions: Vec2[], radii: number[]): void {
  const ancestors = ancestorSets(model)
  const peripheralChildren = peripheralChildKeys(model)
  for (let pass = 0; pass < PROJECTION_PASSES; pass += 1) {
    for (const relation of model.relations) {
      if (relation.kind !== 'peripheral') continue
      const parent = model.index.get(relation.from)
      const child = model.index.get(relation.to)
      if (parent === undefined || child === undefined) continue

      const minimumParentRadius = radii[child] / (1 - MIN_PERIPHERAL_CENTER_FRACTION)
      if (model.nodes[parent].isContainer && radii[parent] < minimumParentRadius) {
        radii[parent] = minimumParentRadius
      }

      let dx = positions[child].x - positions[parent].x
      let dy = positions[child].y - positions[parent].y
      let distance = Math.hypot(dx, dy)
      if (distance < EPS) {
        const angle = hashAngle(model.nodes[child].id)
        dx = Math.cos(angle)
        dy = Math.sin(angle)
        distance = 1
      }
      const margin = radii[parent] * 0.08
      const target = Math.max(
        radii[parent] - radii[child] - margin,
        radii[parent] * MIN_PERIPHERAL_CENTER_FRACTION,
      )
      if (distance < target) {
        const shift = target - distance
        translateSubtree(model, positions, child, (dx / distance) * shift, (dy / distance) * shift)
      }
    }

    for (let a = 0; a < model.nodes.length; a += 1) {
      for (let b = a + 1; b < model.nodes.length; b += 1) {
        if (isNested(ancestors, a, b)) continue
        let dx = positions[b].x - positions[a].x
        let dy = positions[b].y - positions[a].y
        let distance = Math.hypot(dx, dy)
        if (distance < EPS) {
          const angle = hashAngle(`${model.nodes[a].id}|${model.nodes[b].id}`)
          dx = Math.cos(angle)
          dy = Math.sin(angle)
          distance = 1
        }
        const required = radii[a] + radii[b]
        if (distance < required) {
          const shift = (required - distance) / 2
          translateSubtree(model, positions, a, (-dx / distance) * shift, (-dy / distance) * shift)
          translateSubtree(model, positions, b, (dx / distance) * shift, (dy / distance) * shift)
        }
      }
    }

    for (let parent = 0; parent < model.nodes.length; parent += 1) {
      let envelopeRadius = 0
      for (const childId of model.nodes[parent].childIds) {
        const child = model.index.get(childId)
        if (child === undefined) continue
        const distance = Math.hypot(
          positions[child].x - positions[parent].x,
          positions[child].y - positions[parent].y,
        )
        const requiredRadius = distance + radii[child]
        if (!peripheralChildren.has(`${model.nodes[parent].id}\u0000${model.nodes[child].id}`)) {
          envelopeRadius = Math.max(envelopeRadius, requiredRadius)
        }
      }
      const requiredParentRadius = envelopeRadius / PARENT_CONTENT_RADIUS_RATIO
      if (model.nodes[parent].isContainer && radii[parent] < requiredParentRadius) {
        radii[parent] = requiredParentRadius
      }
    }
  }
}

export function solve(model: ProblemModel, override?: SolverConfigOverride): SolveResult {
  if (model.nodes.length === 0) return { positions: [], radii: [], energy: 0, perTerm: {}, iterations: 0 }

  const config = mergeConfig(override)
  const scale = characteristicLength(model)
  const normalized = normalizeModel(model, scale)
  const terms = buildTerms(config)

  const seed = config.seed ?? 0
  const result = optimize(normalized, terms, {
    iterations: config.iterations,
    learningRate: config.learningRate,
    adam: config.adam,
    seed,
  })

  const solved = {
    ...result,
    positions: result.positions.map((p) => ({ x: p.x * scale, y: p.y * scale })),
    radii: result.radii.map((radius) => radius * scale),
  }
  projectFeasibleGeometry(model, solved.positions, solved.radii)
  validateSolvedGeometry(model, solved.positions, solved.radii)
  return solved
}
