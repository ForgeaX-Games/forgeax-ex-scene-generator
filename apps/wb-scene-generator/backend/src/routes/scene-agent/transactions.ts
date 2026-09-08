import type { FastifyInstance } from 'fastify'

import {
  boundedUnique,
  commandModuleIds,
  commandTargetIds,
  SCENE_WORKFLOW_LIMITS,
  stableArtifactStringify,
  type SceneEditPrecondition,
  type SceneVerification,
} from '@forgeax/scene-authoring'

import { getProjectDir } from '../../runtime.js'
import { readSceneModule } from '../../scene-script/persist/store.js'
import {
  newWorkNode,
  readStoredTransaction,
  writeStoredTransaction,
  writeWorkNodeArtifacts,
} from '../../scene-script/agent/workflowStore.js'
import { ensureMutationAccess } from '../projects.js'
import {
  copyCallerHeaders,
  hasErrors,
  now,
  projectContext,
  restoreTransaction,
  semanticDiff,
} from './helpers.js'
import { SCENE_AGENT_PREFIX, type ProjectParams, type TransactionParams } from './types.js'

export function registerSceneAgentTransactionRoutes(app: FastifyInstance): void {
  const prefix = SCENE_AGENT_PREFIX

  app.post<{
    Params: TransactionParams
    Body: { humanApproved?: boolean }
  }>(`${prefix}/transactions/:transactionId/apply`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: 'project not found' })
    const access = await ensureMutationAccess(req, req.params.projectId)
    if (!access.ok) return reply.code(403).send(access)
    const stored = await readStoredTransaction(projectDir, req.params.transactionId)
    if (!stored) return reply.code(404).send({ reason: 'transaction not found' })
    if (stored.retries >= SCENE_WORKFLOW_LIMITS.maxRetries) {
      return reply.code(429).send({
        code: 'scene-edit-circuit-open',
        reason: 'Retry budget exhausted; circuit breaker is open and human intervention is required.',
      })
    }
    if (!['planned', 'blocked'].includes(stored.status)) return reply.code(409).send({ reason: `transaction is ${stored.status}` })
    if (stored.transaction.humanGate?.required && !req.body?.humanApproved) {
      return reply.code(409).send({
        status: 'human-gate-required',
        reasons: stored.transaction.humanGate.reasons,
        transaction: { applied: false, rolledBack: false },
      })
    }
    if (stored.transaction.humanGate?.required) stored.transaction.humanGate.approvedAt = now()
    const { entry, project } = await projectContext(req.params.projectId, projectDir)
    const actualRevision = entry.state?.projectRevision ?? entry.state?.sourceRevision ?? entry.revision
    if (actualRevision !== stored.transaction.baseProjectRevision) {
      return reply.code(409).send({ code: 'scene-edit-stale', reason: 'Base project revision is stale.', transaction: { applied: false, rolledBack: false } })
    }
    const actualModuleRevisions = new Map(Object.values(entry.state?.moduleRevisions ?? {}).map((item) => [item.moduleId, item.revision]))
    const staleModule = Object.entries(stored.transaction.baseModuleRevisions)
      .find(([moduleId, revision]) => actualModuleRevisions.get(moduleId) !== revision)
    if (staleModule) {
      return reply.code(409).send({ code: 'scene-edit-module-conflict', reason: `Module ${staleModule[0]} changed.`, transaction: { applied: false, rolledBack: false } })
    }
    const sourceMap = entry.state?.sourceMap ?? project.compiled.sourceMap
    const commandModules = stored.transaction.astCommands.flatMap((command) => {
      const explicit = commandModuleIds(command)
      const targets = commandTargetIds(command)
      return [...explicit, ...sourceMap.filter((item) =>
        targets.includes(item.entityId) || targets.includes(item.statementId)).map((item) => item.moduleId)]
    })
    const unauthorized = boundedUnique(commandModules, SCENE_WORKFLOW_LIMITS.maxTargets)
      .filter((moduleId) => !stored.transaction.writableModuleIds.includes(moduleId))
    if (unauthorized.length) {
      return reply.code(403).send({ code: 'scene-edit-scope-violation', reason: `Write outside allowed scope: ${unauthorized.join(', ')}`, transaction: { applied: false, rolledBack: false } })
    }
    const missingTarget = stored.transaction.preconditions
      .filter((item): item is Extract<SceneEditPrecondition, { kind: 'target-exists' }> => item.kind === 'target-exists')
      .find((item) => !sourceMap.some((entry) => entry.entityId === item.targetId || entry.statementId === item.targetId))
    if (missingTarget) {
      return reply.code(409).send({ code: 'scene-edit-precondition-failed', reason: `Target no longer exists: ${missingTarget.targetId}` })
    }
    const signatureFailure = stored.transaction.preconditions
      .filter((item): item is Extract<SceneEditPrecondition, { kind: 'module-signature' }> => item.kind === 'module-signature')
      .find((item) => project.incremental.modules[item.moduleId]?.publicSignatureHash !== item.hash)
    if (signatureFailure) {
      return reply.code(409).send({
        code: 'scene-edit-precondition-failed',
        reason: `Module interface changed: ${signatureFailure.moduleId}`,
      })
    }
    const statements = Object.values(project.modules).flatMap((module) => module.statements)
    const argumentFailure = stored.transaction.preconditions
      .filter((item): item is Extract<SceneEditPrecondition, { kind: 'argument-equals' }> => item.kind === 'argument-equals')
      .find((item) => {
        const statement = statements.find((candidate) => candidate.statementId === item.statementId)
        return !statement || stableArtifactStringify(statement.args[item.argument]) !== stableArtifactStringify(item.value)
      })
    if (argumentFailure) {
      return reply.code(409).send({
        code: 'scene-edit-precondition-failed',
        reason: `Argument precondition changed: ${argumentFailure.statementId}.${argumentFailure.argument}`,
      })
    }
    const beforeStatements = Object.fromEntries(Object.values(project.modules).flatMap((module) =>
      module.statements.map((statement) => [statement.statementId, statement])))
    const commandResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${encodeURIComponent(req.params.projectId)}/scene-script/commands`,
      headers: { 'content-type': 'application/json', ...copyCallerHeaders(req) },
      payload: {
        expectedProjectRevision: stored.transaction.baseProjectRevision,
        expectedModuleRevisions: stored.transaction.baseModuleRevisions,
        commands: stored.transaction.astCommands,
        label: stored.transaction.intent,
      },
    })
    const commandPayload = commandResponse.json() as Record<string, unknown>
    if (commandResponse.statusCode >= 400) {
      stored.retries += 1
      stored.updatedAt = now()
      const failureNode = newWorkNode(
        stored.transaction.workNodeId,
        stored.transaction.targetIds,
        stored.transaction.writableModuleIds,
        stored.transaction.humanGate,
        stored.retries,
      )
      failureNode.kind = 'platform-recovery'
      failureNode.status = stored.retries >= SCENE_WORKFLOW_LIMITS.maxRetries ? 'failed' : 'planned'
      failureNode.budget.circuitOpen = stored.retries >= SCENE_WORKFLOW_LIMITS.maxRetries
      failureNode.budget.stopped = failureNode.budget.circuitOpen
      await Promise.all([
        writeStoredTransaction(projectDir, stored),
        writeWorkNodeArtifacts(projectDir, failureNode, {
          result: { status: failureNode.status, failure: commandPayload },
          progress: { at: now(), event: 'platform-recovery', retry: stored.retries },
        }),
      ])
      return reply.code(commandResponse.statusCode).send({
        ...commandPayload,
        retry: {
          attempted: stored.retries,
          maxRetries: SCENE_WORKFLOW_LIMITS.maxRetries,
          circuitOpen: failureNode.budget.circuitOpen,
        },
      })
    }
    const after = await projectContext(req.params.projectId, projectDir)
    const afterStatements = Object.fromEntries(Object.values(after.project.modules).flatMap((module) =>
      module.statements.map((statement) => [statement.statementId, statement])))
    const incremental = commandPayload.incremental as { invalidatedModuleIds?: string[] } | undefined
    const diff = semanticDiff(
      stored.transaction.transactionId,
      beforeStatements,
      afterStatements,
      incremental?.invalidatedModuleIds ?? stored.transaction.writableModuleIds,
      Object.keys(after.project.modules),
      stored.transaction.expectedSemanticDelta,
    )
    if (!diff.expectedDeltaMatches) {
      await restoreTransaction(req.params.projectId, projectDir, stored)
      stored.status = 'failed'
      stored.retries = SCENE_WORKFLOW_LIMITS.maxRetries
      stored.diff = diff
      stored.updatedAt = now()
      const failureNode = newWorkNode(
        stored.transaction.workNodeId,
        stored.transaction.targetIds,
        stored.transaction.writableModuleIds,
        stored.transaction.humanGate,
        stored.retries,
      )
      failureNode.status = 'failed'
      failureNode.budget.circuitOpen = true
      failureNode.budget.stopped = true
      await Promise.all([
        writeStoredTransaction(projectDir, stored),
        writeWorkNodeArtifacts(projectDir, failureNode, {
          result: { status: 'failed', rolledBack: true },
          semanticDiff: diff,
          progress: { at: now(), event: 'semantic-delta-mismatch-rollback' },
        }),
      ])
      return reply.code(422).send({
        code: 'scene-edit-semantic-delta-mismatch',
        reason: 'Actual semantic delta does not match the declared expectation; transaction was rolled back.',
        semanticDiff: diff,
        transaction: { applied: false, rolledBack: true },
      })
    }
    stored.status = 'preview'
    stored.diff = diff
    stored.afterSources = commandPayload.sources as Record<string, string> | undefined
    stored.undoToken = (commandPayload.transaction as { undoToken?: string } | undefined)?.undoToken
    stored.updatedAt = now()
    const node = newWorkNode(stored.transaction.workNodeId, stored.transaction.targetIds, stored.transaction.writableModuleIds, stored.transaction.humanGate)
    node.status = 'preview'
    node.updatedAt = now()
    node.checkpoint = {
      id: `checkpoint-${stored.transaction.transactionId}-preview`,
      projectRevision: String(commandPayload.projectRevision),
      createdAt: now(),
    }
    await Promise.all([
      writeStoredTransaction(projectDir, stored),
      writeWorkNodeArtifacts(projectDir, node, {
        result: { status: 'preview', transaction: commandPayload.transaction },
        semanticDiff: diff,
        progress: { at: now(), event: 'applied-for-preview' },
        checkpoint: node.checkpoint,
      }),
    ])
    return { status: 'preview', semanticDiff: diff, transaction: commandPayload.transaction, checkpoint: node.checkpoint }
  })

  app.get<{ Params: TransactionParams }>(`${prefix}/transactions/:transactionId/diff`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: 'project not found' })
    const stored = await readStoredTransaction(projectDir, req.params.transactionId)
    if (!stored?.diff) return reply.code(409).send({ reason: 'semantic diff is not available before apply' })
    return stored.diff
  })

  app.post<{
    Params: TransactionParams
    Body: { profile?: 'local' | 'global' }
  }>(`${prefix}/transactions/:transactionId/verify`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: 'project not found' })
    const stored = await readStoredTransaction(projectDir, req.params.transactionId)
    if (!stored || stored.status !== 'preview') return reply.code(409).send({ reason: 'transaction is not awaiting verification' })
    const profile = req.body?.profile ?? stored.transaction.verificationProfile
    const { project } = await projectContext(req.params.projectId, projectDir)
    const diagnostics = project.diagnostics.slice(0, 20)
    const findings = [
      ...(!stored.diff?.expectedDeltaMatches ? ['Declared semantic delta does not match.'] : []),
      ...(hasErrors(diagnostics) ? ['Compile diagnostics contain errors.'] : []),
    ]
    const verification: SceneVerification = {
      transactionId: stored.transaction.transactionId,
      profile,
      ok: findings.length === 0,
      diagnostics,
      frozenStandardsPreserved: true,
      critic: {
        readOnly: true,
        verdict: findings.length ? 'request-changes' : 'approve',
        findings,
      },
    }
    stored.verification = verification
    stored.status = verification.ok ? 'verified' : 'preview'
    stored.updatedAt = now()
    const node = newWorkNode(stored.transaction.workNodeId, stored.transaction.targetIds, stored.transaction.writableModuleIds, stored.transaction.humanGate)
    node.status = stored.status
    node.budget.stopped = true
    node.diagnostics = diagnostics
    node.updatedAt = now()
    node.checkpoint = {
      id: `checkpoint-${stored.transaction.transactionId}-verify`,
      projectRevision: (await readSceneModule(projectDir)).state?.projectRevision ?? '',
      createdAt: now(),
    }
    await Promise.all([
      writeStoredTransaction(projectDir, stored),
      writeWorkNodeArtifacts(projectDir, node, {
        result: { status: node.status },
        verification,
        progress: { at: now(), event: 'critic-review-completed', verdict: verification.critic.verdict },
        checkpoint: node.checkpoint,
      }),
    ])
    return verification
  })

  app.post<{
    Params: TransactionParams
    Body: { decision: 'accept' | 'revert' }
  }>(`${prefix}/transactions/:transactionId/decision`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: 'project not found' })
    const access = await ensureMutationAccess(req, req.params.projectId)
    if (!access.ok) return reply.code(403).send(access)
    const stored = await readStoredTransaction(projectDir, req.params.transactionId)
    if (!stored) return reply.code(404).send({ reason: 'transaction not found' })
    const decision = req.body?.decision
    if (decision === 'accept') {
      if (stored.status !== 'verified' || !stored.verification?.ok) {
        return reply.code(409).send({ reason: 'Only a successfully verified preview can be accepted.' })
      }
      stored.status = 'accepted'
    } else if (decision === 'revert') {
      if (!['preview', 'verified'].includes(stored.status)) return reply.code(409).send({ reason: `Cannot revert ${stored.status}` })
      await restoreTransaction(req.params.projectId, projectDir, stored)
      stored.status = 'reverted'
    } else {
      return reply.code(400).send({ reason: 'decision must be accept or revert' })
    }
    stored.updatedAt = now()
    const module = await readSceneModule(projectDir)
    const node = newWorkNode(stored.transaction.workNodeId, stored.transaction.targetIds, stored.transaction.writableModuleIds, stored.transaction.humanGate)
    node.status = stored.status
    node.updatedAt = now()
    node.checkpoint = {
      id: `checkpoint-${stored.transaction.transactionId}-${stored.status}`,
      projectRevision: module.state?.projectRevision ?? module.revision,
      createdAt: now(),
    }
    await Promise.all([
      writeStoredTransaction(projectDir, stored),
      writeWorkNodeArtifacts(projectDir, node, {
        result: { status: stored.status },
        progress: { at: now(), event: stored.status },
        checkpoint: node.checkpoint,
      }),
    ])
    return { status: stored.status, transactionId: stored.transaction.transactionId, checkpoint: node.checkpoint }
  })

}
