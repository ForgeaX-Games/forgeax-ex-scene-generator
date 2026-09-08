import { portContractForType } from '../contracts/portTypes.js'
import { literalValueForAccess } from '../model/literal-datatree.js'
import type {
  ContractRegistry,
  NodeFunctionContract,
  RawTemplateEdge,
  RawTemplateGroup,
  SceneExpression,
  SceneGroupDefinition,
} from '../model/types.js'

export interface DefinitionCompilation {
  contract?: NodeFunctionContract
  diagnostics: Array<{ code: string; message: string }>
}

function definitionPortContract(name: string, descriptor: SceneGroupDefinition['meta']['inputs'][string]) {
  const base = portContractForType(name, descriptor.type)
  return {
    ...base,
    ...(descriptor.runtimeType ? { type: descriptor.runtimeType } : {}),
    ...(descriptor.runtimePort ? { runtimePort: descriptor.runtimePort } : {}),
    ...(descriptor.access ? { access: descriptor.access } : {}),
    ...(descriptor.hidden !== undefined ? { hidden: descriptor.hidden } : {}),
    ...(descriptor.required !== undefined ? { required: descriptor.required } : {}),
    ...(descriptor.mode ? { mode: descriptor.mode } : {}),
    ...(descriptor.defaultValue !== undefined ? { defaultValue: descriptor.defaultValue } : {}),
    ...(descriptor.order !== undefined ? { order: descriptor.order } : {}),
    ...(descriptor.labelEn ?? descriptor.label ? { label: descriptor.labelEn ?? descriptor.label } : {}),
    ...(descriptor.description ?? descriptor.label ? { description: descriptor.description ?? descriptor.label } : {}),
  }
}

function referencedPort(expression: SceneExpression, contract: NodeFunctionContract): string | undefined {
  if (expression.kind !== 'reference') return undefined
  if (expression.output) {
    const output = contract.outputs.find((item) => item.name === expression.output)
    return output?.runtimePort ?? output?.name ?? expression.output
  }
  return contract.outputs.length === 1 ? (contract.outputs[0].runtimePort ?? contract.outputs[0].name) : undefined
}

function referenceExpressions(
  expression: SceneExpression,
): Array<Extract<SceneExpression, { kind: 'reference' }>> {
  if (expression.kind === 'reference') return [expression]
  // Arrays of typed references preserve multiple edges targeting one runtime
  // port. The runtime port contract, rather than this syntax, owns the rank.
  if (expression.kind === 'array' && expression.items.every((item) => item.kind === 'reference')) {
    return expression.items as Array<Extract<SceneExpression, { kind: 'reference' }>>
  }
  return []
}

function staticExpression(expression: SceneExpression): unknown {
  if (expression.kind === 'literal') return expression.value
  if (expression.kind === 'array') return expression.items.map(staticExpression)
  if (expression.kind === 'object') {
    return Object.fromEntries(Object.entries(expression.properties).map(([key, value]) => [key, staticExpression(value)]))
  }
  return undefined
}

function resolveParameterTarget(
  root: RawTemplateGroup,
  port: NonNullable<RawTemplateGroup['exposedInputs']>[number],
): { templateNodeId: string; param: string } | undefined {
  const groups = new Map<string, RawTemplateGroup>()
  const visit = (group: RawTemplateGroup): void => {
    groups.set(group.id, group)
    for (const nested of group._nestedGroups ?? []) visit(nested)
  }
  visit(root)

  let group = root
  let current = port
  const visited = new Set<string>()
  while (true) {
    const node = group.nodes?.find((candidate) => candidate.id === current.sourceNodeId)
    if (!node) return undefined
    if (node.opId !== '__group__') {
      return { templateNodeId: node.id, param: current.sourcePortName }
    }
    const nestedId = typeof node.params?.groupId === 'string' ? node.params.groupId : undefined
    const key = `${group.id}:${node.id}:${current.sourcePortName}`
    if (!nestedId || visited.has(key)) return undefined
    visited.add(key)
    const nested = groups.get(nestedId)
    const nestedPort = nested?.exposedInputs?.find((candidate) => candidate.portName === current.sourcePortName)
    if (!nested || !nestedPort) return undefined
    group = nested
    current = nestedPort
  }
}

