import { readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { NodeFunctionContract, PortContract, RawTemplateGroup } from '../../../packages/scene-authoring/src/index.ts'
import { loadAtomicContracts } from '../backend/src/scene-script/contracts/atomicContracts.ts'

type RawPort = NonNullable<RawTemplateGroup['exposedInputs']>[number] & {
  portLabel?: string
  portLabelEn?: string
}
type RawNode = NonNullable<RawTemplateGroup['nodes']>[number]

type DefinitionModel = {
  group: RawTemplateGroup
  exportName: string
  definitionId: string
  definitionAnchor: string
  inputs: Array<{ name: string; port: RawPort }>
  outputs: Array<{ name: string; port: RawPort }>
  nestedById: Map<string, DefinitionModel>
}

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const roots = [resolve(appRoot, 'batteries', 'groups'), resolve(appRoot, 'batteries', 'templates')]

async function collectJson(dir: string, output: string[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) await collectJson(path, output)
    else if (entry.isFile() && entry.name.endsWith('.generated.json')) output.push(path)
  }
}

function words(value: string): string[] {
  return value.normalize('NFKD')
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim().split(/\s+/).filter(Boolean)
}

function identifier(value: string, fallback: string): string {
  const parts = words(value)
  const joined = parts.map((part, index) =>
    index === 0 ? part.charAt(0).toLowerCase() + part.slice(1) : part.charAt(0).toUpperCase() + part.slice(1),
  ).join('').replace(/[^\w$]/g, '')
  const candidate = joined || fallback
  return /^[A-Za-z_$]/.test(candidate) ? candidate : `_${candidate}`
}

function pascal(value: string, fallback: string): string {
  const result = identifier(value, fallback)
  return result.charAt(0).toUpperCase() + result.slice(1)
}

function kebab(value: string): string {
  return words(value).map((part) => part.toLowerCase()).join('-') || 'group'
}

function portLabel(port: RawPort): string | undefined {
  return port.customLabelEn ?? port.portLabelEn ?? port.customLabel ?? port.portLabel
}

function namedPorts(ports: RawPort[] | undefined, direction: 'input' | 'output'): Array<{ name: string; port: RawPort }> {
  const used = new Set<string>()
  return (ports ?? []).map((port, index) => {
    let name = identifier(portLabel(port) ?? `${direction}${index}`, `${direction}${index}`)
    while (used.has(name)) name = `${name}${index}`
    used.add(name)
    return { name, port }
  })
}

function sceneType(port: RawPort): string {
  const type = (port.portType ?? 'any').toLowerCase()
  if (type === 'scene') return 'Scene'
  if (type === 'number') return port.access === 'list' ? 'NumberList' : 'NumberValue'
  if (type === 'string') return port.access === 'list' ? 'StringList' : 'StringValue'
  if (type === 'boolean' || type === 'bool') return 'BooleanValue'
  if (type === 'grid') return 'Grid'
  if (type === 'point2d' || type === 'point') return 'Point2d'
  return 'Any'
}

function renderPortMap(ports: Array<{ name: string; port: RawPort }>): string {
  if (!ports.length) return '{}'
  const lines = ports.map(({ name, port }) => {
    const label = port.customLabel ?? port.portLabel
    const labelEn = port.customLabelEn ?? port.portLabelEn
    const fields = [
      `type: ${sceneType(port)}`,
      `runtimeType: ${JSON.stringify(port.portType ?? 'any')}`,
      `runtimePort: ${JSON.stringify(port.portName)}`,
      port.access ? `access: ${JSON.stringify(port.access)}` : '',
      port.hidden !== undefined ? `hidden: ${port.hidden}` : '',
      port.order !== undefined ? `order: ${port.order}` : '',
      label ? `label: ${JSON.stringify(label)}` : '',
      labelEn ? `labelEn: ${JSON.stringify(labelEn)}` : '',
    ].filter(Boolean)
    return `      ${name}: { ${fields.join(', ')} },`
  })
  return `{\n${lines.join('\n')}\n    }`
}

