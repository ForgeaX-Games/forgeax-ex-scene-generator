// 💡 Per-cell draw attribution — "what is drawn on this cell?"
//
// The render side must be able to answer, for any voxel/cell, WHICH layers draw
// on it and in what visual order (top-most first). This is the data the SELECT
// tool attributes a click to: a clicked screen pixel resolves to a stack of
// voxels (see billboardVoxelStackAtScreenCell), and each voxel resolves to the
// layer(s) painting it here.
//
// Decoupling: this is a pure function over the render store's layer buckets +
// the same render ORDER the billboard painter uses (graph output layers first,
// baked layers second in tree z-order). It hard-wires nothing about the node
// editor; callers pass the layer records + ordered keys and get layer keys back.

import type { Point3D, RendererVoxelLayer } from '../types'

/** A single layer that draws on a queried cell, with where it sits in paint order. */
export interface CellLayerHit {
  /** `${nodeId}:${nodePath}` for output layers, `baked:${nodePath}` for baked. */
  layerKey: string
  kind: 'baked' | 'output'
  /** Painter index (higher = drawn later = visually on top). */
  paintIndex: number
  /** The matched cell on that layer (carries token/state for sprite attribution). */
  cell: Point3D
}

export interface CellQuerySources {
  /** Graph output layers, key = `${nodeId}:${nodePath}`. */
  layers: Record<string, RendererVoxelLayer>
  /** Baked (editable) layers, key = `baked:${nodePath}`. */
  bakedLayers: Record<string, RendererVoxelLayer>
  /**
   * Render order, back→front (same as the billboard painter): graph output keys
   * first, then baked keys in tree z-order. Index in this array IS the paint
   * index, so the LAST matching layer is the visually-topmost.
   */
  orderedKeys: ReadonlyArray<string>
}

function lookupLayer(sources: CellQuerySources, key: string): { layer: RendererVoxelLayer; kind: 'baked' | 'output' } | null {
  if (key.startsWith('baked:')) {
    const layer = sources.bakedLayers[key]
    return layer ? { layer, kind: 'baked' } : null
  }
  const layer = sources.layers[key]
  return layer ? { layer, kind: 'output' } : null
}

/**
 * Every layer that draws on the exact voxel `(x,y,z)`, ordered VISUALLY top-most
 * first (reverse paint order). A cell can be covered by multiple layers (e.g. a
 * baked hand-edit over a generated floor at the same voxel); the topmost is the
 * one painted last. Only visible layers are considered (a hidden layer draws
 * nothing, so it can't own a pixel).
 */
export function layersDrawnAtCell(sources: CellQuerySources, x: number, y: number, z: number): CellLayerHit[] {
  const hits: CellLayerHit[] = []
  for (let i = 0; i < sources.orderedKeys.length; i++) {
    const key = sources.orderedKeys[i]
    const resolved = lookupLayer(sources, key)
    if (!resolved || !resolved.layer.visible) continue
    const cell = resolved.layer.cells.find((c) => c.x === x && c.y === y && c.z === z)
    if (!cell) continue
    hits.push({ layerKey: key, kind: resolved.kind, paintIndex: i, cell })
  }
  // Reverse paint order → visually top-most layer first.
  hits.reverse()
  return hits
}

/** The single visually-topmost layer drawing on a voxel, or null when none do. */
export function topLayerAtCell(sources: CellQuerySources, x: number, y: number, z: number): CellLayerHit | null {
  const hits = layersDrawnAtCell(sources, x, y, z)
  return hits.length > 0 ? hits[0] : null
}
