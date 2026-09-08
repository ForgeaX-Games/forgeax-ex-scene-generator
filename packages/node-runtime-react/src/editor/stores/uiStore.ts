// UI store — global editor UI state: sidebar/palette visibility, theme,
// language, connection status, snap/probe toggles, text presets and favorite
// batteries. Persisted to localStorage where available.
//
// App-level fields from the legacy editor are stripped: projects, workspace,
// multi-iframe inline panels (renderer/assetstore/viewer), workbench focus,
// and the battery-meta network calls (stars / dev-notes). Only the generic
// editor UI state remains. The legacy lang toggle also broadcast a WS event to
// a separate renderer iframe; with no second frame here that broadcast is
// dropped.

import { create } from 'zustand'

import type { Battery } from '../types.js'
import { peekEditorTransport } from '../transport/index.js'
import { usePipelineStore } from './pipelineStore.js'

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected'
export type Theme = 'dark' | 'light'
export type LangMode = 'zh' | 'en'

export interface TextPreset {
  id: string
  /** User-facing label shown in the presets rail. May be empty for legacy/local entries. */
  title: string
  text: string
  createdAt: number
  /** True for plugin built-in presets (read-only, cannot be deleted). */
  builtin: boolean
}

export interface FavoriteBattery {
  batteryId: string
  name: string
  /** Serialised Battery (for dropping onto the canvas). */
  batteryJson: string
  addedAt: number
}

/** Dev-note entry: appended each time the note modal opens; history is read-only. */
export interface DevNoteEntry {
  ts: number
  title: string
  content: string
}

/**
 * Battery catalog filter mode. The legacy editor adds a 'templates' mode backed
 * by an app-level template-folder API; in the generic editor only 'develop' is
 * driven, but the field is kept so the sidebar render branches stay faithful.
 */
export type BatteryFilterMode = 'develop' | 'templates'

// ── localStorage helpers (SSR / test safe) ────────────────────────────────

function hasStorage(): boolean {
  return typeof localStorage !== 'undefined'
}

function readStorage(key: string): string | null {
  if (!hasStorage()) return null
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string): void {
  if (!hasStorage()) return
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

function loadJsonArray<T>(key: string): T[] {
  const raw = readStorage(key)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

function applyTheme(theme: Theme): void {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme)
  }
  writeStorage('theme', theme)
}

/**
 * Load the localStorage-seeded preset list, backfilling the newer `title` /
 * `builtin` fields onto legacy entries (which only had id/text/createdAt). Used
 * as the initial value and as the fallback when the client has no preset routes.
 */
function loadLocalTextPresets(): TextPreset[] {
  return loadJsonArray<Partial<TextPreset>>('text-presets')
    .filter((p): p is Partial<TextPreset> & { text: string } => typeof p.text === 'string' && !!p.text)
    .map((p) => ({
      id: typeof p.id === 'string' && p.id ? p.id : `preset-${Math.random().toString(36).slice(2, 9)}`,
      title: typeof p.title === 'string' ? p.title : '',
      text: p.text,
      createdAt: typeof p.createdAt === 'number' ? p.createdAt : 0,
      builtin: p.builtin === true,
    }))
}

// ── Initial values ────────────────────────────────────────────────────────

const initialTheme: Theme = (readStorage('theme') as Theme) || 'dark'
applyTheme(initialTheme)
const initialLangMode: LangMode = (readStorage('langMode') as LangMode) || 'en'
const initialProbeMode = readStorage('probeMode') === 'true'
const initialShowDevNoteCount = readStorage('showDevNoteCount') !== 'false'
const initialShowSidebar = readStorage('showSidebar') !== 'false'

function loadJsonRecord<T>(key: string): Record<string, T> {
  const raw = readStorage(key)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, T>) : {}
  } catch {
    return {}
  }
}

const initialBatteryStars = loadJsonRecord<number>('battery-stars')
const initialBatteryDevNotes = loadJsonRecord<DevNoteEntry[]>('battery-dev-notes')
const initialBatteryFilterMode: BatteryFilterMode =
  readStorage('batteryFilterMode') === 'templates' ? 'templates' : 'develop'

