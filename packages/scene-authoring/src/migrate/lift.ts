import type { GraphEdge, KernelGraphV1, NodeGroup } from '@forgeax/node-runtime'

import { compileSceneModule } from '../compile/compiler.js'
import { compiledOpsToKernelGraph } from '../compile/projector.js'
import { resolveAtomicContract } from '../contracts/contracts.js'
import { stableEntityId, stableHash } from '../model/identity.js'
import { printSceneModule } from '../language/printer.js'
import type {
  ContractRegistry,
  NodeFunctionContract,
  RawTemplateGroup,
  SceneCallStatement,
  SceneExpression,
  SceneModuleAst,
} from '../model/types.js'

export type LiftConfidence = 'high' | 'medium' | 'low'

export interface LiftDiagnostic {
  entityId: string
  entityKind: 'node' | 'group' | 'edge' | 'project'
  confidence: LiftConfidence
  code: string
  message: string
  requiresConfirmation: boolean
}

export interface LegacyGraphLiftOptions {
  projectId: string
  moduleId?: string
  file?: string
  /** Execute both graphs and return a stable, payload-bounded result hash. */
  execute?: (graph: KernelGraphV1) => Promise<{ resultHash: string }>
}

export interface LegacyGraphLiftResult {
  status: 'canonical' | 'confirmation-required' | 'read-only'
  canonical: boolean
  readOnly: boolean
  source?: string
  module?: SceneModuleAst
  diagnostics: LiftDiagnostic[]
  confidence: LiftConfidence
  semanticParity: {
    legacyGraphHash: string
    liftedGraphHash?: string
    graphEquivalent: boolean
    legacyResultHash?: string
    liftedResultHash?: string
    resultEquivalent?: boolean
  }
  /** Escape hatch for an ambiguous migration. It is never accepted as a new authoring source. */
  rawGraph?: KernelGraphV1
}

function graphValues<T>(value: readonly T[] | Record<string, T> | undefined): T[] {
  if (!value) return []
  return Array.isArray(value) ? value : Object.values(value)
}

function groupTree(groups: readonly NodeGroup[]): NodeGroup[] {
  const result: NodeGroup[] = []
  const visit = (group: NodeGroup): void => {
    result.push(group)
    for (const nested of group._nestedGroups ?? []) visit(nested)
  }
  for (const group of groups) visit(group)
  return result
}

function normalizedParams(params: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(params)
    .filter(([key]) => !key.startsWith('__') && key !== 'groupId')
    .sort(([left], [right]) => left.localeCompare(right)))
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

/** Runtime semantic hash deliberately excludes ids, names, positions, and layout. */
export function runtimeGraphSemanticHash(graph: KernelGraphV1): string {
  const nodes = graphValues(graph.nodes)
  const groups = groupTree(graphValues(graph.groups))
  const nodeKey = new Map(nodes.map((node) => [
    node.id,
    `${node.opId}:${stableStringify(normalizedParams(node.params ?? {}))}`,
  ]))
  for (const group of groups) {
    nodeKey.set(group.id, `group:${topologySignature(group)}`)
  }
  const nodeShapes = [...nodeKey.values()].sort()
  const edgeShapes = graphValues(graph.edges).map((edge) =>
    `${nodeKey.get(edge.source.nodeId) ?? edge.source.nodeId}.${edge.source.port}->`
      + `${nodeKey.get(edge.target.nodeId) ?? edge.target.nodeId}.${edge.target.port}`,
  ).sort()
  return stableHash(stableStringify({ nodes: nodeShapes, edges: edgeShapes }))
}

function rawGroupTree(root: RawTemplateGroup): RawTemplateGroup[] {
  const result: RawTemplateGroup[] = []
  const visit = (group: RawTemplateGroup): void => {
    result.push(group)
    for (const nested of group._nestedGroups ?? []) visit(nested)
  }
  visit(root)
  return result
}

