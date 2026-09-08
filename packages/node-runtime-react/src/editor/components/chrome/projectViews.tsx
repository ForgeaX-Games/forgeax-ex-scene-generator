// Shared project sub-views — the building blocks for both the modal
// `ProjectsDialog` and the inline `ProjectPanel` (left side pane). Extracted so
// the project UI has a SINGLE implementation: a card (open / rename / delete),
// the new-project wizard, and the delete confirmation. Consumers compose these;
// they own no layout chrome beyond what the cards need.

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { getEditorTransport } from '../../transport/index.js'
import { useProjectStore } from '../../stores/projectStore.js'
import type { ImportTemplate, ProjectMeta } from '@forgeax/node-runtime'
import {
  formatProjectTimestamp,
  formatWhenFull,
  pt,
  type Locale,
} from './projectI18n.js'
import './ProjectsDialog.css'

export interface ProjectExecutionLock {
  agentId: string
  sessionId?: string
  acquiredAt?: string
}

/** aw-support export pipeline still in flight (may not hold a scene lock). */
export interface ActivePipelineRunInfo {
  runId: string
  sceneProjectId: string
  sceneName?: string
  sessionId?: string
  stage?: string
}

/** Human-readable agent lock badge: agent + session + aw-support run hint from name. */
export function formatProjectLockLabel(lock: ProjectExecutionLock, projectName?: string): string {
  const agent =
    lock.agentId === 'sino' || lock.agentId.startsWith('sino-')
      ? 'Sino'
      : lock.agentId.startsWith('ai:')
        ? lock.agentId.slice(3)
        : lock.agentId
  const session = lock.sessionId ? lock.sessionId.slice(0, 8) : null
  const runMatch = projectName?.match(/aw-support · .+? · ([\w-]+)/)
  const runHint = runMatch?.[1]
  const parts = [`Executing · ${agent}`]
  if (session) parts.push(`session ${session}`)
  if (runHint) parts.push(`run ${runHint}`)
  return parts.join(' · ')
}

/** Pipeline-run badge when ForgeaX agents are working but scene lock may be idle. */
export function formatPipelineRunLabel(run: ActivePipelineRunInfo): string {
  const session = run.sessionId ? run.sessionId.slice(0, 8) : null
  const shortRun = run.runId.replace(/^pure-asset-\d{8}-/, '').replace(/^export-\d{8}-/, '')
  const parts = ['Pipeline run']
  if (session) parts.push(`session ${session}`)
  parts.push(`run ${shortRun}`)
  if (run.stage && run.stage !== 'agents') parts.push(run.stage)
  return parts.join(' · ')
}

/**
 * Pick a project name that doesn't collide with existing ones. The first choice
 * is `base` ("My scene"); if taken, append " (2)", " (3)", … until free.
 * Comparison is case-insensitive on the trimmed name.
 */
function uniqueProjectName(base: string, existing: readonly ProjectMeta[]): string {
  const taken = new Set(existing.map((p) => p.name.trim().toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}

function RenameIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"
      />
    </svg>
  )
}

function DeleteIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 6h18M8 6V4h8v2m-1 0v14H9V6"
      />
    </svg>
  )
}

export function SaveIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M17 21v-8H7v8M7 3v5h8"
      />
    </svg>
  )
}

export { formatProjectTimestamp } from './projectI18n.js'

