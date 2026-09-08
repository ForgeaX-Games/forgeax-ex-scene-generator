import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  compileSceneGroupDefinition,
  parseSceneModule,
  SceneContractRegistry,
  type ContractRegistry,
  type NodeFunctionContract,
  type RawTemplateGroup,
} from '../../../packages/scene-authoring/src/index.ts'
import { loadAtomicContracts } from '../backend/src/scene-script/contracts/atomicContracts.ts'

type OraclePort = NonNullable<RawTemplateGroup['exposedInputs']>[number]
type OraclePortWithLegacyLabels = OraclePort & { portLabel?: string; portLabelEn?: string }

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const roots = [
  { path: resolve(appRoot, 'batteries', 'groups'), expected: 18 },
  { path: resolve(appRoot, 'batteries', 'templates'), expected: 36 },
]

async function collectJson(dir: string, output: string[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) await collectJson(path, output)
    else if (entry.isFile() && entry.name.endsWith('.generated.json')) output.push(path)
  }
}

function kebab(value: string): string {
  return value.normalize('NFKD').replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ').trim().split(/\s+/)
    .filter(Boolean).map((part) => part.toLowerCase()).join('-') || 'group'
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

function allGroups(root: RawTemplateGroup): RawTemplateGroup[] {
  return [root, ...(root._nestedGroups ?? []).flatMap(allGroups)]
}

function verifyTopology(root: RawTemplateGroup, file: string): void {
  const groups = allGroups(root)
  const groupIds = new Set(groups.map((group) => group.id))
  assert.equal(groupIds.size, groups.length, `${file}: duplicate group id`)
  const entityIds = new Set<string>()
  for (const group of groups) {
    for (const node of group.nodes ?? []) {
      assert(!entityIds.has(node.id), `${file}: duplicate node id ${node.id}`)
      entityIds.add(node.id)
      if (node.opId === '__group__') {
        const groupId = node.params?.groupId
        assert.equal(typeof groupId, 'string', `${file}: group node ${node.id} has no groupId`)
        assert(groupIds.has(groupId), `${file}: unresolved nested group ${String(groupId)}`)
      }
    }
    for (const edge of group.edges ?? []) {
      assert(!entityIds.has(edge.id), `${file}: duplicate edge id ${edge.id}`)
      entityIds.add(edge.id)
      const localNodes = new Set((group.nodes ?? []).map((node) => node.id))
      assert(localNodes.has(edge.source.nodeId), `${file}: edge ${edge.id} has missing source`)
      assert(localNodes.has(edge.target.nodeId), `${file}: edge ${edge.id} has missing target`)
    }
    for (const port of [...(group.exposedInputs ?? []), ...(group.exposedOutputs ?? [])]) {
      assert(
        (group.nodes ?? []).some((node) => node.id === port.sourceNodeId) || groupIds.has(port.sourceNodeId),
        `${file}: exposed port ${port.portName} has missing node or nested group`,
      )
    }
  }
}

function verifyPorts(actual: Array<Record<string, unknown>>, expected: OraclePortWithLegacyLabels[], file: string, direction: string): void {
  assert.equal(actual.length, expected.length, `${file}: ${direction} count`)
  expected.forEach((port, index) => {
    const contract = actual[index]
    assert.equal(contract.runtimePort, port.portName, `${file}: ${direction}[${index}] runtimePort`)
    assert.equal(contract.type, port.portType ?? 'any', `${file}: ${direction}[${index}] type`)
    if (port.access !== undefined) assert.equal(contract.access, port.access, `${file}: ${direction}[${index}] access`)
    assert.equal(contract.hidden, port.hidden, `${file}: ${direction}[${index}] hidden`)
    assert.equal(contract.order, port.order, `${file}: ${direction}[${index}] order`)
    assert.equal(contract.label, port.customLabelEn ?? port.portLabelEn ?? port.customLabel ?? port.portLabel, `${file}: ${direction}[${index}] label`)
  })
}

function withoutGroupId(params: Record<string, unknown> | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(params ?? {}).filter(([name]) => name !== 'groupId'))
}

function actualNodeFor(actual: RawTemplateGroup, oracleNodeId: string, file: string) {
  const matches = (actual.nodes ?? []).filter((node) => node.id.endsWith(`:${oracleNodeId}`))
  assert.equal(matches.length, 1, `${file}: stable anchor for node ${oracleNodeId}`)
  return matches[0]
}

