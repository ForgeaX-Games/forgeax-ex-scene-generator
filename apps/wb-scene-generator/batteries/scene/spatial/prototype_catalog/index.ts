import { prototypeCatalogOp } from '../lib.js'

export function prototypeCatalog(input: Record<string, unknown>): Record<string, unknown> {
  return prototypeCatalogOp(input)
}