function signatureParts(
  nodes: ReadonlyArray<{ id: string; opId: string }>,
  edges: ReadonlyArray<{ source: { nodeId: string; port: string }; target: { nodeId: string; port: string } }>,
): string {
  const opById = new Map(nodes.map((node) => [node.id, node.opId]))
  const ops = nodes.filter((node) => node.opId !== '__group__').map((node) => node.opId).sort()
  const links = edges.map((edge) =>
    `${opById.get(edge.source.nodeId) ?? '__group__'}.${edge.source.port}->`
      + `${opById.get(edge.target.nodeId) ?? '__group__'}.${edge.target.port}`,
  ).sort()
  return stableHash(stableStringify({ ops, links }))
}

export function topologySignature(group: NodeGroup | RawTemplateGroup): string {
  const tree = '_nestedGroups' in group
    ? ('nodes' in group && Array.isArray(group.nodes) && group.nodes.some((node) => 'params' in node)
      ? groupTree([group as NodeGroup])
      : rawGroupTree(group as RawTemplateGroup))
    : [group]
  const nodes = tree.flatMap((item) => item.nodes ?? [])
  const edges = tree.flatMap((item) => item.edges ?? [])
  return signatureParts(nodes, edges)
}

function uniqueBinding(contract: NodeFunctionContract, used: Set<string>): string {
  const base = contract.functionName.replace(/[^A-Za-z0-9_$]/g, '') || 'node'
  let candidate = /^[A-Za-z_$]/.test(base) ? base : `node${base}`
  let suffix = 2
  while (used.has(candidate)) candidate = `${base}${suffix++}`
  used.add(candidate)
  return candidate
}

function literal(value: unknown): SceneExpression | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return { kind: 'literal', value }
  }
  if (Array.isArray(value)) {
    const items = value.map(literal)
    return items.every(Boolean) ? { kind: 'array', items: items as SceneExpression[] } : undefined
  }
  if (value && typeof value === 'object') {
    const properties = Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
      const expression = literal(item)
      return expression ? [[key, expression]] : []
    }))
    return Object.keys(properties).length === Object.keys(value).length
      ? { kind: 'object', properties }
      : undefined
  }
  return undefined
}

function semanticPort(
  contract: NodeFunctionContract,
  direction: 'input' | 'output',
  runtimePort: string,
): string | undefined {
  const ports = direction === 'input' ? contract.inputs : contract.outputs
  const exact = ports.filter((port) => port.name === runtimePort || (port.runtimePort ?? port.name) === runtimePort)
  if (exact.length === 1) return exact[0].name
  const dynamicBase = runtimePort.replace(/_\d+$/, '')
  const dynamic = ports.filter((port) => (port.runtimePort ?? port.name) === dynamicBase)
  return dynamic.length === 1 ? dynamic[0].name : undefined
}

function confidenceRank(value: LiftConfidence): number {
  return value === 'high' ? 2 : value === 'medium' ? 1 : 0
}

