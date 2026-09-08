import type { FastifyInstance } from 'fastify'

import { noteAuthoringCommit, rendererSyncStatus } from '../../agent/rendererStatus.js'
import { getProjectDir } from '../../runtime.js'
import { commitSceneProjectFiles } from '../../scene-script/commit/commitProject.js'
import {
  MINIMAL_SCENE_SCAFFOLD_FILES,
  minimalSceneScaffoldManifest,
} from '../../scene-script/scaffold/minimal.js'
import { allSceneFiles, readSceneModule } from '../../scene-script/persist/store.js'
import { ensureMutationAccess, extractCaller } from '../projects.js'
import { SCENE_SCRIPT_PREFIX, type ProjectParams } from './types.js'

interface ScaffoldBody {
  template?: 'minimal-terrain'
  expectedProjectRevision?: string
  overwrite?: boolean
}

function hasAuthoredSource(source: string): boolean {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/^\s*\/\/.*$/gmu, '')
    .trim().length > 0
}

export async function authoredSceneFiles(projectDir: string): Promise<string[]> {
  const files = await allSceneFiles(projectDir)
  const authored = await Promise.all(files.map(async (file) => ({
    file,
    source: (await readSceneModule(projectDir, file)).source,
  })))
  return authored.filter((item) => hasAuthoredSource(item.source)).map((item) => item.file)
}

export function registerSceneScriptScaffoldRoutes(app: FastifyInstance): void {
  app.post<{ Params: ProjectParams; Body: ScaffoldBody }>(`${SCENE_SCRIPT_PREFIX}/scaffold`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: `project not found: ${req.params.projectId}` })
    const access = await ensureMutationAccess(req, req.params.projectId)
    if (!access.ok) return reply.code(403).send(access)
    if (typeof req.body?.expectedProjectRevision !== 'string' || !req.body.expectedProjectRevision.trim()) {
      return reply.code(400).send({
        status: 'rejected',
        code: 'scaffold-project-revision-required',
        reason: 'expectedProjectRevision is required; read the Scene Project before scaffolding.',
      })
    }
    const template = req.body.template ?? 'minimal-terrain'
    if (template !== 'minimal-terrain') {
      return reply.code(400).send({
        status: 'rejected',
        code: 'scaffold-template-not-found',
        reason: `unknown Scene scaffold template: ${template}`,
        templates: ['minimal-terrain'],
      })
    }
    const existing = await authoredSceneFiles(projectDir)
    if (existing.length > 0 && req.body.overwrite !== true) {
      return reply.code(409).send({
        status: 'rejected',
        code: 'scaffold-would-overwrite',
        reason: 'Scene Project already contains authored source; scaffold refuses to overwrite by default.',
        existingFiles: existing,
      })
    }

    const caller = extractCaller(req)
    const result = await commitSceneProjectFiles({
      projectId: req.params.projectId,
      projectDir,
      files: MINIMAL_SCENE_SCAFFOLD_FILES.map((item) => ({ ...item })),
      entryFile: 'main.scene.ts',
      expectedProjectRevision: req.body.expectedProjectRevision,
      label: 'Scaffold minimal Scene Project',
      actor: caller.kind === 'ai' ? 'scene-script:agent' : 'scene-script:user',
      kind: 'scaffold',
    })
    if (!result.ok) return reply.code(result.statusCode).send(result.payload)
    noteAuthoringCommit({
      projectId: req.params.projectId,
      revision: result.projectRevision,
      graphHash: result.graphHash,
    })
    return reply.code(201).send({
      ...result,
      scaffold: minimalSceneScaffoldManifest(),
      starterFiles: MINIMAL_SCENE_SCAFFOLD_FILES.map((item) => ({ ...item })),
      starterOnly: true,
      nextAction: {
        tool: 'scene:script.commitProject',
        entryFile: 'main.scene.ts',
        expectedProjectRevision: result.projectRevision,
        instruction: 'Keep heightfieldMesh → meshSceneNode as the visible ground. Replace starterTerrain with the real landform; gridSceneNode occupancy is an overlay, not terrain.',
      },
      sync: rendererSyncStatus(req.params.projectId),
    })
  })
}
