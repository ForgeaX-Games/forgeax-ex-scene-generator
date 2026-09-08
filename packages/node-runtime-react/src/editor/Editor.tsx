// The composed, faithful node editor — a single mount that reproduces the
// legacy editor layout EXACTLY: Toolbar (top) · BatteryBar (left) · Canvas
// (center), inside the real `.app`/`.editor-pane`/`.main-layout`/
// `.main-content`/`.canvas-container` structure. Node params are edited inline
// on the nodes (as in legacy); the legacy app-level chrome (embedded-workbench
// iframes, projects modal) is NOT part of the generic editor — a consumer
// injects domain bits via `domainNodeTypes` + `toolbarActions`.
//
// LIVE SYNC: on mount we point the editor transport at the consumer's ApiClient
// and subscribe the pipeline store to the `graph` channel — so a mutation from
// ANY actor (human, or an AI/CLI hitting the same backend) refetches and the
// canvas updates. That is the North-Star "watch the AI work".
import { useEffect, useLayoutEffect } from 'react'
import type { ReactNode } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import type { NodeTypes } from '@xyflow/react'
import type { ApiClient } from '../api/ApiClient.js'
import type { DomainPortTypes } from './utils/portTypes.js'
import type { ExternalDropHandler } from './components/canvas/useCanvasDrop.js'
import { createEditorTransport, configureEditorTransport, getEditorTransport } from './transport/index.js'
import { usePipelineStore, useProjectStore, useUIStore, useHistoryStore } from './stores/index.js'
import { useEditorBroadcastHost } from './sync/editorBridge.js'
import Toolbar from './components/toolbar/Toolbar.js'
import BatteryBar from './components/sidebar/BatteryBar.js'
import Canvas from './components/canvas/Canvas.js'
import { ValueFormattersProvider } from './components/canvas/nodeTooltip.js'
import type { DomainValueFormatters } from './components/canvas/nodeTooltip.js'
import './styles/design-system.css'
import './EditorLayout.css'

export interface EditorProps {
  /** Layer 2 client driving every read / mutation / execution. */
  apiClient: ApiClient
  /** Domain node renderers (e.g. `scene_sink`) registered into the canvas. */
  domainNodeTypes?: Record<string, NodeTypes[string]>
  /** Domain port types supplied by the host app without relying on module-global registration. */
  domainPortTypes?: DomainPortTypes
  /** Domain runtime value formatters for wire probes, port tooltips and panel previews. */
  domainValueFormatters?: DomainValueFormatters
  /** App/domain buttons injected into the toolbar's right slot. */
  toolbarActions?: ReactNode
  /**
   * App/domain buttons injected INSIDE the settings (gear) dropdown — the
   * legacy editor placed the Render / AssetStore embed toggles here.
   */
  settingsActions?: ReactNode
  /** App/domain status sections injected into the settings Status panel. */
  settingsStatusExtra?: ReactNode
  /**
   * Workbench-fullscreen state + toggle, forwarded to the toolbar's faithful
   * Maximize2 / Minimize2 control. When omitted the fullscreen button is hidden.
   */
  isFullscreen?: boolean
  onToggleFullscreen?: () => void
  /** Editor title shown on the toolbar left. */
  title?: ReactNode
  /**
   * Generic Open / Save handlers forwarded to the toolbar's settings menu.
   * The legacy editor's FolderOpen / save-dialog actions; a consumer wires
   * these to the graph import / export flow (see scene-generator WorkbenchHost).
   * The buttons only render when wired.
   */
  onOpen?: () => void
  onSave?: () => void
  /**
   * Show the toolbar Run / Stop control. Faithful apps that auto-execute (scene
   * generator) pass `false`; defaults to `true` for the generic editor.
   */
  showRunControl?: boolean
  /**
   * Optional bottom status bar. The legacy editor surfaced status through the
   * toolbar settings menu, so this is opt-in; pass the kernel `StatusBar` (or an
   * app-specific footer) to render a persistent strip below the canvas.
   */
  statusBar?: ReactNode
  /**
   * Hide the toolbar's settings (gear) button. Pass `false` when the host app
   * re-surfaces those controls elsewhere (e.g. a side pane). Default `true`.
   */
  showSettingsButton?: boolean
  /**
   * When set, this Editor acts as the HOST of the same-origin editor sync bridge
   * on this key: it broadcasts a live snapshot (operation history + status) and
   * answers commands from side panes that open a bridge on the same key. See
   * sync/editorBridge.ts. Leave unset for a standalone editor.
   */
  editorSyncKey?: string
  /**
   * App/domain handler for a canvas drop that carries no `application/battery`
   * payload — typically an asset dragged from an embedded panel in a sibling
   * iframe, whose native dataTransfer does not cross the boundary. Receives the
   * drop position (flow coords), the drag event, and `placeBattery` so the
   * consumer can look up a battery and insert a node with preset params. Leave
   * unset for a standalone editor with no external drop sources.
   */
  onExternalDrop?: ExternalDropHandler
}