interface UIState {
  showSidebar: boolean
  showBatteryBar: boolean
  batteryBarCollapsed: boolean
  isLoading: boolean
  error: string | null
  connectionStatus: ConnectionStatus
  theme: Theme
  /** Data-probe mode: show port types / values on edges. */
  probeMode: boolean
  /** Node language mode: zh = labels, en = identifiers. */
  langMode: LangMode
  /** Snap-to-axis on drag. Always on at boot (no titlebar toggle). */
  snapEnabled: boolean
  /** Show the dev-note count badge on battery cards. */
  showDevNoteCount: boolean
  textPresets: TextPreset[]
  /**
   * True once the backend-backed preset store has answered (or failed). Until
   * then the rail shows whatever localStorage seeded. Apps whose client lacks
   * preset routes stay in pure-localStorage mode (this stays false-then-true
   * after a no-op load).
   */
  textPresetsLoaded: boolean
  favoriteBatteries: FavoriteBattery[]
  /** Per-battery star rating (catalog favourites/ranking). */
  batteryStars: Record<string, number>
  /** Per-battery dev-note history. */
  batteryDevNotes: Record<string, DevNoteEntry[]>
  /** Catalog filter mode: develop (generic) or templates (app-level, not driven here). */
  batteryFilterMode: BatteryFilterMode
  /**
   * Active project type for projectTypes filtering. Null = show all batteries;
   * the multi-project chrome that sets this is app-level and stripped, so it
   * stays null here and the filter is a faithful no-op.
   */
  activeProjectType: string | null

  toggleSidebar: () => void
  toggleBatteryBar: () => void
  toggleBatteryBarCollapsed: () => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setConnectionStatus: (status: ConnectionStatus) => void
  toggleTheme: () => void
  toggleProbeMode: () => void
  toggleLangMode: () => void
  toggleSnap: () => void
  toggleShowDevNoteCount: () => void
  addTextPreset: (text: string, title?: string) => void
  removeTextPreset: (id: string) => void
  /**
   * Refresh presets from the backend store (built-in + user). No-op (other than
   * flipping `textPresetsLoaded`) when the active client lacks preset routes, so
   * the localStorage-seeded list stays put.
   */
  loadTextPresets: () => Promise<void>
  /**
   * Save the current panel text as a reusable prompt battery (asset-only).
   * No-op when the active client lacks prompt routes. The server parses the
   * `[placeholder]` names; on success the battery catalog is refreshed so the
   * new prompt appears under the BatteryBar "Prompts" big tag.
   */
  addPrompt: (template: string, name?: string, tag?: string) => void
  /**
   * Delete a USER prompt by its raw store id (the `prompt:` battery-id prefix is
   * stripped by the caller). No-op for built-in prompts (the server rejects
   * them). On success the catalog is refreshed so the prompt battery disappears.
   */
  removePrompt: (promptId: string) => void
  /**
   * Delete a USER template by group id. No-op when the transport lacks the
   * delete route or the template is a read-only preset. Refreshes the catalog on
   * success so the template battery disappears from the Templates palette.
   */
  removeUserTemplate: (groupId: string) => void
  /**
   * Delete a develop GROUPS-tab group battery by group id, removing it from the
   * app's local battery directory. No-op when the transport lacks the delete
   * route. Refreshes the catalog on success so the group battery disappears.
   */
  removeGroupBattery: (groupId: string) => void
  addFavoriteBattery: (battery: Battery) => void
  removeFavoriteBattery: (batteryId: string) => void
  reorderFavoriteBatteries: (fromId: string, toId: string) => void
  setBatteryFilterMode: (mode: BatteryFilterMode) => void
  setActiveProjectType: (type: string | null) => void
  adjustBatteryStars: (batteryId: string, delta: 1 | -1) => void
  appendDevNote: (batteryId: string, entry: DevNoteEntry) => void
  updateLastDevNote: (batteryId: string, entry: DevNoteEntry) => void
  deleteLastDevNote: (batteryId: string, ts: number) => void
}

