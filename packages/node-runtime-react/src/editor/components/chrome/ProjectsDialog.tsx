import { useCallback, useEffect, useMemo, useState } from 'react'
import { useProjectStore } from '../../stores/projectStore.js'
import type { ProjectMeta } from '@forgeax/node-runtime'
import { ProjectCard, NewProjectWizard, DeleteProjectDialog } from './projectViews.js'
import { useProjectLocale } from './projectI18n.js'
import './ProjectsDialog.css'

type View = { kind: 'list' } | { kind: 'new' } | { kind: 'delete'; project: ProjectMeta }

export interface ProjectsDialogProps {
  onClose: () => void
  defaultProjectType?: string
  defaultProjectName?: string
}

export function ProjectsDialog({
  onClose,
  defaultProjectType = 'default',
  defaultProjectName = 'My project',
}: ProjectsDialogProps): JSX.Element {
  const locale = useProjectLocale()
  const projects = useProjectStore((s) => s.projects)
  const viewingProjectId = useProjectStore((s) => s.viewingProjectId)
  const isSwitching = useProjectStore((s) => s.isSwitching)
  const fetchProjects = useProjectStore((s) => s.fetchProjects)
  const switchProject = useProjectStore((s) => s.switchProject)
  const renameProject = useProjectStore((s) => s.renameProject)

  const [view, setView] = useState<View>({ kind: 'list' })

  useEffect(() => {
    void fetchProjects()
  }, [fetchProjects])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleActivate = useCallback(
    async (id: string) => {
      if (id === viewingProjectId) {
        onClose()
        return
      }
      await switchProject(id)
      onClose()
    },
    [viewingProjectId, switchProject, onClose],
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

  const sorted = useMemo(() => [...projects].sort((a, b) => a.name.localeCompare(b.name)), [projects])

  return (
    <div className="proj-modal__backdrop" onMouseDown={onClose}>
      <div
        className="proj-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Projects"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {view.kind === 'list' && (
          <>
            <header className="proj-modal__head">
              <h2>Projects</h2>
              <div className="proj-modal__head-actions">
                <button type="button" className="proj-btn proj-btn--primary" onClick={() => setView({ kind: 'new' })}>
                  + New project
                </button>
                <button type="button" className="proj-btn" onClick={onClose} aria-label="Close">
                  x
                </button>
              </div>
            </header>
            <div className="proj-grid">
              {sorted.length === 0 && <div className="proj-empty">No projects yet - create one.</div>}
              {sorted.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  locale={locale}
                  isActive={p.id === viewingProjectId}
                  isSwitching={isSwitching}
                  // Never let the workspace go empty: the sole remaining
                  // (active) project can't be deleted.
                  canDelete={sorted.length > 1}
                  onActivateProject={handleActivate}
                  onRenameProject={handleRenameProject}
                  onRequestDeleteProject={handleRequestDeleteProject}
                />
              ))}
            </div>
          </>
        )}

        {view.kind === 'new' && (
          <NewProjectWizard
            defaultProjectType={defaultProjectType}
            defaultProjectName={defaultProjectName}
            onCancel={() => setView({ kind: 'list' })}
            onCreated={onClose}
          />
        )}

        {view.kind === 'delete' && (
          <DeleteProjectDialog
            project={view.project}
            onCancel={() => setView({ kind: 'list' })}
            onDone={() => setView({ kind: 'list' })}
          />
        )}
      </div>
    </div>
  )
}
