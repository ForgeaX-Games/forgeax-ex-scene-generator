import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  DataTree,
  OpRegistry,
  createBatteryLoader,
  executeGroupSubgraph,
  executeNode,
  type ExecutionContext,
  type NodeGroup,
  type OpInput,
  type OpSpec,
} from '@forgeax/node-runtime/layer1'
import type { NodeFunctionContract, RawTemplateGroup } from '../../../../packages/scene-authoring/src/index.ts'

type InventoryEntry = {
  cellId?: string
  opId: string
  kind: string
  category: string
  status: string
  functionNameSuggestion?: string
}

type GateResult = {
  status: 'pass' | 'failed'
  reason: string
  evidence: Record<string, unknown>
}

type ExecutionEvidence = Record<string, { execute: GateResult }>

const PRODUCERS: Record<string, { opId: string; port: string }> = {
  scene: { opId: 'empty_scene', port: 'scene' },
  grid: { opId: 'rect_grid', port: 'grid' },
  mask: { opId: 'rect_grid', port: 'grid' },
  field: { opId: 'rect_grid', port: 'grid' },
  point2d: { opId: 'pt2_construct', port: 'point' },
  point3d: { opId: 'pt_construct', port: 'point' },
  point: { opId: 'pt2_construct', port: 'point' },
}

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1pAAAAAASUVORK5CYII=',
  'base64',
)

function wire(value: unknown): readonly { readonly path: readonly number[]; readonly items: readonly unknown[] }[] {
  return DataTree.fromEntries([{ path: [0, 0], items: [value] }]).toJSON()
}

function summarizeWire(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value)) return { wireShape: typeof value }
  const entries = value as Array<{ path?: unknown; items?: unknown }>
  return {
    branches: entries.length,
    items: entries.reduce((sum, entry) => sum + (Array.isArray(entry.items) ? entry.items.length : 0), 0),
    paths: entries.slice(0, 3).map((entry) => entry.path),
  }
}

function semanticFixture(opId: string | undefined, inputName: string): { value: unknown; source: string } | undefined {
  const grid = [[1, 1], [1, 1]]
  const gridList = [grid]
  if (['alg_topology_connect_points', 'road_connect_link', 'road_connect_random_walk'].includes(opId ?? '')) {
    const roadGrid = Array.from({ length: 10 }, () => Array(10).fill(0))
    if (inputName === 'poiGrid') {
      roadGrid[1][1] = 1
      roadGrid[8][8] = 2
      return { value: roadGrid, source: 'semantic-fixture:road-pois' }
    }
    if (['obstacle', 'obstacleGrid'].includes(inputName)) {
      return { value: roadGrid, source: 'semantic-fixture:empty-obstacles' }
    }
  }
  if (opId === 'grid_split_by_connectivity' && inputName === 'inputGrids') {
    return { value: grid, source: 'semantic-fixture:connected-grid' }
  }
  if (opId === 'wfc_tile_solver' && inputName === 'adjacency') {
    return { value: [{ N: [0], S: [0], E: [0], W: [0] }], source: 'semantic-fixture:wfc-adjacency' }
  }
  if (opId === 'wfc_tile_solver' && inputName === 'weights') {
    return { value: [1], source: 'semantic-fixture:wfc-weights' }
  }
  if (['gridListA', 'gridListB', 'gridList', 'caveGrids', 'maskList', 'terrainGridList', 'inputGrids'].includes(inputName)) {
    return { value: gridList, source: 'semantic-fixture:grid-list' }
  }
  if (['terrainGrid', 'zoneGrid', 'poiGrid'].includes(inputName)) {
    return { value: grid, source: 'semantic-fixture:grid' }
  }
  if (opId === 'deeper_poi_placer' && inputName === 'poiList') {
    return { value: [{ name: 'acceptance-poi', count: 1, minDist: 1 }], source: 'semantic-fixture:poi-list' }
  }
  if (opId === 'delaunay_terrain' && inputName === 'seeds') {
    return { value: [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 2, y: 3 }], source: 'semantic-fixture:seed-points' }
  }
  if (opId === 'furniture_list_split' && inputName === 'result') {
    return { value: '{"furniture_list":[]}', source: 'semantic-fixture:furniture-json' }
  }
  if (opId === 'natural_decoration' && inputName === 'decorations') {
    return { value: [{ name: 'tree', density: 10 }], source: 'semantic-fixture:decorations' }
  }
  if (opId === 'precise_decoration_scatter' && inputName === 'decorations') {
    return { value: [{ decoration: 'tree', count: 1 }], source: 'semantic-fixture:decorations' }
  }
  if (['poi_place', 'poi_scatter'].includes(opId ?? '') && inputName === 'poiRules') {
    return {
      value: [{
        decoration: 'poi',
        targetValue: 1,
        count: 1,
        minDistance: 1,
        ...(opId === 'poi_place' ? { points: [[0, 0]] } : {}),
      }],
      source: 'semantic-fixture:poi-rules',
    }
  }
  if (inputName === 'center') return { value: [1, 1], source: 'semantic-fixture:center' }
  if (['centerline', 'skeleton'].includes(inputName)) {
    return {
      value: [{ x: 1, y: 1 }, { x: 4, y: 1 }, { x: 2, y: 4 }],
      source: 'semantic-fixture:track-points',
    }
  }
  if (['wang_tile', 'wfc_tile_solver'].includes(opId ?? '') && ['tiles', 'templates'].includes(inputName)) {
    return { value: gridList, source: 'semantic-fixture:tile-templates' }
  }
  return undefined
}

