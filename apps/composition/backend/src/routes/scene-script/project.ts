import type { FastifyInstance } from 'fastify'

import { createSceneArtifact, SCENE_SCRIPT_VERSION } from '@forgeax/scene-authoring'
import { getProjectDir, getRuntimeForProject } from '../../runtime.js'
import { getSceneContractRegistry } from '../../scene-script/contracts/contracts.js'
import {
  allSceneFiles,
  computeSourceProjectRevision,
  listSceneProjectFiles,
  readAuthoringLayout,
  readSceneArtifactBundle,
  readSceneModule,
  writeSceneArtifactBundle,
} from '../../scene-script/persist/store.js'
import { getAuthoringHistoryStatus } from '../../scene-script/persist/transactionHistory.js'
import { rejectedSceneScriptPayload } from '../../scene-script/diagnostics.js'
import { currentRuntimeGraph, hasErrors } from './helpers.js'
import { runSceneProject } from '../../scene-script/run/runProject.js'

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
      projectRevision: await computeSourceProjectRevision(projectDir),
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
        reason: 'Write a .scene.ts module tree before exporting a Scene artifact.',
      })
    }
    const registry = await getSceneContractRegistry()
    const ran = await runSceneProject({
      projectId: req.params.projectId,
      projectDir,
      runtime: await getRuntimeForProject(req.params.projectId),
      entryFile: stored.file,
      actor: 'scene-script:artifact',
      label: 'Export Scene artifact',
    })
    if (hasErrors(ran.diagnostics) && !ran.reusedLastGood) {
      return reply.code(422).send(rejectedSceneScriptPayload('Scene artifact run failed.', ran.diagnostics))
    }
    const files = await allSceneFiles(projectDir)
    const sources = Object.fromEntries(await Promise.all(files.map(async (file) => [
      file,
      (await readSceneModule(projectDir, file)).source,
    ])))
    const modules = Object.fromEntries(files.map((file) => [file, {
      moduleId: file,
      file,
      imports: [],
      exports: [],
      definitions: [],
      statements: [],
    }]))
    const runtimeSnapshot = await currentRuntimeGraph(req.params.projectId)
    const bundle = createSceneArtifact({
      projectId: req.params.projectId,
      project: { entryModuleId: stored.file, modules },
      sources,
      entityIds: ran.trace.map((item) => item.id),
      layout: await readAuthoringLayout(projectDir),
      sourceMap: ran.sourceMap,
      compilerVersion: 'scene-run-0.1',
      sceneScriptVersion: SCENE_SCRIPT_VERSION,
      contractVersions: Object.fromEntries(registry.list().map((contract) => [
        contract.functionName,
        contract.definitionVersion ?? contract.contractVersion,
      ])),
      captures: ran.trace.filter((item) => item.functionName === 'sceneOutput').map((item) => item.id),
      resultLineage: stored.state?.resultLineage ?? [],
      ...(runtimeSnapshot ? { runtimeSnapshot } : {}),
      diagnostics: ran.diagnostics,
    })
    await writeSceneArtifactBundle(projectDir, bundle)
    return bundle
  })

}
