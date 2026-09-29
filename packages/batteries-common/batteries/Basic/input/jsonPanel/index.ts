function isPlainJsonValue(value: unknown, depth = 0): boolean {
  if (depth > 8) return false
  if (value === null) return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'string' || typeof value === 'boolean') return true
  if (Array.isArray(value)) return value.every((item) => isPlainJsonValue(item, depth + 1))
  if (!value || typeof value !== 'object') return false
  if (typeof (value as { kind?: unknown }).kind === 'string') return false
  return Object.values(value as Record<string, unknown>).every((item) => isPlainJsonValue(item, depth + 1))
}

/**
 * JSON panel: emit the parsed object/array as a dict. The canvas stores the
 * value on `params.value`; Scene Script is the same object literal.
 */
export function jsonPanel(input: Record<string, unknown>): Record<string, unknown> {
  if (input.value !== undefined && isPlainJsonValue(input.value)) {
    return { value: input.value }
  }
  return { value: {} }
}