function scalarFixture(input: OpInput, fixtureDir: string, opId?: string): { value: unknown; source: string } {
  const semantic = semanticFixture(opId, input.name)
  if (semantic) return semantic
  if (opId === 'list_collect' && input.name === 'total') return { value: 1, source: 'semantic-fixture:single-iteration' }
  if (input.name === 'seed' && input.type === 'number') return { value: 143, source: 'semantic-fixture:fixed-seed' }
  if (input.default !== undefined) return { value: input.default, source: 'meta.default' }
  if (input.options?.length) return { value: input.options[0], source: 'meta.options[0]' }
  if (input.name === 'path') return { value: '/', source: 'semantic-fixture:scene-root-path' }
  if (input.name === 'points') return { value: [[1, 1], [2, 2]], source: 'semantic-fixture:points' }
  if (opId === 'str_to_dict' && input.name === 'str') return { value: '{"key":"value"}', source: 'semantic-fixture:json-object' }
  if (['str_to_grid', 'str_to_grid_array'].includes(opId ?? '') && input.name === 'str') {
    return { value: '[[1,1],[1,1]]', source: 'semantic-fixture:grid-json' }
  }
  if (['str_to_list', 'str_to_num_list', 'list_explode'].includes(opId ?? '') && ['str', 'list'].includes(input.name)) {
    return { value: '[1,2]', source: 'semantic-fixture:list-json' }
  }
  if (opId === 'json2voxels' && input.name === 'json') {
    return { value: '[{"x":0,"y":0,"z":0,"token":"cell"}]', source: 'semantic-fixture:voxel-json' }
  }
  const type = input.type.toLowerCase()
  if (['number', 'float', 'double', 'int', 'integer'].includes(type)) return { value: 2, source: 'typed-fixture' }
  if (['bool', 'boolean'].includes(type)) return { value: false, source: 'typed-fixture' }
  if (type.includes('image') || type.includes('texture')) {
    return { value: resolve(fixtureDir, 'one-pixel.png'), source: 'file-fixture:one-pixel.png' }
  }
  if (type.includes('file') || type.includes('path')) {
    return { value: resolve(fixtureDir, 'fixture.txt'), source: 'file-fixture:fixture.txt' }
  }
  if (type.includes('url')) return { value: 'data:text/plain,forgeax-acceptance', source: 'data-url-fixture' }
  if (type.includes('dict') || type.includes('object') || type.includes('json')) {
    return { value: {}, source: 'typed-fixture' }
  }
  if (type.includes('list') || type.includes('array')) return { value: ['acceptance'], source: 'typed-fixture' }
  return { value: 'acceptance', source: 'typed-fixture' }
}

