import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

import {
  compileSceneGroupDefinition,
  compileSceneModule,
  parseSceneModule,
  type ContractRegistry,
  type NodeFunctionContract,
  type PortContract,
  type SourceMapEntry,
} from '../../../../packages/scene-authoring/src/index.ts'

type InventoryEntry = {
  cellId?: string
  opId?: string
  kind: 'atomic' | 'group' | 'template'
  functionNameSuggestion?: string
  source?: string
  status?: string
}

type EvidenceFailure = {
  status: 'failed'
  reason: string
  evidence?: unknown
}

type FixtureStatement = {
  statementId: string
  binding: string
  contract: NodeFunctionContract
  args: Record<string, string>
}

type FixtureBuild = {
  source: string
  targetStatementId: string
  targetBinding: string
}

function kebab(value: string): string {
  return value.normalize('NFKD').replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ').trim().split(/\s+/)
    .filter(Boolean).map((part) => part.toLowerCase()).join('-') || 'group'
}

function literalFor(port: PortContract): string {
  const value = port.defaultValue
  if (value !== undefined) {
    const serialized = JSON.stringify(value)
    if (serialized !== undefined) return serialized
  }
  if (port.options?.length) return JSON.stringify(port.options[0])
  const type = port.type.toLowerCase()
  if (type.includes('bool')) return 'false'
  if (/(number|float|double|int|seed)/.test(type)) return '0'
  if (/(string|text|name|path|asset)/.test(type)) return '""'
  return 'null'
}

