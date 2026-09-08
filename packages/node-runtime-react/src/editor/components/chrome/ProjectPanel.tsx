// ProjectPanel — the inline, non-modal project manager for a workbench's left
// side pane. The SSOT for "switch / create / delete project" UI: it is driven by
// the same `useProjectStore` as the editor canvas, so a switch here flips the
// center editor live (via the project:viewing cross-client sync), and a switch
// elsewhere (an agent tool) reflects here. Replaces the old top-right toolbar
// button + ProjectsDialog modal.
//
// The host (left-pane surface) is responsible for configuring the editor
// transport (configureEditorTransport) and calling
// useProjectStore.subscribeProjectActivation() so this panel stays live.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useProjectStore } from '../../stores/projectStore.js'
import { peekEditorTransport } from '../../transport/index.js'
import type { ProjectMeta } from '@forgeax/node-runtime'
import {
  ProjectCard,
  NewProjectWizard,
  DeleteProjectDialog,
  formatProjectLockLabel,
  formatPipelineRunLabel,
  type ActivePipelineRunInfo,
  type ProjectExecutionLock,
} from './projectViews.js'
import { pt, useProjectLocale } from './projectI18n.js'
import './ProjectPanel.css'

type View = { kind: 'list' } | { kind: 'new' } | { kind: 'delete'; project: ProjectMeta }

type LockMap = Record<string, ProjectExecutionLock>

function lockMapsEqual(a: LockMap, b: LockMap): boolean {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const k of aKeys) {
    const va = a[k]
    const vb = b[k]
    if (!vb || va.agentId !== vb.agentId || va.sessionId !== vb.sessionId || va.acquiredAt !== vb.acquiredAt) return false
  }
  return true
}

type StatusRow =
  | { key: string; kind: 'executing'; projectId: string; name: string; detail?: string }
  | { key: string; kind: 'pipeline'; name: string; detail: string }

const STATUS_COLLAPSE_THRESHOLD = 2

export interface ProjectPanelProps {
  /** Domain type tag for newly-created projects (e.g. 'lowpoly', 'scene'). */
  defaultProjectType?: string
  /** Placeholder name shown in the new-project wizard. */
  defaultProjectName?: string
  /** Optional resolver for a per-project "held by agent" badge label. */
  lockLabelOf?: (project: ProjectMeta) => string | null
  /** Optional icon for the compact create-project header action. */
  newButtonIcon?: ReactNode
  /**
   * aw-support (or other orchestrator) export pipelines still in flight.
   * Distinct from scene-generator locks — parallel runs may share only one lock
   * at a time but still have multiple ForgeaX sessions active.
   */
  activePipelineRuns?: readonly ActivePipelineRunInfo[]
  /** Optional extra control(s) rendered in the panel header, after "+ New". */
  headerActions?: ReactNode
  /** Optional per-project action(s) injected into each card's action column. */
  renderProjectActions?: (project: ProjectMeta) => ReactNode
  /** Optional save handler — rendered as a built-in toolbar icon (stable for memo). */
  onSaveProject?: (project: ProjectMeta) => void
}

/** Pin agent/pipeline activity to the top; selection does not reorder the list. */
function projectAttentionRank(
  p: ProjectMeta,
  lockedProjectIds: ReadonlySet<string>,
  pipelineProjectIds: ReadonlySet<string>,
): number {
  return lockedProjectIds.has(p.id) || pipelineProjectIds.has(p.id) ? 0 : 1
}

export function compareProjectsForList(
  a: ProjectMeta,
  b: ProjectMeta,
  lockedProjectIds: ReadonlySet<string>,
  pipelineProjectIds: ReadonlySet<string>,
): number {
  const ra = projectAttentionRank(a, lockedProjectIds, pipelineProjectIds)
  const rb = projectAttentionRank(b, lockedProjectIds, pipelineProjectIds)
  if (ra !== rb) return ra - rb
  const ua = a.updatedAt ?? a.createdAt ?? ''
  const ub = b.updatedAt ?? b.createdAt ?? ''
  if (ua !== ub) return ua < ub ? 1 : -1
  const ca = a.createdAt ?? ''
  const cb = b.createdAt ?? ''
  if (ca !== cb) return ca < cb ? 1 : -1
  return a.name.localeCompare(b.name)
}

