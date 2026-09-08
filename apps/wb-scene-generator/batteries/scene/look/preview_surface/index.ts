import { previewSurfaceOp } from '../lib.js'

export function previewSurface(input: Record<string, unknown>): Record<string, unknown> {
  return previewSurfaceOp(input)
}