export const useUIStore = create<UIState>((set) => ({
  showSidebar: initialShowSidebar,
  showBatteryBar: true,
  batteryBarCollapsed: false,
  isLoading: false,
  error: null,
  connectionStatus: 'disconnected',
  theme: initialTheme,
  probeMode: initialProbeMode,
  langMode: initialLangMode,
  snapEnabled: true,
  showDevNoteCount: initialShowDevNoteCount,
  textPresets: loadLocalTextPresets(),
  textPresetsLoaded: false,
  favoriteBatteries: loadJsonArray<FavoriteBattery>('favorite-batteries'),
  batteryStars: initialBatteryStars,
  batteryDevNotes: initialBatteryDevNotes,
  batteryFilterMode: initialBatteryFilterMode,
  activeProjectType: null,

  toggleSidebar: () =>
    set((state) => {
      const next = !state.showSidebar
      writeStorage('showSidebar', String(next))
      return { showSidebar: next }
    }),

  toggleBatteryBar: () => set((state) => ({ showBatteryBar: !state.showBatteryBar })),
  toggleBatteryBarCollapsed: () => set((state) => ({ batteryBarCollapsed: !state.batteryBarCollapsed })),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  setConnectionStatus: (status) => set({ connectionStatus: status }),

  toggleTheme: () =>
    set((state) => {
      const next: Theme = state.theme === 'dark' ? 'light' : 'dark'
      applyTheme(next)
      return { theme: next }
    }),

  toggleProbeMode: () =>
    set((state) => {
      const next = !state.probeMode
      writeStorage('probeMode', String(next))
      return { probeMode: next }
    }),

  toggleLangMode: () =>
    set((state) => {
      const next: LangMode = state.langMode === 'zh' ? 'en' : 'zh'
      writeStorage('langMode', next)
      return { langMode: next }
    }),

  toggleSnap: () =>
    set((state) => {
      const next = !state.snapEnabled
      writeStorage('snapEnabled', String(next))
      return { snapEnabled: next }
    }),

  toggleShowDevNoteCount: () =>
    set((state) => {
      const next = !state.showDevNoteCount
      writeStorage('showDevNoteCount', String(next))
      return { showDevNoteCount: next }
    }),

  // Save a preset. When the active client backs presets with a server store
  // (the 2d-scene-asset-generator does), persist there (one file per entry) and
  // refresh from the merged built-in + user list. Otherwise fall back to the
  // legacy localStorage list. `title` is the user-entered label.
  addTextPreset: (text, title) =>
    set((state) => {
      const adapter = peekEditorTransport()?.api
      if (adapter?.supportsTextPresets) {
        void adapter
          .createTextPreset({ text, ...(title ? { title } : {}) })
          .then(() => useUIStore.getState().loadTextPresets())
          .catch(() => {})
        return state
      }
      if (state.textPresets.some((p) => p.text === text)) return state
      const next = [
        ...state.textPresets,
        {
          id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          title: title ?? '',
          text,
          createdAt: Date.now(),
          builtin: false,
        },
      ].slice(-100)
      writeStorage('text-presets', JSON.stringify(next))
      return { textPresets: next }
    }),

  removeTextPreset: (id) =>
    set((state) => {
      const target = state.textPresets.find((p) => p.id === id)
      if (target?.builtin) return state // built-ins are read-only
      const adapter = peekEditorTransport()?.api
      if (adapter?.supportsTextPresets) {
        void adapter
          .deleteTextPreset(id)
          .then(() => useUIStore.getState().loadTextPresets())
          .catch(() => {})
        // Optimistic local removal; loadTextPresets reconciles.
        return { textPresets: state.textPresets.filter((p) => p.id !== id) }
      }
      const next = state.textPresets.filter((p) => p.id !== id)
      writeStorage('text-presets', JSON.stringify(next))
      return { textPresets: next }
    }),

  loadTextPresets: async () => {
    const adapter = peekEditorTransport()?.api
    if (!adapter?.supportsTextPresets) {
      set({ textPresetsLoaded: true })
      return
    }
    try {
      const presets = await adapter.listTextPresets()
      if (presets) {
        set({
          textPresets: presets.map((p) => ({
            id: p.id,
            title: p.title,
            text: p.text,
            createdAt: p.createdAt,
            builtin: p.builtin,
          })),
          textPresetsLoaded: true,
        })
        return
      }
    } catch {
      /* keep the localStorage-seeded list on failure */
    }
    set({ textPresetsLoaded: true })
  },

  addPrompt: (template, name, tag) => {
    const adapter = peekEditorTransport()?.api
    if (!adapter?.supportsPrompts || !template.trim()) return
    void adapter
      .createPrompt({ template, ...(name ? { name } : {}), ...(tag ? { tag } : {}) })
      .then(() => usePipelineStore.getState().loadBatteries())
      .catch(() => {})
  },

  removePrompt: (promptId) => {
    const adapter = peekEditorTransport()?.api
    if (!adapter?.supportsPrompts || !promptId.trim()) return
    void adapter
      .deletePrompt(promptId)
      .then((ok) => { if (ok) return usePipelineStore.getState().loadBatteries() })
      .catch(() => {})
  },

  removeUserTemplate: (groupId) => {
    const adapter = peekEditorTransport()?.api
    if (!adapter?.supportsDeleteUserTemplate || !groupId.trim()) return
    void adapter
      .deleteUserTemplate(groupId)
      .then((ok) => { if (ok) return usePipelineStore.getState().loadBatteries() })
      .catch(() => {})
  },

  removeGroupBattery: (groupId) => {
    const adapter = peekEditorTransport()?.api
    if (!adapter?.supportsDeleteGroupBattery || !groupId.trim()) return
    void adapter
      .deleteGroupBattery(groupId)
      .then((ok) => { if (ok) return usePipelineStore.getState().loadBatteries() })
      .catch(() => {})
  },

  addFavoriteBattery: (battery) =>
    set((state) => {
      if (state.favoriteBatteries.some((f) => f.batteryId === battery.id)) return state
      const next = [
        ...state.favoriteBatteries,
        { batteryId: battery.id, name: battery.name, batteryJson: JSON.stringify(battery), addedAt: Date.now() },
      ].slice(-50)
      writeStorage('favorite-batteries', JSON.stringify(next))
      return { favoriteBatteries: next }
    }),

  removeFavoriteBattery: (batteryId) =>
    set((state) => {
      const next = state.favoriteBatteries.filter((f) => f.batteryId !== batteryId)
      writeStorage('favorite-batteries', JSON.stringify(next))
      return { favoriteBatteries: next }
    }),

  reorderFavoriteBatteries: (fromId, toId) =>
    set((state) => {
      if (fromId === toId) return state
      const arr = [...state.favoriteBatteries]
      const fromIdx = arr.findIndex((f) => f.batteryId === fromId)
      const toIdx = arr.findIndex((f) => f.batteryId === toId)
      if (fromIdx === -1 || toIdx === -1) return state
      const [moved] = arr.splice(fromIdx, 1)
      arr.splice(toIdx, 0, moved)
      writeStorage('favorite-batteries', JSON.stringify(arr))
      return { favoriteBatteries: arr }
    }),

  setBatteryFilterMode: (mode) =>
    set(() => {
      writeStorage('batteryFilterMode', mode)
      return { batteryFilterMode: mode }
    }),

  setActiveProjectType: (type) => set({ activeProjectType: type }),

  // Adjust a battery's star rating (delta=1 adds, delta=-1 removes, floor 0).
  // The legacy editor mirrored this to a backend battery-meta API; the generic
  // editor persists locally instead.
  adjustBatteryStars: (batteryId, delta) =>
    set((state) => {
      const current = state.batteryStars[batteryId] ?? 0
      const next = Math.max(0, current + delta)
      const nextStars = { ...state.batteryStars, [batteryId]: next }
      writeStorage('battery-stars', JSON.stringify(nextStars))
      return { batteryStars: nextStars }
    }),

  appendDevNote: (batteryId, entry) =>
    set((state) => {
      const prev = state.batteryDevNotes[batteryId] ?? []
      const nextNotes = { ...state.batteryDevNotes, [batteryId]: [...prev, entry] }
      writeStorage('battery-dev-notes', JSON.stringify(nextNotes))
      return { batteryDevNotes: nextNotes }
    }),

  updateLastDevNote: (batteryId, entry) =>
    set((state) => {
      const prev = state.batteryDevNotes[batteryId] ?? []
      if (prev.length === 0) return state
      const updated = [...prev.slice(0, -1), entry]
      const nextNotes = { ...state.batteryDevNotes, [batteryId]: updated }
      writeStorage('battery-dev-notes', JSON.stringify(nextNotes))
      return { batteryDevNotes: nextNotes }
    }),

  deleteLastDevNote: (batteryId, ts) =>
    set((state) => {
      const prev = state.batteryDevNotes[batteryId] ?? []
      if (prev.length === 0) return state
      const last = prev[prev.length - 1]
      if (last.ts !== ts) return state
      const nextNotes = { ...state.batteryDevNotes, [batteryId]: prev.slice(0, -1) }
      writeStorage('battery-dev-notes', JSON.stringify(nextNotes))
      return { batteryDevNotes: nextNotes }
    }),
}))

