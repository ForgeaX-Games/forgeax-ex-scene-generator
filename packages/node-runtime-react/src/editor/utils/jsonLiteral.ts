import { normalizeType } from './portTypes.js'

/** Canvas `json` is the same catalog slot as `dict`. */
export function isDictPortType(type: string | undefined): boolean {
  return normalizeType(type ?? '') === 'dict'
}

export function formatJsonLiteral(value: unknown): string {
  if (value === undefined) return ''
  try {
    const text = JSON.stringify(value, null, 2)
    return typeof text === 'string' ? text : ''
  } catch {
    return ''
  }
}

export function parseJsonLiteral(
  text: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, error: 'JSON cannot be empty' }
  try {
    return { ok: true, value: JSON.parse(trimmed) as unknown }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON'
    return { ok: false, error: message }
  }
}

/** Records / lists of primitives. Geometry (`kind`) and functions stay out. */
export function isPlainJsonValue(value: unknown, depth = 0): boolean {
  if (depth > 8) return false
  if (value === null) return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'string' || typeof value === 'boolean') return true
  if (Array.isArray(value)) return value.every((item) => isPlainJsonValue(item, depth + 1))
  if (!value || typeof value !== 'object') return false
  if (typeof (value as { kind?: unknown }).kind === 'string') return false
  return Object.values(value as Record<string, unknown>).every((item) => isPlainJsonValue(item, depth + 1))
}

export function dictEditorSeed(params: unknown, fallback: unknown, access?: string): unknown {
  if (isPlainJsonValue(params) && params !== undefined) return params
  if (isPlainJsonValue(fallback) && fallback !== undefined) return fallback
  return access === 'list' || access === 'tree' ? [] : {}
}
