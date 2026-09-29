import type { DisplayDrawable, DisplayIndex } from './displayIndex'
import type { MeshLayer } from '../types'

const HOST_SCHEMAS = new Set(['mesh', 'road', 'houses', 'ref'])

function isSharedNodeId(nodeId: string, index: DisplayIndex): boolean {
  return index.drawables.filter((d) => d.nodeId === nodeId).length > 1
}

function matchesSelection(drawable: DisplayDrawable, selectedIds: ReadonlyArray<string>, index: DisplayIndex): boolean {
  if (selectedIds.includes(drawable.layerKey) || selectedIds.includes(drawable.id) || selectedIds.includes(drawable.path)) {
    return true
  }
  // Hydrated scene prims share the scene_output node id. A nodeId hit is only
  // unique when exactly one drawable owns it — otherwise click-select lights
  // the whole valley and every nested Control.
  return !!drawable.nodeId
    && selectedIds.includes(drawable.nodeId)
    && !isSharedNodeId(drawable.nodeId, index)
}

/** Nearest mesh/road/houses ancestor of a guide prim. Sibling guides under Terrain do not bind to River. */
export function nearestHostDrawable(
  guidePath: string,
  index: DisplayIndex,
): DisplayDrawable | undefined {
  let best: DisplayDrawable | undefined
  for (const drawable of index.drawables) {
    if (!HOST_SCHEMAS.has(drawable.schema)) continue
    if (drawable.path === guidePath) continue
    if (!guidePath.startsWith(`${drawable.path}/`)) continue
    if (!best || drawable.path.length > best.path.length) best = drawable
  }
  return best
}

/**
 * Control handles appear only after the user selects that structure (or the
 * guide prim itself). Always-on Guide overlays were unfindable in a 128 m valley.
 */
export function isGuideActiveForSelection(
  guide: DisplayDrawable,
  index: DisplayIndex,
  selectedIds: ReadonlyArray<string>,
): boolean {
  if (selectedIds.length === 0) return false
  if (matchesSelection(guide, selectedIds, index)) return true
  const host = nearestHostDrawable(guide.path, index)
  return !!host && matchesSelection(host, selectedIds, index)
}

export function isGuideLayerKeyActive(
  layerKey: string,
  index: DisplayIndex,
  selectedIds: ReadonlyArray<string>,
  fallbackNodeId?: string,
): boolean {
  const drawable = index.drawables.find((d) => d.schema === 'guide' && d.layerKey === layerKey)
  if (drawable) return isGuideActiveForSelection(drawable, index, selectedIds)
  if (selectedIds.length === 0) return false
  return !!fallbackNodeId && selectedIds.includes(fallbackNodeId)
}

/** Highlight only the clicked mesh layer, not every prim hydrated from scene_output. */
export function isMeshLayerSelected(
  layer: Pick<MeshLayer, 'key' | 'nodeId'>,
  selectedIds: ReadonlyArray<string>,
  meshLayers: Record<string, Pick<MeshLayer, 'nodeId'>>,
): boolean {
  if (selectedIds.includes(layer.key)) return true
  if (!selectedIds.includes(layer.nodeId)) return false
  let count = 0
  for (const other of Object.values(meshLayers)) {
    if (other.nodeId === layer.nodeId) count++
    if (count > 1) return false
  }
  return count === 1
}