function buildModel(
  group: RawTemplateGroup,
  exportName: string,
  definitionId: string,
  definitionAnchor: string,
  reservedNames: Set<string>,
): DefinitionModel {
  const nestedById = new Map<string, DefinitionModel>()
  for (const [index, nested] of (group._nestedGroups ?? []).entries()) {
    let nestedName = `${exportName}${pascal(nested.nameEn ?? nested.name ?? `Nested${index}`, `Nested${index}`)}`
    let suffix = 2
    while (reservedNames.has(nestedName)) nestedName = `${nestedName}${suffix++}`
    reservedNames.add(nestedName)
    const child = buildModel(
      nested,
      nestedName,
      `${definitionId}.nested.${index}`,
      `${definitionAnchor}.nested.${index}`,
      reservedNames,
    )
    nestedById.set(nested.id, child)
  }
  return {
    group,
    exportName,
    definitionId,
    definitionAnchor,
    inputs: namedPorts(group.exposedInputs as RawPort[] | undefined, 'input'),
    outputs: namedPorts(group.exposedOutputs as RawPort[] | undefined, 'output'),
    nestedById,
  }
}

function localContract(model: DefinitionModel): NodeFunctionContract {
  const convert = ({ name, port }: { name: string; port: RawPort }): PortContract => ({
    name,
    type: port.portType ?? 'any',
    ...(port.access ? { access: port.access } : {}),
    runtimePort: port.portName,
  })
  return {
    functionName: model.exportName,
    kind: 'group',
    contractVersion: '1.0.0',
    description: 'Generated module-local nested Definition.',
    inputs: model.inputs.map(convert),
    outputs: model.outputs.map(convert),
  }
}

function runtimeInput(contract: NodeFunctionContract, port: string): string {
  return contract.inputs.find((item) => (item.runtimePort ?? item.name) === port)?.name ?? port
}

function runtimeOutput(contract: NodeFunctionContract, port: string): string {
  return contract.outputs.find((item) => (item.runtimePort ?? item.name) === port)?.name ?? port
}

function contractForNode(
  node: RawNode,
  model: DefinitionModel,
  contractsByOp: Map<string, NodeFunctionContract[]>,
  retiredContracts: Map<string, NodeFunctionContract>,
  retired: boolean,
): NodeFunctionContract {
  if (node.opId === '__group__') {
    const nested = model.nestedById.get(String(node.params?.groupId))
    if (!nested) throw new Error(`${model.definitionId}: node ${node.id} references missing nested group ${String(node.params?.groupId)}`)
    return localContract(nested)
  }
  const candidates = contractsByOp.get(node.opId) ?? []
  if (candidates.length) return candidates[0]
  if (!retired) throw new Error(`${model.definitionId}: production Definition uses unknown op '${node.opId}'`)
  let contract = retiredContracts.get(node.opId)
  if (!contract) {
    const incoming = (model.group.edges ?? []).filter((edge) => edge.target.nodeId === node.id).map((edge) => edge.target.port)
    const outgoing = (model.group.edges ?? []).filter((edge) => edge.source.nodeId === node.id).map((edge) => edge.source.port)
    const exposedInputs = (model.group.exposedInputs ?? []).filter((port) => port.sourceNodeId === node.id).map((port) => port.sourcePortName)
    const exposedOutputs = (model.group.exposedOutputs ?? []).filter((port) => port.sourceNodeId === node.id).map((port) => port.sourcePortName)
    const inputNames = [...new Set([...Object.keys(node.params ?? {}), ...incoming, ...exposedInputs])]
    const outputNames = [...new Set([...outgoing, ...exposedOutputs])]
    contract = {
      functionName: `retired${pascal(node.opId, 'UnknownOp')}`,
      kind: 'atomic',
      contractVersion: 'retired-test-oracle',
      opId: node.opId,
      description: 'Verifier-only contract for a retired test oracle.',
      inputs: inputNames.map((name) => ({ name, type: 'any' })),
      outputs: outputNames.map((name) => ({ name, type: 'any' })),
    }
    retiredContracts.set(node.opId, contract)
  }
  return contract
}

