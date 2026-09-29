import type { FastifyInstance } from 'fastify'

import { toPublicSceneDiagnostics } from '@forgeax/scene-authoring'
import { runSceneModule } from '@forgeax/scene'
import { getProjectDir, getRuntimeForProject } from '../../runtime.js'
import { firstBatchImplementations } from '../../scene-script/run/hostImplementations.js'
import { sceneResultCaptures } from '../../scene-script/run/runProject.js'
import {
  createSceneModuleFile,
  deleteSceneModuleFile,
  moveSceneModuleFile,
  readSceneModule,
  SceneModuleInUseError,
  sceneRoot,
} from '../../scene-script/persist/store.js'
import {
  captureAuthoringSourceSnapshot,
  recordAuthoringTransaction,
  restoreAuthoringSourceSnapshot,
} from '../../scene-script/persist/transactionHistory.js'
import { ensureMutationAccess, extractCaller } from '../projects.js'
import { NOT_APPLIED } from '../../scene-script/diagnostics.js'
import { noteAuthoringCommit, rendererSyncStatus } from '../../agent/rendererStatus.js'
import { commitSceneProjectFiles } from '../../scene-script/commit/commitProject.js'
import {
  canonicalSnapshot,
  hasErrors,
  requireResultCapture,
  rollbackSourceSnapshot,
} from './helpers.js'

import { SCENE_SCRIPT_PREFIX, type ProjectParams, type SceneScriptQuery, type SceneScriptBody } from './types.js'
import { notifySceneProjectChanged } from './changes.js'

