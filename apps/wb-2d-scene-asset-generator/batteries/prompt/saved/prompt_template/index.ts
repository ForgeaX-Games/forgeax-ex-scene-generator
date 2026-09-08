/**
 * prompt_template — saved-prompt substitution op.
 *
 * One shared op backs every saved prompt battery: the per-prompt template lives
 * in `node.params.template` (control input), and each `[xxx]` placeholder is
 * exposed by the PromptNode renderer as a str input port named `xxx`. Connected
 * ports arrive here as undeclared inputs (DataTree, access:tree by default), so
 * we duck-type-peel each to its first scalar leaf and substitute. Unconnected
 * placeholders are left verbatim (no value present) so the operator can see what
 * is still missing.
 *
 * Output: `prompt` (string).
 */

/** Duck-typed DataTree check (instanceof breaks across dynamic-import module copies). */
function isDataTreeLike(v: unknown): v is { toJSON: () => Array<{ path: number[]; items: unknown[] }> } {
  if (v === null || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o['branches'] === 'function' && typeof o['toJSON'] === 'function'
}

/** Reduce any wire value (DataTree / entry-array / raw) to its first scalar leaf. */
function peelFirst(value: unknown): unknown {
  if (value === undefined || value === null) return value
  if (isDataTreeLike(value)) {
    const entries = value.toJSON()
    for (const e of entries) {
      if (e.items && e.items.length > 0) return e.items[0]
    }
    return undefined
  }
  // Wire form [{ path, items: [...] }] (toJSON entries).
  if (Array.isArray(value)) {
    const first = value[0] as { items?: unknown[] } | unknown
    if (first && typeof first === 'object' && Array.isArray((first as { items?: unknown[] }).items)) {
      const items = (first as { items: unknown[] }).items
      return items.length > 0 ? items[0] : undefined
    }
    return value
  }
  return value
}

function toStr(v: unknown): string {
  if (typeof v === 'string') return v
  if (v === null || v === undefined) return ''
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

export function promptTemplate(input: Record<string, unknown>): Record<string, unknown> {
  const template = typeof input.template === 'string' ? input.template : ''

  const prompt = template.replace(/\[([^[\]]+)\]/g, (match, rawName: string) => {
    const name = rawName.trim()
    // Engine/control keys are never substitution targets.
    if (!name) return match
    const raw = input[name]
    if (raw === undefined) return match // unconnected placeholder: keep [name] verbatim
    const peeled = peelFirst(raw)
    if (peeled === undefined) return match
    return toStr(peeled)
  })

  return { prompt }
}
