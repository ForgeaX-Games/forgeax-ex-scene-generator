import type { Op } from '@forgeax/node-runtime'

import { createSceneDiagnostic } from '../diagnostics/diagnostics.js'
import { stableEntityId } from '../model/identity.js'
import { literalValue, literalValueForAccess } from '../model/literal-datatree.js'
import type {
  NodeFunctionContract,
  PortContract,
  RawTemplateGroup,
  SceneCallStatement,
  SceneDiagnostic,
} from '../model/types.js'

export interface CompiledEntity {
  statement: SceneCallStatement
  contract: NodeFunctionContract
  entityId: string
  runtimeNodeIds: string[]
  runtimeEdgeIds: string[]
  runtimeOrigins?: Record<string, string>
  runtimeEdgeOrigins?: Record<string, string>
}

export function runtimePort(port: PortContract): string {
  return port.runtimePort ?? port.name
}

const COMPILE_HOW_TO_FIX: Record<string, string[]> = {
  SCENE_COMPILE_UNKNOWN_FUNCTION: ['Use a function from the versioned Scene Function Catalog.'],
  SCENE_COMPILE_DEFINITION_SCOPE: ['Call this function only inside defineGroup, or use the public catalog entry instead.'],
  SCENE_COMPILE_GROUP_DEFINITION: ['Ensure the group contract includes a compiled definition before calling it from .scene.ts.'],
  SCENE_COMPILE_PARAMETER_TARGET: ['Point the group parameter at a template node id, or pass the value as a graph input.'],
  SCENE_TYPE_DUPLICATE_BINDING: ['Rename one of the duplicate bindings so each statement id is unique in this module.'],
  SCENE_TYPE_REQUIRED_INPUT: ['Connect the missing required input from an upstream node or a Control parameter.'],
  SCENE_TYPE_EXPECTED_VALUE: ['Pass a typed output from another node or group, not a bare literal.'],
  SCENE_RESOLVE_BINDING: ['Bind this argument to an earlier statement in the same module.'],
  SCENE_TYPE_OUTPUT: ['Select a named output, or use a function that exposes a single output.'],
  SCENE_TYPE_MISMATCH: ['Connect ports of the same type, or convert through a catalog function that produces the expected type.'],
  SCENE_TYPE_PROTOCOL_MISMATCH: ['Connect ports with the same spatial protocol; untyped Any cannot satisfy a typed spatial input.'],
  SCENE_REPEAT_ARGUMENTS: ['Call repeat with exactly { count, initial, step }; wrap extra step inputs in defineGroup.'],
  SCENE_REPEAT_COUNT: ['Use a static integer count from 1 through 16; larger iteration belongs in a project Generator.'],
  SCENE_REPEAT_INITIAL: ['Pass a typed reference to an earlier statement as repeat.initial.'],
  SCENE_REPEAT_STEP: ['Pass a public Scene function identifier as repeat.step, not a closure or expression.'],
  SCENE_REPEAT_STEP_CONTRACT: ['Give the step one state value input, a matching state output, and an optional number index.'],
  SCENE_REPEAT_INDEX_TYPE: ['Declare the optional step index as a number input.'],
  SCENE_REPEAT_STATE_TYPE: ['Keep the step state input and output on the same type and runtimeType.'],
  SCENE_CHOOSE_ARGUMENTS: ['Call choose with exactly { when, then, otherwise }.'],
  SCENE_CHOOSE_REFERENCE: ['Pass typed references for when, then, and otherwise; do not inline literals or closures.'],
  SCENE_CHOOSE_CONDITION: ['Connect choose.when to a booleanValue (or another boolean) output.'],
  SCENE_CHOOSE_BRANCH_TYPE: ['Give then and otherwise the same type, runtimeType, and access.'],
}

const COMPILE_CAUSES: Record<string, string[]> = {
  SCENE_COMPILE_UNKNOWN_FUNCTION: [
    'The identifier is not in the current contract registry.',
    'The import was omitted or the Generator failed to compile.',
  ],
  SCENE_TYPE_REQUIRED_INPUT: [
    'An upstream node was not connected.',
    'A Control parameter was not declared on this port.',
  ],
  SCENE_TYPE_MISMATCH: ['The source output and target input use different Scene types.'],
  SCENE_TYPE_PROTOCOL_MISMATCH: [
    'The source and target declare different runtimeType protocols.',
    'One side is untyped Any while the other requires a spatial protocol.',
  ],
  SCENE_RESOLVE_BINDING: ['The referenced binding was never declared in this module.'],
  SCENE_REPEAT_COUNT: ['repeat.count is missing, not an integer, or larger than the static bound.'],
  SCENE_REPEAT_STEP_CONTRACT: ['The step function exposes extra inputs or does not keep a state in/out pair.'],
  SCENE_CHOOSE_CONDITION: ['choose.when is not a boolean typed reference.'],
  SCENE_CHOOSE_BRANCH_TYPE: ['The two choose branches use different effective protocols.'],
}

