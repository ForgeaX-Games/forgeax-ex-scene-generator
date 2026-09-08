import type { FastifyInstance } from 'fastify'

import { getProjectDir } from '../../runtime.js'
import { commitSceneProjectFiles } from '../../scene-script/commit/commitProject.js'
import { noteAuthoringCommit, rendererSyncStatus } from '../../agent/rendererStatus.js'
import { ensureMutationAccess, extractCaller } from '../projects.js'
import { SCENE_SCRIPT_PREFIX, type ProjectParams } from './types.js'

interface CommitBody {
  files?: Array<{ file?: string; source?: string }>
  entryFile?: string
  expectedProjectRevision?: string
  expectedRevision?: string
  canonicalize?: boolean
  label?: string
}

export function registerSceneScriptCommitRoutes(app: FastifyInstance): void {
  app.post<{ Params: ProjectParams; Body: CommitBody }>(`${SCENE_SCRIPT_PREFIX}/commit`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: `project not found: ${req.params.projectId}` })
    const access = await ensureMutationAccess(req, req.params.projectId)
    if (!access.ok) return reply.code(403).send(access)
    const files = (req.body?.files ?? [])
      .filter((item): item is { file: string; source: string } =>
        typeof item?.file === 'string' && typeof item?.source === 'string')
    if (files.length === 0) return reply.code(400).send({ reason: 'files must contain { file, source } entries' })
    const caller = extractCaller(req)
    const result = await commitSceneProjectFiles({
      projectId: req.params.projectId,
      projectDir,
      files,
      entryFile: req.body.entryFile,
      expectedProjectRevision: req.body.expectedProjectRevision,
      expectedRevision: req.body.expectedRevision,
      canonicalize: req.body.canonicalize,
      label: req.body.label,
      actor: caller.kind === 'ai' ? 'scene-script:agent' : 'scene-script:user',
      kind: 'commit-project',
    })
    if (!result.ok) return reply.code(result.statusCode).send(result.payload)
    noteAuthoringCommit({
      projectId: req.params.projectId,
      revision: result.projectRevision,
      graphHash: result.graphHash,
    })
    return { ...result, sync: rendererSyncStatus(req.params.projectId) }
  })
}
