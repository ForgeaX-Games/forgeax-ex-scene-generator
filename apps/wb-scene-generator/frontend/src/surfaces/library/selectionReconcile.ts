import type { RendererVoxelLayer } from '../../renderer/types'

/**
 * Bidirectional layer-selection contract between the LAYER PANEL (local
 * multi-select sets in RendererSurface) and the SELECT tool / AI command (which
 * write the store's single `selectedLayerKey`). Both must share ONE source of
 * truth: `store.selectedLayerKey` is that source for the single highlighted row.
 *
 * This pure helper decides how the panel's local selection sets should reconcile
 * when `selectedLayerKey` changes from OUTSIDE the panel (a scene SELECT click or
 * AI select-layer). Keeping the decision pure lets us test the contract — panel
 * selects A, then a scene click resolves B → the panel selection is REPLACED by
 * B — without rendering the whole surface.
 */
export interface SelectionReconcileSources {
  /** baked layers keyed by `baked:${path}`. */
  readonly baked: Readonly<Record<string, RendererVoxelLayer | undefined>>
  /** output layers keyed by `${nodeId}:${nodePath}`. */
  readonly output: Readonly<Record<string, RendererVoxelLayer | undefined>>
}

export interface SelectionReconcileResult {
  /** The single key the OUTPUT set should collapse to, or null to clear it. */
  readonly outputKey: string | null
  /** The single key the BAKED set should collapse to, or null to clear it. */
  readonly bakedKey: string | null
}

/**
 * Given an EXTERNAL `selectedLayerKey`, classify it as a baked or output layer
 * and return which single key each local set should hold. Exactly one of the two
 * is non-null when the key resolves; both null when the selection is cleared or
 * the key matches neither bucket yet (layers still loading — leave sets as-is at
 * the call site, but the bus fallback still emits the key).
 */
export function reconcilePanelSelection(
  selectedKey: string | null,
  sources: SelectionReconcileSources,
): SelectionReconcileResult {
  if (selectedKey === null) return { outputKey: null, bakedKey: null }
  if (sources.baked[selectedKey]) return { outputKey: null, bakedKey: selectedKey }
  if (sources.output[selectedKey]) return { outputKey: selectedKey, bakedKey: null }
  return { outputKey: null, bakedKey: null }
}
