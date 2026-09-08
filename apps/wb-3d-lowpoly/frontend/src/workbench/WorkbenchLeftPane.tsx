import { useEffect, useMemo, useState } from 'react'
import type { GraphNode, OpSpec, ProjectMeta, WorkspaceState } from '@forgeax/node-runtime'
import {
  EditorControlsPanel,
  ProjectPanel,
  configureEditorTransport,
  createEditorTransport,
  useProjectStore,
} from '@forgeax/node-runtime-react/editor'
import type { HttpApiClient } from '../api/HttpApiClient.js'
import './WorkbenchLeftPane.css'

// Keep in sync with WorkbenchHost (the center <Editor editorSyncKey> + the embed
// localStorage key it mirrors via its `storage` listener).
const EDITOR_SYNC_KEY = 'wb-3d-lowpoly-editor'
const LS_VIEWER3D = 'wb3d:viewer3dInline'
const geometryPortTypes = [
  { type: 'geometry', desc: '几何', descEn: 'Geometry', color: '#f87171', compatibleWith: ['string'] },
]

interface Props {
  client: HttpApiClient
}

interface LeftPaneSnapshot {
  projects: readonly ProjectMeta[]
  workspace: WorkspaceState | null
  ops: readonly OpSpec[]
  nodes: readonly GraphNode[]
}

export function WorkbenchLeftPane({ client }: Props): JSX.Element {
  const [snapshot, setSnapshot] = useState<LeftPaneSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  // The left pane is its own iframe/document, so it owns its own editor
  // transport + project store. Wiring it here lets <ProjectPanel> drive
  // switch/create/delete, and subscribeProjectActivation keeps the panel's
  // active highlight in sync with switches made in the center pane / by agents.
  useEffect(() => {
    const transport = createEditorTransport(client)
    configureEditorTransport(transport)
    // This navigation-only iframe does not own the live canvas. Loading a
    // pipeline here would leave it with a stale graph snapshot that must never
    // be persisted over edits made by the center editor.
    void useProjectStore.getState().fetchProjects()
    const unsub = useProjectStore.getState().subscribeProjectActivation()
    return () => {
      unsub()
      transport.dispose()
      configureEditorTransport(null)
    }
  }, [client])

  useEffect(() => {
    let cancelled = false
    async function loadSnapshot(): Promise<void> {
      try {
        const [projects, workspace] = await Promise.all([
          client.listProjects(),
          client.getWorkspace(),
        ])
        const [ops, nodes] = await Promise.all([
          client.listOps(),
          client.listNodes(),
        ])
        if (!cancelled) {
          setSnapshot({ projects, workspace, ops, nodes })
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      }
    }
    void loadSnapshot()
    return () => {
      cancelled = true
    }
  }, [client])

  const activeProject = useMemo(() => {
    const activeId =
      snapshot?.workspace?.viewingProjectId ??
      (snapshot?.workspace as { activeProjectId?: string | null } | undefined)?.activeProjectId
    return snapshot?.projects.find((project) => project.id === activeId) ?? snapshot?.projects[0] ?? null
  }, [snapshot])

  return (
    <aside className="lowpoly-left-pane" aria-label="Lowpoly Workbench Navigation">
      <header className="lowpoly-left-pane__hero">
        <div className="lowpoly-left-pane__eyebrow">3D Lowpoly Generator</div>
        <h1>Lowpoly Workbench Navigation</h1>
        <p>Use the center pane for the node canvas and embedded 3D preview. This side pane summarizes the lowpoly build flow and outputs.</p>
      </header>

      {error && (
        <section className="lowpoly-left-pane__notice">
          <strong>Status unavailable</strong>
          <span>{error}</span>
        </section>
      )}

      <section className="lowpoly-left-pane__section">
        <ProjectPanel defaultProjectType="lowpoly" defaultProjectName="My part" />
      </section>

      <section className="lowpoly-left-pane__grid" aria-label="Workbench status">
        <StatusCard label="Active project" value={activeProject?.name ?? 'Loading'} />
        <StatusCard label="Projects" value={snapshot ? String(snapshot.projects.length) : '...'} />
        <StatusCard label="3D ops" value={snapshot ? String(snapshot.ops.length) : '...'} />
        <StatusCard label="Canvas nodes" value={snapshot ? String(snapshot.nodes.length) : '...'} />
      </section>

      <section className="lowpoly-left-pane__section">
        <h2>Editor controls</h2>
        <EditorControlsPanel
          syncKey={EDITOR_SYNC_KEY}
          domainPortTypes={geometryPortTypes}
          windowToggles={<EmbedToggle storageKey={LS_VIEWER3D} label="3D" />}
        />
      </section>

      <section className="lowpoly-left-pane__section">
        <h2>Lowpoly generation flow</h2>
        <ol className="lowpoly-left-pane__steps">
          <li>Start from primitive parts or a lowpoly asset template.</li>
          <li>Shape parts with transform, CSG, profile, and gear operations.</li>
          <li>Assemble links and joints, then validate geometry and inertial data.</li>
          <li>Preview as a static scene, URDF robot, or rigged character, then export GLB assets.</li>
        </ol>
      </section>

      <section className="lowpoly-left-pane__section">
        <h2>Asset outputs</h2>
        <div className="lowpoly-left-pane__pane-row">
          <span>3D preview</span>
          <em>Static scene, URDF, or character</em>
        </div>
        <div className="lowpoly-left-pane__pane-row">
          <span>GLB / mesh assets</span>
          <em>Lowpoly model export target</em>
        </div>
        <div className="lowpoly-left-pane__pane-row">
          <span>Validation</span>
          <em>Geometry and assembly diagnostics</em>
        </div>
      </section>

      <section className="lowpoly-left-pane__section lowpoly-left-pane__tips">
        <h2>Helpful prompts</h2>
        <p>Ask the agent to add a preview sink (scene, URDF, or character), create a lowpoly asset graph, or check why a joint is not moving.</p>
      </section>
    </aside>
  )
}

function StatusCard({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="lowpoly-left-pane__card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

// Relocated embed/window toggle. Writes the localStorage key the center pane
// mirrors via its `storage` listener (cross-document), so flipping it here
// shows/hides the embedded URDF viewer in the center workbench live.
function EmbedToggle({ storageKey, label, fallback = true }: { storageKey: string; label: string; fallback?: boolean }): JSX.Element {
  const [on, setOn] = useState(() => {
    if (typeof localStorage === 'undefined') return fallback
    const raw = localStorage.getItem(storageKey)
    return raw === null ? fallback : raw === 'true'
  })
  const toggle = (): void => {
    setOn((v) => {
      const next = !v
      if (typeof localStorage !== 'undefined') localStorage.setItem(storageKey, String(next))
      return next
    })
  }
  return (
    <button
      type="button"
      className={`editor-controls__btn${on ? ' is-on' : ''}`}
      aria-pressed={on}
      onClick={toggle}
    >
      {label}
    </button>
  )
}