export const SCENE_REPEAT_MAX_COUNT = 16

export function compileDiagnostic(
  statement: SceneCallStatement,
  contract: NodeFunctionContract | undefined,
  code: string,
  message: string,
  phase: SceneDiagnostic['phase'] = 'compile',
  details: Pick<SceneDiagnostic, 'expected' | 'actual'> = {},
): SceneDiagnostic {
  return createSceneDiagnostic({
    code,
    phase,
    severity: 'error',
    message,
    source: statement.source,
    statementId: statement.statementId,
    operation: statement.functionName,
    ...details,
    ...(COMPILE_HOW_TO_FIX[code] ? { howToFix: COMPILE_HOW_TO_FIX[code] } : {}),
    ...(COMPILE_CAUSES[code] ? { possibleCauses: COMPILE_CAUSES[code] } : {}),
    ...(contract
      ? {
          signature: `${contract.functionName}({ ${contract.inputs.map((input) => input.name).join(', ')} })`,
          documentationHint: contract.description,
        }
      : {}),
  })
}

export interface PortCompatibilityIssue {
  code: 'SCENE_TYPE_MISMATCH' | 'SCENE_TYPE_PROTOCOL_MISMATCH'
  expected: { type: string; runtimeType?: string }
  actual: { type: string; runtimeType?: string }
}

function sameOrdinaryType(source: string, target: string): boolean {
  if (source === target) return true
  return (source === 'bool' || source === 'boolean') && (target === 'bool' || target === 'boolean')
}

/** One compatibility rule for authored edges, including portable spatial protocols. */
export function portCompatibilityIssue(
  source: PortContract,
  target: PortContract,
): PortCompatibilityIssue | undefined {
  if (!sameOrdinaryType(source.type, target.type) && source.type !== 'any' && target.type !== 'any') {
    return {
      code: 'SCENE_TYPE_MISMATCH',
      expected: { type: target.type, ...(target.runtimeType ? { runtimeType: target.runtimeType } : {}) },
      actual: { type: source.type, ...(source.runtimeType ? { runtimeType: source.runtimeType } : {}) },
    }
  }
  if (source.runtimeType !== target.runtimeType && (source.runtimeType !== undefined || target.runtimeType !== undefined)) {
    return {
      code: 'SCENE_TYPE_PROTOCOL_MISMATCH',
      expected: { type: target.type, ...(target.runtimeType ? { runtimeType: target.runtimeType } : {}) },
      actual: { type: source.type, ...(source.runtimeType ? { runtimeType: source.runtimeType } : {}) },
    }
  }
  return undefined
}

export function resolveOutput(contract: NodeFunctionContract, requested: string | undefined): PortContract | undefined {
  if (requested) return contract.outputs.find((output) => output.name === requested)
  return contract.outputs.length === 1 ? contract.outputs[0] : undefined
}

export function groupTree(root: RawTemplateGroup): RawTemplateGroup[] {
  const result: RawTemplateGroup[] = []
  const visit = (group: RawTemplateGroup): void => {
    for (const child of group._nestedGroups ?? []) visit(child)
    result.push(group)
  }
  visit(root)
  return result
}