function topologicalNodes(group: RawTemplateGroup): RawNode[] {
  const nodes = group.nodes ?? []
  const index = new Map(nodes.map((node, ordinal) => [node.id, ordinal]))
  const indegree = new Map(nodes.map((node) => [node.id, 0]))
  const outgoing = new Map<string, string[]>()
  for (const edge of group.edges ?? []) {
    indegree.set(edge.target.nodeId, (indegree.get(edge.target.nodeId) ?? 0) + 1)
    outgoing.set(edge.source.nodeId, [...(outgoing.get(edge.source.nodeId) ?? []), edge.target.nodeId])
  }
  const ready = nodes.filter((node) => indegree.get(node.id) === 0)
  const result: RawNode[] = []
  while (ready.length) {
    ready.sort((a, b) => (index.get(a.id) ?? 0) - (index.get(b.id) ?? 0))
    const node = ready.shift()!
    result.push(node)
    for (const target of outgoing.get(node.id) ?? []) {
      const next = (indegree.get(target) ?? 0) - 1
      indegree.set(target, next)
      if (next === 0) ready.push(nodes[index.get(target)!])
    }
  }
  if (result.length !== nodes.length) throw new Error(`${group.id}: cyclic graphs cannot be represented by restricted typed references`)
  return result
}

function literal(value: unknown): string {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Error('Definition params must be JSON literals')
  return encoded
}

function renderDefinition(
  model: DefinitionModel,
  contractsByOp: Map<string, NodeFunctionContract[]>,
  retiredContracts: Map<string, NodeFunctionContract>,
  retired: boolean,
  exported: boolean,
): string {
  const nodes = topologicalNodes(model.group)
  const bindingByNode = new Map<string, string>()
  const contractByNode = new Map<string, NodeFunctionContract>()
  const usedBindings = new Set<string>()
  for (const [index, node] of nodes.entries()) {
    const contract = contractForNode(node, model, contractsByOp, retiredContracts, retired)
    contractByNode.set(node.id, contract)
    let binding = identifier(`${contract.functionName}${index + 1}`, `node${index + 1}`)
    while (usedBindings.has(binding)) binding = `${binding}_${index + 1}`
    usedBindings.add(binding)
    bindingByNode.set(node.id, binding)
  }

  const calls = nodes.map((node) => {
    const contract = contractByNode.get(node.id)!
    const args = new Map<string, string>()
    if (node.opId !== '__group__') {
      if (Object.keys(node.params ?? {}).length) args.set('$params', literal(node.params))
    } else {
      const params = Object.fromEntries(Object.entries(node.params ?? {}).filter(([name]) => name !== 'groupId'))
      if (Object.keys(params).length) args.set('$params', literal(params))
    }
    const referencesByPort = new Map<string, string[]>()
    for (const exposed of model.inputs) {
      if (
        exposed.port.sourceNodeId !== node.id &&
        !(node.opId === '__group__' && exposed.port.sourceNodeId === node.params?.groupId)
      ) continue
      const target = runtimeInput(contract, exposed.port.sourcePortName)
      referencesByPort.set(target, [...(referencesByPort.get(target) ?? []), exposed.name])
    }
    for (const edge of (model.group.edges ?? []).filter((item) => item.target.nodeId === node.id)) {
      const sourceContract = contractByNode.get(edge.source.nodeId)
      const sourceBinding = bindingByNode.get(edge.source.nodeId)
      if (!sourceContract || !sourceBinding) throw new Error(`${model.definitionId}: unresolved source node ${edge.source.nodeId}`)
      const target = runtimeInput(contract, edge.target.port)
      referencesByPort.set(target, [
        ...(referencesByPort.get(target) ?? []),
        `${sourceBinding}.${runtimeOutput(sourceContract, edge.source.port)}`,
      ])
    }
    for (const [target, references] of referencesByPort) {
      args.set(target, references.length === 1 ? references[0] : `[${references.join(', ')}]`)
    }
    const renderedArgs = args.size
      ? `{\n${[...args].map(([name, value]) => `        ${JSON.stringify(name)}: ${value},`).join('\n')}\n      }`
      : '{}'
    return `    // @scene-id ${node.id}\n    const ${bindingByNode.get(node.id)} = ${contract.functionName}(${renderedArgs})`
  })

  const returns = model.outputs.map(({ name, port }) => {
    const sourceNode = nodes.find((node) =>
      node.id === port.sourceNodeId || (node.opId === '__group__' && node.params?.groupId === port.sourceNodeId))
    const sourceContract = sourceNode && contractByNode.get(sourceNode.id)
    const sourceBinding = sourceNode && bindingByNode.get(sourceNode.id)
    if (!sourceContract || !sourceBinding) throw new Error(`${model.definitionId}: unresolved output source ${port.sourceNodeId}`)
    return `      ${name}: ${sourceBinding}.${runtimeOutput(sourceContract, port.sourcePortName)},`
  })
  return `// @scene-id ${model.definitionAnchor}
${exported ? 'export ' : ''}const ${model.exportName} = defineGroup(
  {
    id: ${JSON.stringify(model.definitionId)},
    version: "1.0.0",
    inputs: ${renderPortMap(model.inputs)},
    outputs: ${renderPortMap(model.outputs)},
  },
  ({ ${model.inputs.map((item) => item.name).join(', ')} }) => {
${calls.join('\n\n')}
    return {
${returns.join('\n')}
    }
  },
)`
}