export function Editor({ apiClient, domainNodeTypes, domainPortTypes, domainValueFormatters, toolbarActions, settingsActions, settingsStatusExtra, isFullscreen, onToggleFullscreen, title, onOpen, onSave, showRunControl = true, statusBar, showSettingsButton = true, editorSyncKey, onExternalDrop }: EditorProps): JSX.Element {
  useLayoutEffect(() => {
    const transport = createEditorTransport(apiClient)
    configureEditorTransport(transport)
    return () => {
      transport.dispose()
      configureEditorTransport(null)
    }
  }, [apiClient])

  // Domain node renderers are merged into the canvas via the `domainNodeTypes`
  // prop (Canvas → createCanvasNodeTypes), domain port types via `domainPortTypes`,
  // and domain value formatters via the ValueFormattersProvider below — all per
  // editor instance, never a module-global registry, so no side effect is needed.

  useEffect(() => {
    const store = usePipelineStore.getState()
    const ui = useUIStore.getState()
    let disposed = false
    // Reflect backend reachability in the StatusBar: a successful initial load
    // of the catalog + pipeline means we're live (the legacy editor surfaced
    // this via its ws bus; here we derive it from the transport round-trips).
    ui.setConnectionStatus('connecting')
    Promise.all([
      store.loadBatteries(),
      // Hosted apps (scene-generator WorkbenchHost) run projectStore.bootstrap()
      // which switchProject → viewProject → loadPipeline → refreshConnectedOutputs
      // → autoExecuteOnOpen (see projectStore.ts refreshOutputsAfterProjectSwitch).
      // Avoid racing an early pull before viewProject sets the client routing id,
      // skip a duplicate load when bootstrap already populated the snapshot, AND
      // — critically — report back whether that cascade owns this project so the
      // `.then()` below does not fire a second, independent
      // `refreshConnectedOutputs('mount').then(autoExecuteOnOpen)`. Without this,
      // both chains can race: whichever's `autoExecuteOnOpen()` loses the race
      // still finds "nothing missing" most of the time, but if the backend event
      // loop is busy running the FIRST chain's execution, the slower chain's
      // `viewProject()` call is delayed until after it finishes — and its
      // subsequent `resetPipelineUiForProjectSwitch()` wipes the just-computed
      // `nodeOutputs`, making `autoExecuteOnOpen()` see everything as "missing"
      // again and re-run the (potentially multi-second) pipeline a second time
      // for no reason. Observed in practice as two back-to-back full executions
      // on the very first project open — see wb-scene-generator-project-switch.md
      // §2.13 / P0-8.
      (async (): Promise<boolean> => {
        if (useProjectStore.getState().viewingProjectId === null) {
          await useProjectStore.getState().fetchProjects()
        }
        // Once a project is known, `bootstrap()` is guaranteed to (or already
        // did) call `switchProject()` for it, which owns the entire open
        // cascade end-to-end — defer to it instead of duplicating the tail.
        const ownedByProjectStore = useProjectStore.getState().viewingProjectId !== null
        if (useProjectStore.getState().isSwitching) {
          await new Promise<void>((resolve) => {
            const unsub = useProjectStore.subscribe((state) => {
              if (!state.isSwitching) {
                unsub()
                resolve()
              }
            })
          })
        }
        if (!usePipelineStore.getState().currentPipeline) {
          await store.loadPipeline()
        }
        return ownedByProjectStore
      })(),
    ])
      .then(([, ownedByProjectStore]) => {
        if (disposed) return
        useUIStore.getState().setConnectionStatus('connected')
        // Seed the nodeOutputs cache from the backend's retained last-run values
        // so the wire data-probe / port tooltips show data on first load, not
        // only after a fresh execution. When the cache is cold (first open / after
        // a cache wipe) nothing is hydrated, so auto-run the pipeline once so the
        // canvas — and every group's inner view — is populated without the user
        // having to nudge an input first. Skipped when a project-store cascade
        // already owns (or is about to own) this exact sequence — see comment above.
        if (!ownedByProjectStore) {
          void usePipelineStore
            .getState()
            .refreshConnectedOutputs('mount')
            .then(() => {
              if (!disposed) return usePipelineStore.getState().autoExecuteOnOpen()
            })
        }
        // Rebuild the operation-history panel from this project's persistent log
        // (history.jsonl), so a refresh keeps the recent ops instead of starting
        // empty. Best-effort: a failure just leaves the panel empty.
        void getEditorTransport().api.getHistory()
          .then((h) => useHistoryStore.getState().hydrate(h))
          .catch(() => {})
        // Load the text-preset rail from the backend store (built-in + user),
        // falling back to the localStorage-seeded list when unsupported.
        void useUIStore.getState().loadTextPresets()
      })
      .catch(() => useUIStore.getState().setConnectionStatus('disconnected'))
    const unsubscribe = store.subscribeLiveSync()
    // Re-sync when another client (left project panel / human /view) switches
    // the viewing project. Agent projects.open does not change viewing.
    const unsubProject = useProjectStore.getState().subscribeProjectActivation()
    return () => {
      disposed = true
      unsubscribe()
      unsubProject()
      useUIStore.getState().setConnectionStatus('disconnected')
    }
  }, [apiClient])

  // Host the same-origin sync bridge when a key is supplied, so side panes can
  // mirror this editor's live history + status. No-op when editorSyncKey unset.
  useEditorBroadcastHost(editorSyncKey, domainValueFormatters ?? [])

  return (
    <ReactFlowProvider>
      <ValueFormattersProvider value={domainValueFormatters ?? []}>
        <div className="app">
          <div className="editor-pane">
            <Toolbar
              title={title}
              actions={toolbarActions}
              settingsActions={settingsActions}
              settingsStatusExtra={settingsStatusExtra}
              isFullscreen={isFullscreen}
              onToggleFullscreen={onToggleFullscreen}
              onOpen={onOpen}
              onSave={onSave}
              showRunControl={showRunControl}
              domainPortTypes={domainPortTypes}
              showSettingsButton={showSettingsButton}
            />
            <div className="main-layout">
              <BatteryBar />
              <div className="main-content">
                <div className="canvas-container">
                  <Canvas domainNodeTypes={domainNodeTypes} domainPortTypes={domainPortTypes} onExternalDrop={onExternalDrop} />
                </div>
              </div>
            </div>
            {statusBar}
          </div>
        </div>
      </ValueFormattersProvider>
    </ReactFlowProvider>
  )
}
