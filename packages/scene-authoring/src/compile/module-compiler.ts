import type { Op } from '@forgeax/node-runtime'

import { stableEntityId } from '../model/identity.js'
import type {
  CompiledSceneModule,
  ContractRegistry,
  NodeFunctionContract,
  PortContract,
  SceneCallStatement,
  SceneDiagnostic,
  SceneExpression,
  SceneModuleAst,
  SourceMapEntry,
} from '../model/types.js'
import {
  applyInitialAuthoringLayout,
  compileAtomic,
  compileDiagnostic,
  compileGroup,
  portCompatibilityIssue,
  resolveOutput,
  runtimePort,
  SCENE_REPEAT_MAX_COUNT,
  type CompiledEntity,
} from './compiler-helpers.js'

type TypedReference = Extract<SceneExpression, { kind: 'reference' }>

function referencedOutput(
  expression: SceneExpression | undefined,
  byBinding: Map<string, CompiledEntity>,
): { reference: TypedReference; entity: CompiledEntity; output: PortContract } | undefined {
  if (expression?.kind !== 'reference') return undefined
  const entity = byBinding.get(expression.binding)
  const output = entity && resolveOutput(entity.contract, expression.output)
  return entity && output ? { reference: expression, entity, output } : undefined
}

function sameValueProtocol(left: PortContract, right: PortContract): boolean {
  return left.type === right.type
    && left.runtimeType === right.runtimeType
    && (left.access ?? 'item') === (right.access ?? 'item')
}

function builtinDiagnostic(
  diagnostics: SceneDiagnostic[],
  statement: SceneCallStatement,
  code: string,
  message: string,
  phase: SceneDiagnostic['phase'] = 'compile',
): void {
  diagnostics.push(compileDiagnostic(statement, undefined, code, message, phase))
}

function isBooleanCondition(port: PortContract): boolean {
  return (port.type === 'boolean' || port.type === 'bool') && port.runtimeType === undefined
}

function compileChooseBuiltin(
  statement: SceneCallStatement,
  byBinding: Map<string, CompiledEntity>,
  diagnostics: SceneDiagnostic[],
): (CompiledEntity & { ops: Op[] }) | undefined {
  const names = Object.keys(statement.args)
  if (names.length !== 3 || !['when', 'then', 'otherwise'].every((name) => name in statement.args)) {
    builtinDiagnostic(
      diagnostics,
      statement,
      'SCENE_CHOOSE_ARGUMENTS',
      'choose requires exactly { when, then, otherwise }; wrap branch preparation in ordinary Scene calls.',
      'type',
    )
    return undefined
  }
  const when = referencedOutput(statement.args.when, byBinding)
  const thenValue = referencedOutput(statement.args.then, byBinding)
  const otherwiseValue = referencedOutput(statement.args.otherwise, byBinding)
  if (!when || !thenValue || !otherwiseValue) {
    builtinDiagnostic(
      diagnostics,
      statement,
      'SCENE_CHOOSE_REFERENCE',
      'choose when, then, and otherwise must be typed references to earlier statements.',
      'resolve',
    )
    return undefined
  }
  if (!isBooleanCondition(when.output)) {
    builtinDiagnostic(diagnostics, statement, 'SCENE_CHOOSE_CONDITION', 'choose when must reference a boolean value.', 'type')
    return undefined
  }
  if (!sameValueProtocol(thenValue.output, otherwiseValue.output)) {
    builtinDiagnostic(
      diagnostics,
      statement,
      'SCENE_CHOOSE_BRANCH_TYPE',
      `choose branches must have the same type, runtimeType, and access; received '${thenValue.output.runtimeType ?? thenValue.output.type}' and '${otherwiseValue.output.runtimeType ?? otherwiseValue.output.type}'.`,
      'type',
    )
    return undefined
  }
  const branch = thenValue.output
  const contract: NodeFunctionContract = {
    functionName: 'choose',
    kind: 'atomic',
    contractVersion: SCENE_BUILTIN_VERSION,
    opId: 'scene_choose',
    description: 'Compiler builtin selecting between two already-evaluated typed values.',
    inputs: [
      { name: 'when', type: 'boolean', required: true, mode: 'value' },
      { name: 'then', type: branch.type, ...(branch.runtimeType ? { runtimeType: branch.runtimeType } : {}), ...(branch.access ? { access: branch.access } : {}), required: true, mode: 'value' },
      { name: 'otherwise', type: branch.type, ...(branch.runtimeType ? { runtimeType: branch.runtimeType } : {}), ...(branch.access ? { access: branch.access } : {}), required: true, mode: 'value' },
    ],
    outputs: [
      { name: 'value', type: branch.type, ...(branch.runtimeType ? { runtimeType: branch.runtimeType } : {}), ...(branch.access ? { access: branch.access } : {}) },
    ],
    deterministic: true,
  }
  return compileAtomic(statement, contract)
}

