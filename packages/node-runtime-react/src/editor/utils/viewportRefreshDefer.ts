/** Shared viewport-moving flag so pipeline refresh can defer until pan/zoom stops. */
import type { RefreshReason } from './refreshTrace.js'

let _viewportMoving = false
let _deferredRefreshReason: RefreshReason | null = null
const _deferredGraphAppliedBatchIds: string[] = []

type GraphAppliedHandler = (batchId: string | undefined) => void
let _graphAppliedHandler: GraphAppliedHandler | null = null

export function setViewportMoving(moving: boolean): void {
  _viewportMoving = moving
}

export function isViewportMoving(): boolean {
  return _viewportMoving
}

export function deferRefreshUntilViewportEnd(reason: RefreshReason): void {
  _deferredRefreshReason = reason
}

export function takeDeferredRefreshReason(): RefreshReason | null {
  const r = _deferredRefreshReason
  _deferredRefreshReason = null
  return r
}

/** Register the live-sync graph:applied handler (set once from subscribeLiveSync). */
export function registerGraphAppliedHandler(handler: GraphAppliedHandler): void {
  _graphAppliedHandler = handler
}

export function deferGraphAppliedBatch(batchId?: string): void {
  _deferredGraphAppliedBatchIds.push(batchId ?? '')
}

export function flushDeferredGraphAppliedBatches(): void {
  const ids = _deferredGraphAppliedBatchIds.splice(0)
  for (const id of ids) {
    _graphAppliedHandler?.(id || undefined)
  }
}
