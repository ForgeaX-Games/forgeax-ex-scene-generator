// Project store — multi-project management for the faithful editor.
//
// A port of the legacy editor's projectStore onto the kernel transport. It
// drives create / list / open(switch) / delete over the EditorApiAdapter's
// optional project methods, and wires the OPEN CASCADE into the existing
// live-sync machinery rather than reinventing it:
//
//   switchProject(id):
//     1. persistSession()            ← flush the outgoing project's canvas
//     2. api.viewProject(id)        ← server sets the UI viewing target
//     3. reset node outputs / dynamic ports / selection / group view
//     4. loadPipeline()              ← pipelineRevision++ → useCanvasGraphSync
//                                       reconcile rebuild → preview refresh
//     5. clearHistory()              ← undo stack does NOT cross projects
//     6. setActiveProjectType(type)  ← keeps the battery filter correct
//     7. refresh recentProjectIds from the workspace doc
//
// Steps 1–7 reuse the SAME paths every other actor uses (loadPipeline →
// graph:applied → reconcile), so no editor behaviour is regressed. The app
// (e.g. scene-generator) observes `viewingProjectId` to clear/reload its preview
// iframe (the renderer `projectChanged` signal) — that wiring stays app-level.

import { create } from 'zustand'

import type { CreateProjectRequest } from '../../api/ApiClient.js'
import type { ProjectMeta, WorkspaceState } from '@forgeax/node-runtime'

import { getEditorTransport } from '../transport/index.js'
import { useHistoryStore } from './historyStore.js'
import {
  cancelDeferredProjectSwitchOutputRefresh,
  clearOutputMetaCache,
  hasLocalPipelineMutations,
  usePipelineStore,
} from './pipelineStore.js'
import { useUIStore } from './uiStore.js'

function resetPipelineUiForProjectSwitch(): void {
  cancelDeferredProjectSwitchOutputRefresh()
  clearOutputMetaCache()
  usePipelineStore.setState({
    nodeOutputs: {},
    dynamicOutputPorts: {},
    pipelineStatus: 'idle',
    selectedNode: null,
    selectedNodeIds: [],
    pendingSelectNodeIds: null,
    groupViewStack: [],
  })
}

function refreshOutputsAfterProjectSwitch(_agentBusy: boolean, targetIsExecuting: boolean): void {
  // Always hydrate the viewing project from server-retained outputs. Agents
  // executing on *other* projects must not defer or skip this — that left the
  // preview blank until every unrelated session went idle.
  cancelDeferredProjectSwitchOutputRefresh()
  const refreshed = usePipelineStore.getState().refreshConnectedOutputs('project-switch')
  if (targetIsExecuting) return
  // refreshConnectedOutputs only pulls whatever the server already has cached —
  // it never runs anything. If the project we just switched into has a cold
  // output cache (new project, cache cleared, or never executed), the preview
  // then silently stays blank until the user manually hits "clear cache + re-run".
  // Editor.tsx's initial mount effect already covers this exact case via
  // `refreshConnectedOutputs('mount').then(() => autoExecuteOnOpen())`, but that
  // effect only fires once per editor session — it never re-runs on later
  // switches. Chain the same no-op-when-warm auto-run here so every switch gets
  // the same guarantee. Skipped when an agent is already executing the *target*
  // project — its own run will populate outputs via live-sync; auto-running here
  // would just race/duplicate that work.
  void refreshed.then(() => usePipelineStore.getState().autoExecuteOnOpen())
}

function reloadHistoryAfterProjectSwitch(agentBusy: boolean): void {
  const { api } = getEditorTransport()
  useHistoryStore.getState().clearHistory()
  if (agentBusy) {
    void api
      .getHistory()
      .then((entries) => useHistoryStore.getState().hydrate(entries))
      .catch((e) => console.warn('[projectStore] deferred history reload failed:', e))
    return
  }
  void (async () => {
    try {
      useHistoryStore.getState().hydrate(await api.getHistory())
    } catch (e) {
      console.warn('[projectStore] history reload after switch failed:', e)
      useHistoryStore.getState().clearHistory()
    }
  })()
}

