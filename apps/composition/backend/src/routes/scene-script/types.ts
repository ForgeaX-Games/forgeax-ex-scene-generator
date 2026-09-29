import type { AuthoringCommand } from '@forgeax/scene-authoring'

export const SCENE_SCRIPT_PREFIX = '/api/v1/projects/:projectId/scene-script'

export interface ProjectParams {
  projectId: string
}

export interface SceneScriptQuery {
  file?: string
}

export interface SceneScriptBody {
  file?: string
  source?: string
  expectedRevision?: string
  canonicalize?: boolean
  label?: string
}

export interface SceneCommandBody {
  file?: string
  expectedRevision?: string
  expectedProjectRevision?: string
  expectedModuleRevisions?: Record<string, string>
  commands: AuthoringCommand[]
  label?: string
}
