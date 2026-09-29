import { pathParent } from './pathTree.js'

/**
 * Manual stacking order for OUTPUT layers, `${nodeId}:${nodePath}` → rank.
 * Only siblings the user actually reordered get an entry.
 */
export type OutputLayerOrder = Readonly<Record<string, number>>

/**
 * Reorder `keys` so that sibling groups the user has ranked come out in their
 * chosen order, leaving everything else exactly where it was.
 *
 * This list is BOTH the panel's row order and the painter's order — OUTPUT does
 * not invert one into the other the way `orderBakedKeysForRender` does, because
 * inverting would flip the default stacking of every existing scene. So rank 0 =
 * listed first = drawn FIRST = at the bottom; a row dragged DOWN paints on top.
 *
 * Why "sibling group" and not a global sort: the painter reads position, so a
 * move only ever has to be local. Two rival `SceneOutput` sinks that both project
 * `/Island/Beach` are siblings by SCENE PATH but live under different `nodeId`s,
 * so grouping keys by `pathParent(nodePath)` — not by the key's own prefix — is
 * what puts them in the same group.
 *
 * Ranked members are permuted **within the array slots that group already
 * occupies**. That keeps the operation local and total: unranked groups, and
 * every layer's position relative to other groups, are untouched, and there is
 * no comparator whose intransitivity could scramble the list.
 */
export function applyOutputLayerOrder(
  keys: readonly string[],
  order: OutputLayerOrder,
  nodePathOf: (key: string) => string | undefined,
): string[] {
  const out = keys.slice()
  if (Object.keys(order).length === 0) return out

  const slotsByParent = new Map<string, number[]>()
  keys.forEach((key, i) => {
    const nodePath = nodePathOf(key)
    if (nodePath === undefined) return
    const parent = pathParent(nodePath)
    const slots = slotsByParent.get(parent)
    if (slots) slots.push(i)
    else slotsByParent.set(parent, [i])
  })

  for (const slots of slotsByParent.values()) {
    if (slots.length < 2) continue
    const members = slots.map((i) => keys[i])
    if (!members.some((key) => order[key] !== undefined)) continue
    // Unranked members sort after ranked ones, keeping their relative order
    // (index tiebreak) so a partially-ranked group stays predictable.
    const rankOf = (key: string, i: number): [number, number] => [order[key] ?? Number.POSITIVE_INFINITY, i]
    const sorted = members
      .map((key, i) => ({ key, rank: rankOf(key, i) }))
      .sort((a, b) => (a.rank[0] - b.rank[0]) || (a.rank[1] - b.rank[1]))
      .map((m) => m.key)
    slots.forEach((slot, j) => { out[slot] = sorted[j] })
  }
  return out
}

/**
 * Emit every layer at a scene path BEFORE the layers below that path, so a child
 * always paints on top of its parent.
 *
 * This had been an accident of store insertion order: it holds inside a single
 * sink, because `projection.collect()` walks the subtree pre-order and
 * `setLayers` preserves that, but nothing enforced it — and it broke across
 * sinks, where a parent re-pulled after its child would paint over it (`/主岛`
 * covering `/主岛/沙滩`).
 *
 * Siblings are deliberately NOT reversed here: their relative order is the one
 * the panel shows and the user drags, and the OUTPUT list *is* the painter's
 * order (a row lower in the list paints on top). Only the parent/child axis is
 * corrected — that one carries no user intent, it is a structural fact of the
 * scene graph.
 *
 * The tree cannot be derived from the keys the way `orderBakedKeysForRender`
 * derives it: a key is `${nodeId}:${nodePath}`, and rival sinks projecting the
 * same scene path are siblings sharing one path node. Hence `nodePathOf`, and
 * hence "all layers at a path" moving as one block.
 */