function viewingIdFromWorkspace(workspace: WorkspaceState | null | undefined): string | null {
  if (!workspace) return null
  return workspace.viewingProjectId ?? (workspace as { activeProjectId?: string | null }).activeProjectId ?? null
}

/**
 * Coarse phase within `switchProject`'s open cascade, for loading-progress UI
 * (e.g. the workbench's project-switch status panel). Read-only telemetry —
 * nothing branches on it. `null` when no switch is in flight.
 */
export type SwitchPhase = 'persisting' | 'viewing' | 'hydrating'

/**
 * How this document participates in project open/switch.
 *
 * - `host` (default): owns the full open cascade — viewProject, loadPipeline,
 *   refreshConnectedOutputs, autoExecuteOnOpen. Used by the center workbench
 *   document that hosts the Editor canvas.
 * - `satellite`: a sibling iframe (left project panel) that only tells the
 *   backend which project is being viewed via `viewProject`; the host document
 *   picks up the `project:viewing` broadcast and runs the heavy cascade. Without
 *   this split, two documents each calling `bootstrap()` → `switchProject()` on
 *   cold boot each trigger a full pipeline execution (observed as two back-to-back
 *   `[execute-trace]` lines for the same project).
 */
export type ProjectSwitchRole = 'host' | 'satellite'

interface ProjectState {
  projects: ProjectMeta[]
  viewingProjectId: string | null
  /**
   * The project this document's CANVAS is actually hydrated to (host role only).
   *
   * Distinct from `viewingProjectId`, which merely mirrors the server workspace
   * and is written by any `fetchProjects()` — including the one triggered by the
   * `project:created` broadcast. Skipping the open cascade on `viewingProjectId`
   * equality therefore dropped the real `project:viewing` event that follows a
   * "new project" (the id already matched), leaving the canvas on the PREVIOUS
   * project's graph while every write went to the new project id. Only a real
   * hydrate updates this field, so it is the correct "already open" test.
   */
  hydratedProjectId: string | null
  executingProjectIds: string[]
  recentProjectIds: string[]
  isLoading: boolean
  isSwitching: boolean
  switchPhase: SwitchPhase | null
  error: string | null
  /**
   * Current ForgeaX game slug (from the host iframe URL — see setActiveGameSlug
   * callers). When set and `showAllProjects` is false, fetchProjects() scopes
   * the list to this game only. Null in standalone/non-studio contexts, where
   * the panel always shows every project (no game to scope by).
   */
  activeGameSlug: string | null
  /** "显示全部" toggle — when true, fetchProjects() ignores activeGameSlug and
   *  lists every project in the workspace. Persisted per-browser so the user's
   *  choice survives a reload. */
  showAllProjects: boolean
  /** See `ProjectSwitchRole` — set once at boot by host vs left-pane surfaces. */
  projectSwitchRole: ProjectSwitchRole

  /** Set the current game slug (host wiring) and re-fetch if it actually changed. */
  setActiveGameSlug: (slug: string | null) => void
  /** Declare whether this document owns the full open cascade or is a satellite. */
  setProjectSwitchRole: (role: ProjectSwitchRole) => void
  /** Flip the "show all" toggle and re-fetch. */
  setShowAllProjects: (show: boolean) => void
  /** Load the project list + workspace, syncing the viewing project type. */
  fetchProjects: () => Promise<void>
  /** fetchProjects then open the viewing project (cold boot). */
  bootstrap: () => Promise<void>
  /** Open a project: the full faithful cascade (flush → view → reconcile → clearHistory). */
  switchProject: (id: string) => Promise<void>
  /**
   * Listen for `project:viewing` (and legacy `project:activated`) broadcast by
   * the backend when ANOTHER client switches the viewing project, and re-sync
   * this client to it. Also tracks `project:executing` for agent lock badges.
   * Returns an unsubscribe. Wire alongside pipelineStore.subscribeLiveSync at boot.
   */
  subscribeProjectActivation: () => () => void
  /** Create a project then open it. Auto-tags with activeGameSlug unless the
   *  caller already specified a gameSlug (or there is no active game). */
  createProject: (input: CreateProjectRequest) => Promise<ProjectMeta>
  /** Delete a project; the server keeps the workspace non-empty + returns it. */
  deleteProject: (id: string, assetPolicy?: 'detach' | 'delete') => Promise<void>
  /** Rename a project. */
  renameProject: (id: string, name: string) => Promise<void>
}