function flattenDefinitions(model: DefinitionModel): DefinitionModel[] {
  return [...[...model.nestedById.values()].flatMap(flattenDefinitions), model]
}

function render(
  group: RawTemplateGroup,
  jsonPath: string,
  exportName: string,
  reservedNames: Set<string>,
  contractsByOp: Map<string, NodeFunctionContract[]>,
  retiredContracts: Map<string, NodeFunctionContract>,
): string {
  const sourcePath = relative(appRoot, jsonPath).replaceAll('\\', '/')
  const namespace = sourcePath.replace(/\.json$/, '').split('/').map(kebab).join('.')
  const definitionId = sourcePath.startsWith('batteries/templates/')
    ? `scene.template.${kebab(basename(jsonPath, '.generated.json'))}`
    : `scene.group.${namespace.replace(/^batteries\.groups\./, '')}`
  const names = new Set(reservedNames)
  names.add(exportName)
  const model = buildModel(group, exportName, definitionId, `definition:${namespace}`, names)
  const retired = sourcePath.includes('/groups/test_terrain/')
  const definitions = flattenDefinitions(model)
  const localDefinitions = new Map(definitions.filter((item) => item !== model).map((item) => [item.group.id, item]))
  for (const definition of definitions) definition.nestedById = localDefinitions
  const rendered = definitions
    .map((definition) => renderDefinition(definition, contractsByOp, retiredContracts, retired, definition === model))
  return `// Generated by scripts/generate-native-group-definitions.mts.
// JSON parity oracle only: ${sourcePath}
${retired ? '// Inventory status: retired-test-oracle; never loaded by the production Registry.\n' : ''}${rendered.join('\n\n')}
`
}

const atomicContracts = await loadAtomicContracts([
  resolve(appRoot, '..', '..', 'packages', 'batteries-common', 'batteries', 'common'),
  resolve(appRoot, 'batteries'),
])
const contractsByOp = new Map<string, NodeFunctionContract[]>()
for (const contract of atomicContracts) {
  contractsByOp.set(contract.opId!, [...(contractsByOp.get(contract.opId!) ?? []), contract])
}
const reservedNames = new Set(atomicContracts.map((contract) => contract.functionName))
const retiredContracts = new Map<string, NodeFunctionContract>()
const jsonFiles: string[] = []
for (const root of roots) await collectJson(root, jsonFiles)
jsonFiles.sort()