const SCENE_BUILTIN_VERSION = '0.1'

function compileRepeatBuiltin(
  statement: SceneCallStatement,
  registry: ContractRegistry,
  byBinding: Map<string, CompiledEntity>,
  diagnostics: SceneDiagnostic[],
): CompiledEntity & { ops: Op[] } | undefined {
  const names = Object.keys(statement.args)
  if (names.length !== 3 || !['count', 'initial', 'step'].every((name) => name in statement.args)) {
    builtinDiagnostic(
      diagnostics,
      statement,
      'SCENE_REPEAT_ARGUMENTS',
      'repeat requires exactly { count, initial, step }; wrap additional step inputs in defineGroup.',
      'type',
    )
    return undefined
  }
  const countExpression = statement.args.count
  const count = countExpression?.kind === 'literal' ? countExpression.value : undefined
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > SCENE_REPEAT_MAX_COUNT) {
    builtinDiagnostic(diagnostics, statement, 'SCENE_REPEAT_COUNT', `repeat count must be a static integer from 1 through ${SCENE_REPEAT_MAX_COUNT}.`, 'type')
    return undefined
  }
  const initial = referencedOutput(statement.args.initial, byBinding)
  if (!initial) {
    builtinDiagnostic(diagnostics, statement, 'SCENE_REPEAT_INITIAL', 'repeat initial must be a typed reference to an earlier statement.', 'resolve')
    return undefined
  }
  const stepExpression = statement.args.step
  if (stepExpression?.kind !== 'callable') {
    builtinDiagnostic(diagnostics, statement, 'SCENE_REPEAT_STEP', 'repeat step must be a direct Scene function identifier.', 'resolve')
    return undefined
  }
  const step = registry.get(stepExpression.functionName)
  if (!step || step.definitionScope === 'group-body' || step.agentVisible === false) {
    builtinDiagnostic(
      diagnostics,
      statement,
      'SCENE_REPEAT_STEP',
      `repeat step '${stepExpression.functionName}' must resolve to a public Scene contract.`,
      'resolve',
    )
    return undefined
  }
  const stateInput = step.inputs.find((input) => input.name === 'state')
  const stateOutput = step.outputs.find((output) => output.name === 'state')
  const indexInput = step.inputs.find((input) => input.name === 'index')
  const extraInputs = step.inputs.filter((input) => input.name !== 'state' && input.name !== 'index')
  if (!stateInput || !stateOutput || extraInputs.length > 0) {
    builtinDiagnostic(
      diagnostics,
      statement,
      'SCENE_REPEAT_STEP_CONTRACT',
      `repeat step '${step.functionName}' must expose only a state input and an optional number index input, with a state output; use defineGroup to bind additional inputs.`,
      'type',
    )
    return undefined
  }
  if (indexInput && indexInput.type !== 'number') {
    builtinDiagnostic(diagnostics, statement, 'SCENE_REPEAT_INDEX_TYPE', `repeat step '${step.functionName}' index input must have type number.`, 'type')
    return undefined
  }
  if (!sameValueProtocol(stateInput, stateOutput)) {
    builtinDiagnostic(
      diagnostics,
      statement,
      'SCENE_REPEAT_STATE_TYPE',
      `repeat step '${step.functionName}' state input and output must have the same type, runtimeType, and access.`,
      'type',
    )
    return undefined
  }
  const initialCompatibility = portCompatibilityIssue(initial.output, stateInput)
  if (initialCompatibility) {
    diagnostics.push(compileDiagnostic(
      statement,
      step,
      initialCompatibility.code,
      `repeat initial (${initial.output.runtimeType ?? initial.output.type}) is incompatible with ${step.functionName}.state (${stateInput.runtimeType ?? stateInput.type}).`,
      'type',
      { expected: initialCompatibility.expected, actual: initialCompatibility.actual },
    ))
    return undefined
  }

  const entityId = stableEntityId('group', statement.statementId)
  const ops: Op[] = []
  const runtimeNodeIds: string[] = []
  const runtimeEdgeIds: string[] = []
  const runtimeOrigins: Record<string, string> = {}
  const runtimeEdgeOrigins: Record<string, string> = {}
  const memberNodeIds: string[] = []
  const iterations: CompiledEntity[] = []
  for (let index = 0; index < count; index += 1) {
    const iterationStatement: SceneCallStatement = {
      kind: 'call',
      statementId: `${statement.statementId}:repeat:${index}`,
      binding: `${statement.binding ?? 'repeat'}$${index}`,
      functionName: step.functionName,
      args: indexInput?.mode === 'parameter'
        ? { index: { kind: 'literal', value: index } }
        : {},
      contractKind: step.kind,
      source: statement.source,
    }
    const iteration = step.kind === 'atomic'
      ? compileAtomic(iterationStatement, step)
      : (() => {
          const group = compileGroup(iterationStatement, step, diagnostics)
          return {
            statement: iterationStatement,
            contract: step,
            entityId: group.entityId,
            runtimeNodeIds: group.runtimeNodeIds,
            runtimeEdgeIds: group.runtimeEdgeIds,
            runtimeOrigins: group.runtimeOrigins,
            runtimeEdgeOrigins: group.runtimeEdgeOrigins,
            ops: group.ops,
          }
        })()
    iterations.push(iteration)
    memberNodeIds.push(iteration.entityId)
    runtimeNodeIds.push(...iteration.runtimeNodeIds)
    runtimeEdgeIds.push(...iteration.runtimeEdgeIds)
    Object.assign(runtimeOrigins, iteration.runtimeOrigins ?? {})
    Object.assign(runtimeEdgeOrigins, iteration.runtimeEdgeOrigins ?? {})
    for (const op of iteration.ops) {
      if (op.type === 'createNode' && op.nodeId === iteration.entityId) op.position = { x: index * 360, y: 0 }
      if (op.type === 'createGroup' && op.groupId === iteration.entityId) op.position = { x: index * 360, y: 0 }
      ops.push(op)
    }

    if (indexInput && indexInput.mode !== 'parameter') {
      const indexNodeId = stableEntityId('node', `${statement.statementId}:repeat-index:${index}`)
      const indexEdgeId = stableEntityId('edge', `${statement.statementId}:repeat-index:${index}`)
      memberNodeIds.push(indexNodeId)
      runtimeNodeIds.push(indexNodeId)
      runtimeEdgeIds.push(indexEdgeId)
      runtimeOrigins[indexNodeId] = `repeat-index:${index}`
      runtimeEdgeOrigins[indexEdgeId] = `repeat-index:${index}`
      ops.push({
        type: 'createNode',
        nodeId: indexNodeId,
        opId: 'number_const',
        position: { x: index * 360, y: 180 },
        params: { value: index },
        name: `Index ${index}`,
      })
      ops.push({
        type: 'connect',
        edgeId: indexEdgeId,
        source: { nodeId: indexNodeId, port: 'value' },
        target: { nodeId: iteration.entityId, port: runtimePort(indexInput) },
      })
    }
    if (index > 0) {
      const chainEdgeId = stableEntityId('edge', `${statement.statementId}:repeat-state:${index - 1}:${index}`)
      runtimeEdgeIds.push(chainEdgeId)
      runtimeEdgeOrigins[chainEdgeId] = `repeat-state:${index - 1}:${index}`
      ops.push({
        type: 'connect',
        edgeId: chainEdgeId,
        source: { nodeId: iterations[index - 1]!.entityId, port: runtimePort(stateOutput) },
        target: { nodeId: iteration.entityId, port: runtimePort(stateInput) },
      })
    }
  }
  runtimeNodeIds.push(entityId)
  runtimeOrigins[entityId] = 'repeat'
  ops.push({
    type: 'createGroup',
    groupId: entityId,
    name: `Repeat ${step.functionName} × ${count}`,
    memberNodeIds,
    position: { x: 0, y: 0 },
    exposedPorts: {
      inputs: [{
        portName: 'initial',
        portType: stateInput.type,
        access: stateInput.access,
        sourceNodeId: iterations[0]!.entityId,
        sourcePortName: runtimePort(stateInput),
      }],
      outputs: [{
        portName: 'state',
        portType: stateOutput.type,
        access: stateOutput.access,
        sourceNodeId: iterations.at(-1)!.entityId,
        sourcePortName: runtimePort(stateOutput),
      }],
    },
  })
  const contract: NodeFunctionContract = {
    functionName: 'repeat',
    kind: 'group',
    contractVersion: SCENE_BUILTIN_VERSION,
    description: `Compiler builtin expanding ${step.functionName} ${count} times.`,
    inputs: [{
      name: 'initial',
      type: stateInput.type,
      ...(stateInput.runtimeType ? { runtimeType: stateInput.runtimeType } : {}),
      ...(stateInput.access ? { access: stateInput.access } : {}),
      required: true,
      mode: 'value',
    }],
    outputs: [{
      name: 'state',
      type: stateOutput.type,
      ...(stateOutput.runtimeType ? { runtimeType: stateOutput.runtimeType } : {}),
      ...(stateOutput.access ? { access: stateOutput.access } : {}),
    }],
    deterministic: step.deterministic,
  }
  return {
    statement,
    contract,
    entityId,
    runtimeNodeIds,
    runtimeEdgeIds,
    runtimeOrigins,
    runtimeEdgeOrigins,
    ops,
  }
}

