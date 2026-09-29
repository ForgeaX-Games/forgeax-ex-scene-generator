/**
 * Multi-layer shape types for Scene Script.
 *
 * TypeScript is the authoring SSOT. Graph `item` / `list` / `tree` (DataTree)
 * ports are the canvas projection of these layers — not a second type system.
 *
 * SceneTree is a different kind: a named node hierarchy with content.
 * Do not model a scene as ShapeTree<SceneNode>.
 */

/** One value. Graph access: `item`. */
export type Item<T> = T

/** Flat sequence. Graph access: `list`. Wire form is one branch at path `[0]`. */
export type List<T> = readonly T[]

/**
 * One branch of a grafted collection.
 * Same shape as kernel `DataTreeEntry`. Path length is ≥ 1; `[0]` is a flat list.
 */
export interface ShapeBranch<T> {
  readonly path: readonly number[]
  readonly items: readonly T[]
}

/**
 * Branched collection. Graph access: `tree` / DataTree.
 * This is not the scene tree.
 */
export type ShapeTree<T> = readonly ShapeBranch<T>[]

export function asItem<T>(value: T): Item<T> {
  return value
}

export function asList<T>(values: readonly T[]): List<T> {
  return values
}

/** Project one value onto the DataTree wire that `fromItem` uses. */
export function shapeTreeFromItem<T>(value: T): ShapeTree<T> {
  return [{ path: [0], items: [value] }]
}

/** Project a flat list onto the DataTree wire that `fromList` uses. */
export function shapeTreeFromList<T>(values: readonly T[]): ShapeTree<T> {
  return [{ path: [0], items: values }]
}

export function isShapeBranch(value: unknown): value is ShapeBranch<unknown> {
  if (!value || typeof value !== 'object') return false
  const rec = value as { path?: unknown; items?: unknown }
  return Array.isArray(rec.path) && rec.path.length >= 1 && Array.isArray(rec.items)
}

export function isShapeTree(value: unknown): value is ShapeTree<unknown> {
  return Array.isArray(value) && value.length > 0 && value.every(isShapeBranch)
}
