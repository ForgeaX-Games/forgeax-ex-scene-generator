import { bindMaterialOp } from '../lib.js'

export function bindMaterial(input: Record<string, unknown>): Record<string, unknown> {
  return bindMaterialOp(input)
}
