import type { FastifyRequest } from 'fastify'

import {
  applySceneSourceEdits,
  findSceneSite,
  inspectSceneSource,
  type SourceEdit,
} from '@forgeax/scene'
import { resolveAtomicContract, toPublicSceneDiagnostics } from '@forgeax/scene-authoring'
import {
  applyBatch,
  getPipeline,
  isNumberConstSliderPresentationOp,
  type Op,
} from '@forgeax/node-runtime'

import { getProjectDir, getRuntimeForProject } from '../../runtime.js'
import { extractCaller } from '../../routes/projects.js'
import { getSceneContractRegistry } from '../contracts/contracts.js'
import {
  ensureCanonicalSceneProject,
  keyedLayoutPatch,
  readAuthoringLayout,
  readSceneModule,
  writeAuthoringLayout,
  writeSceneProjectTransaction,
} from '../persist/store.js'
import {
  captureAuthoringSourceSnapshot,
  recordAuthoringTransaction,
  restoreAuthoringSourceSnapshot,
} from '../persist/transactionHistory.js'
import { classifyWriteLane, isPrimitiveOpId, PRIMITIVE_OP_IDS, uniqueSceneBinding } from './writeLanes.js'
import { sourceEntryFor } from '../agent/lineage.js'
import { collectSceneExecutionDiagnostics } from '../diagnostics.js'
import { runSceneProject } from '../run/runProject.js'

interface BatchOptions {
  actor?: string
  label?: string
  batchId?: string
  ephemeral?: boolean
  expectedPrevHash?: string
}

function uniqueBinding(base: string, bindings: Set<string>): string {
  return uniqueSceneBinding(base, bindings)
}

function liveNodeOf(
  liveNodes: Record<string, { id: string; opId: string; params?: Record<string, unknown> }> | Array<{ id: string; opId: string; params?: Record<string, unknown> }> | undefined,
  nodeId: string,
): { id: string; opId: string; params?: Record<string, unknown> } | undefined {
  if (!liveNodes) return undefined
  return Array.isArray(liveNodes) ? liveNodes.find((item) => item.id === nodeId) : liveNodes[nodeId]
}

function primitiveValueFromParams(opId: string, params: Record<string, unknown> | undefined): string | number | boolean | object | null {
  const record = params ?? {}
  if (opId === 'text_panel') return typeof record.text === 'string' ? record.text : ''
  if (opId === 'toggle') return Boolean(record.enabled ?? record.value)
  if (opId === 'json_panel') return record.value !== undefined && typeof record.value === 'object' ? record.value : {}
  return typeof record.value === 'number' ? record.value : 0
}

function primitiveValueFromUpdate(params: Record<string, unknown>): string | number | boolean | object | null | undefined {
  if (params.value !== undefined && typeof params.value === 'object') return params.value
  if (typeof params.value === 'number' || typeof params.value === 'string' || typeof params.value === 'boolean') {
    return params.value
  }
  if (typeof params.text === 'string') return params.text
  if ('enabled' in params) return Boolean(params.enabled)
  return undefined
}