// ── Cross-document preference sync ─────────────────────────────────────────
// The editor can render across multiple same-origin iframes (e.g. a host app
// splits a center canvas pane and a side controls pane). Each iframe owns its
// own store instance, so a toggle in one pane would otherwise not reach the
// other. The `storage` event fires in EVERY same-origin document EXCEPT the one
// that wrote, so mirroring localStorage-backed prefs here keeps all panes in
// lockstep (e.g. flip the language in the side pane → the canvas relabels live).
// Only persisted prefs flow this way; ephemeral live state uses the editor
// bridge (see sync/editorBridge.ts).
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e: StorageEvent) => {
    switch (e.key) {
      case 'langMode': {
        const v = readStorage('langMode')
        if (v === 'zh' || v === 'en') useUIStore.setState({ langMode: v })
        break
      }
      case 'theme': {
        const v = readStorage('theme')
        if (v === 'dark' || v === 'light') {
          applyTheme(v)
          useUIStore.setState({ theme: v })
        }
        break
      }
      case 'probeMode':
        useUIStore.setState({ probeMode: readStorage('probeMode') === 'true' })
        break
      case 'showDevNoteCount':
        useUIStore.setState({ showDevNoteCount: readStorage('showDevNoteCount') !== 'false' })
        break
      case 'batteryFilterMode':
        useUIStore.setState({
          batteryFilterMode: readStorage('batteryFilterMode') === 'templates' ? 'templates' : 'develop',
        })
        break
      case 'snapEnabled':
        useUIStore.setState({ snapEnabled: readStorage('snapEnabled') !== 'false' })
        break
      case 'showSidebar':
        useUIStore.setState({ showSidebar: readStorage('showSidebar') !== 'false' })
        break
      default:
        break
    }
  })
}
