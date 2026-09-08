import { instantiatePlacementsOp } from '../lib.js'

export function instantiatePlacements(input: Record<string, unknown>): Record<string, unknown> {
  return instantiatePlacementsOp(input)
}