export async function liftLegacyRuntimeGraph(
  graph: KernelGraphV1,
  registry: ContractRegistry,
  options: LegacyGraphLiftOptions,
): Promise<LegacyGraphLiftResult> {
  const diagnostics: LiftDiagnostic[] = []
  const nodes = graphValues(graph.nodes)
  const edges = graphValues(graph.edges)
  const groups = graphValues(graph.groups)
  const allGroups = groupTree(groups)
  const contracts = registry.list()
  const entityContracts = new Map<string, NodeFunctionContract>()
  const groupMembers = new Set(allGroups.flatMap((group) => group.nodes.map((node) => node.id)))
  const rootGroupIds = new Set(groups.map((group) => group.id))

  for (const group of groups) {
    const shadow = nodes.find((node) => node.id === group.id || (
      node.opId === '__group__' && String(node.params?.groupId ?? '') === group.id))
    const definitionId = String(shadow?.params?.__sceneScriptDefinitionId ?? '')
    const definitionVersion = String(shadow?.params?.__sceneScriptDefinitionVersion ?? '')
    const byIdentity = contracts.filter((contract) =>
      contract.kind !== 'atomic'
      && contract.definitionId === definitionId
      && (!definitionVersion || contract.definitionVersion === definitionVersion))
    const signature = topologySignature(group)
    const byTopology = contracts.filter((contract) =>
      contract.kind !== 'atomic' && contract.definition && topologySignature(contract.definition) === signature)
    const matches = byIdentity.length ? byIdentity : byTopology
    if (matches.length === 1) {
      entityContracts.set(group.id, matches[0])
      diagnostics.push({
        entityId: group.id,
        entityKind: 'group',
        confidence: byIdentity.length ? 'high' : 'medium',
        code: byIdentity.length ? 'LIFT_GROUP_IDENTITY_MATCH' : 'LIFT_GROUP_TOPOLOGY_MATCH',
        message: byIdentity.length
          ? `Matched ${matches[0].definitionId}@${matches[0].definitionVersion ?? 'unversioned'}.`
          : `Matched ${matches[0].definitionId} by topology signature ${signature}.`,
        requiresConfirmation: false,
      })
    } else {
      diagnostics.push({
        entityId: group.id,
        entityKind: 'group',
        confidence: 'low',
        code: matches.length ? 'LIFT_GROUP_AMBIGUOUS' : 'LIFT_GROUP_UNKNOWN',
        message: matches.length
          ? `Topology matches ${matches.length} Definitions; identity/version is required.`
          : `No Definition matches topology signature ${signature}.`,
        requiresConfirmation: true,
      })
    }
  }

  for (const node of nodes) {
    if (node.opId === '__group__' || groupMembers.has(node.id) || rootGroupIds.has(node.id)) continue
    const contract = resolveAtomicContract(registry, node.opId, node.params)
    if (contract) {
      entityContracts.set(node.id, contract)
      diagnostics.push({
        entityId: node.id,
        entityKind: 'node',
        confidence: 'high',
        code: 'LIFT_ATOMIC_UNIQUE',
        message: `Mapped runtime op '${node.opId}' to '${contract.functionName}'.`,
        requiresConfirmation: false,
      })
    } else {
      diagnostics.push({
        entityId: node.id,
        entityKind: 'node',
        confidence: 'low',
        code: 'LIFT_ATOMIC_AMBIGUOUS',
        message: `Runtime op '${node.opId}' has no unique Scene Contract.`,
        requiresConfirmation: true,
      })
    }
  }

  const usedBindings = new Set<string>()
  const bindingByEntity = new Map<string, string>()
  const statements: SceneCallStatement[] = []
  const topEntities = [
    ...groups.filter((group) => entityContracts.has(group.id)).map((group) => ({ id: group.id, params: {} })),
    ...nodes.filter((node) => entityContracts.has(node.id) && node.opId !== '__group__' && !groupMembers.has(node.id)),
  ]
  const incoming = new Map<string, GraphEdge[]>()
  for (const edge of edges) (incoming.get(edge.target.nodeId) ?? incoming.set(edge.target.nodeId, []).get(edge.target.nodeId)!).push(edge)
  for (const entity of topEntities) {
    const contract = entityContracts.get(entity.id)!
    const binding = uniqueBinding(contract, usedBindings)
    bindingByEntity.set(entity.id, binding)
    const args: Record<string, SceneExpression> = {}
    for (const input of contract.inputs) {
      const matches = (incoming.get(entity.id) ?? []).filter((edge) =>
        semanticPort(contract, 'input', edge.target.port) === input.name)
      if (matches.length) {
        const references = matches.flatMap((edge) => {
          const sourceContract = entityContracts.get(edge.source.nodeId)
          const sourceBinding = bindingByEntity.get(edge.source.nodeId)
          const output = sourceContract && semanticPort(sourceContract, 'output', edge.source.port)
          if (!sourceContract || !sourceBinding || !output) {
            diagnostics.push({
              entityId: edge.id,
              entityKind: 'edge',
              confidence: 'low',
              code: 'LIFT_EDGE_SEMANTIC_PORT',
              message: `Cannot map ${edge.source.port} -> ${edge.target.port} to semantic ports.`,
              requiresConfirmation: true,
            })
            return []
          }
          return [{ kind: 'reference', binding: sourceBinding, output } satisfies SceneExpression]
        })
        if (references.length === 1) args[input.name] = references[0]
        else if (references.length > 1) args[input.name] = { kind: 'array', items: references }
        continue
      }
      const value = (entity.params as Record<string, unknown>)[input.runtimePort ?? input.name]
        ?? (entity.params as Record<string, unknown>)[input.name]
      const expression = value === undefined ? undefined : literal(value)
      if (expression) args[input.name] = expression
      else if (input.required && input.defaultValue === undefined) {
        diagnostics.push({
          entityId: entity.id,
          entityKind: contract.kind === 'atomic' ? 'node' : 'group',
          confidence: 'low',
          code: 'LIFT_REQUIRED_INPUT',
          message: `Required input '${contract.functionName}.${input.name}' cannot be recovered.`,
          requiresConfirmation: true,
        })
      }
    }
    const statementId = stableEntityId('stmt', `${options.projectId}:${entity.id}`)
    statements.push({
      kind: 'call',
      statementId,
      binding,
      functionName: contract.functionName,
      args,
      contractKind: contract.kind,
      source: { file: options.file ?? 'main.scene.ts', start: 0, end: 0, line: 1, column: 1, statementId },
    })
  }

  const low = diagnostics.some((item) => item.confidence === 'low')
  const legacyGraphHash = runtimeGraphSemanticHash(graph)
  if (low) {
    return {
      status: topEntities.length ? 'confirmation-required' : 'read-only',
      canonical: false,
      readOnly: true,
      diagnostics,
      confidence: 'low',
      semanticParity: { legacyGraphHash, graphEquivalent: false },
      rawGraph: graph,
    }
  }
  const module: SceneModuleAst = {
    moduleId: options.moduleId ?? stableEntityId('module', options.projectId),
    file: options.file ?? 'main.scene.ts',
    imports: [],
    exports: [],
    definitions: [],
    statements,
  }
  const compiled = compileSceneModule(module, registry)
  if (compiled.diagnostics.some((item) => item.severity === 'error')) {
    return {
      status: 'read-only',
      canonical: false,
      readOnly: true,
      diagnostics: [
        ...diagnostics,
        ...compiled.diagnostics.map((item) => ({
          entityId: item.statementId ?? module.moduleId,
          entityKind: 'project' as const,
          confidence: 'low' as const,
          code: item.code,
          message: item.message,
          requiresConfirmation: true,
        })),
      ],
      confidence: 'low',
      semanticParity: { legacyGraphHash, graphEquivalent: false },
      rawGraph: graph,
    }
  }
  const liftedGraph = compiledOpsToKernelGraph(compiled.ops)
  const liftedGraphHash = runtimeGraphSemanticHash(liftedGraph)
  const graphEquivalent = legacyGraphHash === liftedGraphHash
  let resultParity: Pick<LegacyGraphLiftResult['semanticParity'], 'legacyResultHash' | 'liftedResultHash' | 'resultEquivalent'> = {}
  if (options.execute) {
    const [legacy, lifted] = await Promise.all([options.execute(graph), options.execute(liftedGraph)])
    resultParity = {
      legacyResultHash: legacy.resultHash,
      liftedResultHash: lifted.resultHash,
      resultEquivalent: legacy.resultHash === lifted.resultHash,
    }
  }
  const parityFailed = !graphEquivalent || resultParity.resultEquivalent === false
  if (parityFailed) {
    diagnostics.push({
      entityId: module.moduleId,
      entityKind: 'project',
      confidence: 'low',
      code: 'LIFT_SEMANTIC_PARITY_FAILED',
      message: 'Lifted Scene Project does not match the legacy graph/result semantic hash.',
      requiresConfirmation: true,
    })
  }
  const confidence = diagnostics.reduce<LiftConfidence>(
    (value, item) => confidenceRank(item.confidence) < confidenceRank(value) ? item.confidence : value,
    'high',
  )
  return {
    status: parityFailed ? 'confirmation-required' : 'canonical',
    canonical: !parityFailed,
    readOnly: parityFailed,
    source: parityFailed ? undefined : printSceneModule(module),
    module: parityFailed ? undefined : module,
    diagnostics,
    confidence: parityFailed ? 'low' : confidence,
    semanticParity: { legacyGraphHash, liftedGraphHash, graphEquivalent, ...resultParity },
    ...(parityFailed ? { rawGraph: graph } : {}),
  }
}
