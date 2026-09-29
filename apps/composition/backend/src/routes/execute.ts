import { hydrateCapturedOutputs } from '../captured-outputs.js'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { getPipeline, type ExecutionResult } from '@forgeax/node-runtime'
import { getProjectDir, getRuntimeForProject } from '../runtime.js'
import { ensureMutationAccess } from './projects.js'
import { applySpatialVerification, summarizeExecutionResult } from '../execution-summary.js'
import { syncTrace } from '../debug/syncTrace.js'
import { buildExecutionLineage } from '../scene-script/agent/lineage.js'
import { collectSceneExecutionDiagnostics } from '../scene-script/diagnostics.js'
import { computeSourceProjectRevision, readAuthoringState, writeResultLineage } from '../scene-script/persist/store.js'
import { noteExecutedRevision, readSceneRevisionState } from '../scene-script/agent/revisionState.js'
import { noteAuthoringExecute, rendererSyncStatus } from '../agent/rendererStatus.js'
import { executeSummaryChannelFailure } from '../execute-summary-channel.js'
import {
  createSceneDiagnostic,
  toPublicSceneDiagnostics,
  type ResultLineage,
  type SceneDiagnostic,
  type SourceMapEntry,
} from '@forgeax/scene-authoring'
import { materializeDeferredOutputs, runSceneProject, sceneResultCaptures } from '../scene-script/run/runProject.js'

function currentGraphForSummary(
  runtime: Awaited<ReturnType<typeof getRuntimeForProject>>,
): { edges: readonly { source?: { nodeId?: string; port?: unknown }; target?: { nodeId?: string; port?: unknown } }[] } | undefined {
  const snap = getPipeline(runtime)
  if (!snap) return undefined
  const rawEdges = snap.edges
  const edges = Array.isArray(rawEdges)
    ? rawEdges
    : rawEdges && typeof rawEdges === 'object'
      ? Object.values(rawEdges)
      : []
  return { edges }
}

interface ProjectParams {
  projectId: string
}

function rejectInvalidCanonicalExecution(
  reply: FastifyReply,
  capture: {
    resultEntityIds: string[]
    resultCaptures: Array<{ entityId: string; kind: string }>
    diagnostics: SceneDiagnostic[]
  } | undefined,
): unknown {
  if (!capture) return null
  const compileErrors = capture.diagnostics.filter((item) => item.severity === 'error')
  const sceneOutputs = capture.resultCaptures.filter((c) => c.kind === 'sceneOutput')
  const pairingErrors: SceneDiagnostic[] = []
  if (compileErrors.length === 0 && sceneOutputs.length > 1) {
    pairingErrors.push(createSceneDiagnostic({
      code: 'SCENE_RESULT_CAPTURE_BLOCKOUT',
      phase: 'execute',
      severity: 'error',
      message: 'Canonical projects may declare at most one sceneOutput.',
      expected: 'Zero or one sceneOutput',
      actual: `sceneOutput=${sceneOutputs.length}`,
      operation: 'sceneOutput',
    }))
  }
  const errors = compileErrors.length > 0 ? compileErrors : pairingErrors
  if (errors.length === 0) return null
  return reply.code(422).send({
    status: 'rejected',
    code: 'scene-script-execution-invalid',
    reason: errors[0]?.message ?? 'Canonical Scene Script is not executable.',
    diagnostics: toPublicSceneDiagnostics(errors, { applied: false, rolledBack: false }),
    verification: {
      ok: false,
      primaryFailure: 'structural',
      finalOutput: {
        ok: false,
        resultEntityIds: capture.resultEntityIds,
        totalSceneCells: 0,
      },
    },
  })
}