const SHOW_ALL_KEY = 'forgeax.projectPanel.showAllProjects'

function loadShowAllProjects(): boolean {
  try {
    return localStorage.getItem(SHOW_ALL_KEY) === 'true'
  } catch {
    return false
  }
}

function persistShowAllProjects(show: boolean): void {
  try {
    localStorage.setItem(SHOW_ALL_KEY, String(show))
  } catch {
    /* ignore (private mode / SSR) */
  }
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  viewingProjectId: null,
  hydratedProjectId: null,
  executingProjectIds: [],
  recentProjectIds: [],
  isLoading: false,
  isSwitching: false,
  switchPhase: null,
  error: null,
  activeGameSlug: null,
  showAllProjects: loadShowAllProjects(),
  projectSwitchRole: 'host',

  setProjectSwitchRole: (role: ProjectSwitchRole) => {
    set({ projectSwitchRole: role })
  },

  setActiveGameSlug: (slug: string | null) => {
    if (slug === get().activeGameSlug) return
    set({ activeGameSlug: slug })
    void get().fetchProjects()
  },

  setShowAllProjects: (show: boolean) => {
    if (show === get().showAllProjects) return
    persistShowAllProjects(show)
    set({ showAllProjects: show })
    void get().fetchProjects()
  },

  fetchProjects: async () => {
    set({ isLoading: true, error: null })
    try {
      const { api } = getEditorTransport()
      const { activeGameSlug, showAllProjects } = get()
      const listOpts = !showAllProjects && activeGameSlug ? { gameSlug: activeGameSlug } : undefined
      const [projects, workspace] = await Promise.all([api.listProjects(listOpts), api.getWorkspace()])
      const viewingProjectId = viewingIdFromWorkspace(workspace)
      set({
        projects: [...projects],
        viewingProjectId,
        executingProjectIds: workspace?.executingProjectIds ?? [],
        recentProjectIds: workspace?.recentProjectIds ?? [],
      })
      const viewing = projects.find((p) => p.id === viewingProjectId)
      useUIStore.getState().setActiveProjectType(viewing?.type ?? null)
    } catch (e) {
      set({ error: (e as Error).message })
    } finally {
      set({ isLoading: false })
    }
  },

  bootstrap: async () => {
    await get().fetchProjects()
    const viewingId = get().viewingProjectId
    if (viewingId) {
      await get().switchProject(viewingId)
    }
  },

  switchProject: async (id: string) => {
    if (get().isSwitching) return
    // Satellite panes never hydrate a pipeline — re-clicking the active row is
    // a no-op. Host panes skip only when the canvas is ALREADY HYDRATED to this
    // project (not merely when the workspace mirror says so — see
    // `hydratedProjectId`).
    if (get().projectSwitchRole === 'satellite') {
      if (id === get().viewingProjectId) return
    } else if (id === get().hydratedProjectId && usePipelineStore.getState().currentPipeline) {
      return
    }

    // Satellite documents (left project-panel iframe) only announce the viewing
    // target to the backend. The host document's subscribeProjectActivation()
    // handler runs the full open cascade when it receives project:viewing.
    if (get().projectSwitchRole === 'satellite') {
      set({ isSwitching: true, error: null, switchPhase: 'viewing' })
      try {
        const { api } = getEditorTransport()
        const view = api.viewProject ?? api.activateProject
        if (!view) throw new Error('[projectStore] transport does not support viewProject')
        const __tView0 = performance.now()
        const { project } = await view.call(api, id)
        const __viewMs = performance.now() - __tView0
        set({ viewingProjectId: id })
        useUIStore.getState().setActiveProjectType(project?.manifest?.type ?? null)
        console.log(
          `[switch-trace] switchProject satellite id=${id} viewProject(network)=${__viewMs.toFixed(1)}ms`,
        )
      } catch (e) {
        console.error('[projectStore] satellite switchProject failed:', e)
        set({ error: (e as Error).message })
      } finally {
        set({ isSwitching: false, switchPhase: null })
      }
      return
    }

    const __tSwitch0 = performance.now()
    set({ isSwitching: true, error: null })
    try {
      const { api } = getEditorTransport()
      const leavingId = get().viewingProjectId
      const agentBusy = get().executingProjectIds.length > 0
      const leavingIsExecuting =
        leavingId != null && get().executingProjectIds.includes(leavingId)
      const targetIsExecuting = get().executingProjectIds.includes(id)

      // Split-pane navigation runs in a separate iframe with its own store. It
      // may hold an old pipeline snapshot, so only the iframe that actually
      // changed its local graph is allowed to flush before switching.
      let __persistMs = 0
      if (!leavingIsExecuting && hasLocalPipelineMutations()) {
        set({ switchPhase: 'persisting' })
        const __t0 = performance.now()
        try {
          await usePipelineStore.getState().persistSession()
        } catch (e) {
          console.warn('[projectStore] persistSession before switch failed:', e)
        }
        __persistMs = performance.now() - __t0
      }

      set({ switchPhase: 'viewing' })
      const view = api.viewProject ?? api.activateProject
      if (!view) throw new Error('[projectStore] transport does not support viewProject')
      const __tView0 = performance.now()
      const { project, pipeline } = await view.call(api, id)
      const __viewMs = performance.now() - __tView0

      set({ viewingProjectId: id })
      resetPipelineUiForProjectSwitch()

      set({ switchPhase: 'hydrating' })
      const __tHydrate0 = performance.now()
      if (pipeline) {
        usePipelineStore.getState().hydratePipelineFromSnapshot(pipeline)
      } else {
        await usePipelineStore.getState().loadPipeline()
      }
      const __hydrateMs = performance.now() - __tHydrate0
      set({ hydratedProjectId: id })

      refreshOutputsAfterProjectSwitch(agentBusy, targetIsExecuting)
      reloadHistoryAfterProjectSwitch(agentBusy)

      useUIStore.getState().setActiveProjectType(project?.manifest?.type ?? null)

      void api.getWorkspace().then((ws) => {
        set({
          recentProjectIds: ws?.recentProjectIds ?? [],
          executingProjectIds: ws?.executingProjectIds ?? get().executingProjectIds,
        })
      })

      const __totalMs = performance.now() - __tSwitch0
      console.log(
        `[switch-trace] switchProject id=${id} persistSession=${__persistMs.toFixed(1)}ms ` +
          `viewProject(network)=${__viewMs.toFixed(1)}ms hydrate/loadPipeline=${__hydrateMs.toFixed(1)}ms ` +
          `TOTAL(blocking UI)=${__totalMs.toFixed(1)}ms`,
      )
    } catch (e) {
      console.error('[projectStore] switchProject failed:', e)
      set({ error: (e as Error).message })
    } finally {
      set({ isSwitching: false, switchPhase: null })
    }
  },

  subscribeProjectActivation: () => {
    const { ws } = getEditorTransport()
    ws.connect()

    const syncViewingProject = (projectId: string) => {
      if (get().isSwitching) return
      // A satellite pane owns no canvas: it only tracks which project is being
      // viewed. Hydrating here would leave it holding a stale graph snapshot
      // that must never be persisted over the host editor's edits.
      if (get().projectSwitchRole === 'satellite') {
        if (projectId !== get().viewingProjectId) set({ viewingProjectId: projectId })
        return
      }
      if (projectId === get().hydratedProjectId) return
      void (async () => {
        set({ isSwitching: true, switchPhase: 'viewing', error: null })
        try {
          const agentBusy = get().executingProjectIds.length > 0
          const targetIsExecuting = get().executingProjectIds.includes(projectId)
          set({ viewingProjectId: projectId })
          resetPipelineUiForProjectSwitch()
          set({ switchPhase: 'hydrating' })
          await usePipelineStore.getState().loadPipeline()
          set({ hydratedProjectId: projectId })
          refreshOutputsAfterProjectSwitch(agentBusy, targetIsExecuting)
          reloadHistoryAfterProjectSwitch(agentBusy)
          await get().fetchProjects()
        } catch (e) {
          console.error('[projectStore] project:viewing sync failed:', e)
          set({ error: (e as Error).message })
        } finally {
          set({ isSwitching: false, switchPhase: null })
        }
      })()
    }

    const refreshExecuting = () => {
      void (async () => {
        try {
          const ws = await getEditorTransport().api.getWorkspace()
          if (ws?.executingProjectIds) {
            set({ executingProjectIds: ws.executingProjectIds })
          }
        } catch {
          /* ignore — badge degrades gracefully */
        }
      })()
    }

    const unsubs = [
      ws.on('project:viewing', ({ projectId }) => syncViewingProject(projectId)),
      ws.on('project:activated', ({ projectId }) => syncViewingProject(projectId)),
      ws.on('project:executing', ({ projectId }) => {
        set((s) => ({
          executingProjectIds: s.executingProjectIds.includes(projectId)
            ? s.executingProjectIds
            : [...s.executingProjectIds, projectId],
        }))
        refreshExecuting()
        // Refresh list for new rows / lock badges only. Do NOT adopt workspace
        // viewing here via a full fetchProjects→set(viewingProjectId) cycle when
        // an agent opens a different project — viewing stays whatever the human
        // last /view'd (AI open no longer mutates viewingProjectId).
        void get().fetchProjects()
      }),
      ws.on('project:list-changed', () => {
        void get().fetchProjects()
      }),
      // The project list changed elsewhere (an agent created/removed a project
      // via the tool bridge). Refetch so the navigation pane reflects it without
      // a manual reload. Idempotent for the client that made the change locally.
      ws.on('project:created', () => {
        void get().fetchProjects()
      }),
      ws.on('project:deleted', () => {
        void get().fetchProjects()
      }),
      ws.on('project:idle', ({ projectId }) => {
        set((s) => {
          const next = s.executingProjectIds.filter((id) => id !== projectId)
          if (next.length === 0) {
            queueMicrotask(() => {
              cancelDeferredProjectSwitchOutputRefresh()
              void usePipelineStore.getState().refreshConnectedOutputs('project-switch')
            })
          }
          return { executingProjectIds: next }
        })
      }),
    ]
    return () => unsubs.forEach((u) => u())
  },

  createProject: async (input: CreateProjectRequest) => {
    const { api } = getEditorTransport()
    const { activeGameSlug } = get()
    const withGameSlug: CreateProjectRequest =
      input.gameSlug !== undefined || !activeGameSlug ? input : { ...input, gameSlug: activeGameSlug }
    const meta = await api.createProject(withGameSlug)
    set((s) => ({ projects: [...s.projects, meta] }))
    await get().switchProject(meta.id)
    return meta
  },

  deleteProject: async (id: string, assetPolicy?: 'detach' | 'delete') => {
    const { api } = getEditorTransport()
    const wasViewing = get().viewingProjectId === id
    const res = await api.deleteProject(id, assetPolicy ? { assetPolicy } : undefined)
    set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
      recentProjectIds: s.recentProjectIds.filter((rid) => rid !== id),
      executingProjectIds: s.executingProjectIds.filter((eid) => eid !== id),
    }))
    const nextViewing = viewingIdFromWorkspace(res.workspace)
    if (wasViewing && nextViewing) {
      await get().switchProject(nextViewing)
    } else {
      await get().fetchProjects()
    }
  },

  renameProject: async (id: string, name: string) => {
    const { api } = getEditorTransport()
    const meta = await api.updateProject(id, { name })
    set((s) => ({ projects: s.projects.map((p) => (p.id === id ? meta : p)) }))
  },
}))
