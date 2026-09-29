import { useCallback, useEffect, useRef, useState, memo } from 'react'
import type { GraphNode, OpSpec, ProjectMeta, WorkspaceState } from '@forgeax/node-runtime'
import {
  ProjectPanel,
  configureEditorTransport,
  createEditorTransport,
  useProjectStore,
} from '@forgeax/node-runtime-react/editor'
import type { ActivePipelineRunInfo } from '@forgeax/node-runtime-react/editor'
import { HttpApiRequestError, type HttpApiClient } from '../api/HttpApiClient.js'
import { NodeInfoDashboard } from './SceneGeneratorControlsPanel.js'
import { scenePortTypes } from './scenePortTypes.js'
import { useAssetStoreStore } from '../surfaces/library/assetStoreStore.js'
import { Plus, Upload } from '../surfaces/icons.js'
import { sceneT, useSceneLocale } from '../sceneI18n.js'
import './AuthoringLeftPane.css'

// Must match the center <Editor editorSyncKey>; Node Info reads this mirror from
// the Page sidebar without owning a second editor instance.
const EDITOR_SYNC_KEY = 'scene-generator-editor'

const AW_SUPPORT_BASE =
  typeof location !== 'undefined'
    ? `${location.protocol}//${location.hostname}:8787`
    : 'http://127.0.0.1:8787'

interface Props {
  client: HttpApiClient
  /** Current ForgeaX game slug, forwarded from the host iframe URL (see main.tsx). */
  slug?: string | null
}

interface LeftPaneSnapshot {
  projects: readonly ProjectMeta[]
  workspace: WorkspaceState | null
  ops: readonly OpSpec[]
  nodes: readonly GraphNode[]
}

type LeftPaneError = { kind: 'active-game-required' | 'unavailable'; message: string }