function context(signal: AbortSignal): ExecutionContext {
  return { pipelineId: 'scene-acceptance', signal, log: () => undefined }
}

async function executeWithTimeout(
  registry: OpRegistry,
  op: OpSpec,
  inputs: Record<string, unknown>,
  timeoutMs: number,
  params: Record<string, unknown> = {},
): Promise<Awaited<ReturnType<typeof executeNode>>> {
  const controller = new AbortController()
  const execution = executeNode(
    registry,
    { id: `acceptance:${op.id}`, opId: op.id, position: { x: 0, y: 0 }, params },
    inputs,
    context(controller.signal),
  )
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      execution,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(new Error(`execution timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function loadAtomicOpRegistry(
  extensionRoot: string,
  inventory: { scanRoots?: string[] },
): Promise<{ registry: OpRegistry; scan: Record<string, unknown> }> {
  const registry = new OpRegistry()
  const scanDirs = (inventory.scanRoots ?? []).map((root) => resolve(extensionRoot, root))
  const loader = createBatteryLoader(registry, {
    pluginId: '@forgeax-plugin/wb-scene-generator',
    scanDirs,
    layout: 'flexible',
    watch: false,
  })
  const scan = await loader.scan()
  return {
    registry,
    scan: { scanDirs, added: scan.added, errors: scan.errors },
  }
}

export async function runAtomicExecuteBatch(options: {
  inventory: { entries?: InventoryEntry[] }
  registry: OpRegistry
  fixtureDir: string
  cellIds?: ReadonlySet<string>
  prior?: ExecutionEvidence
  resume?: boolean
  timeoutMs?: number
  onCell?: (cellId: string, evidence: ExecutionEvidence) => Promise<void>
}): Promise<ExecutionEvidence> {
  const {
    inventory,
    registry,
    fixtureDir,
    cellIds,
    prior = {},
    resume = false,
    timeoutMs = 5_000,
    onCell,
  } = options
  await mkdir(fixtureDir, { recursive: true })
  await Promise.all([
    writeFile(resolve(fixtureDir, 'one-pixel.png'), ONE_PIXEL_PNG),
    writeFile(resolve(fixtureDir, 'fixture.txt'), 'forgeax scene acceptance fixture\n'),
  ])

  const evidence: ExecutionEvidence = { ...prior }
  const producerCache = new Map<string, Promise<{
    wire: unknown
    evidence: Record<string, unknown>
  }>>()

  const produce = (type: string): Promise<{ wire: unknown; evidence: Record<string, unknown> }> => {
    const normalized = type.toLowerCase()
    const existing = producerCache.get(normalized)
    if (existing) return existing
    const pending = (async () => {
      const fixture = PRODUCERS[normalized]
      if (!fixture) throw new Error(`no real producer battery fixture for complex type "${type}"`)
      const producer = registry.get(fixture.opId)
      if (!producer) throw new Error(`producer battery is not registered: ${fixture.opId}`)
      const producerInputs: Record<string, unknown> = {}
      const inputSummary: Record<string, unknown> = {}
      for (const input of producer.inputs) {
        const selected = scalarFixture(input, fixtureDir, producer.id)
        producerInputs[input.name] = wire(selected.value)
        inputSummary[input.name] = { type: input.type, source: selected.source, ...summarizeWire(producerInputs[input.name]) }
      }
      const result = await executeWithTimeout(registry, producer, producerInputs, timeoutMs)
      if (result.error) throw new Error(`producer ${producer.id} failed: ${result.error}`)
      const output = result.outputs[fixture.port]
      if (output === undefined) throw new Error(`producer ${producer.id} did not emit ${fixture.port}`)
      return {
        wire: output,
        evidence: {
          opId: producer.id,
          inputSummary,
          outputPort: fixture.port,
          outputSummary: summarizeWire(output),
          status: 'completed',
        },
      }
    })()
    producerCache.set(normalized, pending)
    return pending
  }

  const produceChildScene = async (): Promise<{ wire: unknown; evidence: Record<string, unknown> }> => {
    const op = registry.get('grid2node')
    if (!op) throw new Error('child-scene producer grid2node is not registered')
    const grid = await produce('grid')
    const inputs: Record<string, unknown> = {}
    for (const input of op.inputs) {
      if (input.name === 'grid') inputs.grid = grid.wire
      else {
        const selected = input.name === 'name'
          ? { value: 'acceptance-child', source: 'semantic-fixture:child-name' }
          : scalarFixture(input, fixtureDir, op.id)
        inputs[input.name] = wire(selected.value)
      }
    }
    const result = await executeWithTimeout(registry, op, inputs, timeoutMs)
    if (result.error) throw new Error(`child-scene producer grid2node failed: ${result.error}`)
    if (result.outputs.scene === undefined) throw new Error('child-scene producer grid2node omitted scene')
    return {
      wire: result.outputs.scene,
      evidence: {
        opId: op.id,
        inputSummary: Object.fromEntries(Object.entries(inputs).map(([name, value]) => [name, summarizeWire(value)])),
        outputPort: 'scene',
        outputSummary: summarizeWire(result.outputs.scene),
        status: 'completed',
      },
    }
  }

  const entries = (inventory.entries ?? []).filter((entry) =>
    entry.kind === 'atomic' && entry.status === 'ready' &&
    (!cellIds || cellIds.has(entry.cellId ?? entry.opId)))

  for (const entry of entries) {
    const cellId = entry.cellId ?? entry.opId
    if (resume && evidence[cellId]?.execute.status === 'pass') continue
    const op = registry.get(entry.opId)
    if (!op) {
      evidence[cellId] = { execute: {
        status: 'failed',
        reason: 'atomic op was not loaded into the live OpRegistry',
        evidence: { opId: entry.opId, category: entry.category, executionStatus: 'not-registered' },
      } }
      await onCell?.(cellId, evidence)
      continue
    }

    const startedAt = Date.now()
    const inputValues: Record<string, unknown> = {}
    const nodeParams: Record<string, unknown> = {}
    const inputSummary: Record<string, unknown> = {}
    const dependencyGraph: Record<string, unknown>[] = []
    try {
      for (const input of op.inputs) {
        if (op.id === 'add_child' && input.name === 'nodes') {
          const generated = await produceChildScene()
          inputValues[input.name] = generated.wire
          inputSummary[input.name] = {
            type: input.type,
            access: input.access ?? 'item',
            source: 'producer:grid2node.scene',
            ...summarizeWire(generated.wire),
          }
          dependencyGraph.push(generated.evidence)
          continue
        }
        const semantic = semanticFixture(op.id, input.name)
        if (semantic) {
          inputValues[input.name] = wire(semantic.value)
          inputSummary[input.name] = {
            type: input.type,
            access: input.access ?? 'item',
            source: semantic.source,
            ...summarizeWire(inputValues[input.name]),
          }
          continue
        }
        const producer = PRODUCERS[input.type.toLowerCase()]
        if (producer) {
          const generated = await produce(input.type)
          inputValues[input.name] = generated.wire
          inputSummary[input.name] = {
            type: input.type,
            access: input.access ?? 'item',
            source: `producer:${producer.opId}.${producer.port}`,
            ...summarizeWire(generated.wire),
          }
          if (!dependencyGraph.some((node) => node.opId === producer.opId)) dependencyGraph.push(generated.evidence)
        } else {
          const selected = scalarFixture(input, fixtureDir, op.id)
          if (op.id === 'list_explode' && input.name === 'list') nodeParams[input.name] = selected.value
          else inputValues[input.name] = wire(selected.value)
          inputSummary[input.name] = {
            type: input.type,
            access: input.access ?? 'item',
            source: selected.source,
            ...(input.name in nodeParams ? { valueType: typeof nodeParams[input.name] } : summarizeWire(inputValues[input.name])),
          }
        }
      }
      for (const param of op.params) {
        const selected = scalarFixture(param as OpInput, fixtureDir, op.id)
        nodeParams[param.name] = selected.value
      }
      if (op.id === 'image_reader') {
        nodeParams.imageRef = JSON.stringify({ alias: 'acceptance.png', blobId: 'acceptance-fixture' })
      }
      if (op.dynamicInputs) {
        for (let index = 0; index < op.dynamicInputs.minCount; index += 1) {
          const input = {
            name: `${op.dynamicInputs.prefix}${index}`,
            type: op.dynamicInputs.type,
            access: op.dynamicInputs.access,
          } satisfies OpInput
          const producer = PRODUCERS[input.type.toLowerCase()]
          if (producer) {
            const generated = await produce(input.type)
            inputValues[input.name] = generated.wire
            inputSummary[input.name] = {
              type: input.type,
              access: input.access ?? 'item',
              source: `producer:${producer.opId}.${producer.port}`,
              ...summarizeWire(generated.wire),
            }
            if (!dependencyGraph.some((node) => node.opId === producer.opId)) dependencyGraph.push(generated.evidence)
          } else {
            const selected = scalarFixture(input, fixtureDir, op.id)
            inputValues[input.name] = wire(selected.value)
            inputSummary[input.name] = {
              type: input.type,
              access: input.access ?? 'item',
              source: selected.source,
              ...summarizeWire(inputValues[input.name]),
            }
          }
        }
      }

      const result = await executeWithTimeout(registry, op, inputValues, timeoutMs, nodeParams)
      const outputPorts = Object.fromEntries(
        Object.entries(result.outputs).map(([name, value]) => [name, summarizeWire(value)]),
      )
      const missingOutputs = op.outputs.filter((output) => !(output.name in result.outputs)).map((output) => output.name)
      const executionEvidence = {
        opId: op.id,
        registryLoaded: true,
        nodeId: `acceptance:${op.id}`,
        dependencyGraph,
        inputSummary,
        outputPorts,
        declaredOutputPorts: op.outputs.map((output) => output.name),
        executionStatus: result.error ? 'error' : 'completed',
        ...(result.error ? { error: result.error } : {}),
        ...(missingOutputs.length ? { missingOutputs } : {}),
      }
      evidence[cellId] = { execute: result.error
        ? {
          status: 'failed',
          reason: `live node execution failed: ${result.error}`,
          evidence: executionEvidence,
        }
        : {
          status: 'pass',
          reason: missingOutputs.length
            ? 'live execution completed; conditional output ports were not emitted for this fixture'
            : 'loaded from the live OpRegistry and executed with DataTree inputs',
          evidence: executionEvidence,
        } }
    } catch (error) {
      evidence[cellId] = { execute: {
        status: 'failed',
        reason: `live node execution blocker: ${error instanceof Error ? error.message : String(error)}`,
        evidence: {
          opId: op.id,
          registryLoaded: true,
          dependencyGraph,
          inputSummary,
          outputPorts: {},
          executionStatus: 'failed-blocker',
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startedAt,
        },
      } }
    }
    await onCell?.(cellId, evidence)
  }
  return evidence
}

async function producerWireForType(
  type: string,
  registry: OpRegistry,
  fixtureDir: string,
  timeoutMs: number,
): Promise<{ wire: unknown; evidence: Record<string, unknown> } | undefined> {
  const fixture = PRODUCERS[type.toLowerCase()]
  if (!fixture) return undefined
  const producer = registry.get(fixture.opId)
  if (!producer) throw new Error(`producer battery is not registered: ${fixture.opId}`)
  const inputs: Record<string, unknown> = {}
  for (const input of producer.inputs) {
    const selected = scalarFixture(input, fixtureDir, producer.id)
    inputs[input.name] = wire(selected.value)
  }
  const result = await executeWithTimeout(registry, producer, inputs, timeoutMs)
  if (result.error) throw new Error(`producer ${producer.id} failed: ${result.error}`)
  const output = result.outputs[fixture.port]
  if (output === undefined) throw new Error(`producer ${producer.id} omitted ${fixture.port}`)
  return {
    wire: output,
    evidence: {
      opId: producer.id,
      outputPort: fixture.port,
      outputSummary: summarizeWire(output),
    },
  }
}

function nestedGroupMap(root: RawTemplateGroup): Map<string, RawTemplateGroup> {
  const output = new Map<string, RawTemplateGroup>()
  const visit = (group: RawTemplateGroup): void => {
    output.set(group.id, group)
    for (const nested of group._nestedGroups ?? []) visit(nested)
  }
  visit(root)
  return output
}

export async function runCompositeExecuteBatch(options: {
  inventory: { entries?: InventoryEntry[] }
  contracts: readonly NodeFunctionContract[]
  registry: OpRegistry
  fixtureDir: string
  cellIds?: ReadonlySet<string>
  timeoutMs?: number
}): Promise<ExecutionEvidence> {
  const { inventory, contracts, registry, fixtureDir, cellIds, timeoutMs = 10_000 } = options
  const evidence: ExecutionEvidence = {}
  const byFunction = new Map(contracts.map((contract) => [contract.functionName, contract]))
  for (const entry of inventory.entries ?? []) {
    if (!['group', 'template'].includes(entry.kind) || entry.status !== 'ready') continue
    const cellId = entry.cellId ?? entry.opId
    if (cellIds && !cellIds.has(cellId)) continue
    const contract = byFunction.get(entry.functionNameSuggestion ?? '')
    if (!contract?.definition) {
      evidence[cellId] = { execute: {
        status: 'failed',
        reason: 'native composite contract or Definition is missing',
        evidence: { functionName: entry.functionNameSuggestion },
      } }
      continue
    }
    const externalInputs: Record<string, unknown> = {}
    const inputSummary: Record<string, unknown> = {}
    const dependencies: Record<string, unknown>[] = []
    try {
      for (const exposed of contract.definition.exposedInputs ?? []) {
        const publicPort = contract.inputs.find((port) => (port.runtimePort ?? port.name) === exposed.portName)
        const type = publicPort?.type ?? exposed.portType ?? 'any'
        const produced = await producerWireForType(type, registry, fixtureDir, timeoutMs)
        if (produced) {
          externalInputs[exposed.portName] = produced.wire
          dependencies.push(produced.evidence)
        } else {
          const selected = scalarFixture({
            name: publicPort?.name ?? exposed.portName,
            type,
            access: publicPort?.access ?? exposed.access,
            ...(publicPort?.defaultValue !== undefined ? { default: publicPort.defaultValue } : {}),
            ...(publicPort?.options ? { options: publicPort.options } : {}),
          }, fixtureDir, contract.functionName)
          externalInputs[exposed.portName] = wire(selected.value)
        }
        inputSummary[exposed.portName] = {
          publicName: publicPort?.name,
          type,
          access: publicPort?.access ?? exposed.access ?? 'item',
          ...summarizeWire(externalInputs[exposed.portName]),
        }
      }
      const groups = nestedGroupMap(contract.definition)
      const outputs = await executeGroupSubgraph(
        contract.definition as unknown as NodeGroup,
        externalInputs,
        registry,
        context(new AbortController().signal),
        { getNestedGroup: (groupId) => groups.get(groupId) as unknown as NodeGroup | undefined },
      )
      const missingOutputs = (contract.definition.exposedOutputs ?? [])
        .filter((port) => !(port.portName in outputs))
        .map((port) => port.portName)
      evidence[cellId] = { execute: {
        status: 'pass',
        reason: missingOutputs.length
          ? 'native composite executed; conditional public outputs were not emitted'
          : 'native composite Definition executed through the live group runtime',
        evidence: {
          functionName: contract.functionName,
          definitionId: contract.definitionId,
          inputSummary,
          dependencies,
          outputPorts: Object.fromEntries(Object.entries(outputs).map(([name, value]) => [name, summarizeWire(value)])),
          missingOutputs,
        },
      } }
    } catch (error) {
      evidence[cellId] = { execute: {
        status: 'failed',
        reason: `native composite execution failed: ${error instanceof Error ? error.message : String(error)}`,
        evidence: {
          functionName: contract.functionName,
          definitionId: contract.definitionId,
          inputSummary,
          dependencies,
        },
      } }
    }
  }
  return evidence
}
