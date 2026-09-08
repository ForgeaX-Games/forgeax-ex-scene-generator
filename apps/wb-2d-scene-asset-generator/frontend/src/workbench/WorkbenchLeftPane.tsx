import { useCallback, useEffect, useRef, useState } from 'react'
import type { GraphNode, OpSpec, ProjectMeta, WorkspaceState } from '@forgeax/node-runtime'
import {
  ProjectPanel,
  configureEditorTransport,
  createEditorTransport,
  useProjectStore,
} from '@forgeax/node-runtime-react/editor'
import type { HttpApiClient } from '../api/HttpApiClient.js'
import { SceneGeneratorControlsPanel } from './SceneGeneratorControlsPanel.js'
import { AssetFoldersControlsPanel } from './AssetFoldersControlsPanel.js'
import { ImagePreviewControlsPanel } from './ImagePreviewControlsPanel.js'
import './WorkbenchLeftPane.css'

// Keep in sync with WorkbenchHost (the center <Editor editorSyncKey> + the embed
// localStorage keys it mirrors via its `storage` listener).
const EDITOR_SYNC_KEY = 'wb-2d-scene-asset-generator-editor'
const LS_PREVIEW = 'wb-2d-scene-asset-generator.rendererInline'
const LS_ASSETSTORE = 'wb-2d-scene-asset-generator.assetStoreInline'
const LS_EDITOR = 'wb-2d-scene-asset-generator.editorInline'

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
  const [, setSnapshot] = useState<LeftPaneSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  // The left pane is its own iframe/document, so it owns its own editor
  // transport + project store. Wiring it here lets <ProjectPanel> drive
  // switch/create/delete, and subscribeProjectActivation keeps the panel's
  // active highlight in sync with switches made in the center pane / by agents.
  useEffect(() => {
    const transport = createEditorTransport(client)
    configureEditorTransport(transport)
    void useProjectStore.getState().bootstrap()
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

  // Which interface's controls/info the lower half of the pane shows. The three
  // group buttons (below the project list) switch between them, mirroring the
  // scene-generator workbench. The right panels' open/close lives separately in
  // the panel tabs (LS_* embed toggles).
  const [group, setGroup] = useState<ControlGroup>('editor')

  // Resizable projects section.
  const [projectsHeight, setProjectsHeight] = useState<number>(250)
  const projectsSectionRef = useRef<HTMLElement>(null)
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = projectsSectionRef.current?.offsetHeight ?? projectsHeight

    const onMove = (mv: MouseEvent): void => {
      const delta = mv.clientY - startY
      setProjectsHeight(Math.max(60, startHeight + delta))
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [projectsHeight])

  // ── Open / Save: local import & export of the canvas graph JSON ──
  // The studio wraps each plugin pane in a sandboxed iframe WITHOUT
  // `allow-downloads`, so a programmatic file download is silently blocked here
  // (and sandboxed popups can't escape it either). Save therefore builds the
  // kernel-graph-v1 text (same shape the backend /pipeline/export route writes,
  // so it is re-importable) and shows it in a copyable modal; the user saves it
  // as a .json file themselves. Open uploads a JSON, creates a NEW project named
  // after the file, opens it, and imports the graph into it (mode:'replace') —
  // the backend broadcasts graph:applied over /ws, so the canvas + preview
  // refresh live without clobbering the project that was open before.
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [saveModal, setSaveModal] = useState<{ name: string; json: string } | null>(null)

  // Build + surface the copyable JSON for a single project. When the project is
  // not the active one, activate it first so client.getPipeline() reads ITS
  // graph (the backend exposes only the active runtime's pipeline).
  const handleSaveProject = useCallback(
    async (project: ProjectMeta) => {
      try {
        if (useProjectStore.getState().viewingProjectId !== project.id) {
          await useProjectStore.getState().switchProject(project.id)
        }
        const [snap, groups] = await Promise.all([client.getPipeline(), client.listGroups()])
        if (!snap || Object.keys(snap.nodes ?? {}).length === 0) {
          setError('Canvas is empty — nothing to save.')
          return
        }
        const base = project.name?.trim() || new Date().toISOString().slice(0, 19).replace('T', '_')
        const safeName = base.replace(/[\\/:*?"<>|]/g, '_')
        const file = {
          format: 'kernel-graph-v1' as const,
          name: safeName,
          graph: {
            id: snap.id,
            nodes: snap.nodes,
            edges: snap.edges,
            ...(groups.length ? { groups: Object.fromEntries(groups.map((g) => [g.id, g])) } : {}),
            ...(snap.metadata ? { metadata: snap.metadata } : {}),
          },
        }
        setSaveModal({ name: `${safeName}.json`, json: JSON.stringify(file, null, 2) })
        setError(null)
      } catch (err) {
        setError((err as Error).message)
      }
    },
    [client],
  )

  const handleOpen = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const onFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.currentTarget
      const file = input.files?.[0]
      input.value = '' // allow re-selecting the same file
      if (!file) return
      let parsed: unknown
      try {
        parsed = JSON.parse(await file.text())
      } catch (err) {
        setError(`Invalid JSON: ${(err as Error).message}`)
        return
      }
      // A saved file wraps the graph as { format, graph }; tolerate a raw graph too.
      const wrapper = parsed as { format?: string; graph?: unknown; name?: string }
      const hasWrapper = !!wrapper && typeof wrapper === 'object' && 'graph' in wrapper
      const graph = hasWrapper ? wrapper.graph : parsed
      const format = hasWrapper ? wrapper.format : undefined
      if (graph == null) {
        setError('No graph found in file.')
        return
      }
      // Name the new project after the file: prefer the wrapper's saved `name`,
      // else the upload's filename sans extension.
      const rawName =
        (hasWrapper && typeof wrapper.name === 'string' && wrapper.name.trim()) ||
        file.name.replace(/\.[^.]+$/, '').trim() ||
        'Imported scene'
      try {
        // createProject opens (switches to) the new empty project; then we import
        // the uploaded graph into it so the project that was open is untouched.
        await useProjectStore.getState().createProject({ type: 'asset2d', name: rawName })
        await client.importPipelineInline({ format, graph, options: { mode: 'replace', executeAfter: 'full' } })
        setError(null)
      } catch (err) {
        setError(`Import failed: ${(err as Error).message}`)
      }
    },
    [client],
  )

  return (
    <aside className="scene-left-pane" aria-label="Asset Workbench Navigation">
      <header className="scene-left-pane__hero">
        <FluidPaneTitle>Asset Workbench Navigation</FluidPaneTitle>
      </header>

      {error && (
        <section className="scene-left-pane__notice">
          <strong>Status unavailable</strong>
          <span>{error}</span>
        </section>
      )}

      {/* Flat tabs that open/close the right-side iframe panels. They write
          the same localStorage keys the center pane mirrors via its `storage`
          listener, so flipping one here shows/hides the embedded pane live. */}
      <div className="scene-left-pane__panel-tabs" role="group" aria-label="Toggle preview panels">
        <EmbedToggle storageKey={LS_EDITOR} label="Asset Generator" />
        <EmbedToggle storageKey={LS_ASSETSTORE} label="AssetStore" />
        <EmbedToggle storageKey={LS_PREVIEW} label="Preview" />
      </div>

      {/* Hidden uploader backing the Projects-header "Open" button. Open imports
          a JSON as a brand-new project (named after the file) — see onFileChange. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={onFileChange}
      />

      <section
        ref={projectsSectionRef}
        className="scene-left-pane__section scene-left-pane__section--projects"
        style={{ height: projectsHeight, overflow: 'hidden', flexShrink: 0 }}
      >
        {/* Open lives next to the "+ New" glyph; each card carries its own Save.
            Both surface the canvas as re-importable kernel-graph-v1 JSON (the
            iframe sandbox blocks a real download — see handleSaveProject). */}
        <ProjectPanel
          defaultProjectType="asset2d"
          defaultProjectName="My asset workspace"
          headerActions={
            <button
              type="button"
              className="scene-left-pane__open-btn"
              title="Open an asset graph JSON as a new project"
              aria-label="Open an asset graph JSON as a new project"
              onClick={handleOpen}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">
                <path
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v2H3V7Zm0 4h18l-2 7a2 2 0 0 1-2 1.5H5A2 2 0 0 1 3 18l0-7Z"
                />
              </svg>
            </button>
          }
          renderProjectActions={(p) => (
            <button
              type="button"
              className="proj-card__action scene-left-pane__save-action"
              title="Save this project as JSON"
              onClick={() => void handleSaveProject(p)}
            >
              Save
            </button>
          )}
        />
      </section>
      <div
        className="scene-left-pane__projects-resize"
        onMouseDown={handleResizeMouseDown}
        aria-label="Drag to resize projects panel"
        role="separator"
        aria-orientation="horizontal"
      />

      {/* Group switcher: picks which interface's controls/info fill the lower
          half below. Pure left-pane view state — does not touch the panels. */}
      <div className="scene-left-pane__group-tabs" role="tablist" aria-label="Control group">
        <GroupTab current={group} value="editor" label="Asset Generator" onSelect={setGroup} />
        <GroupTab current={group} value="assetstore" label="AssetStore" onSelect={setGroup} />
        <GroupTab current={group} value="preview" label="Preview" onSelect={setGroup} />
      </div>

      {group === 'editor' && (
        <section className="scene-left-pane__section scene-left-pane__section--controls">
          <SceneGeneratorControlsPanel syncKey={EDITOR_SYNC_KEY} />
        </section>
      )}

      {group === 'assetstore' && (
        <section className="scene-left-pane__section scene-left-pane__section--controls">
          <AssetFoldersControlsPanel />
        </section>
      )}

      {group === 'preview' && (
        <section className="scene-left-pane__section scene-left-pane__section--controls">
          <ImagePreviewControlsPanel />
        </section>
      )}

      {/* Save fallback: the plugin pane's iframe sandbox has no `allow-downloads`,
          so we surface the graph JSON for the user to copy + save manually. The
          chrome matches the project wizard/delete dialogs (accent-green primary,
          muted secondary) so Open/Save feel native to the rest of the pane. */}
      {saveModal && (
        <div className="scene-left-pane__save" role="dialog" aria-label="Save canvas JSON">
          <header className="proj-modal__head scene-left-pane__save-head">
            <h2>Save scene</h2>
          </header>
          <p className="scene-left-pane__save-copy">
            Copy this and save it as <code>{saveModal.name}</code>.
          </p>
          <textarea
            className="scene-left-pane__save-json"
            readOnly
            autoFocus
            value={saveModal.json}
            onFocus={(e) => e.currentTarget.select()}
          />
          <footer className="proj-modal__foot scene-left-pane__save-foot">
            <button type="button" className="proj-btn" onClick={() => setSaveModal(null)}>
              Close
            </button>
            <button
              type="button"
              className="proj-btn proj-btn--primary"
              onClick={() => {
                void navigator.clipboard?.writeText(saveModal.json)
              }}
            >
              Copy to clipboard
            </button>
          </footer>
        </div>
      )}
    </aside>
  )
}

const PANE_TITLE_MIN_PX = 12
const PANE_TITLE_MAX_PX = 34

/** Single-line title scaled to the pane width (sidebar resize → refit). */
function FluidPaneTitle({ children }: { children: string }): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    const container = containerRef.current
    const title = titleRef.current
    if (!container || !title) return

    const fit = (): void => {
      const maxWidth = container.clientWidth
      if (maxWidth <= 0) return
      let lo = PANE_TITLE_MIN_PX
      let hi = PANE_TITLE_MAX_PX
      let best = lo
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        title.style.fontSize = `${mid}px`
        if (title.scrollWidth <= maxWidth) {
          best = mid
          lo = mid + 1
        } else {
          hi = mid - 1
        }
      }
      title.style.fontSize = `${best}px`
    }

    fit()
    const ro = new ResizeObserver(() => requestAnimationFrame(fit))
    ro.observe(container)
    void document.fonts?.ready.then(() => requestAnimationFrame(fit))
    return () => ro.disconnect()
  }, [children])

  return (
    <div ref={containerRef} className="scene-left-pane__hero-title">
      <h1 ref={titleRef}>{children}</h1>
    </div>
  )
}

type ControlGroup = 'editor' | 'assetstore' | 'preview'

function GroupTab({
  current,
  value,
  label,
  onSelect,
}: {
  current: ControlGroup
  value: ControlGroup
  label: string
  onSelect: (group: ControlGroup) => void
}): JSX.Element {
  const active = current === value
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`scene-left-pane__group-tab${active ? ' is-active' : ''}`}
      onClick={() => onSelect(value)}
    >
      {label}
    </button>
  )
}

// Relocated embed/window toggle. Writes the localStorage key the center pane
// mirrors via its `storage` listener (cross-document), so flipping it here
// shows/hides the corresponding embedded pane in the center workbench live.
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
