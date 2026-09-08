import type { FastifyInstance } from 'fastify'

import { createSceneArtifact, SCENE_SCRIPT_VERSION } from '@forgeax/scene-authoring'
import { getProjectDir } from '../../runtime.js'
import { getSceneContractRegistry } from '../../scene-script/contracts/contracts.js'
import { compileStoredSceneProject } from '../../scene-script/compile/projectCompiler.js'
import {
  listSceneProjectFiles,
  readAuthoringLayout,
  readSceneArtifactBundle,
  readSceneModule,
  writeSceneArtifactBundle,
} from '../../scene-script/persist/store.js'
import { getAuthoringHistoryStatus } from '../../scene-script/persist/transactionHistory.js'
import { rejectedSceneScriptPayload } from '../../scene-script/diagnostics.js'
import { currentRuntimeGraph, hasErrors } from './helpers.js'

import { SCENE_SCRIPT_PREFIX, type ProjectParams } from './types.js'

export function registerSceneScriptProjectRoutes(app: FastifyInstance): void {
  const prefix = SCENE_SCRIPT_PREFIX
  app.get<{ Params: ProjectParams }>(`${prefix}/project-info`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: `project not found: ${req.params.projectId}` })
    const stored = await readSceneModule(projectDir)
    const files = await listSceneProjectFiles(projectDir)
    const history = await getAuthoringHistoryStatus(projectDir)
    return {
      projectId: req.params.projectId,
      canonical: stored.source.trim().length > 0,
      authoringSource: stored.source.trim().length > 0 ? 'scene-project' : 'legacy-runtime-graph',
      runtimeGraphRole: 'cache-debug-export',
      migrationRequired: stored.source.trim().length === 0,
      canonicalModule: stored.file,
      revision: stored.revision,
      projectRevision: stored.state?.projectRevision ?? stored.state?.sourceRevision ?? stored.revision,
      moduleRevisions: stored.state?.moduleRevisions ?? {},
      moduleCount: files.filter((file) => file.kind === 'module').length,
      files,
      sourceMapEntries: stored.state?.sourceMap.length ?? 0,
      updatedAt: stored.state?.updatedAt ?? null,
      history,
    }
  })

  app.get<{ Params: ProjectParams }>(`${prefix}/raw-graph`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: `project not found: ${req.params.projectId}` })
    const stored = await readSceneModule(projectDir)
    if (stored.source.trim()) {
      return reply.code(410).send({
        status: 'rejected',
        code: 'raw-graph-not-authoring-source',
        reason: 'Canonical projects expose Runtime Graph only through cache/debug/export endpoints.',
      })
    }
    const rawGraph = await currentRuntimeGraph(req.params.projectId)
    if (!rawGraph) return reply.code(404).send({ reason: 'legacy Runtime Graph not found' })
    return {
      readOnly: true,
      newProjectsAllowed: false,
      authoringSource: 'legacy-runtime-graph',
      rawGraph,
    }
  })

  app.get<{ Params: ProjectParams }>(`${prefix}/artifact`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: `project not found: ${req.params.projectId}` })
    const artifact = await readSceneArtifactBundle(projectDir)
    if (!artifact) return reply.code(404).send({ reason: 'Scene artifact has not been generated' })
    return artifact
  })

  app.post<{ Params: ProjectParams }>(`${prefix}/artifact`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: `project not found: ${req.params.projectId}` })
    const stored = await readSceneModule(projectDir)
    if (!stored.source.trim()) {
      return reply.code(409).send({
        status: 'rejected',
        code: 'scene-script-not-canonical',
        reason: 'Legacy projects must be lifted before a Scene artifact can be generated.',
      })
    }
    const registry = await getSceneContractRegistry()
    const project = await compileStoredSceneProject(projectDir, {
      entryFile: stored.file,
      entrySource: stored.source,
      projectId: req.params.projectId,
      registry,
    })
    if (hasErrors(project.diagnostics)) {
      return reply.code(422).send(rejectedSceneScriptPayload('Scene artifact compilation failed.', project.diagnostics))
    }
    const sources = Object.fromEntries(await Promise.all(Object.values(project.modules).map(async (module) => [
      module.file,
      (await readSceneModule(projectDir, module.file)).source,
    ])))
    const runtimeSnapshot = await currentRuntimeGraph(req.params.projectId)
    const bundle = createSceneArtifact({
      projectId: req.params.projectId,
      project: { entryModuleId: project.compiled.module.moduleId, modules: project.modules },
      sources,
      entityIds: project.compiled.entityIds,
      layout: await readAuthoringLayout(projectDir),
      sourceMap: project.compiled.sourceMap,
      compilerVersion: 'scene-authoring-0.1',
      sceneScriptVersion: SCENE_SCRIPT_VERSION,
      contractVersions: Object.fromEntries(registry.list().map((contract) => [
        contract.functionName,
        contract.definitionVersion ?? contract.contractVersion,
      ])),
      captures: project.compiled.resultEntityIds,
      resultLineage: stored.state?.resultLineage ?? [],
      ...(runtimeSnapshot ? { runtimeSnapshot } : {}),
      diagnostics: project.diagnostics,
    })
    await writeSceneArtifactBundle(projectDir, bundle)
    return bundle
  })

}