function fixtureProducer(
  registry: ContractRegistry,
  target: NodeFunctionContract,
): FixtureBuild | EvidenceFailure {
  const contracts = registry.list()
    .filter((contract) => contract.definitionScope !== 'group-body' && contract.kind !== 'template')
    .sort((left, right) =>
      Number(left.kind !== 'atomic') - Number(right.kind !== 'atomic') ||
      left.functionName.localeCompare(right.functionName))
  const statements: FixtureStatement[] = []
  let sequence = 0

  const addContract = (
    contract: NodeFunctionContract,
    trail: ReadonlySet<string>,
  ): { binding: string; output?: string } | EvidenceFailure => {
    if (trail.has(contract.functionName)) {
      return { status: 'failed', reason: `typed fixture dependency cycle at ${contract.functionName}` }
    }
    const nextTrail = new Set(trail).add(contract.functionName)
    const args: Record<string, string> = {}
    for (const input of contract.inputs.filter((port) => port.required)) {
      if (input.mode === 'parameter') {
        args[input.name] = literalFor(input)
        continue
      }
      const candidates = contracts.filter((candidate) =>
        !nextTrail.has(candidate.functionName) &&
        candidate.outputs.some((output) => output.type === input.type))
        .sort((left, right) => {
          const leftDependencies = left.inputs.filter((port) => port.required && port.mode !== 'parameter').length
          const rightDependencies = right.inputs.filter((port) => port.required && port.mode !== 'parameter').length
          return leftDependencies - rightDependencies || left.functionName.localeCompare(right.functionName)
        })
      let produced: { binding: string; output?: string } | undefined
      const failures: string[] = []
      for (const candidate of candidates) {
        const result = addContract(candidate, nextTrail)
        if ('status' in result) {
          failures.push(result.reason)
          continue
        }
        const output = candidate.outputs.find((item) => item.type === input.type)
        produced = { binding: result.binding, ...(candidate.outputs.length === 1 ? {} : { output: output?.name }) }
        break
      }
      if (!produced) {
        return {
          status: 'failed',
          reason: `no constructible typed fixture producer for ${contract.functionName}.${input.name} (${input.type})`,
          evidence: { attemptedProducers: candidates.map((item) => item.functionName), failures },
        }
      }
      args[input.name] = produced.output ? `${produced.binding}.${produced.output}` : produced.binding
    }

    sequence += 1
    const binding = `fixture${sequence}`
    const statementId = contract === target ? 'fixture-target' : `fixture-producer-${sequence}`
    statements.push({ statementId, binding, contract, args })
    return { binding }
  }

  const built = addContract(target, new Set())
  if ('status' in built) return built
  return {
    targetStatementId: 'fixture-target',
    targetBinding: built.binding,
    source: `${statements.map((statement) => {
      const args = Object.entries(statement.args).map(([name, value]) => `${JSON.stringify(name)}: ${value}`).join(', ')
      return `// @scene-id ${statement.statementId}\nconst ${statement.binding} = ${statement.contract.functionName}({ ${args} })`
    }).join('\n')}\n`,
  }
}

function stableSourceMap(
  fixture: FixtureBuild,
  registry: ContractRegistry,
  file: string,
): SourceMapEntry | EvidenceFailure {
  const firstParsed = parseSceneModule(fixture.source, { file, moduleId: file, registry })
  const secondParsed = parseSceneModule(fixture.source, { file, moduleId: file, registry })
  const first = compileSceneModule(firstParsed.module, registry)
  const second = compileSceneModule(secondParsed.module, registry)
  const diagnostics = [
    ...firstParsed.diagnostics,
    ...secondParsed.diagnostics,
    ...first.diagnostics,
    ...second.diagnostics,
  ]
  if (diagnostics.length) {
    return {
      status: 'failed',
      reason: 'minimal Scene Script fixture did not compile cleanly',
      evidence: diagnostics,
    }
  }
  if (JSON.stringify(first.sourceMap) !== JSON.stringify(second.sourceMap)) {
    return { status: 'failed', reason: 'SourceMap changed during the second compilation' }
  }
  const mapping = first.sourceMap.find((item) => item.statementId === fixture.targetStatementId)
  if (!mapping) return { status: 'failed', reason: 'compiled fixture has no target SourceMap entry' }
  if (!mapping.entityId || mapping.runtimeNodeIds.length === 0) {
    return { status: 'failed', reason: 'target SourceMap has no reproducible runtime entity IDs', evidence: mapping }
  }
  return mapping
}

function stableGroupBodySourceMap(
  fixture: FixtureBuild,
  registry: ContractRegistry,
  file: string,
): SourceMapEntry | EvidenceFailure {
  const definitionSource = `export const sourceMapFixtureGroup = defineGroup(
  { id: "acceptance.source-map.group-body", version: "1.0.0", inputs: {}, outputs: { value: Any } },
  ({}) => {
${fixture.source.split('\n').filter(Boolean).map((line) => `    ${line}`).join('\n')}
    return { value: ${fixture.targetBinding} }
  },
)`
  const parsedDefinition = parseSceneModule(definitionSource, { file: `${file}:definition`, registry })
  if (parsedDefinition.diagnostics.length || parsedDefinition.module.definitions.length !== 1) {
    return { status: 'failed', reason: 'group-body SourceMap fixture Definition did not parse', evidence: parsedDefinition.diagnostics }
  }
  const lowered = compileSceneGroupDefinition(parsedDefinition.module.definitions[0], registry)
  if (!lowered.contract || lowered.diagnostics.length) {
    return { status: 'failed', reason: 'group-body SourceMap fixture Definition did not compile', evidence: lowered.diagnostics }
  }
  const overlay: ContractRegistry = {
    get: (name) => name === lowered.contract?.functionName ? lowered.contract : registry.get(name),
    list: () => [...registry.list(), lowered.contract!],
  }
  const instanceSource = '// @scene-id fixture-wrapper\nconst fixtureWrapper = sourceMapFixtureGroup({})\n'
  const compileInstance = () => {
    const parsed = parseSceneModule(instanceSource, { file, moduleId: file, registry: overlay })
    const compiled = compileSceneModule(parsed.module, overlay)
    return { parsed, compiled }
  }
  const first = compileInstance()
  const second = compileInstance()
  const diagnostics = [
    ...first.parsed.diagnostics,
    ...first.compiled.diagnostics,
    ...second.parsed.diagnostics,
    ...second.compiled.diagnostics,
  ]
  if (diagnostics.length || JSON.stringify(first.compiled.sourceMap) !== JSON.stringify(second.compiled.sourceMap)) {
    return { status: 'failed', reason: 'group-body SourceMap fixture instance was not stable', evidence: diagnostics }
  }
  const wrapper = first.compiled.sourceMap.find((item) => item.statementId === 'fixture-wrapper')
  const runtimeNodeId = wrapper?.runtimeOrigins
    ? Object.entries(wrapper.runtimeOrigins).find(([, origin]) => origin.endsWith(`:${fixture.targetStatementId}`))?.[0]
    : undefined
  if (!wrapper || !runtimeNodeId) {
    return { status: 'failed', reason: 'group-body target statement was absent from runtimeOrigins', evidence: wrapper }
  }
  const runtimeEdgeIds = Object.entries(wrapper.runtimeEdgeOrigins ?? {})
    .filter(([, origin]) => origin.includes(fixture.targetStatementId))
    .map(([edgeId]) => edgeId)
  return {
    statementId: fixture.targetStatementId,
    source: { file, start: 0, end: definitionSource.length, line: 1, column: 1 },
    entityId: runtimeNodeId,
    runtimeNodeIds: [runtimeNodeId],
    runtimeEdgeIds,
    ...(wrapper.runtimeOrigins ? { runtimeOrigins: wrapper.runtimeOrigins } : {}),
    ...(wrapper.runtimeEdgeOrigins ? { runtimeEdgeOrigins: wrapper.runtimeEdgeOrigins } : {}),
    ...(wrapper.definitionId ? { definitionId: wrapper.definitionId } : {}),
    ...(wrapper.definitionVersion ? { definitionVersion: wrapper.definitionVersion } : {}),
    ...(wrapper.instancePath ? { instancePath: wrapper.instancePath } : {}),
  }
}

function mappingEvidence(mapping: SourceMapEntry, fixtureSource: string): Record<string, unknown> {
  return {
    fixtureSource,
    statementId: mapping.statementId,
    entityId: mapping.entityId,
    runtimeNodeIds: mapping.runtimeNodeIds,
    runtimeEdgeIds: mapping.runtimeEdgeIds,
    ...(mapping.runtimeOrigins ? { runtimeOrigins: mapping.runtimeOrigins } : {}),
    ...(mapping.runtimeEdgeOrigins ? { runtimeEdgeOrigins: mapping.runtimeEdgeOrigins } : {}),
    ...(mapping.definitionId ? { definitionId: mapping.definitionId } : {}),
    ...(mapping.definitionVersion ? { definitionVersion: mapping.definitionVersion } : {}),
    ...(mapping.instancePath ? { instancePath: mapping.instancePath } : {}),
    secondCompilationIdentical: true,
  }
}

function compileCanonicalDefinitions(
  definitions: ReturnType<typeof parseSceneModule>['module']['definitions'],
  registry: ContractRegistry,
): { registry: ContractRegistry; contracts: Map<string, NodeFunctionContract> } | EvidenceFailure {
  const pending = [...definitions]
  const contracts = new Map<string, NodeFunctionContract>()
  while (pending.length) {
    let progressed = false
    for (let index = 0; index < pending.length; index += 1) {
      const definition = pending[index]
      const overlay: ContractRegistry = {
        get: (name) => contracts.get(name) ?? registry.get(name),
        list: () => [...registry.list().filter((item) => !contracts.has(item.functionName)), ...contracts.values()],
      }
      const result = compileSceneGroupDefinition(definition, overlay)
      if (!result.contract) continue
      contracts.set(result.contract.functionName, result.contract)
      pending.splice(index, 1)
      index -= 1
      progressed = true
    }
    if (!progressed) {
      return {
        status: 'failed',
        reason: `canonical Definition dependencies cannot be compiled: ${pending.map((item) => item.exportName).join(', ')}`,
      }
    }
  }
  return {
    contracts,
    registry: {
      get: (name) => contracts.get(name) ?? registry.get(name),
      list: () => [...registry.list().filter((item) => !contracts.has(item.functionName)), ...contracts.values()],
    },
  }
}

export async function buildSourceMapEvidence(
  inventory: { entries?: InventoryEntry[] },
  registry: ContractRegistry,
  extensionRoot: string,
): Promise<Record<string, { sourceMap: Record<string, unknown> | EvidenceFailure }>> {
  const evidence: Record<string, { sourceMap: Record<string, unknown> | EvidenceFailure }> = {}
  for (const entry of inventory.entries ?? []) {
    if (entry.status === 'retired-test-oracle') continue
    const cellId = entry.cellId ?? entry.opId
    if (!cellId) continue

    if (entry.kind === 'atomic') {
      const contracts = registry.list()
        .filter((contract) => contract.kind === 'atomic' && contract.opId === entry.opId)
        .sort((left, right) => left.functionName.localeCompare(right.functionName))
      if (!contracts.length) {
        evidence[cellId] = { sourceMap: { status: 'failed', reason: `no atomic contract for ${entry.opId}` } }
        continue
      }
      const variants: Record<string, unknown>[] = []
      let failure: EvidenceFailure | undefined
      for (const contract of contracts) {
        const fixture = fixtureProducer(registry, contract)
        if ('status' in fixture) {
          failure = fixture
          break
        }
        const mapping = contract.definitionScope === 'group-body'
          ? stableGroupBodySourceMap(fixture, registry, `${cellId}.scene.ts`)
          : stableSourceMap(fixture, registry, `${cellId}.scene.ts`)
        if ('status' in mapping) {
          failure = mapping
          break
        }
        variants.push({
          functionName: contract.functionName,
          ...mappingEvidence(mapping, fixture.source),
        })
      }
      evidence[cellId] = {
        sourceMap: failure ?? {
          kind: 'atomic',
          opId: entry.opId,
          variants,
        },
      }
      continue
    }

    if (!entry.source) {
      evidence[cellId] = { sourceMap: { status: 'failed', reason: 'group/template inventory entry has no canonical source' } }
      continue
    }
    const inventoryPath = resolve(extensionRoot, entry.source)
    const scenePath = entry.source.endsWith('.scene.ts')
      ? inventoryPath
      : resolve(dirname(inventoryPath), `${kebab(basename(inventoryPath, '.generated.json'))}.scene.ts`)
    let canonicalSource: string
    try {
      canonicalSource = await readFile(scenePath, 'utf8')
    } catch (error) {
      evidence[cellId] = {
        sourceMap: {
          status: 'failed',
          reason: `cannot read canonical Definition: ${error instanceof Error ? error.message : String(error)}`,
        },
      }
      continue
    }
    const parsedDefinition = parseSceneModule(canonicalSource, { file: scenePath, moduleId: scenePath, registry })
    const blockingDiagnostics = parsedDefinition.diagnostics.filter((item) => item.code !== 'SCENE_RESOLVE_FUNCTION')
    const topLevelDefinitions = parsedDefinition.module.definitions.filter((item) => !item.meta.id.includes('.nested.'))
    const definition = parsedDefinition.module.definitions.find((item) =>
      item.exportName === entry.functionNameSuggestion) ??
      (topLevelDefinitions.length === 1 ? topLevelDefinitions[0] : undefined)
    if (blockingDiagnostics.length || !definition) {
      evidence[cellId] = {
        sourceMap: {
          status: 'failed',
          reason: `canonical .scene.ts has no target Definition '${entry.functionNameSuggestion ?? '(missing function name)'}'`,
          evidence: blockingDiagnostics,
        },
      }
      continue
    }
    const compiledDefinitions = compileCanonicalDefinitions(parsedDefinition.module.definitions, registry)
    if ('status' in compiledDefinitions) {
      evidence[cellId] = { sourceMap: compiledDefinitions }
      continue
    }
    const contract = compiledDefinitions.contracts.get(definition.exportName)
    if (!contract ||
        contract.definitionId !== definition.meta.id ||
        contract.definitionVersion !== definition.meta.version) {
      evidence[cellId] = {
        sourceMap: {
          status: 'failed',
          reason: 'canonical Definition identity does not match the live contract',
          evidence: {
            definition: { id: definition.meta.id, version: definition.meta.version, exportName: definition.exportName },
            contract: contract && {
              kind: contract.kind,
              definitionId: contract.definitionId,
              definitionVersion: contract.definitionVersion,
            },
          },
        },
      }
      continue
    }
    const fixture = fixtureProducer(compiledDefinitions.registry, contract)
    if ('status' in fixture) {
      evidence[cellId] = { sourceMap: fixture }
      continue
    }
    const mapping = stableSourceMap(fixture, compiledDefinitions.registry, `${scenePath}#instance`)
    if ('status' in mapping) {
      evidence[cellId] = { sourceMap: mapping }
      continue
    }
    if (mapping.definitionId !== definition.meta.id ||
        mapping.definitionVersion !== definition.meta.version ||
        !mapping.instancePath ||
        !mapping.runtimeOrigins ||
        Object.keys(mapping.runtimeOrigins).length !== mapping.runtimeNodeIds.length) {
      evidence[cellId] = {
        sourceMap: {
          status: 'failed',
          reason: 'Definition instance SourceMap lacks stable identity/origin coverage',
          evidence: mapping,
        },
      }
      continue
    }
    evidence[cellId] = {
      sourceMap: {
        kind: entry.kind,
        canonicalDefinition: entry.source.replace(/\.json$/, '.scene.ts'),
        ...mappingEvidence(mapping, fixture.source),
        internalIds: {
          nodes: mapping.runtimeNodeIds,
          edges: mapping.runtimeEdgeIds,
        },
      },
    }
  }
  return evidence
}
