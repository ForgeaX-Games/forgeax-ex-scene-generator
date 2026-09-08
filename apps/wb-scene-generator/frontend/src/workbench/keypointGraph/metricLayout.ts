// Metric layout: when every node carries a solved `position` (from the
// keypoint_layout battery), draw the graph at those real coordinates instead of
// the force-directed fallback. y is flipped so north (y+) points up on screen.

import type { KeypointModel } from './parse.js'
import type { Positions } from './forceLayout.js'

export function hasAllPositions(model: KeypointModel): boolean {
  return (
    model.nodes.length > 0 &&
    model.nodes.every(
      (n) => n.position && Number.isFinite(n.position.x) && Number.isFinite(n.position.y),
    )
  )
}

export function metricPositions(model: KeypointModel): Positions {
  const out: Positions = {}
  for (const n of model.nodes) {
    if (n.position) out[n.id] = { x: n.position.x, y: -n.position.y }
  }
  return out
}

/** Circle radius in meters (area = π r²). */
export function metricRadius(area: number): number {
  return Math.sqrt(Math.max(0, area) / Math.PI)
}
