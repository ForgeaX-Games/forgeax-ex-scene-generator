import { useEffect } from 'react'
import { useRenderStore } from '../store'
import type { AliasMeta } from '../framework/asset/matchAssetEntry'
import { clearAllImgCache } from '../framework/asset/imageCache'
import { beginLoadingTask, endLoadingTask } from './loadingSignals.js'
import type { HttpApiClient } from '../../api/HttpApiClient'
import { pluginFetch } from '../../api/pluginHttp'

let refreshTimer: ReturnType<typeof setTimeout> | null = null
// One project switch fires THREE independent triggers for this hook (both
// `project:viewing` AND the legacy `project:activated` alias on the `graph`
// channel, plus the host's `workbench:project-changed` postMessage), and the
// backend's post-`/view` `reloadGameTexturesBinding()` broadcast adds a 4th
// (delayed) `library:changed` on the `asset` channel. Debouncing merges
// whichever of these land within the window into a single refetch instead of
// one GET + one clearAllImgCache() per source.
const REFRESH_DEBOUNCE_MS = 300

// Fetch the alias metadata matching pool and push it into the store. The asset
// drawMode matcher resolves each layer's asset_name against this pool.
//
// Zone-agnostic on purpose: the request omits `zone` so the backend returns the
// merged pool across ALL zones (except trash). A painted alias can live in any
// zone — e.g. after the base library was migrated raw→staging — so pinning the
// pool to a single zone (the old `?zone=raw`) left it empty and every asset-mode
// cell skipped (no texture) while color mode still worked.
//
// The pool is NOT static: it grows whenever a texture is imported / published
// into the active project's private store (e.g. the texture-pipeline publish
// bridge `scene:library.publishExternal`), and it differs per project.
// So besides the initial fetch we MUST re-pull on:
//   - `library:changed`  — any library mutation (import / publish-external / …)
//                          broadcasts this; without it a freshly published
//                          texture never matches until a full reload.
//   - project activation — switching the active project changes the private
//                          store; the old project's pool is stale.
// Mirrors the `/ws` + `workbench:project-changed` wiring in useBakedLayers.

async function refreshAliasMetas(): Promise<void> {
  beginLoadingTask('aliases')
  try {
    const res = await pluginFetch('/api/v1/library/aliases-meta')
    if (!res.ok) return
    const metas = (await res.json()) as AliasMeta[]
    if (Array.isArray(metas)) {
      useRenderStore.getState().setAliasMetas(metas)
      // New sandbox/private assets may have failed an earlier serve fetch (404);
      // bust the cache so billboard/topBillboard retry loading textures live.
      clearAllImgCache()
    }
  } catch {
    // tolerate failure — leave the current pool intact
  } finally {
    endLoadingTask('aliases')
  }
}

/** True for the kernel's runtime events that signal a project switch (both the legacy `project:activated` alias and `project:viewing` fire per switch — see refreshAliasMetas' own trigger-dedup note above). */
function isProjectViewing(kind: string): boolean {
  return kind === 'project:activated' || kind === 'project:viewing'
}

function scheduleAliasMetasRefresh(): void {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    void refreshAliasMetas()
  }, REFRESH_DEBOUNCE_MS)
}

// Shares the SAME `/ws` connection `useNodePreviews`/`useBakedLayers` use via
// `client.subscribe(...)` — a project switch used to open a 3rd independent
// `new WebSocket(...)` from this hook alone. `library:changed` already rides
// the kernel's `asset` channel (HttpApiClient forwards it as a synthetic
// `asset:library-changed` RuntimeEvent); `project:viewing`/`project:activated`
// ride `graph` (kernel workspace-lifecycle events).
export function useAliasMetas(client: HttpApiClient): void {
  useEffect(() => {
    scheduleAliasMetasRefresh()

    // Dedupe the project-switch trigger sources (WS `graph` event + host
    // postMessage) by project id, mirroring `useBakedLayers`' own
    // `handleProjectChanged` — the same `nextProjectId` re-arriving (e.g.
    // `project:viewing` immediately followed by the legacy `project:activated`
    // alias, or the WS event racing the postMessage) is a no-op instead of
    // another scheduled refetch.
    let activeProjectId: string | null = null
    const handleProjectChanged = (projectId: string | undefined): void => {
      const nextProjectId = projectId && projectId.trim() ? projectId : null
      if (nextProjectId && nextProjectId === activeProjectId) return
      if (nextProjectId) activeProjectId = nextProjectId
      scheduleAliasMetasRefresh()
    }

    // Any 'asset' channel event currently means the synthetic
    // `library:changed` forward (see HttpApiClient.ensureSocket), including
    // the backend's post-`/view` `reloadGameTexturesBinding()` broadcast —
    // refetch on the channel (debounced), same trigger AssetStoreSurface's
    // own `client.subscribe('asset', () => void fetchAssets())` reacts to.
    const unsubAsset = client.subscribe('asset', () => scheduleAliasMetasRefresh())
    const unsubGraph = client.subscribe('graph', (e) => {
      if (isProjectViewing(e.kind)) handleProjectChanged((e as { projectId?: string }).projectId)
    })
    const onWorkbenchMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; projectId?: unknown } | null
      if (!data || data.type !== 'workbench:project-changed') return
      handleProjectChanged(typeof data.projectId === 'string' ? data.projectId : undefined)
    }
    window.addEventListener('message', onWorkbenchMessage)
    return () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer)
        refreshTimer = null
      }
      unsubAsset()
      unsubGraph()
      window.removeEventListener('message', onWorkbenchMessage)
    }
  }, [client])
}