export async function handleAuthoringRuntimeBatch(
  req: FastifyRequest,
  projectId: string,
  rawOps: unknown[],
  opts: BatchOptions | undefined,
): Promise<{ status: number; body: unknown } | null> {
  const projectDir = await getProjectDir(projectId)
  if (!projectDir) return null
  const caller = extractCaller(req)
  if (caller.kind === 'ai') {
    return {
      status: 409,
      body: {
        status: 'rejected',
        code: 'scene-script-is-canonical',
        reason: 'Direct pipeline graph mutation is disabled for AI callers. Use scene:script.put or scene:authoring.applyCommands.',
      },
    }
  }
  let stored = await readSceneModule(projectDir)
  if (!stored.source.trim()) {
    stored = await ensureCanonicalSceneProject(projectDir, projectId)
  }
  const beforeSnapshot = await captureAuthoringSourceSnapshot(projectDir, stored.file)
  const before = getPipeline(await getRuntimeForProject(projectId))
  const liveNodes = before?.nodes ?? {}

  const ops = rawOps as Op[]
  const semanticOps = ops.filter(
    (op) => !(op.type === 'updateNode' && op.position !== undefined && op.params === undefined && op.name === undefined)
      && op.type !== 'setMetadata'
      && !isNumberConstSliderPresentationOp(op, liveNodes),
  )
  const layoutPatch: Record<string, { x: number; y: number }> = {}
  for (const op of ops) {
    if (op.type === 'updateNode' && op.position) layoutPatch[op.nodeId] = op.position
    if (op.type === 'createNode' && op.position) layoutPatch[op.nodeId] = op.position
  }
  if (semanticOps.length === 0) {
    const result = await applyBatch(await getRuntimeForProject(projectId), ops, {
      actor: opts?.actor ?? 'ui',
      ...(opts?.label ? { label: opts.label } : {}),
      ...(opts?.batchId ? { batchId: opts.batchId } : {}),
      ...(opts?.ephemeral !== undefined ? { ephemeral: opts.ephemeral } : {}),
      ...(opts?.expectedPrevHash ? { expectedPrevHash: opts.expectedPrevHash } : {}),
    })
    if (result.status === 'ok' && Object.keys(layoutPatch).length > 0) {
      const keyed = keyedLayoutPatch(layoutPatch, stored.state?.sourceMap ?? [], stored.file)
      await writeAuthoringLayout(projectDir, keyed, result.newHash)
      const afterSnapshot = await captureAuthoringSourceSnapshot(projectDir, stored.file)
      if (!opts?.ephemeral) {
        await recordAuthoringTransaction(projectDir, beforeSnapshot, afterSnapshot, opts?.label ?? 'Update Scene layout')
      }
    }
    return { status: result.status === 'ok' ? 200 : 422, body: result }
  }

  const paramOnly = semanticOps.every((op) => op.type === 'updateNode' && op.params && op.position === undefined)
  if (opts?.ephemeral && paramOnly) {
    const result = await applyBatch(await getRuntimeForProject(projectId), ops, {
      actor: opts.actor ?? 'ui',
      ...(opts.label ? { label: opts.label } : {}),
      ...(opts.batchId ? { batchId: opts.batchId } : {}),
      ephemeral: true,
      ...(opts.expectedPrevHash ? { expectedPrevHash: opts.expectedPrevHash } : {}),
    })
    return { status: result.status === 'ok' ? 200 : 422, body: result }
  }

  const runtimeLanes = semanticOps.filter((op) => classifyWriteLane(op, liveNodes, opts?.ephemeral) === 'runtime')
  const authoringOps = semanticOps.filter((op) => classifyWriteLane(op, liveNodes, opts?.ephemeral) === 'authoring')
  if (authoringOps.length === 0) {
    const result = await applyBatch(await getRuntimeForProject(projectId), [...runtimeLanes, ...ops.filter((op) => op.type === 'updateNode' && op.position)], {
      actor: opts?.actor ?? 'ui',
      ...(opts?.label ? { label: opts.label } : {}),
      ephemeral: true,
    })
    return { status: result.status === 'ok' ? 200 : 422, body: result }
  }

  const registry = await getSceneContractRegistry()
  const sites = inspectSceneSource(stored.source, stored.file)
  const bindings = new Set(sites.map((site) => site.binding).filter((item): item is string => Boolean(item)))
  const edits: SourceEdit[] = []

  for (const op of authoringOps) {
    if (op.type === 'createGroup' || op.type === 'ungroup' || op.type === 'updateGroup') {
      return {
        status: 422,
        body: {
          status: 'rejected',
          code: 'scene-authoring-no-group-compile',
          reason: 'Grouping is another .scene.ts import, not a compile-time defineGroup.',
        },
      }
    }
    if (op.type === 'createNode') {
      const contract = resolveAtomicContract(registry, op.opId, op.params)
      if (!contract && !PRIMITIVE_OP_IDS.has(op.opId)) {
        return {
          status: 422,
          body: { status: 'rejected', code: 'scene-authoring-no-reverse-contract', reason: `No Scene function maps to op '${op.opId}'.` },
        }
      }
      const id = op.nodeId
      if (isPrimitiveOpId(op.opId)) {
        const binding = uniqueBinding(
          op.opId === 'number_const' ? 'n'
            : op.opId === 'text_panel' ? 'text'
              : op.opId === 'json_panel' ? 'rec'
                : 'flag',
          bindings,
        )
        bindings.add(binding)
        edits.push({ type: 'insertLiteral', id, binding, value: primitiveValueFromParams(op.opId, op.params) })
        continue
      }
      const binding = contract!.opId === 'scene_output' ? undefined : uniqueBinding(contract!.functionName, bindings)
      if (binding) bindings.add(binding)
      const args = Object.fromEntries(
        Object.entries(op.params ?? {}).filter(([key]) => !key.startsWith('__')),
      )
      edits.push({
        type: 'insertCall',
        functionName: contract!.functionName,
        id,
        ...(binding ? { binding } : {}),
        args,
      })
      continue
    }
    if (op.type === 'deleteNode') {
      edits.push({ type: 'removeCall', id: op.nodeId })
      continue
    }
    if (op.type === 'updateNode' && op.params) {
      if (isPrimitiveOpId(liveNodes && !Array.isArray(liveNodes) ? liveNodes[op.nodeId]?.opId : undefined)) {
        const value = primitiveValueFromUpdate(op.params)
        if (value !== undefined) {
          const helper = sourceEntryFor(stored.state?.sourceMap ?? [], op.nodeId)
          if (helper?.argument) {
            edits.push({ type: 'updateLiteral', id: helper.statementId, path: [helper.argument], value })
          } else {
            edits.push({ type: 'updateLiteral', id: op.nodeId, value })
          }
        }
        continue
      }
      for (const [key, value] of Object.entries(op.params)) {
        if (key.startsWith('__')) continue
        if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
          edits.push({ type: 'updateLiteral', id: op.nodeId, path: [key], value })
        } else if (value !== null && typeof value === 'object') {
          edits.push({ type: 'updateLiteral', id: op.nodeId, path: [key], value })
        }
      }
      continue
    }
    if (op.type === 'connect') {
      const source = findSceneSite(stored.source, stored.file, op.source.nodeId)
      if (!source?.binding) {
        return {
          status: 422,
          body: { status: 'rejected', code: 'scene-authoring-entity-not-found', reason: `No binding for '${op.source.nodeId}'.` },
        }
      }
      const target = liveNodeOf(liveNodes, op.target.nodeId)
      const contract = target ? resolveAtomicContract(registry, target.opId, target.params) : undefined
      const access = contract?.inputs.find((item) => item.name === op.target.port)?.access
      edits.push({
        type: 'connectBinding',
        id: op.target.nodeId,
        arg: op.target.port,
        binding: source.binding,
        output: op.source.port,
        ...(access === 'list' || access === 'tree' ? { list: true } : {}),
      })
      continue
    }
    if (op.type === 'disconnect' || op.type === 'deleteEdge') {
      const edges = before?.edges
      const edge = edges
        ? (Array.isArray(edges) ? edges.find((item) => item.id === op.edgeId) : edges[op.edgeId])
        : undefined
      if (edge?.target.nodeId && edge.target.port) {
        const source = findSceneSite(stored.source, stored.file, edge.source.nodeId)
        edits.push({
          type: 'disconnectArg',
          id: edge.target.nodeId,
          arg: edge.target.port,
          unset: true,
          ...(source?.binding ? { binding: source.binding, output: edge.source.port } : {}),
        })
      }
    }
  }

  const written = applySceneSourceEdits(stored.source, edits, stored.file)
  if (written.diagnostics.some((item) => item.severity === 'error')) {
    return { status: 422, body: { status: 'rejected', diagnostics: written.diagnostics } }
  }
  const writes = [{ file: stored.file, source: written.source }]
  const keyedPatch = keyedLayoutPatch(layoutPatch, stored.state?.sourceMap ?? [], stored.file)
  try {
    await writeSceneProjectTransaction(
      projectDir,
      stored.file,
      writes,
      stored.state?.sourceMap ?? [],
      undefined,
      stored.state?.dependencyGraph,
      { ...(await readAuthoringLayout(projectDir)), ...keyedPatch },
    )
    const ran = await runSceneProject({
      projectId,
      projectDir,
      runtime: await getRuntimeForProject(projectId),
      entryFile: stored.file,
      sourceOverrides: { [stored.file]: written.source },
      actor: 'scene-script:user',
      label: opts?.label ?? 'Canvas Scene Script edit',
    })
    const sourceCalls = inspectSceneSource(written.source, stored.file).filter((site) => site.kind === 'call').length
    if (ran.diagnostics.some((item) => item.severity === 'error') && ran.trace.length === 0 && sourceCalls > 0) {
      await restoreAuthoringSourceSnapshot(projectId, projectDir, beforeSnapshot, {
        actor: 'scene-script:rollback',
        label: 'Rollback failed canvas Scene Script edit',
      })
      return { status: 422, body: { status: 'rejected', diagnostics: ran.diagnostics } }
    }
    const afterSnapshot = await captureAuthoringSourceSnapshot(projectDir, stored.file)
    if (!opts?.ephemeral) {
      await recordAuthoringTransaction(projectDir, beforeSnapshot, afterSnapshot, opts?.label ?? 'Canvas Scene Script edit')
    }
    if (Object.keys(keyedPatch).length) {
      await writeAuthoringLayout(projectDir, keyedPatch)
    }
    return {
      status: 200,
      body: {
        status: 'ok',
        newHash: ran.result.entryFile,
        diagnostics: toPublicSceneDiagnostics(collectSceneExecutionDiagnostics(
          ran.execution,
          ran.sourceMap,
          [],
          ran.diagnostics,
        )),
      },
    }
  } catch (error) {
    await restoreAuthoringSourceSnapshot(projectId, projectDir, beforeSnapshot, {
      actor: 'scene-script:rollback',
      label: 'Rollback failed canvas Scene Script edit',
    })
    throw error
  }
}
