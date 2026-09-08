// Wire-value normalization for `getNodeOutput`, grounded in the kernel DataTree
// codec (`layer1/datatree`). A port's runtime payload is a DataTree serialized
// as `[{ path:number[], items:T[] }, ...]`:
//   * `DataTree.fromItem(value)`  → one branch `{path:[0], items:[value]}`
//     (a scalar: the single item IS the port's value)
//   * `DataTree.fromList(values)` → one branch `{path:[0], items:[v0, v1, …]}`
//     (a list: each item is one value)
//
// `flattenWire` unwraps ONE DataTree level, concatenating `items` across every
// branch, yielding the port's item VALUES. That is exactly right for ports
// whose item value is the entity the consumer wants — e.g. the `urdf` port emits
// `fromItem(string)` → `items:[urdfXml]` → `flattenWire` → `[urdfXml]`.

/**
 * DataTree wire → flat array of item values (one DataTree level unwrapped).
 * Use for ports whose leaf item is itself the consumed entity (e.g. a `string`
 * `urdf` port, where each item is one URDF XML string).
 */
export function flattenWire<T = unknown>(wire: unknown): T[] {
  if (!Array.isArray(wire)) return []
  const out: T[] = []
  for (const entry of wire) {
    if (entry && typeof entry === 'object' && Array.isArray((entry as { items?: unknown[] }).items)) {
      out.push(...((entry as { items: T[] }).items))
    } else {
      out.push(entry as T)
    }
  }
  return out
}

/**
 * DataTree wire → flat array of list ELEMENTS.
 *
 * For "list-valued" ports the port emits the WHOLE collection as a single
 * DataTree item, i.e. `fromItem(T[])` → `items:[[e0, e1, …]]` (double-wrapped).
 * This unwraps the DataTree level (via `flattenWire`) and then spreads any
 * array-valued leaf, so it is correct whether the port used `fromItem(T[])`
 * (double-wrapped → spread the inner list) or `fromList(T[])` (each item is one
 * element → passed through).
 */
export function flattenWireList<T = unknown>(wire: unknown): T[] {
  const items = flattenWire<unknown>(wire)
  const out: T[] = []
  for (const item of items) {
    if (Array.isArray(item)) out.push(...(item as T[]))
    else out.push(item as T)
  }
  return out
}