export function compileGroup(
  statement: SceneCallStatement,
  contract: NodeFunctionContract,
  diagnostics: SceneDiagnostic[],
): {
  ops: Op[]
  entityId: string
  runtimeNodeIds: string[]
  runtimeEdgeIds: string[]
  runtimeOrigins: Record<string, string>
  runtimeEdgeOrigins: Record<string, string>
} {
  const definition = contract.definition
  if (!definition || !contract.definitionId) {
    diagnostics.push(
      compileDiagnostic(statement, contract, 'SCENE_COMPILE_GROUP_DEFINITION', 'Group contract has no definition.'),
    )
    return {
      ops: [],
      entityId: stableEntityId('group', statement.statementId),
      runtimeNodeIds: [],
      runtimeEdgeIds: [],
      runtimeOrigins: {},
      runtimeEdgeOrigins: {},
    }
  }
  const instanceId = stableEntityId('group', statement.statementId)
  const groups = groupTree(definition)
  const groupIds = new Map<string, string>()
  const nodeIds = new Map<string, string>()
  for (const group of groups) {
    groupIds.set(
      group.id,
      group.id === definition.id ? instanceId : stableEntityId('group', `${statement.statementId}:${group.id}`),
    )
  }
  for (const group of groups) {
    for (const node of group.nodes ?? []) {
      const nestedId =
        node.opId === '__group__'
          ? String(node.params?.groupId ?? node.id)
          : undefined
      nodeIds.set(
        node.id,
        nestedId
          ? (groupIds.get(nestedId) ?? stableEntityId('group', `${statement.statementId}:${nestedId}`))
          : stableEntityId('node', `${statement.statementId}:${node.id}`),
      )
    }
  }
  const mapNode = (id: string): string => nodeIds.get(id) ?? groupIds.get(id) ?? id
  const ops: Op[] = []
  const runtimeNodeIds: string[] = []
  const runtimeEdgeIds: string[] = []
  const runtimeOrigins: Record<string, string> = {}
  const runtimeEdgeOrigins: Record<string, string> = {}
  const parameterOverrides = new Map<string, Record<string, unknown>>()
  for (const input of contract.inputs) {
    if (input.mode !== 'parameter') continue
    const expression = statement.args[input.name]
    const value = expression ? literalValueForAccess(expression, input.access) : undefined
    if (value === undefined) continue
    const templateNodeId = input.parameterTarget?.templateNodeId
    const param = input.parameterTarget?.param ?? input.name
    if (!templateNodeId) {
      diagnostics.push(
        compileDiagnostic(
          statement,
          contract,
          'SCENE_COMPILE_PARAMETER_TARGET',
          `Group parameter '${input.name}' has no template node target.`,
        ),
      )
      continue
    }
    parameterOverrides.set(templateNodeId, {
      ...(parameterOverrides.get(templateNodeId) ?? {}),
      [param]: value,
    })
  }

  for (const group of groups) {
    for (const node of group.nodes ?? []) {
      if (node.opId === '__group__') continue
      const nodeId = mapNode(node.id)
      runtimeNodeIds.push(nodeId)
      runtimeOrigins[nodeId] = node.id
      ops.push({
        type: 'createNode',
        nodeId,
        opId: node.opId,
        position: node.position ?? { x: 0, y: 0 },
        params: { ...(node.params ?? {}), ...(parameterOverrides.get(node.id) ?? {}) },
        ...(node.name ? { name: node.name } : {}),
      })
    }
    for (const edge of group.edges ?? []) {
      const edgeId = stableEntityId('edge', `${statement.statementId}:${group.id}:${edge.id}`)
      runtimeEdgeIds.push(edgeId)
      runtimeEdgeOrigins[edgeId] = edge.id
      ops.push({
        type: 'connect',
        edgeId,
        source: { nodeId: mapNode(edge.source.nodeId), port: edge.source.port },
        target: { nodeId: mapNode(edge.target.nodeId), port: edge.target.port },
      })
    }
    const groupId = groupIds.get(group.id)!
    runtimeNodeIds.push(groupId)
    runtimeOrigins[groupId] = group.id
    const remapPorts = (ports: RawTemplateGroup['exposedInputs']) =>
      (ports ?? []).map((port) => ({
        portName: port.portName,
        sourceNodeId: mapNode(port.sourceNodeId),
        sourcePortName: port.sourcePortName,
        ...(port.portType ? { portType: port.portType } : {}),
        ...(port.access ? { access: port.access } : {}),
        ...(port.hidden !== undefined ? { hidden: port.hidden } : {}),
        ...(port.order !== undefined ? { order: port.order } : {}),
        ...(port.customLabel ? { customLabel: port.customLabel } : {}),
        ...(port.customLabelEn ? { customLabelEn: port.customLabelEn } : {}),
      }))
    const inputs = remapPorts(group.exposedInputs)
    const outputs = remapPorts(group.exposedOutputs)
    ops.push({
      type: 'createGroup',
      groupId,
      name: group.name ?? contract.functionName,
      ...(group.nameEn ? { nameEn: group.nameEn } : {}),
      position: group.id === definition.id ? { x: 0, y: 0 } : (group.position ?? { x: 0, y: 0 }),
      memberNodeIds: (group.nodes ?? []).map((node) => mapNode(node.id)),
      ...(inputs.length || outputs.length
        ? {
            exposedPorts: {
              ...(inputs.length ? { inputs } : {}),
              ...(outputs.length ? { outputs } : {}),
            },
          }
        : {}),
    })
    if (group.id === definition.id) {
      ops.push({
        type: 'updateNode',
        nodeId: groupId,
        params: {
          groupId,
          __sceneScriptFunctionName: contract.functionName,
          __sceneScriptDefinitionId: contract.definitionId,
          __sceneScriptDefinitionVersion: contract.definitionVersion ?? contract.contractVersion,
          __sceneScriptStatus: contract.sceneScriptStatus ?? 'script-callable',
          __sceneScriptSourceFile: `${contract.definitionId?.split('.').at(-1) ?? contract.functionName}.scene.ts`,
        },
      })
    }
  }
  return { ops, entityId: instanceId, runtimeNodeIds, runtimeEdgeIds, runtimeOrigins, runtimeEdgeOrigins }
}