/**
 * Lowers a closed Scene Script definition into the existing sealed group
 * representation. Its output deliberately uses only the well-tested group
 * contract path; the DSL is an authoring syntax, not a second runtime.
 */
export function compileSceneGroupDefinition(
  definition: SceneGroupDefinition,
  registry: ContractRegistry,
): DefinitionCompilation {
  const diagnostics: DefinitionCompilation['diagnostics'] = []
  const nodes: RawTemplateGroup['nodes'] = []
  const edges: RawTemplateEdge[] = []
  const nested: RawTemplateGroup[] = []
  const bindings = new Map<string, { nodeId: string; contract: NodeFunctionContract }>()
  const exposedInputs = new Map<string, NonNullable<RawTemplateGroup['exposedInputs']>[number]>()
  let nodeOrdinal = 0

  const nextPosition = (): { x: number; y: number } => {
    const index = nodeOrdinal++
    return { x: (index % 4) * 360, y: Math.floor(index / 4) * 240 }
  }

  for (const statement of definition.body) {
    const contract = registry.get(statement.functionName)
    if (!contract) {
      diagnostics.push({ code: 'SCENE_DEFINE_CONTRACT', message: `Definition '${definition.exportName}' calls unknown function '${statement.functionName}'.` })
      continue
    }
    const nodeId = `def:${definition.definitionId}:${statement.statementId}`
    const params: Record<string, unknown> = {}
    for (const [argName, expression] of Object.entries(statement.args)) {
      if (argName === '$params') {
        const staticParams = staticExpression(expression)
        if (staticParams && typeof staticParams === 'object' && !Array.isArray(staticParams)) {
          Object.assign(params, staticParams)
        } else {
          diagnostics.push({ code: 'SCENE_DEFINE_PARAMS_LITERAL', message: `'${statement.functionName}.$params' must be a static object literal.` })
        }
        continue
      }
      if (referenceExpressions(expression).length) continue
      const input = contract.inputs.find((item) => item.name === argName)
      params[input?.runtimePort ?? input?.name ?? argName] = literalValueForAccess(expression, input?.access)
    }
    if (contract.kind === 'group' && contract.definition) {
      const nestedId = `nested:${definition.definitionId}:${statement.statementId}`
      nested.push({ ...contract.definition, id: nestedId })
      nodes.push({ id: nodeId, opId: '__group__', params: { ...params, groupId: nestedId }, position: nextPosition() })
    } else if (contract.opId) {
      nodes.push({ id: nodeId, opId: contract.opId, params, position: nextPosition() })
    } else {
      diagnostics.push({ code: 'SCENE_DEFINE_CONTRACT', message: `Function '${contract.functionName}' cannot be lowered to a group body.` })
      continue
    }
    if (statement.binding) bindings.set(statement.binding, { nodeId, contract })
    for (const [argName, expression] of Object.entries(statement.args)) {
      if (argName === '$params') continue
      const input = contract.inputs.find((item) => item.name === argName)
      const runtimeInput = input?.runtimePort ?? input?.name ?? argName
      const references = expression ? referenceExpressions(expression) : []
      for (const [referenceIndex, reference] of references.entries()) {
        if (definition.paramNames.includes(reference.binding)) {
          if (!exposedInputs.has(reference.binding)) {
            exposedInputs.set(reference.binding, {
              portName: definition.meta.inputs[reference.binding].runtimePort ?? reference.binding,
              portType: definitionPortContract(reference.binding, definition.meta.inputs[reference.binding]).type,
              access: definition.meta.inputs[reference.binding].access,
              sourceNodeId: nodeId,
              sourcePortName: runtimeInput,
              ...(definition.meta.inputs[reference.binding].hidden !== undefined
                ? { hidden: definition.meta.inputs[reference.binding].hidden }
                : {}),
              ...(definition.meta.inputs[reference.binding].order !== undefined
                ? { order: definition.meta.inputs[reference.binding].order }
                : {}),
              ...(definition.meta.inputs[reference.binding].label
                ? { customLabel: definition.meta.inputs[reference.binding].label }
                : {}),
              ...(definition.meta.inputs[reference.binding].labelEn
                ? { customLabelEn: definition.meta.inputs[reference.binding].labelEn }
                : {}),
            })
          }
          continue
        }
        const source = bindings.get(reference.binding)
        const sourcePort = source && referencedPort(reference, source.contract)
        if (!source || !sourcePort) {
          diagnostics.push({ code: 'SCENE_DEFINE_REFERENCE', message: `Cannot resolve '${reference.binding}' in '${definition.exportName}'.` })
          continue
        }
        edges.push({
          id: `edge:${statement.statementId}:${argName}:${referenceIndex}`,
          source: { nodeId: source.nodeId, port: sourcePort },
          target: { nodeId, port: runtimeInput },
        })
      }
    }
  }

  const exposedOutputs: NonNullable<RawTemplateGroup['exposedOutputs']> = []
  for (const [name, expression] of Object.entries(definition.returnOutputs)) {
    if (expression.kind !== 'reference') {
      diagnostics.push({ code: 'SCENE_DEFINE_RETURN_REFERENCE', message: `Output '${name}' must be a binding reference.` })
      continue
    }
    const source = bindings.get(expression.binding)
    const sourcePort = source && referencedPort(expression, source.contract)
    if (!source || !sourcePort) {
      diagnostics.push({ code: 'SCENE_DEFINE_RETURN_REFERENCE', message: `Cannot resolve output '${name}'.` })
      continue
    }
    exposedOutputs.push({
      portName: definition.meta.outputs[name].runtimePort ?? name,
      portType: definitionPortContract(name, definition.meta.outputs[name]).type,
      access: definition.meta.outputs[name].access,
      sourceNodeId: source.nodeId,
      sourcePortName: sourcePort,
      ...(definition.meta.outputs[name].hidden !== undefined ? { hidden: definition.meta.outputs[name].hidden } : {}),
      ...(definition.meta.outputs[name].order !== undefined ? { order: definition.meta.outputs[name].order } : {}),
      ...(definition.meta.outputs[name].label
        ? { customLabel: definition.meta.outputs[name].label }
        : {}),
      ...(definition.meta.outputs[name].labelEn
        ? { customLabelEn: definition.meta.outputs[name].labelEn }
        : {}),
    })
  }
  if (diagnostics.length) return { diagnostics }
  const raw: RawTemplateGroup = {
    id: `definition:${definition.meta.id}`,
    name: definition.exportName,
    nodes,
    edges,
    exposedInputs: definition.paramNames.flatMap((name) => {
      const port = exposedInputs.get(name)
      return port ? [port] : []
    }),
    exposedOutputs,
    ...(nested.length ? { _nestedGroups: nested } : {}),
  }
  return {
    contract: {
      functionName: definition.exportName,
      kind: definition.meta.id.startsWith('scene.template.') && !definition.meta.id.includes('.nested.')
        ? 'template'
        : 'group',
      contractVersion: definition.meta.version,
      definitionId: definition.meta.id,
      definitionVersion: definition.meta.version,
      description: `Native Scene Script definition ${definition.exportName}.`,
      inputs: Object.entries(definition.meta.inputs).map(([name, descriptor]) => {
        const contract = definitionPortContract(name, descriptor)
        if (contract.mode !== 'parameter') return contract
        const exposed = raw.exposedInputs?.find((port) => port.portName === (contract.runtimePort ?? contract.name))
        const parameterTarget = exposed && resolveParameterTarget(raw, exposed)
        return parameterTarget ? { ...contract, parameterTarget } : contract
      }),
      outputs: Object.entries(definition.meta.outputs).map(([name, descriptor]) => definitionPortContract(name, descriptor)),
      definition: raw,
      deterministic: true,
    },
    diagnostics,
  }
}