export function AuthoringLeftPane({ client, slug }: Props): JSX.Element {
  useSceneLocale()
  const [, setSnapshot] = useState<LeftPaneSnapshot | null>(null)
  const [error, setError] = useState<LeftPaneError | null>(null)
  const [activePipelineRuns, setActivePipelineRuns] = useState<ActivePipelineRunInfo[]>([])

  useEffect(() => {
    let cancelled = false
    const poll = async (): Promise<void> => {
      try {
        const r = await fetch(`${AW_SUPPORT_BASE}/api/v1/export/scene/runs/active`)
        if (!r.ok) return
        const body = (await r.json()) as { runs?: ActivePipelineRunInfo[] }
        if (!cancelled) setActivePipelineRuns(body.runs ?? [])
      } catch {
        if (!cancelled) setActivePipelineRuns([])
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), 3000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  // PreviewLayerInspector resolves thumbnails from the read-only asset index.
  // Load it here because the former AssetStore browser pane no longer mounts.
  useEffect(() => {
    void useAssetStoreStore.getState().init()
  }, [])

  // The left pane is its own iframe/document, so it owns its own editor
  // transport + project store. Wiring it here lets <ProjectPanel> drive
  // switch/create/delete, and subscribeProjectActivation keeps the panel's
  // active highlight in sync with switches made in the center pane / by agents.
  // This pane is a *satellite*: it only calls viewProject to announce the
  // viewing target; the center AuthoringHost (host role) runs the heavy open
  // cascade (loadPipeline, refreshConnectedOutputs, autoExecuteOnOpen). Calling
  // bootstrap() here used to duplicate that cascade and fire a second full
  // pipeline execution on every cold boot.
  useEffect(() => {
    const transport = createEditorTransport(client)
    configureEditorTransport(transport)
    useProjectStore.getState().setActiveGameSlug(slug ?? null)
    useProjectStore.getState().setProjectSwitchRole('satellite')
    void useProjectStore.getState().fetchProjects()
    const unsub = useProjectStore.getState().subscribeProjectActivation()
    return () => {
      unsub()
      transport.dispose()
      configureEditorTransport(null)
    }
  }, [client])

  // The host may re-render this iframe's URL with a different slug (e.g. user
  // switches game in the studio sidebar) without a full reload in some embed
  // modes; keep the project panel's scope in sync if that value changes.
  useEffect(() => {
    useProjectStore.getState().setActiveGameSlug(slug ?? null)
  }, [slug])

  useEffect(() => {
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let waitingForBinding = false
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
          if (waitingForBinding) {
            waitingForBinding = false
            void useProjectStore.getState().fetchProjects()
          }
        }
      } catch (err) {
        if (cancelled) return
        if (err instanceof HttpApiRequestError && err.code === 'ACTIVE_GAME_REQUIRED') {
          waitingForBinding = true
          setError({ kind: 'active-game-required', message: err.message })
          retryTimer = setTimeout(() => void loadSnapshot(), 1000)
          return
        }
        setError({ kind: 'unavailable', message: (err as Error).message })
      }
    }
    void loadSnapshot()
    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [client, slug])

  return (
    <aside className="scene-left-pane" aria-label={sceneT('leftPane.title')}>
      {error && (
        <section className="scene-left-pane__notice">
          <strong>
            {sceneT(error.kind === 'active-game-required'
              ? 'leftPane.activeGameRequired'
              : 'leftPane.statusUnavailable')}
          </strong>
          <span>
            {error.kind === 'active-game-required'
              ? sceneT('leftPane.activeGameRequiredHint')
              : error.message}
          </span>
        </section>
      )}

      <AuthoringProjectsSection client={client} activePipelineRuns={activePipelineRuns} />

      <NodeInfoDashboard syncKey={EDITOR_SYNC_KEY} domainPortTypes={scenePortTypes} client={client} />

    </aside>
  )
}

/** Isolated from preview/selection bus updates so ProjectCard rows aren't re-formatted on every canvas interaction. */
const AuthoringProjectsSection = memo(function AuthoringProjectsSection({
  client,
  activePipelineRuns,
}: {
  client: HttpApiClient
  activePipelineRuns: ActivePipelineRunInfo[]
}): JSX.Element {
  const [projectsHeight, setProjectsHeight] = useState<number>(250)
  const projectsSectionRef = useRef<HTMLElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [saveModal, setSaveModal] = useState<{ name: string; json: string } | null>(null)
  const [projectError, setProjectError] = useState<string | null>(null)

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

  const handleSaveProject = useCallback(
    async (project: ProjectMeta) => {
      try {
        if (useProjectStore.getState().viewingProjectId !== project.id) {
          await useProjectStore.getState().switchProject(project.id)
        }
        const [snap, groups] = await Promise.all([client.getPipeline(), client.listGroups()])
        if (!snap || Object.keys(snap.nodes ?? {}).length === 0) {
          setProjectError(sceneT('leftPane.canvasEmpty'))
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
        setProjectError(null)
      } catch (err) {
        setProjectError((err as Error).message)
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
      input.value = ''
      if (!file) return
      let parsed: unknown
      try {
        parsed = JSON.parse(await file.text())
      } catch (err) {
        setProjectError(sceneT('leftPane.invalidJson', { message: (err as Error).message }))
        return
      }
      const wrapper = parsed as { format?: string; graph?: unknown; name?: string }
      const hasWrapper = !!wrapper && typeof wrapper === 'object' && 'graph' in wrapper
      const graph = hasWrapper ? wrapper.graph : parsed
      const format = hasWrapper ? wrapper.format : undefined
      if (graph == null) {
        setProjectError(sceneT('leftPane.noGraph'))
        return
      }
      const rawName =
        (hasWrapper && typeof wrapper.name === 'string' && wrapper.name.trim()) ||
        file.name.replace(/\.[^.]+$/, '').trim() ||
        'Imported scene'
      try {
        await useProjectStore.getState().createProject({ type: 'scene', name: rawName })
        await client.importPipelineInline({ format, graph, options: { mode: 'replace', executeAfter: 'full' } })
        setProjectError(null)
      } catch (err) {
        setProjectError(sceneT('leftPane.importFailed', { message: (err as Error).message }))
      }
    },
    [client],
  )

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={onFileChange}
      />
      {projectError && (
        <section className="scene-left-pane__notice">
          <strong>{sceneT('leftPane.projectActionFailed')}</strong>
          <span>{projectError}</span>
        </section>
      )}
      <section
        ref={projectsSectionRef}
        className="scene-left-pane__section scene-left-pane__section--projects"
        style={{ height: projectsHeight, overflow: 'hidden', flexShrink: 0 }}
      >
        <ProjectPanel
          defaultProjectType="scene"
          defaultProjectName="My scene"
          newButtonIcon={<Plus size={15} aria-hidden="true" />}
          activePipelineRuns={activePipelineRuns}
          onSaveProject={handleSaveProject}
          headerActions={
            <button
              type="button"
              className="scene-left-pane__open-btn"
              title={sceneT('leftPane.openProject')}
              aria-label={sceneT('leftPane.openProject')}
              onClick={handleOpen}
            >
              <Upload size={15} aria-hidden="true" />
            </button>
          }
        />
      </section>
      <div
        className="scene-left-pane__projects-resize"
        onMouseDown={handleResizeMouseDown}
        aria-label={sceneT('leftPane.resizeProjects')}
        role="separator"
        aria-orientation="horizontal"
      />
      {saveModal && (
        <div className="scene-left-pane__save" role="dialog" aria-label={sceneT('leftPane.saveDialog')}>
          <header className="proj-modal__head scene-left-pane__save-head">
            <h2>{sceneT('leftPane.saveScene')}</h2>
          </header>
          <p className="scene-left-pane__save-copy">
            {sceneT('leftPane.saveCopy', { name: saveModal.name })}
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
              {sceneT('leftPane.close')}
            </button>
            <button
              type="button"
              className="proj-btn proj-btn--primary"
              onClick={() => {
                void navigator.clipboard?.writeText(saveModal.json)
              }}
            >
              {sceneT('leftPane.copyClipboard')}
            </button>
          </footer>
        </div>
      )}
    </>
  )
})