function verifySemanticGroup(
  actual: RawTemplateGroup,
  expected: RawTemplateGroup,
  file: string,
  visited: Set<string> = new Set(),
  oracleGroups: Map<string, RawTemplateGroup> = new Map(allGroups(expected).map((group) => [group.id, group])),
): void {
  if (visited.has(expected.id)) return
  visited.add(expected.id)
  assert.equal(actual.nodes?.length ?? 0, expected.nodes?.length ?? 0, `${file}: node count in ${expected.id}`)
  const actualByOracleId = new Map<string, NonNullable<RawTemplateGroup['nodes']>[number]>()
  for (const expectedNode of expected.nodes ?? []) {
    const actualNode = actualNodeFor(actual, expectedNode.id, file)
    actualByOracleId.set(expectedNode.id, actualNode)
    assert.equal(actualNode.opId, expectedNode.opId, `${file}: op for ${expectedNode.id}`)
    assert.deepEqual(withoutGroupId(actualNode.params), withoutGroupId(expectedNode.params), `${file}: params for ${expectedNode.id}`)
  }
  const actualEdges = new Set((actual.edges ?? []).map((edge) => {
    const source = [...actualByOracleId].find(([, node]) => node.id === edge.source.nodeId)?.[0]
    const target = [...actualByOracleId].find(([, node]) => node.id === edge.target.nodeId)?.[0]
    return `${source}:${edge.source.port}->${target}:${edge.target.port}`
  }))
  const expectedEdges = new Set((expected.edges ?? []).map((edge) =>
    `${edge.source.nodeId}:${edge.source.port}->${edge.target.nodeId}:${edge.target.port}`))
  assert.deepEqual(actualEdges, expectedEdges, `${file}: typed edge topology in ${expected.id}`)

  const verifyExposed = (
    actualPorts: OraclePort[] | undefined,
    expectedPorts: OraclePortWithLegacyLabels[] | undefined,
    direction: string,
  ) => {
    assert.equal(actualPorts?.length ?? 0, expectedPorts?.length ?? 0, `${file}: ${direction} count in ${expected.id}`)
    for (const [index, expectedPort] of (expectedPorts ?? []).entries()) {
      const actualPort = actualPorts![index] as OraclePortWithLegacyLabels
      const oracleSource = (expected.nodes ?? []).find((node) =>
        node.id === expectedPort.sourceNodeId ||
        (node.opId === '__group__' && node.params?.groupId === expectedPort.sourceNodeId))
      const expectedNode = oracleSource && actualByOracleId.get(oracleSource.id)
      assert.equal(actualPort.sourceNodeId, expectedNode?.id, `${file}: ${direction}[${index}] source`)
      assert.equal(actualPort.sourcePortName, expectedPort.sourcePortName, `${file}: ${direction}[${index}] source port`)
      assert.equal(actualPort.portName, expectedPort.portName, `${file}: ${direction}[${index}] runtime port`)
      assert.equal(actualPort.portType, expectedPort.portType, `${file}: ${direction}[${index}] type`)
      assert.equal(actualPort.access, expectedPort.access, `${file}: ${direction}[${index}] access`)
      assert.equal(actualPort.hidden, expectedPort.hidden, `${file}: ${direction}[${index}] hidden`)
      assert.equal(actualPort.order, expectedPort.order, `${file}: ${direction}[${index}] order`)
      assert.equal(actualPort.customLabel, expectedPort.customLabel ?? expectedPort.portLabel, `${file}: ${direction}[${index}] label`)
      assert.equal(actualPort.customLabelEn, expectedPort.customLabelEn ?? expectedPort.portLabelEn, `${file}: ${direction}[${index}] English label`)
    }
  }
  verifyExposed(actual.exposedInputs, expected.exposedInputs, 'input')
  verifyExposed(actual.exposedOutputs, expected.exposedOutputs, 'output')

  const actualGroups = new Map((actual._nestedGroups ?? []).map((group) => [group.id, group]))
  for (const expectedNode of (expected.nodes ?? []).filter((node) => node.opId === '__group__')) {
    const actualNode = actualByOracleId.get(expectedNode.id)!
    const expectedNested = oracleGroups.get(String(expectedNode.params?.groupId))
    const actualNested = actualGroups.get(String(actualNode.params?.groupId))
    assert(expectedNested, `${file}: oracle nested group for ${expectedNode.id}`)
    assert(actualNested, `${file}: compiled nested group for ${expectedNode.id}`)
    verifySemanticGroup(actualNested, expectedNested, file, visited, oracleGroups)
  }
}

