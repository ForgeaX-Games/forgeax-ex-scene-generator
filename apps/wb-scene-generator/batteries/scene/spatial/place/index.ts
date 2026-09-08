import { placeOp } from '../lib.js'

/** Chained place() stays on the host so building parts are siblings. */
export function place(input: Record<string, unknown>): Record<string, unknown> {
  return placeOp(input)
}