export function parentsBeforeChildren(
  keys: readonly string[],
  nodePathOf: (key: string) => string | undefined,
): string[] {
  const keysAtPath = new Map<string, string[]>()
  for (const key of keys) {
    const nodePath = nodePathOf(key)
    if (nodePath === undefined) continue
    const at = keysAtPath.get(nodePath)
    if (at) at.push(key)
    else keysAtPath.set(nodePath, [key])
  }

  const paths = [...keysAtPath.keys()]
  const out: string[] = []
  const emitted = new Set<string>()
  const seenPath = new Set<string>()
  const visit = (path: string): void => {
    if (seenPath.has(path)) return
    seenPath.add(path)
    for (const key of keysAtPath.get(path) ?? []) {
      out.push(key)
      emitted.add(key)
    }
    for (const child of paths) if (pathParent(child) === path) visit(child)
  }
  // A root is any path whose parent carries no layer of its own — covers both
  // top-level paths and orphans whose intermediate path was never projected.
  for (const path of paths) if (!keysAtPath.has(pathParent(path))) visit(path)
  for (const key of keys) if (!emitted.has(key)) out.push(key)
  return out
}

interface ZRangedLayer {
  nodePath: string
  cells?: ReadonlyArray<{ z: number }>
}

function zRange(layer: ZRangedLayer): [number, number] | null {
  const cells = layer.cells
  if (!cells || cells.length === 0) return null
  let min = cells[0].z
  let max = min
  for (let i = 1; i < cells.length; i++) {
    const z = cells[i].z
    if (z < min) min = z
    else if (z > max) max = z
  }
  return [min, max]
}

/**
 * Warn about restacks that cannot possibly show up on screen.
 *
 * Layer order is only the painter's THIRD key — `(y, z, layerIdx)` — so it just
 * breaks ties between cells at the same row and the same elevation. Two sibling
 * layers occupying disjoint `z` bands never tie, and dragging one over the other
 * changes nothing visually. That is geometry, not a bug, but it looks like a
 * broken control, so the row says so.
 *
 * Only groups the user actually ranked are checked — an untouched scene should
 * not sprout warnings.
 */
export function stackOrderHints<T extends ZRangedLayer>(
  keys: readonly string[],
  order: OutputLayerOrder,
  layerOf: (key: string) => T | undefined,
): Map<string, string> {
  const hints = new Map<string, string>()
  const groups = new Map<string, string[]>()
  for (const key of keys) {
    const layer = layerOf(key)
    if (!layer) continue
    const parent = pathParent(layer.nodePath)
    const at = groups.get(parent)
    if (at) at.push(key)
    else groups.set(parent, [key])
  }

  for (const members of groups.values()) {
    if (members.length < 2) continue
    if (!members.some((key) => order[key] !== undefined)) continue
    const ranges = new Map<string, [number, number]>()
    for (const key of members) {
      const layer = layerOf(key)
      const range = layer ? zRange(layer) : null
      if (range) ranges.set(key, range)
    }
    for (const key of members) {
      const mine = ranges.get(key)
      if (!mine) continue
      const overlaps = members.some((other) => {
        if (other === key) return false
        const theirs = ranges.get(other)
        return !!theirs && mine[0] <= theirs[1] && theirs[0] <= mine[1]
      })
      if (!overlaps) {
        hints.set(
          key,
          `Reordering has no visible effect: this layer occupies heights ${mine[0]}–${mine[1]}, `
          + 'which no sibling layer shares. Stacking is decided by elevation first, order only breaks ties.',
        )
      }
    }
  }
  return hints
}

/**
 * Rank `movedKey` immediately before/after `targetKey` among their siblings.
 *
 * Writes an explicit rank for EVERY sibling in the group (not just the moved
 * one) so the group becomes fully user-ordered in one move — a partial ranking
 * would leave the unranked members at the mercy of the store's insertion order,
 * which shifts whenever a sink is re-pulled.
 */
export function reorderSibling(
  siblingKeysInRenderOrder: readonly string[],
  movedKey: string,
  targetKey: string,
  place: 'before' | 'after',
): Record<string, number> {
  const rest = siblingKeysInRenderOrder.filter((k) => k !== movedKey)
  const at = rest.indexOf(targetKey)
  if (at < 0) return {}
  const insertAt = place === 'before' ? at : at + 1
  const next = [...rest.slice(0, insertAt), movedKey, ...rest.slice(insertAt)]
  const ranks: Record<string, number> = {}
  next.forEach((key, i) => { ranks[key] = i })
  return ranks
}
