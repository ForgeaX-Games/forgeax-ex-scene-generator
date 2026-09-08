import type { FastifyInstance } from 'fastify'

import { liftLegacyRuntimeGraph } from '@forgeax/scene-authoring'
import { getProjectDir } from '../../runtime.js'
import { getProjectSceneContractRegistry } from '../../scene-script/contracts/contracts.js'
import { compileStoredSceneProject } from '../../scene-script/compile/projectCompiler.js'
import { readSceneModule, writeSceneModule } from '../../scene-script/persist/store.js'
import { ensureMutationAccess } from '../projects.js'
import { rejectedSceneScriptPayload } from '../../scene-script/diagnostics.js'
import { currentRuntimeGraph, executeLiftCandidate, hasErrors } from './helpers.js'

import { SCENE_SCRIPT_PREFIX, type ProjectParams } from './types.js'

export function registerSceneScriptLiftRoutes(app: FastifyInstance): void {
  const prefix = SCENE_SCRIPT_PREFIX
  app.post<{ Params: ProjectParams; Body: { confirmMedium?: boolean } }>(`${prefix}/lift`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: `project not found: ${req.params.projectId}` })
    const access = await ensureMutationAccess(req, req.params.projectId)
    if (!access.ok) return reply.code(403).send(access)
    const stored = await readSceneModule(projectDir)
    if (stored.source.trim()) {
      return reply.code(409).send({
        status: 'rejected',
        code: 'scene-project-already-canonical',
        reason: 'This project already has a canonical Scene Project.',
      })
    }
    const rawGraph = await currentRuntimeGraph(req.params.projectId)
    if (!rawGraph) return reply.code(404).send({ reason: 'legacy Runtime Graph not found' })
    const registry = await getProjectSceneContractRegistry(projectDir)
    const lifted = await liftLegacyRuntimeGraph(rawGraph, registry, {
      projectId: req.params.projectId,
      file: stored.file,
      execute: (candidate) => executeLiftCandidate(req.params.projectId, candidate),
    })
    if (!lifted.canonical || !lifted.source || !lifted.module) {
      return reply.code(lifted.status === 'read-only' ? 422 : 409).send(lifted)
    }
    const compiled = await compileStoredSceneProject(projectDir, {
      entryFile: stored.file,
      entrySource: lifted.source,
      projectId: req.params.projectId,
      registry,
    })
    if (hasErrors(compiled.diagnostics)) {
      return reply.code(422).send(rejectedSceneScriptPayload(
        'Lifted Scene Project failed canonical compilation.',
        compiled.diagnostics,
      ))
    }
    const next = await writeSceneModule(
      projectDir,
      stored.file,
      lifted.source,
      compiled.compiled.sourceMap,
      lifted.semanticParity.liftedGraphHash,
    )
    return {
      ...lifted,
      revision: next.revision,
      sourceMap: compiled.compiled.sourceMap,
    }
  })

}
