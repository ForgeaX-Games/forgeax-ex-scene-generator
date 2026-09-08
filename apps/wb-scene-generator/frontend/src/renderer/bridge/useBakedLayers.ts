// Baked-layer ingestion — the graph-INDEPENDENT counterpart to useNodePreviews.
// It pulls the project's hand-edited layers from the baked scene-layer service
// into the store's `bakedLayers` bucket. Baked edits can originate outside the
// renderer iframe (left-pane undo/redo, agent actions), so this hook also listens
// for the backend's `baked:changed` broadcast and refreshes from the service.

import { useEffect } from 'react'
import { deferBakedLayersRefresh, hasLocalBakedLayerEdits, useRenderStore } from '../store'
import { bakedApi, type BakedLayersMode } from './bakedApi'
import { readEditMode, subscribeEditMode } from '../../surfaces/library/editToolbarBus'
import { syncTrace, syncTraceHintOnce } from '../../debug/syncTrace.js'
import { beginLoadingTask, endLoadingTask } from './loadingSignals.js'
import type { HttpApiClient } from '../../api/HttpApiClient'

let projectRevision = 0
let viewingProjectId: string | null = null
let bakedChangedTimer: ReturnType<typeof setTimeout> | null = null
const BAKED_CHANGED_DEBOUNCE_MS = 400

/**
 * Fetch baked layers and write them into the store. Safe to call anywhere.
 *
 * Defaults to summary mode (no cells) for browse/project-switch perf; pass
 * `mode: 'full'` when entering edit/paint or after structural mutations.
 */
export async function refreshBakedLayers(
  options: { deferIfLocalPending?: boolean; mode?: BakedLayersMode } = {},
): Promise<void> {
  const revision = projectRevision
  const deferIfLocalPending = options.deferIfLocalPending ?? true
  const mode = options.mode ?? (readEditMode() ? 'full' : 'summary')
  syncTrace('baked:refresh-start', { mode, deferIfLocalPending, revision })
  if (deferIfLocalPending && hasLocalBakedLayerEdits()) {
    syncTrace('baked:refresh-deferred', { reason: 'localPaintDirty' })
    deferBakedLayersRefresh()
    return
  }
  beginLoadingTask('baked')
  try {
    const result = await bakedApi.listResult(mode)
    if (revision !== projectRevision) return
    if (result.truncated && result.layers.length === 0) {
      // Never wipe Editable with an oversized-file empty response (common right
      // after Bake selected on large scenes when WS fires baked:changed → summary).
      syncTrace('baked:refresh-skipped-truncated-empty', { mode })
      console.warn('[baked] layer refresh skipped: baked-scene.json too large (truncated empty)')
      return
    }
    if (!Array.isArray(result.layers)) return
    syncTrace('baked:refresh-done', { layerCount: result.layers.length, mode, truncated: result.truncated })
    useRenderStore.getState().setBakedLayers(result.layers, { summary: mode === 'summary' })
  } catch (e) {
    syncTrace('baked:refresh-error', { error: String(e) })
    // Full cell load can fail on huge trees; fall back to summary so Editable still lists.
    if (mode === 'full') {
      try {
        const summary = await bakedApi.listResult('summary')
        if (revision !== projectRevision) return
        if (summary.truncated && summary.layers.length === 0) {
          console.warn('[baked] layer refresh failed and summary truncated', e)
          return
        }
        useRenderStore.getState().setBakedLayers(summary.layers, { summary: true })
        return
      } catch {
        // fall through
      }
    }
    // Leave the current bucket intact on a transient fetch error.
    console.warn('[baked] layer refresh failed', e)
  } finally {
    endLoadingTask('baked')
  }
}

function refreshBakedLayersForProject(): void {
  projectRevision += 1
  beginLoadingTask('baked')
  void (async () => {
    const revision = projectRevision
    const mode = readEditMode() ? 'full' : 'summary'
    try {
      const result = await bakedApi.listResult(mode)
      if (revision !== projectRevision) return
      const store = useRenderStore.getState()
      store.clearBakedLayers()
      if (result.truncated && result.layers.length === 0) {
        console.warn('[baked] project switch: baked-scene.json too large (truncated empty)')
        return
      }
      if (!Array.isArray(result.layers)) return
      store.setBakedLayers(result.layers, { summary: mode === 'summary' })
    } catch (e) {
      console.warn('[baked] project switch refresh failed', e)
    } finally {
      endLoadingTask('baked')
    }
  })()
}

/** Ignore baked mutations for projects the preview iframe is not showing. */
function shouldIgnoreBakedChanged(payload: unknown): boolean {
  const changedProjectId =
    payload && typeof payload === 'object' && typeof (payload as { projectId?: unknown }).projectId === 'string'
      ? (payload as { projectId: string }).projectId
      : null
  if (changedProjectId && viewingProjectId && changedProjectId !== viewingProjectId) return true
  return false
}

function scheduleBakedChangedRefresh(payload: unknown): void {
  if (shouldIgnoreBakedChanged(payload)) return
  syncTrace('baked:ws-changed-scheduled', { payload })
  if (bakedChangedTimer) clearTimeout(bakedChangedTimer)
  bakedChangedTimer = setTimeout(() => {
    bakedChangedTimer = null
    void refreshBakedLayers({ deferIfLocalPending: true })
  }, BAKED_CHANGED_DEBOUNCE_MS)
}

/** Load baked layers and keep them synced with backend baked mutations. */
export function useBakedLayers(client: HttpApiClient): void {
  useEffect(() => {
    syncTraceHintOnce()
    // Defer so preview/asset-store iframes paint before the baked browse fetch.
    const initialTimer = setTimeout(() => { void refreshBakedLayers() }, 0)
    let activeProjectId: string | null = null
    const handleProjectChanged = (projectId?: string) => {
      const nextProjectId = projectId && projectId.trim() ? projectId : null
      viewingProjectId = nextProjectId
      if (nextProjectId && nextProjectId === activeProjectId) return
      activeProjectId = nextProjectId
      refreshBakedLayersForProject()
    }
    // Shares the SAME `/ws` connection `useNodePreviews`/`useAliasMetas` use
    // via `client` (see HttpApiClient.ensureSocket) instead of opening a 3rd
    // independent `new WebSocket(...)` from this hook alone. `baked:changed`
    // has no `{event:'runtime', payload:{kind}}` envelope, so it rides
    // `subscribeRaw`; `project:viewing` is a typed kernel workspace-lifecycle
    // event on the `graph` channel. Ignore the legacy `project:activated`
    // alias — the backend broadcasts BOTH for one switch and reacting to it
    // too would double-fetch.
    const unsubBaked = client.subscribeRaw('baked:changed', (payload) => scheduleBakedChangedRefresh(payload))
    const unsubGraph = client.subscribe('graph', (e) => {
      if (e.kind === 'project:viewing') handleProjectChanged(e.projectId)
    })
    const onWorkbenchMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; projectId?: unknown } | null
      if (!data || data.type !== 'workbench:project-changed') return
      handleProjectChanged(typeof data.projectId === 'string' ? data.projectId : undefined)
    }
    window.addEventListener('message', onWorkbenchMessage)
    const unsubEdit = subscribeEditMode((on) => {
      if (on) void refreshBakedLayers({ deferIfLocalPending: false, mode: 'full' })
    })
    return () => {
      clearTimeout(initialTimer)
      unsubEdit()
      if (bakedChangedTimer) clearTimeout(bakedChangedTimer)
      unsubBaked()
      unsubGraph()
      window.removeEventListener('message', onWorkbenchMessage)
    }
  }, [client])
}