export function compileAtomic(statement: SceneCallStatement, contract: NodeFunctionContract): CompiledEntity & { ops: Op[] } {
  const entityId = stableEntityId('node', statement.statementId)
  const params: Record<string, unknown> = { ...(contract.runtimeDefaults ?? {}) }
  for (const [name, expression] of Object.entries(statement.args)) {
    const input = contract.inputs.find((candidate) => candidate.name === name)
    if (expression.kind !== 'reference' && input?.mode !== 'value') {
      params[name] = literalValueForAccess(expression, input?.access)
    } else if (!contract.inputs.some((input) => input.name === name) && expression.kind !== 'reference') {
      params[name] = literalValue(expression)
    }
  }
  return {
    statement,
    contract,
    entityId,
    runtimeNodeIds: [entityId],
    runtimeEdgeIds: [],
    ops: [
      {
        type: 'createNode',
        nodeId: entityId,
        opId: contract.opId!,
        params: {
          ...params,
          __sceneScriptFunctionName: contract.functionName,
          ...(contract.sourceKind ? { __sceneScriptKind: contract.sourceKind } : {}),
          ...(contract.sourceFile ? { __sceneScriptSourceFile: contract.sourceFile } : {}),
          ...(contract.definitionId ? { __sceneScriptDefinitionId: contract.definitionId } : {}),
        },
      },
    ],
  }
}

/**
 * Give a newly compiled Authoring Graph a readable deterministic layout.
 * Persisted layout (moduleId + statementId) still wins in the application
 * layer; this only prevents a first compile from placing every node at 0,0.
 */
export function applyInitialAuthoringLayout(ops: Op[], entities: readonly CompiledEntity[]): void {
  const entityIds = new Set(entities.map((entity) => entity.entityId))
  const rank = new Map<string, number>([...entityIds].map((id) => [id, 0]))
  const edges = ops.filter((op): op is Extract<Op, { type: 'connect' }> => op.type === 'connect')

  // Graphs are expected to be DAGs. Bound iterations make malformed cycles
  // deterministic rather than allowing a layout pass to spin indefinitely.
  for (let iteration = 0; iteration < entityIds.size; iteration += 1) {
    let changed = false
    for (const edge of edges) {
      if (!entityIds.has(edge.source.nodeId) || !entityIds.has(edge.target.nodeId)) continue
      const next = (rank.get(edge.source.nodeId) ?? 0) + 1
      if (next > (rank.get(edge.target.nodeId) ?? 0)) {
        rank.set(edge.target.nodeId, next)
        changed = true
      }
    }
    if (!changed) break
  }

  const rowsByRank = new Map<number, number>()
  const positions = new Map<string, { x: number; y: number }>()
  for (const entity of entities) {
    const column = rank.get(entity.entityId) ?? 0
    const row = rowsByRank.get(column) ?? 0
    rowsByRank.set(column, row + 1)
    // Group nodes expand to fit their title and exposed ports, and commonly
    // exceed the old 280px column pitch. Keep enough horizontal clearance for
    // the rendered width so first-compile graphs do not overlap downstream nodes.
    positions.set(entity.entityId, { x: 80 + column * 360, y: 80 + row * 240 })
  }

  for (const op of ops) {
    if (op.type === 'createNode') {
      const position = positions.get(op.nodeId)
      if (position) op.position = position
    } else if (op.type === 'createGroup') {
      const position = positions.get(op.groupId)
      if (position) op.position = position
    }
  }
}

