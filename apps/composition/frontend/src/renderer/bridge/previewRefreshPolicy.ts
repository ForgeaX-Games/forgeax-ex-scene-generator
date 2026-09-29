// Two preview lanes. Mixing them is what made drop/delete wait on Rerun:
//
//   structural — add/delete/connect/Scene Script rewrite. Graph is the source
//     of the next frame. Always GET + GC, including empty worldPlanes.
//   param-drag — a number (or other) slider is moving. Live `preview-data`
//     owns the frame; network refresh waits until the drag settles so an
//     emptied output cache cannot black out the last good voxel/grid.
//
// Slider demand stays. It is this lane, not a blanket "execute in flight"
// suppressor on every graph:applied.
//
import { LOCAL_PARAM_EDIT_BATCH_PREFIX, isLocalParamEditBatch } from '@forgeax/node-runtime-react'

export { LOCAL_PARAM_EDIT_BATCH_PREFIX }

export const STRUCTURAL_GRAPH_DEBOUNCE_MS = 400
export const PARAM_EDIT_SETTLE_MS = 190
export const PARAM_EDIT_ACTIVITY_MS = 600

export type PreviewLane = 'structural' | 'param-drag'

export function previewLaneForGraphBatch(batchId: string | undefined | null): PreviewLane {
  return isLocalParamEditBatch(batchId) ? 'param-drag' : 'structural'
}

export type GraphAppliedAction = 'defer-to-param-settle' | 'structural-refresh'

export function graphAppliedAction(batchId: string | undefined | null): GraphAppliedAction {
  return previewLaneForGraphBatch(batchId) === 'param-drag'
    ? 'defer-to-param-settle'
    : 'structural-refresh'
}

/** Drop/delete execute must not cancel the structural graph:applied debounce. */
export function cancelStructuralDebounceOnExecStart(paramDragActive: boolean): boolean {
  return paramDragActive
}

export function execCompletedRefresh(paramDragActive: boolean): 'settle' | 'refresh' {
  return paramDragActive ? 'settle' : 'refresh'
}
