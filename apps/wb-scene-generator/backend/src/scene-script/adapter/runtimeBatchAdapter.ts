import type { FastifyRequest } from 'fastify'

import {
  applyAuthoringCommands,
  applyProjectAuthoringCommands,
  compiledOpsToKernelGraph,
  expressionFromJson,
  parseSceneModule,
  printSceneModule,
  resolveAtomicContract,
  type AuthoringCommand,
  type SceneExpression,
} from '@forgeax/scene-authoring'
import { applyBatch, getPipeline, importPipelineGraph, type KernelGraphV1, type Op } from '@forgeax/node-runtime'

import { getProjectDir, getRuntimeForProject } from '../../runtime.js'
import { extractCaller } from '../../routes/projects.js'
import { getSceneContractRegistry } from '../contracts/contracts.js'
import { compileStoredSceneProject, resolveSceneImport } from '../compile/projectCompiler.js'
import {
  layoutKey,
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

interface BatchOptions {
  actor?: string
  label?: string
  batchId?: string
  ephemeral?: boolean
  expectedPrevHash?: string
}

function runtimePort(contract: { name: string; runtimePort?: string }): string {
  return contract.runtimePort ?? contract.name
}

function expressionReferences(expression: SceneExpression, binding: string): boolean {
  if (expression.kind === 'reference') return expression.binding === binding
  if (expression.kind === 'array') return expression.items.some((item) => expressionReferences(item, binding))
  if (expression.kind === 'object') return Object.values(expression.properties).some((item) => expressionReferences(item, binding))
  return false
}

function uniqueBinding(base: string, bindings: Set<string>): string {
  const normalized = base.replace(/[^A-Za-z0-9_$]/g, '') || 'node'
  const first = /^[A-Za-z_$]/.test(normalized) ? normalized : `node${normalized}`
  if (!bindings.has(first)) return first
  let suffix = 2
  while (bindings.has(`${first}${suffix}`)) suffix += 1
  return `${first}${suffix}`
}

function paramsToExpressions(params: Record<string, unknown> | undefined): Record<string, SceneExpression> {
  return Object.fromEntries(Object.entries(params ?? {}).map(([key, value]) => [key, expressionFromJson(value)]))
}

function publicNodeFor(
  nodeId: string,
  sourceMap: NonNullable<Awaited<ReturnType<typeof readSceneModule>>['state']>['sourceMap'],
): string | undefined {
  return sourceMap.find((entry) => entry.entityId === nodeId)?.statementId
}

function sourceEntryFor(
  nodeId: string,
  sourceMap: NonNullable<Awaited<ReturnType<typeof readSceneModule>>['state']>['sourceMap'],
) {
  return sourceMap.find((entry) => entry.entityId === nodeId || entry.runtimeNodeIds.includes(nodeId))
}

function applyStoredLayout(
  graph: KernelGraphV1,
  layout: Record<string, { x: number; y: number }>,
  sourceMap: Array<{ moduleId: string; statementId: string; entityId: string; runtimeNodeIds: string[] }>,
): KernelGraphV1 {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : Object.values(graph.nodes)
  for (const node of nodes) {
    const entry = sourceMap.find((item) => item.entityId === node.id || item.runtimeNodeIds.includes(node.id))
    const position = (entry ? layout[layoutKey(entry.moduleId, entry.statementId)] : undefined) ?? layout[node.id]
    if (position) node.position = { ...position }
  }
  return graph
}

/**
 * Canvas-minted createNode ids do not survive Scene Script compile. Stamp the
 * drop (or createGroup) position onto each newly compiled public statement so
 * graph:applied does not teleport the battery to {0,0}.
 */
export function assignCreatedNodeLayouts(input: {
  previousSourceMap: ReadonlyArray<{ statementId: string }>
  compiledSourceMap: ReadonlyArray<{
    statementId: string
    moduleId: string
    entityId: string
    runtimeNodeIds: string[]
  }>
  compiledNodes: ReadonlyArray<{ id: string; opId: string }>
  created: ReadonlyArray<{ opId: string; position: { x: number; y: number } }>
  layout: Record<string, { x: number; y: number }>
}): void {
  if (input.created.length === 0) return
  const previousIds = new Set(input.previousSourceMap.map((entry) => entry.statementId))
  const unused = [...input.created]
  for (const entry of input.compiledSourceMap) {
    if (previousIds.has(entry.statementId) || unused.length === 0) continue
    const node = input.compiledNodes.find(
      (item) => item.id === entry.entityId || entry.runtimeNodeIds.includes(item.id),
    )
    if (!node) continue
    const index = unused.findIndex((item) => item.opId === node.opId)
    if (index < 0) continue
    const { position } = unused.splice(index, 1)[0]!
    input.layout[layoutKey(entry.moduleId, entry.statementId)] = position
  }
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
  const stored = await readSceneModule(projectDir)
  if (!stored.source.trim() || !stored.state) {
    return {
      status: 409,
      body: {
        status: 'rejected',
        code: 'scene-lift-required',
        reason: 'Legacy Runtime Graph projects are read-only. Explicitly lift the graph to a canonical Scene Project before editing.',
      },
    }
  }
  const beforeSnapshot = await captureAuthoringSourceSnapshot(projectDir, stored.file)

  const ops = rawOps as Op[]
  const semanticOps = ops.filter(
    (op) => !(op.type === 'updateNode' && op.position !== undefined && op.params === undefined && op.name === undefined)
      && !(op.type === 'updateGroup'
        && op.position !== undefined
        && op.name === undefined
        && op.nameEn === undefined
        && op.exposedPorts === undefined
        && op.exposedWiring === undefined
        && op.nodes === undefined
        && op.edges === undefined
        && op.innerLayout === undefined)
      && op.type !== 'setMetadata',
  )
  const layoutPatch: Record<string, { x: number; y: number }> = {}
  const createdLayouts: Array<{ opId: string; position: { x: number; y: number } }> = []
  for (const op of ops) {
    if (op.type === 'updateNode' && op.position) layoutPatch[op.nodeId] = op.position
    if (op.type === 'updateGroup' && op.position) layoutPatch[op.groupId] = op.position
    if (op.type === 'createNode' && op.position) {
      layoutPatch[op.nodeId] = op.position
      createdLayouts.push({ opId: op.opId, position: op.position })
    }
    if (op.type === 'createGroup' && op.position) {
      layoutPatch[op.groupId] = op.position
      createdLayouts.push({ opId: '__group__', position: op.position })
    }
  }
  if (semanticOps.length === 0) {
    const result = await applyBatch(await getRuntimeForProject(projectId), ops, {
      actor: opts?.actor ?? 'ui',
      ...(opts?.label ? { label: opts.label } : {}),
      ...(opts?.batchId ? { batchId: opts.batchId } : {}),
      ...(opts?.ephemeral !== undefined ? { ephemeral: opts.ephemeral } : {}),
      ...(opts?.expectedPrevHash ? { expectedPrevHash: opts.expectedPrevHash } : {}),
    })
    if (result.status === 'ok') {
      const keyedLayout = Object.fromEntries(Object.entries(layoutPatch).map(([runtimeId, position]) => {
        const entry = sourceEntryFor(runtimeId, stored.state!.sourceMap)
        return [entry ? layoutKey(entry.moduleId, entry.statementId) : runtimeId, position]
      }))
      try {
        await writeAuthoringLayout(projectDir, keyedLayout, result.newHash)
        const afterSnapshot = await captureAuthoringSourceSnapshot(projectDir, stored.file)
        if (!opts?.ephemeral) {
          await recordAuthoringTransaction(
            projectDir,
            beforeSnapshot,
            afterSnapshot,
            opts?.label ?? 'Update Scene layout',
          )
        }
      } catch (error) {
        await restoreAuthoringSourceSnapshot(projectId, projectDir, beforeSnapshot, {
          actor: 'scene-script:rollback',
          label: 'Rollback failed Scene layout transaction',
        })
        throw error
      }
    }
    return { status: result.status === 'ok' ? 200 : 422, body: result }
  }

  const baseRegistry = await getSceneContractRegistry()
  const currentProject = await compileStoredSceneProject(projectDir, {
    entryFile: stored.file,
    entrySource: stored.source,
    projectId,
    registry: baseRegistry,
  })
  const registry = currentProject.registry
  const commands: AuthoringCommand[] = []
  const allStatements = Object.values(currentProject.modules).flatMap((module) => module.statements)
  const bindings = new Set(allStatements.flatMap((statement) => statement.binding ? [statement.binding] : []))
  const before = getPipeline(await getRuntimeForProject(projectId))
  const edgeById = before?.edges ?? {}
  const statementById = new Map(allStatements.map((statement) => [statement.statementId, statement]))
  const sourceMap = stored.state.sourceMap
  const groupCreates = semanticOps.filter((op): op is Extract<Op, { type: 'createGroup' }> => op.type === 'createGroup')
  for (const op of groupCreates) {
    const entries = op.memberNodeIds.map((nodeId) => sourceEntryFor(nodeId, sourceMap))
    if (entries.some((entry) => !entry) || new Set(entries.map((entry) => entry?.moduleId)).size !== 1) {
      return {
        status: 422,
        body: {
          status: 'rejected',
          code: 'scene-authoring-selection-not-closed',
          reason: 'Group selection must contain public Authoring Entities from one Scene module.',
        },
      }
    }
    commands.push({
      type: 'wrapInGroup',
      moduleId: entries[0]?.moduleId,
      statementIds: [...new Set(entries.map((entry) => entry!.statementId))],
      meta: {
        name: op.name?.replace(/[^A-Za-z0-9_$]/g, '') || 'ExtractedGroup',
        file: `groups/${(op.name || 'extracted-group').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}.scene.ts`,
        seal: true,
        confirmed: false,
      },
    })
  }
  const groupUpdates = semanticOps.filter((op): op is Extract<Op, { type: 'updateGroup' }> => op.type === 'updateGroup')
  if (groupUpdates.length > 0) {
    return {
      status: 422,
      body: {
        status: 'rejected',
        code: 'scene-authoring-sealed-internal',
        reason: 'Definition internals are sealed. Configure the public Group instance or use an explicit template-maintainer Definition command.',
      },
    }
  }
  const ungroups = semanticOps.filter((op): op is Extract<Op, { type: 'ungroup' }> => op.type === 'ungroup')
  for (const op of ungroups) {
    const entry = sourceEntryFor(op.groupId, sourceMap)
    if (!entry) {
      return {
        status: 422,
        body: { status: 'rejected', code: 'scene-authoring-entity-not-found', reason: `Group '${op.groupId}' has no Authoring Entity.` },
      }
    }
    commands.push({ type: 'ungroup', moduleId: entry.moduleId, statementId: entry.statementId, strategy: 'current-instance' })
  }

  for (const op of semanticOps) {
    if (op.type === 'createNode') {
      const contract = resolveAtomicContract(registry, op.opId, op.params)
      if (!contract) {
        return {
          status: 422,
          body: { status: 'rejected', code: 'scene-authoring-no-reverse-contract', reason: `No Scene function maps to op '${op.opId}'.` },
        }
      }
      const binding = contract.opId === 'scene_output' ? undefined : uniqueBinding(contract.functionName, bindings)
      if (binding) bindings.add(binding)
      commands.push({
        type: 'addCall',
        functionName: contract.functionName,
        ...(binding ? { binding } : {}),
        args: paramsToExpressions(op.params),
      })
      continue
    }
    if (op.type === 'updateNode') {
      const entry = sourceEntryFor(op.nodeId, sourceMap)
      const statementId = entry?.statementId
      if (!statementId) {
        return {
          status: 422,
          body: { status: 'rejected', code: 'scene-authoring-sealed-internal', reason: `Node '${op.nodeId}' is inside a sealed Authoring Entity.` },
        }
      }
      if (op.params) commands.push({
        type: 'updateArguments',
        moduleId: entry?.moduleId,
        statementId,
        set: paramsToExpressions(op.params),
      })
      continue
    }
    if (op.type === 'connect') {
      const sourceStatementId = publicNodeFor(op.source.nodeId, sourceMap)
      const targetStatementId = publicNodeFor(op.target.nodeId, sourceMap)
      const targetEntry = sourceEntryFor(op.target.nodeId, sourceMap)
      const sourceStatement = sourceStatementId ? statementById.get(sourceStatementId) : undefined
      const targetStatement = targetStatementId ? statementById.get(targetStatementId) : undefined
      const sourceContract = sourceStatement ? registry.get(sourceStatement.functionName) : undefined
      const targetContract = targetStatement ? registry.get(targetStatement.functionName) : undefined
      const output = sourceContract?.outputs.find((port) => runtimePort(port) === op.source.port)
      const input = targetContract?.inputs.find((port) => runtimePort(port) === op.target.port)
      if (!sourceStatementId || !targetStatementId || !output || !input) {
        return {
          status: 422,
          body: { status: 'rejected', code: 'scene-authoring-port-not-public', reason: 'Connection does not address two public Authoring Entity ports.' },
        }
      }
      commands.push({
        type: 'connectValue',
        moduleId: targetEntry?.moduleId,
        statementId: targetStatementId,
        input: input.name,
        sourceStatementId,
        ...(sourceContract && sourceContract.outputs.length > 1 ? { output: output.name } : {}),
        ...(['list', 'tree'].includes(input.access ?? 'item') ? { append: true } : {}),
      })
      continue
    }
    if (op.type === 'disconnect' || op.type === 'deleteEdge') {
      const edge = edgeById[op.edgeId]
      if (!edge) continue
      const targetStatementId = publicNodeFor(edge.target.nodeId, sourceMap)
      const targetEntry = sourceEntryFor(edge.target.nodeId, sourceMap)
      const target = targetStatementId ? statementById.get(targetStatementId) : undefined
      const contract = target ? registry.get(target.functionName) : undefined
      const input = contract?.inputs.find((port) => runtimePort(port) === edge.target.port)
      const sourceStatementId = publicNodeFor(edge.source.nodeId, sourceMap)
      const source = sourceStatementId ? statementById.get(sourceStatementId) : undefined
      const sourceContract = source ? registry.get(source.functionName) : undefined
      const output = sourceContract?.outputs.find((port) => runtimePort(port) === edge.source.port)
      if (targetStatementId && input) {
        commands.push({
          type: 'disconnectValue',
          moduleId: targetEntry?.moduleId,
          statementId: targetStatementId,
          input: input.name,
          ...(sourceStatementId ? { sourceStatementId } : {}),
          ...(sourceContract && sourceContract.outputs.length > 1 && output ? { output: output.name } : {}),
        })
      }
      continue
    }
    if (op.type === 'deleteNode') {
      const statementId = publicNodeFor(op.nodeId, sourceMap)
      const targetEntry = sourceEntryFor(op.nodeId, sourceMap)
      const target = statementId ? statementById.get(statementId) : undefined
      if (!statementId || !target) continue
      if (target.binding) {
        for (const consumer of allStatements) {
          for (const [input, expression] of Object.entries(consumer.args)) {
            if (expressionReferences(expression, target.binding)) {
              const consumerEntry = sourceMap.find((entry) => entry.statementId === consumer.statementId)
              commands.push({ type: 'disconnectValue', moduleId: consumerEntry?.moduleId, statementId: consumer.statementId, input, sourceStatementId: statementId })
            }
          }
        }
      }
      commands.push({ type: 'removeCall', moduleId: targetEntry?.moduleId, statementId })
      continue
    }
    if (op.type === 'deleteGroup') {
      const statementId = publicNodeFor(op.groupId, sourceMap)
      const targetEntry = sourceEntryFor(op.groupId, sourceMap)
      const target = statementId ? statementById.get(statementId) : undefined
      if (!statementId || !target) continue
      if (target.binding) {
        for (const consumer of allStatements) {
          for (const [input, expression] of Object.entries(consumer.args)) {
            if (expressionReferences(expression, target.binding)) {
              const consumerEntry = sourceMap.find((entry) => entry.statementId === consumer.statementId)
              commands.push({ type: 'disconnectValue', moduleId: consumerEntry?.moduleId, statementId: consumer.statementId, input, sourceStatementId: statementId })
            }
          }
        }
      }
      commands.push({ type: 'removeCall', moduleId: targetEntry?.moduleId, statementId })
      continue
    }
  }

  const routedCommands: AuthoringCommand[] = []
  for (const command of commands) {
    const statementId = 'statementId' in command ? command.statementId : undefined
    const mapped = statementId ? sourceMap.find((entry) => entry.statementId === statementId) : undefined
    const moduleId = command.moduleId ?? mapped?.moduleId ?? currentProject.compiled.module.moduleId
    routedCommands.push({ ...command, moduleId } as AuthoringCommand)
  }
  const fileToModuleId = new Map(Object.values(currentProject.modules).map((module) => [module.file, module.moduleId]))
  const transformed = applyProjectAuthoringCommands(
    { entryModuleId: currentProject.compiled.module.moduleId, modules: currentProject.modules },
    routedCommands,
    {
      actor: 'user',
      registry: currentProject.registry,
      resolveImport: (fromModuleId, specifier) => {
        const fromFile = currentProject.modules[fromModuleId]?.file ?? fromModuleId
        return fileToModuleId.get(resolveSceneImport(fromFile, specifier)) ?? specifier
      },
    },
  )
  if (transformed.confirmations.length > 0) {
    return {
      status: 409,
      body: {
        status: 'confirmation-required',
        code: 'scene-authoring-confirmation-required',
        confirmations: transformed.confirmations,
        transaction: { applied: false, rolledBack: true },
      },
    }
  }
  const writes = transformed.changedModuleIds.map((moduleId) => ({
    file: transformed.project.modules[moduleId].file,
    source: printSceneModule(transformed.project.modules[moduleId]),
  }))
  const overrides = Object.fromEntries(writes.map((write) => [write.file, write.source]))
  const projectCompile = await compileStoredSceneProject(projectDir, {
    entryFile: stored.file,
    entrySource: overrides[stored.file] ?? stored.source,
    sourceOverrides: overrides,
    projectId,
    registry: baseRegistry,
  })
  const compiled = projectCompile.compiled
  const diagnostics = [...transformed.diagnostics, ...projectCompile.diagnostics]
  if (diagnostics.some((item) => item.severity === 'error')) {
    return { status: 422, body: { status: 'rejected', diagnostics } }
  }
  const graph = compiledOpsToKernelGraph(compiled.ops)
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : Object.values(graph.nodes)
  const currentNodes = before?.nodes ?? {}
  const currentLayout = await readAuthoringLayout(projectDir)
  const previousRuntimeGraph = applyStoredLayout(
    compiledOpsToKernelGraph(currentProject.compiled.ops),
    currentLayout,
    currentProject.compiled.sourceMap,
  )
  const semanticLayoutPatch: Record<string, { x: number; y: number }> = {}
  for (const [runtimeId, position] of Object.entries(layoutPatch)) {
    const entry = sourceEntryFor(runtimeId, sourceMap)
    semanticLayoutPatch[entry ? layoutKey(entry.moduleId, entry.statementId) : runtimeId] = position
  }
  const fullLayout = { ...currentLayout, ...semanticLayoutPatch }
  for (const entry of compiled.sourceMap) {
    const previous = sourceMap.find((item) => item.statementId === entry.statementId)
    if (!previous) continue
    const previousKey = layoutKey(previous.moduleId, previous.statementId)
    const position = fullLayout[previousKey]
    if (!position) continue
    delete fullLayout[previousKey]
    fullLayout[layoutKey(entry.moduleId, entry.statementId)] = position
  }
  assignCreatedNodeLayouts({
    previousSourceMap: sourceMap,
    compiledSourceMap: compiled.sourceMap,
    compiledNodes: nodes,
    created: createdLayouts,
    layout: fullLayout,
  })
  for (const node of nodes) {
    const entry = sourceEntryFor(node.id, compiled.sourceMap)
    const position = (entry ? fullLayout[layoutKey(entry.moduleId, entry.statementId)] : undefined)
      ?? fullLayout[node.id]
      ?? currentNodes[node.id]?.position
    if (position) node.position = { ...position }
  }
  const imported = await importPipelineGraph(
    await getRuntimeForProject(projectId),
    { format: 'kernel-graph-v1', graph },
    { mode: 'replace', actor: 'scene-script:user', label: opts?.label ?? 'Project node edit to Scene Script' },
  )
  if (imported.status !== 'ok') return { status: 422, body: imported }
  const dependencyGraph = Object.fromEntries(Object.entries(projectCompile.incremental.modules).map(
    ([moduleId, item]) => [moduleId, {
      dependencies: item.dependencies,
      dependents: item.dependents,
      publicSignatureHash: item.publicSignatureHash,
      semanticHash: item.semanticHash,
    }],
  ))
  let saved
  try {
    saved = await writeSceneProjectTransaction(
      projectDir,
      stored.file,
      writes,
      compiled.sourceMap,
      imported.newHash,
      dependencyGraph,
      fullLayout,
    )
    if (!opts?.ephemeral) {
      const afterSnapshot = await captureAuthoringSourceSnapshot(projectDir, stored.file)
      await recordAuthoringTransaction(
        projectDir,
        beforeSnapshot,
        afterSnapshot,
        opts?.label ?? 'Project node edit to Scene Script',
      )
    }
  } catch (error) {
    await importPipelineGraph(
      await getRuntimeForProject(projectId),
      { format: 'kernel-graph-v1', graph: previousRuntimeGraph },
      { mode: 'replace', actor: 'scene-script:rollback', label: 'Rollback failed Scene Authoring transaction' },
    )
    await restoreAuthoringSourceSnapshot(projectId, projectDir, beforeSnapshot, {
      actor: 'scene-script:rollback',
      label: 'Rollback unrecorded Scene Authoring transaction',
    })
    throw error
  }
  return {
    status: 200,
    body: {
      status: 'ok',
      newHash: imported.newHash,
      sourceRevision: saved.projectRevision,
      projectRevision: saved.projectRevision,
      moduleRevisions: saved.moduleRevisions,
      sourceMap: compiled.sourceMap,
      authoringCommandCount: commands.length,
      incremental: projectCompile.incremental,
    },
  }
}