export function compileSceneModule(module: SceneModuleAst, registry: ContractRegistry): CompiledSceneModule {
  const diagnostics: SceneDiagnostic[] = []
  const entities: CompiledEntity[] = []
  const ops: Op[] = []
  const byBinding = new Map<string, CompiledEntity>()

  for (const statement of module.statements) {
    if (statement.functionName === 'choose' || statement.functionName === 'repeat') {
      const builtin = statement.functionName === 'choose'
        ? compileChooseBuiltin(statement, byBinding, diagnostics)
        : compileRepeatBuiltin(statement, registry, byBinding, diagnostics)
      if (!builtin) continue
      entities.push(builtin)
      ops.push(...builtin.ops)
      if (statement.binding) {
        if (byBinding.has(statement.binding)) {
          diagnostics.push(compileDiagnostic(statement, builtin.contract, 'SCENE_TYPE_DUPLICATE_BINDING', `Duplicate binding '${statement.binding}'.`, 'type'))
        } else {
          byBinding.set(statement.binding, builtin)
        }
      }
      continue
    }
    const contract = registry.get(statement.functionName)
    if (!contract) {
      diagnostics.push(
        compileDiagnostic(statement, undefined, 'SCENE_COMPILE_UNKNOWN_FUNCTION', `Unknown function '${statement.functionName}'.`, 'resolve'),
      )
      continue
    }
    if (contract.definitionScope === 'group-body') {
      diagnostics.push(
        compileDiagnostic(
          statement,
          contract,
          'SCENE_COMPILE_DEFINITION_SCOPE',
          `Function '${contract.functionName}' is an implementation detail and may only be called inside defineGroup.`,
          'capability',
        ),
      )
      continue
    }
    let entity: CompiledEntity
    if (contract.kind === 'atomic') {
      const atomic = compileAtomic(statement, contract)
      entity = atomic
      ops.push(...atomic.ops)
    } else {
      const group = compileGroup(statement, contract, diagnostics)
      entity = {
        statement,
        contract,
        entityId: group.entityId,
        runtimeNodeIds: group.runtimeNodeIds,
        runtimeEdgeIds: group.runtimeEdgeIds,
        runtimeOrigins: group.runtimeOrigins,
        runtimeEdgeOrigins: group.runtimeEdgeOrigins,
      }
      ops.push(...group.ops)
    }
    entities.push(entity)
    if (statement.binding) {
      if (byBinding.has(statement.binding)) {
        diagnostics.push(
          compileDiagnostic(statement, contract, 'SCENE_TYPE_DUPLICATE_BINDING', `Duplicate binding '${statement.binding}'.`, 'type'),
        )
      } else {
        byBinding.set(statement.binding, entity)
      }
    }
  }

  for (const entity of entities) {
    for (const input of entity.contract.inputs) {
      const expression = entity.statement.args[input.name]
      if (!expression) {
        if (input.required) {
          diagnostics.push(
            compileDiagnostic(
              entity.statement,
              entity.contract,
              'SCENE_TYPE_REQUIRED_INPUT',
              `Missing required input '${input.name}'.`,
              'type',
            ),
          )
        }
        continue
      }
      // Parameters accept both literal defaults and typed references. A literal
      // stays in the runtime node params; a reference must still become an edge
      // (e.g. stringValue(...) → gridSceneNode.name). Previously every
      // `parameter` input was skipped here, silently dropping those edges.
      const hasParameterReference =
        expression.kind === 'reference' ||
        (expression.kind === 'array' && expression.items.some((item) => item.kind === 'reference'))
      if (input.mode === 'parameter' && !hasParameterReference) continue
      const references =
        expression.kind === 'reference'
          ? [expression]
          : expression.kind === 'array'
            ? expression.items.filter((item): item is Extract<SceneExpression, { kind: 'reference' }> => item.kind === 'reference')
            : []
      if (references.length === 0) {
        diagnostics.push(
          compileDiagnostic(
            entity.statement,
            entity.contract,
            'SCENE_TYPE_EXPECTED_VALUE',
            `Input '${input.name}' expects a typed value from another node or group.`,
            'type',
          ),
        )
        continue
      }
      if ((entity.contract.opId === 'tree_merge' || input.access === 'list') && references.length > 0) {
        const create = ops.find(
          (op): op is Extract<Op, { type: 'createNode' }> =>
            op.type === 'createNode' && op.nodeId === entity.entityId,
        )
        if (create) create.params.portCount = references.length
      }
      references.forEach((reference, index) => {
        const sourceEntity = byBinding.get(reference.binding)
        if (!sourceEntity) {
          diagnostics.push(
            compileDiagnostic(
              entity.statement,
              entity.contract,
              'SCENE_RESOLVE_BINDING',
              `Unknown input binding '${reference.binding}'.`,
              'resolve',
            ),
          )
          return
        }
        const output = resolveOutput(sourceEntity.contract, reference.output)
        if (!output) {
          diagnostics.push(
            compileDiagnostic(
              entity.statement,
              entity.contract,
              'SCENE_TYPE_OUTPUT',
              reference.output
                ? `Function '${sourceEntity.contract.functionName}' has no output '${reference.output}'.`
                : `Function '${sourceEntity.contract.functionName}' has multiple outputs; select one by name.`,
              'type',
            ),
          )
          return
        }
        const compatibility = portCompatibilityIssue(output, input)
        if (compatibility) {
          diagnostics.push(
            compileDiagnostic(
              entity.statement,
              entity.contract,
              compatibility.code,
              `Cannot connect ${sourceEntity.contract.functionName}.${output.name} (${output.runtimeType ?? output.type}) to ${entity.contract.functionName}.${input.name} (${input.runtimeType ?? input.type}).`,
              'type',
              { expected: compatibility.expected, actual: compatibility.actual },
            ),
          )
          return
        }
        const edgeId = stableEntityId(
          'edge',
          `${sourceEntity.statement.statementId}:${output.name}:${entity.statement.statementId}:${input.name}:${index}`,
        )
        entity.runtimeEdgeIds.push(edgeId)
        sourceEntity.runtimeEdgeIds.push(edgeId)
        ops.push({
          type: 'connect',
          edgeId,
          source: { nodeId: sourceEntity.entityId, port: runtimePort(output) },
          target: {
            nodeId: entity.entityId,
            port: references.length > 1 ? `${runtimePort(input)}_${index}` : runtimePort(input),
          },
        })
      })
    }
  }

  const sourceMap: SourceMapEntry[] = entities.map((entity) => ({
    moduleId: module.moduleId,
    file: module.file,
    statementId: entity.statement.statementId,
    source: entity.statement.source,
    entityId: entity.entityId,
    runtimeNodeIds: entity.runtimeNodeIds,
    runtimeEdgeIds: [...new Set(entity.runtimeEdgeIds)],
    ...(entity.runtimeOrigins ? { runtimeOrigins: entity.runtimeOrigins } : {}),
    ...(entity.runtimeEdgeOrigins ? { runtimeEdgeOrigins: entity.runtimeEdgeOrigins } : {}),
    ...(entity.contract.definitionId ? { definitionId: entity.contract.definitionId } : {}),
    ...(entity.contract.definitionVersion ? { definitionVersion: entity.contract.definitionVersion } : {}),
    ...(entity.contract.kind !== 'atomic' ? { instancePath: entity.entityId } : {}),
  }))
  const resultCaptures = entities.flatMap((entity) => {
    const { opId, functionName } = entity.contract
    if (opId !== 'scene_output' && functionName !== 'sceneOutput') return []
    return [{
      entityId: entity.entityId,
      kind: 'sceneOutput' as const,
      functionName,
      opId: opId ?? functionName,
    }]
  })
  const resultEntityIds = resultCaptures.map((capture) => capture.entityId)

  applyInitialAuthoringLayout(ops, entities)

  return {
    module,
    ops,
    sourceMap,
    diagnostics,
    entityIds: entities.map((entity) => entity.entityId),
    resultEntityIds,
    resultCaptures,
  }
}