function collectRetiredContracts(
  group: RawTemplateGroup,
  knownOps: Set<string>,
  contracts: Map<string, NodeFunctionContract>,
): void {
  for (const node of group.nodes ?? []) {
    if (node.opId === '__group__' || knownOps.has(node.opId)) continue
    let contract = contracts.get(node.opId)
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
      contracts.set(node.opId, contract)
    }
    const inputs = [
      ...Object.keys(node.params ?? {}),
      ...(group.edges ?? []).filter((edge) => edge.target.nodeId === node.id).map((edge) => edge.target.port),
      ...(group.exposedInputs ?? []).filter((port) => port.sourceNodeId === node.id).map((port) => port.sourcePortName),
    ]
    const outputs = [
      ...(group.edges ?? []).filter((edge) => edge.source.nodeId === node.id).map((edge) => edge.source.port),
      ...(group.exposedOutputs ?? []).filter((port) => port.sourceNodeId === node.id).map((port) => port.sourcePortName),
    ]
    for (const name of new Set(inputs)) {
      if (!contract.inputs.some((port) => port.name === name)) contract.inputs.push({ name, type: 'any' })
    }
    for (const name of new Set(outputs)) {
      if (!contract.outputs.some((port) => port.name === name)) contract.outputs.push({ name, type: 'any' })
    }
  }
  for (const nested of group._nestedGroups ?? []) collectRetiredContracts(nested, knownOps, contracts)
}

const atomicContracts = await loadAtomicContracts([
  resolve(appRoot, '..', '..', 'packages', 'batteries-common', 'batteries', 'common'),
  resolve(appRoot, 'batteries'),
])
const retiredContracts = new Map<string, NodeFunctionContract>()
const knownOps = new Set(atomicContracts.map((contract) => contract.opId!))
const filesByRoot = new Map<string, string[]>()
for (const root of roots) {
  const files: string[] = []
  await collectJson(root.path, files)
  assert.equal(files.length, root.expected, `${root.path}: oracle count changed`)
  filesByRoot.set(root.path, files.sort())
  for (const path of files.filter((item) => item.includes('/groups/test_terrain/'))) {
    collectRetiredContracts(JSON.parse(await readFile(path, 'utf8')) as RawTemplateGroup, knownOps, retiredContracts)
  }
}
const baseRegistry = new SceneContractRegistry([...atomicContracts, ...retiredContracts.values()])

let verified = 0
for (const root of roots) {
  for (const jsonPath of filesByRoot.get(root.path)!) {
    const scenePath = resolve(dirname(jsonPath), `${kebab(basename(jsonPath, '.generated.json'))}.scene.ts`)
    const oracle = JSON.parse(await readFile(jsonPath, 'utf8')) as RawTemplateGroup
    const source = await readFile(scenePath, 'utf8')
    assert(!source.includes('rawDefinition'), `${scenePath}: forbidden rawDefinition`)
    const parsed = parseSceneModule(source, { file: scenePath, registry: baseRegistry })
    assert.deepEqual(parsed.diagnostics, [], `${scenePath}: parse diagnostics`)
    assert(parsed.module.definitions.length >= 1, `${scenePath}: expected at least one Definition`)
    const rootDefinition = parsed.module.definitions.at(-1)!
    const pending = [...parsed.module.definitions]
    const localContracts = new Map<string, NodeFunctionContract>()
    while (pending.length) {
      let progressed = false
      for (let index = pending.length - 1; index >= 0; index -= 1) {
        const registry: ContractRegistry = {
          get: (name) => localContracts.get(name) ?? baseRegistry.get(name),
          list: () => [...baseRegistry.list(), ...localContracts.values()],
        }
        const compiled = compileSceneGroupDefinition(pending[index], registry)
        if (!compiled.contract) continue
        assert.deepEqual(compiled.diagnostics, [], `${scenePath}: compile diagnostics`)
        localContracts.set(compiled.contract.functionName, compiled.contract)
        pending.splice(index, 1)
        progressed = true
      }
      assert(progressed, `${scenePath}: unresolved local Definition dependencies`)
    }
    const rootContract = localContracts.get(rootDefinition.exportName)
    assert(rootContract?.definition, `${scenePath}: no compiled root Definition`)
    verifyPorts(rootContract.inputs as Array<Record<string, unknown>>, oracle.exposedInputs ?? [], scenePath, 'input')
    verifyPorts(rootContract.outputs as Array<Record<string, unknown>>, oracle.exposedOutputs ?? [], scenePath, 'output')
    verifySemanticGroup(rootContract.definition, oracle, scenePath)
    verifyTopology(oracle, scenePath)
    verified += 1
  }
}

console.log(`verified ${verified} restricted native Definitions with semantic topology and port parity (${retiredContracts.size} retired-only op contracts)`)