function collectRetiredContracts(group: RawTemplateGroup): void {
  for (const node of group.nodes ?? []) {
    if (node.opId === '__group__' || contractsByOp.has(node.opId)) continue
    let contract = retiredContracts.get(node.opId)
    if (!contract) {
      contract = {
        functionName: `retired${pascal(node.opId, 'UnknownOp')}`,
        kind: 'atomic',
        contractVersion: 'retired-test-oracle',
        opId: node.opId,
        description: 'Verifier-only contract for a retired test oracle.',
        inputs: [],
        outputs: [],
      }
      retiredContracts.set(node.opId, contract)
    }
    const inputNames = [
      ...Object.keys(node.params ?? {}),
      ...(group.edges ?? []).filter((edge) => edge.target.nodeId === node.id).map((edge) => edge.target.port),
      ...(group.exposedInputs ?? []).filter((port) => port.sourceNodeId === node.id).map((port) => port.sourcePortName),
    ]
    const outputNames = [
      ...(group.edges ?? []).filter((edge) => edge.source.nodeId === node.id).map((edge) => edge.source.port),
      ...(group.exposedOutputs ?? []).filter((port) => port.sourceNodeId === node.id).map((port) => port.sourcePortName),
    ]
    for (const name of new Set(inputNames)) {
      if (!contract.inputs.some((port) => port.name === name)) contract.inputs.push({ name, type: 'any' })
    }
    for (const name of new Set(outputNames)) {
      if (!contract.outputs.some((port) => port.name === name)) contract.outputs.push({ name, type: 'any' })
    }
  }
  for (const nested of group._nestedGroups ?? []) collectRetiredContracts(nested)
}

for (const jsonPath of jsonFiles.filter((path) => relative(appRoot, path).replaceAll('\\', '/').includes('/groups/test_terrain/'))) {
  collectRetiredContracts(JSON.parse(await readFile(jsonPath, 'utf8')) as RawTemplateGroup)
}

const groupsByPath = new Map<string, RawTemplateGroup>()
const pathsByPreferredName = new Map<string, string[]>()
for (const jsonPath of jsonFiles) {
  const group = JSON.parse(await readFile(jsonPath, 'utf8')) as RawTemplateGroup
  groupsByPath.set(jsonPath, group)
  const preferred = identifier(group.nameEn ?? group.name ?? basename(jsonPath, '.generated.json'), 'nativeGroup')
  pathsByPreferredName.set(preferred, [...(pathsByPreferredName.get(preferred) ?? []), jsonPath])
}
const definitionNames = new Map<string, string>()
const usedDefinitionNames = new Set(reservedNames)
const groupsRoot = resolve(appRoot, 'batteries', 'groups')
const isGroupPath = (path: string): boolean => {
  const relativePath = relative(groupsRoot, path)
  return relativePath !== '..' && !relativePath.startsWith(`..${sep}`)
}
for (const jsonPath of jsonFiles) {
  const group = groupsByPath.get(jsonPath)!
  const preferred = identifier(group.nameEn ?? group.name ?? basename(jsonPath, '.generated.json'), 'nativeGroup')
  const isGroup = isGroupPath(jsonPath)
  const mirrored = new Set((pathsByPreferredName.get(preferred) ?? []).map((path) => isGroupPath(path) ? 'group' : 'template')).size > 1
  let name = reservedNames.has(preferred) || (mirrored && isGroup)
    ? `${preferred}${isGroup ? 'Group' : 'Template'}`
    : preferred
  let suffix = 2
  while (usedDefinitionNames.has(name)) name = `${preferred}${isGroup ? 'Group' : 'Template'}${suffix++}`
  usedDefinitionNames.add(name)
  definitionNames.set(jsonPath, name)
}

for (const jsonPath of jsonFiles) {
  const group = groupsByPath.get(jsonPath)!
  const output = resolve(dirname(jsonPath), `${kebab(basename(jsonPath, '.generated.json'))}.scene.ts`)
  for (const entry of await readdir(dirname(jsonPath))) {
    if (!entry.endsWith('.scene.ts')) continue
    const candidate = resolve(dirname(jsonPath), entry)
    if (candidate === output) continue
    const source = await readFile(candidate, 'utf8')
    if (source.startsWith('// Generated by scripts/generate-native-group-definitions.mts.')) await unlink(candidate)
  }
  await writeFile(output, render(group, jsonPath, definitionNames.get(jsonPath)!, reservedNames, contractsByOp, retiredContracts), 'utf8')
}

console.log(`generated ${jsonFiles.length} restricted native group Definitions (${retiredContracts.size} retired-only op contracts)`)
