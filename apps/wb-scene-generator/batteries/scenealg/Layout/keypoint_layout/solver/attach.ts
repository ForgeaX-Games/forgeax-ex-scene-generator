// Write solved positions back onto a deep clone of the input keypoint. Unknown
// fields are preserved; only `position` is added to each hierarchy node (by id).

import type { ProblemModel, SolveResult, Vec2 } from './types.ts'
import { coerceKeypointObject } from './model.ts'

function round4(v: number): number {
  return Math.round(v * 1e4) / 1e4
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

interface SolvedNode {
  position: Vec2
  area?: number
}

function walk(node: Record<string, unknown>, byId: Map<string, SolvedNode>): void {
  const id = typeof node.id === 'string' ? node.id.trim() : ''
  const solved = id ? byId.get(id) : undefined
  if (solved) {
    node.position = { x: round4(solved.position.x), y: round4(solved.position.y) }
    if (solved.area !== undefined) node.area = round4(solved.area)
  }
  const children = node.children
  if (Array.isArray(children)) {
    for (const child of children) {
      if (child && typeof child === 'object' && !Array.isArray(child)) {
        walk(child as Record<string, unknown>, byId)
      }
    }
  }
}

/**
 * Return a new keypoint value identical to the input but with `position` attached
 * to every node the solver placed. Falls back to returning the raw value when the
 * input cannot be parsed into an object.
 */
export function attachPositions(raw: unknown, model: ProblemModel, result: SolveResult): unknown {
  const root = coerceKeypointObject(raw)
  if (!root) return raw

  const byId = new Map<string, SolvedNode>()
  model.nodes.forEach((node, i) => {
    const p = result.positions[i]
    if (p) {
      byId.set(node.id, {
        position: p,
        ...(node.isContainer ? { area: Math.PI * result.radii[i] ** 2 } : {}),
      })
    }
  })

  const clone = deepClone(root)
  const hierarchy = clone.hierarchy
  if (hierarchy && typeof hierarchy === 'object' && !Array.isArray(hierarchy)) {
    walk(hierarchy as Record<string, unknown>, byId)
  }
  return clone
}