export function registerSceneScriptSourceRoutes(app: FastifyInstance): void {
  const prefix = SCENE_SCRIPT_PREFIX
  app.get<{ Params: ProjectParams; Querystring: SceneScriptQuery }>(prefix, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: `project not found: ${req.params.projectId}` })
    try {
      return await readSceneModule(projectDir, req.query.file)
    } catch (error) {
      return reply.code(400).send({ reason: error instanceof Error ? error.message : String(error) })
    }
  })

  app.post<{ Params: ProjectParams; Body: { file?: string; source?: string } }>(`${prefix}/files`, { onResponse: notifySceneProjectChanged }, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: `project not found: ${req.params.projectId}` })
    const access = await ensureMutationAccess(req, req.params.projectId)
    if (!access.ok) return reply.code(403).send(access)
    if (typeof req.body?.file !== 'string') return reply.code(400).send({ reason: 'file is required' })
    const before = await canonicalSnapshot(projectDir)
    try {
      const module = await createSceneModuleFile(projectDir, req.body.file, req.body.source)
      if (before) {
        const after = await captureAuthoringSourceSnapshot(projectDir, before.entryFile)
        await restoreAuthoringSourceSnapshot(req.params.projectId, projectDir, after, {
          actor: 'scene-script:user',
          label: `Create Scene module ${module.file}`,
        })
        await recordAuthoringTransaction(projectDir, before, after, `Create Scene module ${module.file}`)
      }
      return reply.code(201).send(module)
    } catch (error) {
      await rollbackSourceSnapshot(req.params.projectId, projectDir, before, 'Rollback failed Scene module creation')
      return reply.code(409).send({ reason: error instanceof Error ? error.message : String(error) })
    }
  })

  app.patch<{ Params: ProjectParams; Body: { from?: string; to?: string } }>(`${prefix}/files`, { onResponse: notifySceneProjectChanged }, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: `project not found: ${req.params.projectId}` })
    const access = await ensureMutationAccess(req, req.params.projectId)
    if (!access.ok) return reply.code(403).send(access)
    if (typeof req.body?.from !== 'string' || typeof req.body?.to !== 'string') {
      return reply.code(400).send({ reason: 'from and to are required' })
    }
    const before = await canonicalSnapshot(projectDir)
    try {
      const module = await moveSceneModuleFile(projectDir, req.body.from, req.body.to)
      if (before) {
        const after = await captureAuthoringSourceSnapshot(projectDir, before.entryFile)
        await restoreAuthoringSourceSnapshot(req.params.projectId, projectDir, after, {
          actor: 'scene-script:user',
          label: `Move Scene module ${req.body.from} to ${req.body.to}`,
        })
        await recordAuthoringTransaction(
          projectDir,
          before,
          after,
          `Move Scene module ${req.body.from} to ${req.body.to}`,
        )
      }
      return module
    } catch (error) {
      await rollbackSourceSnapshot(req.params.projectId, projectDir, before, 'Rollback failed Scene module move')
      return reply.code(409).send({ reason: error instanceof Error ? error.message : String(error) })
    }
  })

  app.delete<{ Params: ProjectParams; Querystring: { file?: string } }>(`${prefix}/files`, { onResponse: notifySceneProjectChanged }, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: `project not found: ${req.params.projectId}` })
    const access = await ensureMutationAccess(req, req.params.projectId)
    if (!access.ok) return reply.code(403).send(access)
    if (typeof req.query.file !== 'string') return reply.code(400).send({ reason: 'file is required' })
    const before = await canonicalSnapshot(projectDir)
    try {
      await deleteSceneModuleFile(projectDir, req.query.file)
      if (before) {
        const after = await captureAuthoringSourceSnapshot(projectDir, before.entryFile)
        await restoreAuthoringSourceSnapshot(req.params.projectId, projectDir, after, {
          actor: 'scene-script:user',
          label: `Delete Scene module ${req.query.file}`,
        })
        await recordAuthoringTransaction(projectDir, before, after, `Delete Scene module ${req.query.file}`)
      }
      return reply.code(204).send()
    } catch (error) {
      await rollbackSourceSnapshot(req.params.projectId, projectDir, before, 'Rollback failed Scene module deletion')
      if (error instanceof SceneModuleInUseError) {
        return reply.code(409).send({
          status: 'rejected',
          code: error.code,
          reason: error.message,
          impact: { module: error.file, importers: error.importers },
        })
      }
      return reply.code(409).send({ reason: error instanceof Error ? error.message : String(error) })
    }
  })

  app.post<{ Params: ProjectParams; Body: SceneScriptBody }>(`${prefix}/validate`, async (req, reply) => {
    const source = req.body?.source
    if (typeof source !== 'string') return reply.code(400).send({ reason: 'source must be a string' })
    const file = req.body.file ?? 'main.scene.ts'
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: `project not found: ${req.params.projectId}` })
    const ran = await runSceneModule({
      projectDir: sceneRoot(projectDir),
      entryFile: file,
      sourceOverrides: { [file]: source },
      implementations: await firstBatchImplementations(),
    })
    const diagnostics = requireResultCapture(
      ran.diagnostics,
      ran.trace.map((item) => item.id),
      sceneResultCaptures(ran.trace),
    )
    const valid = !hasErrors(diagnostics)
    return {
      valid,
      diagnostics: toPublicSceneDiagnostics(diagnostics, NOT_APPLIED),
      canonicalSource: source,
      transaction: NOT_APPLIED,
      sourceMap: ran.sourceMap,
      entityCount: ran.trace.length,
      operationCount: ran.trace.length,
    }
  })

  app.put<{ Params: ProjectParams; Body: SceneScriptBody }>(prefix, { onResponse: notifySceneProjectChanged }, async (req, reply) => {
    const source = req.body?.source
    if (typeof source !== 'string') return reply.code(400).send({ reason: 'source must be a string' })
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: `project not found: ${req.params.projectId}` })
    const access = await ensureMutationAccess(req, req.params.projectId)
    if (!access.ok) return reply.code(403).send(access)
    const caller = extractCaller(req)
    const file = req.body.file ?? 'main.scene.ts'
    const storedEntry = await readSceneModule(projectDir)
    const compileEntryFile = file === storedEntry.file || !storedEntry.source.trim()
      ? file
      : storedEntry.file
    const result = await commitSceneProjectFiles({
      projectId: req.params.projectId,
      projectDir,
      files: [{ file, source }],
      entryFile: compileEntryFile,
      expectedRevision: req.body.expectedRevision,
      canonicalize: req.body.canonicalize,
      label: req.body.label ?? 'Compile Scene Script',
      actor: caller.kind === 'ai' ? 'scene-script:agent' : 'scene-script:user',
      kind: 'direct-put',
    })
    if (!result.ok) return reply.code(result.statusCode).send(result.payload)
    noteAuthoringCommit({
      projectId: req.params.projectId,
      revision: result.projectRevision,
      graphHash: result.graphHash,
    })
    return {
      status: 'ok',
      revision: result.revision,
      projectRevision: result.projectRevision,
      graphHash: result.graphHash,
      diagnostics: result.diagnostics,
      transaction: result.transaction,
      sourceMap: result.sourceMap,
      canonicalSource: result.canonicalSource,
      entityCount: result.entityCount,
      operationCount: result.operationCount,
      sync: rendererSyncStatus(req.params.projectId),
    }
  })

}