async function persistExecutionLineage(
  projectId: string,
  runtime: Awaited<ReturnType<typeof getRuntimeForProject>>,
  result: ExecutionResult,
  sourceMapHint: readonly SourceMapEntry[] = [],
): Promise<{ lineage: ResultLineage[]; sourceMap: readonly SourceMapEntry[] }> {
  const projectDir = await getProjectDir(projectId)
  const authoring = projectDir ? await readAuthoringState(projectDir) : null
  const sourceMap = sourceMapHint.length > 0 ? sourceMapHint : authoring?.sourceMap ?? []
  const freshLineage = buildExecutionLineage(
    result,
    sourceMap,
    (nodeId, port) => runtime.outputs.read(nodeId, port)?.data,
  )
  const lineage = [...new Map(
    [...(authoring?.resultLineage ?? []), ...freshLineage]
      .map((entry) => [`${entry.runtime.nodeId}\0${entry.runtime.port}`, entry]),
  ).values()]
  if (projectDir) await writeResultLineage(projectDir, lineage)
  return { lineage, sourceMap }
}

export async function registerExecuteRoutes(app: FastifyInstance): Promise<void> {
  const prefix = '/api/v1/projects/:projectId'

  app.post<{ Params: ProjectParams }>(`${prefix}/execute`, async (req, reply) => {
    const { projectId } = req.params
    syncTrace('backend:execute', { projectId, nodeId: '(scene-run)', quietErrors: false })
    const access = await ensureMutationAccess(req, projectId)
    if (!access.ok) return reply.code(403).send({ reason: access.reason, code: access.code, projectId: access.projectId })

    const __t0 = Date.now()
    const projectDir = await getProjectDir(projectId)
    const runtime = await getRuntimeForProject(projectId)
    if (!projectDir) return reply.code(404).send({ reason: `project not found: ${projectId}` })
    const ran = await runSceneProject({
      projectId,
      projectDir,
      runtime,
      actor: 'scene-script:execute',
      label: 'Execute Scene Script',
    })
    const result = ran.execution
    syncTrace('backend:execute-done', {
      projectId,
      status: result.status,
      outputNodes: result.outputs ? Object.keys(result.outputs).length : 0,
    })
    const mem = process.memoryUsage()
    console.log(
      `[execute-trace] project=${projectId} nodeId=(scene-run) ` +
        `status=${result.status} outputNodes=${result.outputs ? Object.keys(result.outputs).length : 0} ` +
        `runtimeDurationMs=${result.durationMs} routeTotalMs=${Date.now() - __t0} ` +
        `rss=${(mem.rss / 1024 / 1024).toFixed(1)}MB heapUsed=${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB`,
    )
    const authoring = await readAuthoringState(projectDir)
    const executedRevision = await computeSourceProjectRevision(projectDir)
    await noteExecutedRevision(
      projectDir,
      projectId,
      executedRevision,
      result.executionId,
      result.status === 'completed',
    )
    noteAuthoringExecute({
      projectId,
      revision: executedRevision,
      executionId: result.executionId,
    })
    if (!authoring) return result
    const { lineage } = await persistExecutionLineage(projectId, runtime, result, ran.sourceMap)
    const byPort = new Map(lineage.map((entry) => [`${entry.runtime.nodeId}\0${entry.runtime.port}`, entry]))
    const resultMetadata = Object.fromEntries(Object.entries(result.resultMetadata ?? {}).map(([nodeId, ports]) => [
      nodeId,
      Object.fromEntries(Object.entries(ports).map(([port, metadata]) => {
        const entry = byPort.get(`${nodeId}\0${port}`)
        return [port, entry ? { ...metadata, authoring: entry.authoring, lineageRef: entry.lineageId } : metadata]
      })),
    ]))
    const diagnostics = collectSceneExecutionDiagnostics(
      result,
      ran.sourceMap,
      lineage,
      ran.diagnostics,
    )
    return {
      ...result,
      resultMetadata,
      lineage,
      ...(diagnostics.length ? { diagnostics: toPublicSceneDiagnostics(diagnostics) } : {}),
    }
  })

  app.post<{ Params: ProjectParams }>(`${prefix}/execute/summary`, async (req, reply) => {
    const { projectId } = req.params
    const access = await ensureMutationAccess(req, projectId)
    if (!access.ok) return reply.code(403).send({ reason: access.reason, code: access.code, projectId: access.projectId })
    try {
      const projectDir = await getProjectDir(projectId)
      const runtime = await getRuntimeForProject(projectId)
      if (!projectDir) return reply.code(404).send({ reason: `project not found: ${projectId}` })
      const ran = await runSceneProject({
        projectId,
        projectDir,
        runtime,
        actor: 'scene-script:execute',
        label: 'Execute Scene Script summary',
      })
      const capture = {
        resultEntityIds: ran.trace.map((item) => item.id),
        resultCaptures: sceneResultCaptures(ran.trace),
        diagnostics: ran.diagnostics,
        sourceMap: ran.sourceMap,
      }
      const rejected = rejectInvalidCanonicalExecution(reply, capture)
      if (rejected) return rejected
      const full = ran.execution
      try {
        const narrativeLocationNames = (req.body as { narrativeLocationNames?: unknown } | undefined)?.narrativeLocationNames
        const summary = summarizeExecutionResult(
          hydrateCapturedOutputs(full, (nodeId, port) => runtime.outputs.read(nodeId, port)?.data, capture.resultEntityIds),
          Array.isArray(narrativeLocationNames) ? narrativeLocationNames.filter((n): n is string => typeof n === 'string') : undefined,
          currentGraphForSummary(runtime),
          capture.resultEntityIds,
        ) as Record<string, unknown> & { verification?: Record<string, unknown> }
        const { lineage, sourceMap } = await persistExecutionLineage(
          projectId,
          runtime,
          full,
          capture.sourceMap,
        )
        const diagnostics = collectSceneExecutionDiagnostics(
          full,
          sourceMap,
          lineage,
          capture.diagnostics,
        )
        const verified = applySpatialVerification(summary, diagnostics)
        const executedRevision = await computeSourceProjectRevision(projectDir)
        const verificationOk = verified.verification?.ok === true
        await noteExecutedRevision(
          projectDir,
          projectId,
          executedRevision,
          full.executionId,
          full.status === 'completed',
          verificationOk,
        )
        noteAuthoringExecute({
          projectId,
          revision: executedRevision,
          executionId: full.executionId,
        })
        const revisionState = await readSceneRevisionState(projectDir, projectId)
        const lastCommittedRevision = revisionState?.sourceRevision ?? executedRevision
        return {
          ...verified,
          projectRevision: executedRevision,
          executedRevision,
          lastCommittedRevision,
          evidenceAligned: Boolean(executedRevision && lastCommittedRevision && executedRevision === lastCommittedRevision),
          sync: rendererSyncStatus(projectId),
          ...(diagnostics.length ? { diagnostics: toPublicSceneDiagnostics(diagnostics) } : {}),
        }
      } catch (error) {
        console.error(`[execute/summary] post-execute channel failure project=${projectId}:`, error)
        return executeSummaryChannelFailure(error, {
          status: full.status,
          executionId: full.executionId,
          durationMs: full.durationMs,
          verification: {
            ok: full.status === 'completed',
            primaryFailure: full.status === 'completed' ? undefined : 'execution',
          },
        })
      }
    } catch (error) {
      console.error(`[execute/summary] channel failure project=${projectId}:`, error)
      return executeSummaryChannelFailure(error)
    }
  })

  app.post<{
    Params: ProjectParams
    Body: { ports?: Array<{ nodeId?: string; portId?: string }> }
  }>(`${prefix}/outputs/materialize`, async (req, reply) => {
    const { projectId } = req.params
    const access = await ensureMutationAccess(req, projectId)
    if (!access.ok) return reply.code(403).send({ reason: access.reason, code: access.code, projectId: access.projectId })
    const runtime = await getRuntimeForProject(projectId)
    const ports = (req.body?.ports ?? [])
      .filter((item): item is { nodeId: string; portId: string } => Boolean(item.nodeId && item.portId))
    return { ok: true, ...materializeDeferredOutputs(runtime, projectId, ports) }
  })
}