export function ProjectPanel({
  defaultProjectType = 'default',
  defaultProjectName = 'My project',
  lockLabelOf,
  newButtonIcon,
  activePipelineRuns = [],
  headerActions,
  renderProjectActions,
  onSaveProject,
}: ProjectPanelProps): JSX.Element {
  const locale = useProjectLocale()
  const projects = useProjectStore((s) => s.projects)
  const viewingProjectId = useProjectStore((s) => s.viewingProjectId)
  const executingProjectIds = useProjectStore((s) => s.executingProjectIds)
  const isSwitching = useProjectStore((s) => s.isSwitching)
  const switchProject = useProjectStore((s) => s.switchProject)
  const renameProject = useProjectStore((s) => s.renameProject)
  const activeGameSlug = useProjectStore((s) => s.activeGameSlug)
  const showAllProjects = useProjectStore((s) => s.showAllProjects)
  const setShowAllProjects = useProjectStore((s) => s.setShowAllProjects)

  const [view, setView] = useState<View>({ kind: 'list' })
  const [lockMap, setLockMap] = useState<LockMap>({})
  const [filter, setFilter] = useState('')
  const [statusExpanded, setStatusExpanded] = useState(false)
  const fetchProjects = useProjectStore((s) => s.fetchProjects)

  // aw-support provisions projects out-of-band; refresh while agents are active so
  // newly created rows appear without a full page reload.
  useEffect(() => {
    const hasActive = executingProjectIds.length > 0 || activePipelineRuns.length > 0
    if (!hasActive) return
    void fetchProjects()
    const timer = setInterval(() => void fetchProjects(), 5000)
    return () => clearInterval(timer)
  }, [executingProjectIds.length, activePipelineRuns.length, fetchProjects])

  const pipelineByProject = useMemo(() => {
    const map: Record<string, ActivePipelineRunInfo> = {}
    for (const run of activePipelineRuns) {
      if (run.sceneProjectId) map[run.sceneProjectId] = run
    }
    return map
  }, [activePipelineRuns])

  const pipelineProjectIds = useMemo(
    () => new Set(activePipelineRuns.map((r) => r.sceneProjectId).filter(Boolean)),
    [activePipelineRuns],
  )

  const refreshLocks = useCallback(async () => {
    // Left-pane hosts configure the transport in a parent effect. React runs
    // child effects first, so this can fire before configureEditorTransport.
    const api = peekEditorTransport()?.api
    if (!api) return
    if (api.listWorkspaceLocks) {
      try {
        const res = await api.listWorkspaceLocks()
        if (!res) return
        const next: LockMap = {}
        for (const entry of res.locks ?? []) {
          next[entry.projectId] = {
            agentId: entry.agentId,
            sessionId: entry.sessionId,
            acquiredAt: entry.acquiredAt,
          }
        }
        setLockMap((prev) => (lockMapsEqual(prev, next) ? prev : next))
        return
      } catch {
        /* fall through to per-project fetch */
      }
    }
    if (!api.getProjectLock) {
      setLockMap((prev) => (Object.keys(prev).length === 0 ? prev : {}))
      return
    }
    const ids = new Set([...executingProjectIds, ...Object.keys(pipelineByProject)])
    if (ids.size === 0) {
      setLockMap((prev) => (Object.keys(prev).length === 0 ? prev : {}))
      return
    }
    const entries = await Promise.all(
      [...ids].map(async (id) => {
        try {
          const res = await api.getProjectLock!(id)
          const lock = res?.lock
          return lock ? ([id, { agentId: lock.agentId, sessionId: lock.sessionId, acquiredAt: lock.acquiredAt }] as const) : null
        } catch {
          return null
        }
      }),
    )
    const next = Object.fromEntries(entries.filter(Boolean) as Array<[string, ProjectExecutionLock]>)
    setLockMap((prev) => (lockMapsEqual(prev, next) ? prev : next))
  }, [executingProjectIds, pipelineByProject])

  useEffect(() => {
    void refreshLocks()
    const timer = setInterval(() => void refreshLocks(), 3000)
    return () => clearInterval(timer)
  }, [refreshLocks])

  const lockedProjectIds = useMemo(() => {
    const ids = new Set(Object.keys(lockMap))
    for (const id of executingProjectIds) ids.add(id)
    for (const id of pipelineProjectIds) ids.add(id)
    return ids
  }, [lockMap, executingProjectIds, pipelineProjectIds])

  const resolveSceneLock = useCallback(
    (project: ProjectMeta): ProjectExecutionLock | null => lockMap[project.id] ?? null,
    [lockMap],
  )

  const resolvePipelineRun = useCallback(
    (project: ProjectMeta): ActivePipelineRunInfo | null => pipelineByProject[project.id] ?? null,
    [pipelineByProject],
  )

  const resolveLockLabel = useCallback(
    (project: ProjectMeta): string | null => {
      const custom = lockLabelOf?.(project)
      if (custom) return custom
      const lock = resolveSceneLock(project)
      return lock ? formatProjectLockLabel(lock, project.name) : null
    },
    [lockLabelOf, resolveSceneLock],
  )

  const listScrollRef = useRef(0)
  const captureListScroll = useCallback((el: HTMLDivElement | null) => {
    if (el) listScrollRef.current = el.scrollTop
  }, [])
  const restoreListScroll = useCallback((el: HTMLDivElement | null) => {
    if (el) el.scrollTop = listScrollRef.current
  }, [])

  const handleActivate = useCallback(
    (id: string) => {
      if (id === viewingProjectId) return
      void switchProject(id)
    },
    [viewingProjectId, switchProject],
  )

  const handleRenameProject = useCallback(
    (id: string, name: string) => {
      void renameProject(id, name)
    },
    [renameProject],
  )

  const handleRequestDeleteProject = useCallback((project: ProjectMeta) => {
    setView({ kind: 'delete', project })
  }, [])

  const statusRows = useMemo((): StatusRow[] => {
    const rows: StatusRow[] = []
    const seen = new Set<string>()

    for (const projectId of executingProjectIds) {
      if (lockMap[projectId] || seen.has(projectId)) continue
      seen.add(projectId)
      const meta = projects.find((p) => p.id === projectId)
      rows.push({
        key: `exec-${projectId}`,
        kind: 'executing',
        projectId,
        name: meta?.name ?? projectId,
      })
    }

    for (const [projectId, lock] of Object.entries(lockMap)) {
      if (seen.has(projectId)) continue
      seen.add(projectId)
      const meta = projects.find((p) => p.id === projectId)
      rows.push({
        key: `lock-${projectId}`,
        kind: 'executing',
        projectId,
        name: meta?.name ?? projectId,
        detail: formatProjectLockLabel(lock, meta?.name ?? projectId),
      })
    }

    for (const run of activePipelineRuns) {
      if (!run.sceneProjectId || lockMap[run.sceneProjectId]) continue
      const meta = projects.find((p) => p.id === run.sceneProjectId)
      rows.push({
        key: `run-${run.runId}`,
        kind: 'pipeline',
        name: meta?.name ?? run.sceneName ?? run.sceneProjectId,
        detail: formatPipelineRunLabel(run),
      })
    }

    return rows
  }, [executingProjectIds, lockMap, projects, activePipelineRuns])

  const statusCollapsible = statusRows.length > STATUS_COLLAPSE_THRESHOLD
  const visibleStatusRows =
    statusCollapsible && !statusExpanded ? statusRows.slice(0, STATUS_COLLAPSE_THRESHOLD) : statusRows

  const sorted = useMemo(
    () => {
      const knownIds = new Set(projects.map((p) => p.id))
      const orphanExecuting: ProjectMeta[] = [...executingProjectIds, ...pipelineProjectIds]
        .filter((id, i, arr) => arr.indexOf(id) === i && !knownIds.has(id))
        .map((id) => ({
          id,
          type: defaultProjectType,
          name: `Agent project (${id.slice(-8)})`,
          description: 'Created by agent — refresh if name is missing',
          createdAt: '',
          updatedAt: '',
        }))
      const all = [...orphanExecuting, ...projects]
      return all.sort((a, b) => compareProjectsForList(a, b, lockedProjectIds, pipelineProjectIds))
    },
    [projects, lockedProjectIds, pipelineProjectIds, executingProjectIds, defaultProjectType],
  )

  const showProjectType = useMemo(() => new Set(projects.map((p) => p.type)).size > 1, [projects])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter(
      (p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q),
    )
  }, [sorted, filter])

  const activeCount = lockedProjectIds.size
  const showStatus = statusRows.length > 0
  const countTitle =
    activeCount > 0
      ? pt('countActiveTitle', { count: projects.length, active: activeCount })
      : pt('countTitle', { count: projects.length })

  if (view.kind === 'new') {
    return (
      <section className="proj-panel">
        <NewProjectWizard
          defaultProjectType={defaultProjectType}
          defaultProjectName={defaultProjectName}
          onCancel={() => setView({ kind: 'list' })}
          onCreated={() => setView({ kind: 'list' })}
        />
      </section>
    )
  }

  if (view.kind === 'delete') {
    return (
      <section className="proj-panel">
        <DeleteProjectDialog
          project={view.project}
          onCancel={() => setView({ kind: 'list' })}
          onDone={() => setView({ kind: 'list' })}
        />
      </section>
    )
  }

  return (
    <section className="proj-panel" aria-label={pt('title')}>
      <header className="proj-panel__head">
        <h2>
          {pt('title')}
          <span className="proj-panel__count" title={countTitle}>
            {projects.length}
            {activeCount > 0 ? pt('countActive', { active: activeCount }) : ''}
          </span>
        </h2>
        <button type="button" className="proj-btn proj-btn--primary" onClick={() => setView({ kind: 'new' })}>
          {newButtonIcon}
          {pt('new')}
        </button>
        {headerActions}
      </header>
      <input
        type="search"
        className="proj-panel__filter"
        placeholder={pt('filterPlaceholder')}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        aria-label={pt('filterAria')}
      />
      {activeGameSlug && (
        <div
          className="proj-panel__scope"
          title={showAllProjects ? pt('scopeToggleToGame', { game: activeGameSlug }) : pt('scopeToggleToAll')}
        >
          <span className="proj-panel__scope-context">
            <span className="proj-panel__scope-context-label">{pt('scopeLabel')}</span>
            <span className="proj-panel__scope-context-value">
              {showAllProjects ? pt('scopeAllGames') : activeGameSlug}
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={showAllProjects}
            aria-label={showAllProjects ? pt('scopeToggleToGame', { game: activeGameSlug }) : pt('scopeToggleToAll')}
            className={`proj-panel__scope-switch${showAllProjects ? ' proj-panel__scope-switch--on' : ''}`}
            onClick={() => setShowAllProjects(!showAllProjects)}
          >
            <span className="proj-panel__scope-switch-track" aria-hidden="true">
              <span className="proj-panel__scope-switch-thumb" />
            </span>
          </button>
        </div>
      )}
      {showStatus && (
        <div className="proj-panel__status" aria-live="polite">
          {visibleStatusRows.map((row) => {
            if (row.kind === 'executing') {
              const isViewing = row.projectId === viewingProjectId
              return (
                <div key={row.key} className="proj-panel__status-row proj-panel__status-row--executing">
                  <span className="proj-panel__status-label">{pt('statusExecuting')}</span>
                  <button
                    type="button"
                    className="proj-panel__status-action"
                    disabled={isViewing || isSwitching}
                    title={row.detail ?? pt('statusViewCanvas', { name: row.name })}
                    onClick={() => handleActivate(row.projectId)}
                  >
                    {row.name}
                    {!isViewing && ' →'}
                  </button>
                </div>
              )
            }
            return (
              <div key={row.key} className="proj-panel__status-row proj-panel__status-row--pipeline">
                <span className="proj-panel__status-label">{pt('statusPipeline')}</span>
                <span className="proj-panel__status-value" title={row.detail}>
                  {row.name}
                </span>
              </div>
            )
          })}
          {statusCollapsible && (
            <button
              type="button"
              className="proj-panel__status-toggle"
              onClick={() => setStatusExpanded((v) => !v)}
            >
              {statusExpanded
                ? pt('statusCollapse')
                : pt('statusExpand', { count: statusRows.length })}
            </button>
          )}
        </div>
      )}
      <div className="proj-panel__list" ref={restoreListScroll} onScroll={(e) => captureListScroll(e.currentTarget)}>
        {filtered.length === 0 && (
          <div className="proj-empty">
            {sorted.length === 0 ? pt('emptyNone') : pt('emptyFilter')}
          </div>
        )}
        {filtered.map((p) => (
          <ProjectCard
            key={p.id}
            project={p}
            locale={locale}
            isActive={p.id === viewingProjectId}
            isSwitching={isSwitching}
            showProjectType={showProjectType}
            executingLock={resolveSceneLock(p)}
            pipelineRun={resolvePipelineRun(p)}
            lockLabel={resolveLockLabel(p)}
            canDelete={p.id !== viewingProjectId}
            onSaveProject={onSaveProject}
            extraActions={onSaveProject ? undefined : renderProjectActions?.(p)}
            onActivateProject={handleActivate}
            onRenameProject={handleRenameProject}
            onRequestDeleteProject={handleRequestDeleteProject}
          />
        ))}
      </div>
    </section>
  )
}
