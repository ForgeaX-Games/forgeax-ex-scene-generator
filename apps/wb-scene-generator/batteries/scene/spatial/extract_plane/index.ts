import { extractPlaneOp } from '../lib.js'

export function extractPlane(input: Record<string, unknown>): Record<string, unknown> {
  return extractPlaneOp(input)
}
