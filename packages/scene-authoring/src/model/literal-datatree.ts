import type { PortAccess, SceneExpression } from './types.js'

/**
 * Array literals are data collections, not a single JavaScript-array item.
 * This is the runtime's wire DataTree form: item access fans out over the
 * children, list access receives their ordered values, and tree access receives
 * the complete tree. Scalars deliberately remain raw control values.
 */
export function literalValueForAccess(expression: SceneExpression, access: PortAccess | undefined): unknown {
  const value = literalValue(expression)
  if (expression.kind !== 'array') return value

  // All three access tiers consume the same wire tree and differ only when the
  // runtime dispatcher peels it at the destination contract.
  void access
  return expression.items.map((_, index) => ({
    path: [0, index],
    items: [(value as unknown[])[index]],
  }))
}

export function literalValue(expression: SceneExpression): unknown {
  switch (expression.kind) {
    case 'literal':
      return expression.value
    case 'array':
      return expression.items.map(literalValue)
    case 'object':
      return Object.fromEntries(
        Object.entries(expression.properties).map(([key, child]) => [key, literalValue(child)]),
      )
    case 'reference':
      return undefined
  }
}
