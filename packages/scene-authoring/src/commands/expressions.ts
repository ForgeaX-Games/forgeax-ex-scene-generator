import type { SceneExpression } from '../model/types.js'

export function expressionFromJson(value: unknown): SceneExpression {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return { kind: 'literal', value: value as string | number | boolean | null }
  }
  if (Array.isArray(value)) return { kind: 'array', items: value.map(expressionFromJson) }
  if (typeof value === 'object') {
    return {
      kind: 'object',
      properties: Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, expressionFromJson(item)])),
    }
  }
  throw new Error(`Scene Script values must be JSON-compatible; received ${typeof value}`)
}