function ProjectCardInner({
  project,
  locale,
  isActive,
  isSwitching,
  showProjectType = true,
  lockLabel,
  executingLock,
  pipelineRun,
  canDelete = true,
  extraActions,
  onSaveProject,
  onActivateProject,
  onRenameProject,
  onRequestDeleteProject,
}: {
  project: ProjectMeta
  /** Pass from the panel root — avoids per-card locale subscriptions. */
  locale: Locale
  isActive: boolean
  isSwitching: boolean
  /** When false, hide the type pill (e.g. all projects share one domain type). */
  showProjectType?: boolean
  /** @deprecated Prefer executingLock — kept for custom lockLabelOf overrides. */
  lockLabel?: string | null
  /** When set, the project is held by an agent — render an executing badge. */
  executingLock?: ProjectExecutionLock | null
  /** aw-support pipeline still running on this project (even without scene lock). */
  pipelineRun?: ActivePipelineRunInfo | null
  /** When false, the Delete action is disabled (e.g. the last remaining project). */
  canDelete?: boolean
  /** Optional extra action(s) injected into the card toolbar (e.g. Save). */
  extraActions?: ReactNode
  /** Optional save handler — built-in toolbar icon when set. */
  onSaveProject?: (project: ProjectMeta) => void
  onActivateProject: (id: string) => void
  onRenameProject: (id: string, name: string) => void
  onRequestDeleteProject: (project: ProjectMeta) => void
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(project.name)
  const executingLabel = useMemo(
    () => lockLabel ?? (executingLock ? formatProjectLockLabel(executingLock, project.name) : null),
    [lockLabel, executingLock, project.name],
  )
  const pipelineLabel = useMemo(
    () => (pipelineRun ? formatPipelineRunLabel(pipelineRun) : null),
    [pipelineRun],
  )
  const createdLabel = useMemo(
    () => formatProjectTimestamp(project.createdAt, 'created', locale),
    [project.createdAt, locale],
  )
  const editedLabel = useMemo(
    () => formatProjectTimestamp(project.updatedAt, 'edited', locale),
    [project.updatedAt, locale],
  )
  const metaParts = useMemo(
    () => [createdLabel, editedLabel].filter(Boolean),
    [createdLabel, editedLabel],
  )
  const metaTitle = useMemo(
    () => [formatWhenFull(project.createdAt, locale), formatWhenFull(project.updatedAt, locale)]
      .filter(Boolean)
      .join(' · '),
    [project.createdAt, project.updatedAt, locale],
  )

  const handleActivate = useCallback(() => onActivateProject(project.id), [onActivateProject, project.id])
  const handleRenameCommit = useCallback(() => {
    setEditing(false)
    if (name.trim() && name !== project.name) onRenameProject(project.id, name.trim())
  }, [name, onRenameProject, project.id, project.name])
  const handleRequestDelete = useCallback(() => onRequestDeleteProject(project), [onRequestDeleteProject, project])
  const handleSave = useCallback(() => onSaveProject?.(project), [onSaveProject, project])

  return (
    <div className={`proj-card${isActive ? ' proj-card--active' : ''}${executingLock || pipelineRun ? ' proj-card--executing' : ''}`}>
      <div className="proj-card__inner">
        <button type="button" className="proj-card__open" disabled={isSwitching} onClick={handleActivate}>
          {showProjectType && <span className="proj-card__type">{project.type}</span>}
          {editing ? (
            <input
              className="proj-card__name-input"
              value={name}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setName(e.target.value)}
              onBlur={handleRenameCommit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
            />
          ) : (
            <span className="proj-card__name">{project.name}</span>
          )}
          {metaParts.length > 0 && (
            <span className="proj-card__meta" title={metaTitle || undefined}>
              {createdLabel && (
                <span className="proj-card__meta-created">{createdLabel}</span>
              )}
              {createdLabel && editedLabel && <span className="proj-card__meta-separator" aria-hidden="true"> · </span>}
              {editedLabel && (
                <span className="proj-card__meta-edited">{editedLabel}</span>
              )}
            </span>
          )}
          {(pipelineLabel || executingLabel) && (
            <span className="proj-card__badges">
              {pipelineLabel && (
                <span className="proj-card__badge proj-card__badge--pipeline" title={pipelineLabel}>
                  {pipelineLabel}
                </span>
              )}
              {executingLabel && (
                <span className="proj-card__badge proj-card__badge--lock" title={executingLabel}>
                  {executingLabel}
                </span>
              )}
            </span>
          )}
        </button>
        <div className="proj-card__toolbar">
          {onSaveProject && (
            <button
              type="button"
              className="proj-card__icon-btn"
              title={pt('save')}
              aria-label={pt('save')}
              onClick={handleSave}
            >
              <SaveIcon />
            </button>
          )}
          {extraActions}
          <button
            type="button"
            className="proj-card__icon-btn"
            title={pt('rename')}
            aria-label={pt('rename')}
            onClick={() => setEditing(true)}
          >
            <RenameIcon />
          </button>
          <button
            type="button"
            className="proj-card__icon-btn proj-card__icon-btn--danger"
            title={canDelete ? pt('delete') : pt('deleteDisabled')}
            aria-label={canDelete ? pt('delete') : pt('deleteDisabled')}
            disabled={!canDelete}
            onClick={handleRequestDelete}
          >
            <DeleteIcon />
          </button>
        </div>
      </div>
    </div>
  )
}

export const ProjectCard = memo(ProjectCardInner)

export function NewProjectWizard({
  defaultProjectType,
  defaultProjectName,
  onCancel,
  onCreated,
}: {
  defaultProjectType: string
  defaultProjectName: string
  onCancel: () => void
  onCreated: () => void
}): JSX.Element {
  const createProject = useProjectStore((s) => s.createProject)
  const existingProjects = useProjectStore((s) => s.projects)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [fromTemplate, setFromTemplate] = useState('')
  const [templates, setTemplates] = useState<readonly ImportTemplate[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getEditorTransport()
      .api.listImportTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([]))
  }, [])

  const submit = useCallback(async () => {
    // Empty name → fall back to the default ("My scene"), de-duplicating against
    // existing project names as "My scene (2)", "(3)", … so a blank name is
    // always a valid, unique project rather than an error.
    const resolvedName = name.trim() || uniqueProjectName(defaultProjectName, existingProjects)
    setBusy(true)
    setError(null)
    try {
      await createProject({
        type: defaultProjectType,
        name: resolvedName,
        description: description.trim() || undefined,
        fromTemplate: fromTemplate || undefined,
      })
      onCreated()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [name, description, fromTemplate, defaultProjectType, defaultProjectName, existingProjects, createProject, onCreated])

  return (
    <div className="proj-wizard">
      <header className="proj-modal__head">
        <h2>New project</h2>
      </header>
      <label className="proj-field">
        <span>Name</span>
        <input value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder={defaultProjectName} />
      </label>
      <label className="proj-field">
        <span>Description</span>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="(optional)" />
      </label>
      <label className="proj-field">
        <span>Template</span>
        <select value={fromTemplate} onChange={(e) => setFromTemplate(e.target.value)}>
          <option value="">Blank</option>
          {templates.map((t) => (
            <option key={t.path} value={t.path}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      {error && <div className="proj-error">{error}</div>}
      <footer className="proj-modal__foot">
        <button type="button" className="proj-btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="proj-btn proj-btn--primary" onClick={() => void submit()} disabled={busy}>
          {busy ? 'Creating...' : 'Create and open'}
        </button>
      </footer>
    </div>
  )
}

export function DeleteProjectDialog({
  project,
  onCancel,
  onDone,
}: {
  project: ProjectMeta
  onCancel: () => void
  onDone: () => void
}): JSX.Element {
  const deleteProject = useProjectStore((s) => s.deleteProject)
  const [policy, setPolicy] = useState<'detach' | 'delete'>('detach')
  const [busy, setBusy] = useState(false)

  const confirm = useCallback(async () => {
    setBusy(true)
    try {
      await deleteProject(project.id, policy)
      onDone()
    } finally {
      setBusy(false)
    }
  }, [deleteProject, project.id, policy, onDone])

  return (
    <div className="proj-delete">
      <header className="proj-modal__head">
        <h2>Delete "{project.name}"?</h2>
      </header>
      <p className="proj-delete__copy">
        This permanently removes the project's graph, history, and outputs. This cannot be undone.
      </p>
      <fieldset className="proj-delete__policy">
        <legend>Produced assets</legend>
        <label>
          <input type="radio" checked={policy === 'detach'} onChange={() => setPolicy('detach')} /> Keep assets (detach)
        </label>
        <label>
          <input type="radio" checked={policy === 'delete'} onChange={() => setPolicy('delete')} /> Delete produced assets
        </label>
      </fieldset>
      <footer className="proj-modal__foot">
        <button type="button" className="proj-btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="proj-btn proj-btn--danger" onClick={() => void confirm()} disabled={busy}>
          {busy ? 'Deleting...' : 'Delete project'}
        </button>
      </footer>
    </div>
  )
}
