import {
  inspectSceneSource,
  orderReferencedBindings,
  primaryOutputPort,
  runSceneModule,
  type DisplayGraph,
  type HostImpl,
  type RunSceneModuleResult,
  type SceneCallRecord,
  type SourceMapProjection,
} from '@forgeax/scene'
import { getPipeline, type ExecutionResult, type KernelGraphV1, type Runtime } from '@forgeax/node-runtime'
import { isShapeTree, shapeTreeFromItem, stableHash, type SceneDiagnostic, type SourceMapEntry } from '@forgeax/scene-authoring'
import { applyStoredLayout } from '../../routes/scene-script/helpers.js'
import { noteSceneProjection } from '../display/projectionRevision.js'
import { importDisplayGraphIncrementally } from '../display/runtimeImport.js'
import { readAuthoringLayout, readSceneModule, sceneRoot, writeSceneModule } from '../persist/store.js'
import { firstBatchImplementations } from './hostImplementations.js'

export interface SceneProjectRun {
  ok: boolean
  reusedLastGood: boolean
  result: RunSceneModuleResult
  graph: KernelGraphV1
  sourceMap: SourceMapEntry[]
  trace: SceneCallRecord[]
  diagnostics: SceneDiagnostic[]
  execution: ExecutionResult
}

interface LastGood {
  result: RunSceneModuleResult
  graph: KernelGraphV1
  sourceMap: SourceMapEntry[]
  graphHash: string
}

const lastGood = new Map<string, LastGood>()

function wrapWire(value: unknown): unknown {
  if (isShapeTree(value)) return value
  return shapeTreeFromItem(value)
}

function isGrid2D(value: unknown): value is number[][] {
  if (!Array.isArray(value) || value.length === 0 || !Array.isArray(value[0])) return false
  return value[0].length === 0 || typeof value[0][0] === 'number'
}

const EAGER_HOST_FNS = new Set([
  'point2d',
  'basePlane',
  'polyline2d',
  'spline2d',
  'polygon2d',
  'network2d',
  'heightfield',
  'heightfieldExplode',
  'heightfieldSetMask',
  'heightfieldMesh',
  'emptyScene',
  'sceneNode',
  'addChild',
  'sceneOutput',
])

function shouldDeferGrid(functionName: string, port: string, value: unknown): boolean {
  if (EAGER_HOST_FNS.has(functionName)) return false
  if (port === 'geometry' || port === 'heightfield' || port === 'scene') return false
  return port === 'grid' || isGrid2D(value)
}

function deferredGridStub(value: unknown): { deferred: true; type: 'grid'; rows: number; columns: number } {
  const rows = Array.isArray(value) ? value.length : 0
  const columns = Array.isArray(value) && Array.isArray(value[0]) ? value[0].length : 0
  return { deferred: true, type: 'grid', rows, columns }
}

function inferPortType(port: string, value: unknown): string {
  if (port === 'geometry' || (value && typeof value === 'object' && 'kind' in (value as object))) return 'geometry'
  if (port === 'grid' || Array.isArray(value)) return 'grid'
  if (port === 'heightfield') return 'heightfield'
  if (port === 'layers') return 'voxel_layers'
  if (port === 'scene') return 'scene'
  return 'any'
}

export function sourceMapFromProjection(items: readonly SourceMapProjection[]): SourceMapEntry[] {
  return items.map((item) => ({
    moduleId: item.moduleId,
    file: item.file,
    statementId: item.statementId,
    source: item.source,
    entityId: item.entityId,
    runtimeNodeIds: item.runtimeNodeIds,
    runtimeEdgeIds: item.runtimeEdgeIds,
    ...(item.argument ? { argument: item.argument } : {}),
  }))
}

/** OutputCache executedHash for one Scene Script run. Param-only source edits must change it. */
export function sceneRunExecutedHash(source: string): string {
  return stableHash(source)
}

export function kernelGraphFromDisplay(graph: DisplayGraph): KernelGraphV1 {
  return {
    nodes: Object.fromEntries(Object.entries(graph.nodes).map(([id, node]) => [id, {
      id: node.id,
      opId: node.opId,
      name: node.name,
      position: node.position,
      params: node.params,
      status: node.status,
    }])),
    edges: graph.edges,
  }
}

export function writeTraceOutputs(
  runtime: Runtime,
  trace: readonly SceneCallRecord[],
  graphHash: string,
): Record<string, Record<string, unknown>> {
  const outputs: Record<string, Record<string, unknown>> = {}
  const executedAt = new Date().toISOString()
  // The output store is keyed by source call ID, so later loop iterations
  // replace earlier ones. Persist its final projection once, while keeping
  // every invocation in the trace for diagnostics and scene assembly.
  const latest = new Map(trace.map(call => [call.id, call]))
  for (const call of latest.values()) {
    const result = call.result
    const ports: Record<string, unknown> = {}
    const primary = primaryOutputPort(call.functionName)
    const bag = result && typeof result === 'object' && !Array.isArray(result)
      ? result as Record<string, unknown>
      : undefined
    const writePort = (port: string, value: unknown) => {
      const persist = shouldDeferGrid(call.functionName, port, value) ? deferredGridStub(value) : value
      const data = wrapWire(persist)
      runtime.outputs.write(call.id, port, {
        valid: true,
        executedAt,
        executedHash: graphHash,
        type: inferPortType(port, value),
        data,
      } as never)
      ports[port] = data
    }
    const unwrapped = primary && (result == null || !bag || bag[primary] === undefined)
    if (unwrapped) {
      writePort(primary, result)
    } else if (!bag) {
      writePort(primary ?? 'value', result)
    } else {
      for (const [port, value] of Object.entries(bag)) {
        if (port.startsWith('_') || port === 'error') continue
        writePort(port, value)
      }
    }
    outputs[call.id] = ports
  }
  return outputs
}

/** Write a deferred Grid port from the last in-memory run. Call when Default opens that preview. */
export function materializeDeferredOutputs(
  runtime: Runtime,
  projectId: string,
  ports: ReadonlyArray<{ nodeId: string; portId: string }>,
): { hydrated: number } {
  const good = lastGood.get(projectId)
  if (!good) return { hydrated: 0 }
  const executedAt = new Date().toISOString()
  let hydrated = 0
  for (const { nodeId, portId } of ports) {
    const call = good.result.trace.find((item) => item.id === nodeId)
    if (!call) continue
    const primary = primaryOutputPort(call.functionName)
    const bag = call.result && typeof call.result === 'object' && !Array.isArray(call.result)
      ? call.result as Record<string, unknown>
      : undefined
    const value = bag && bag[portId] !== undefined
      ? bag[portId]
      : (primary === portId || !primary ? call.result : undefined)
    if (value === undefined) continue
    runtime.outputs.write(nodeId, portId, {
      valid: true,
      executedAt,
      executedHash: good.graphHash,
      type: inferPortType(portId, value),
      data: wrapWire(value),
    } as never)
    hydrated += 1
  }
  return { hydrated }
}

export function writeLiteralOutputs(
  runtime: Runtime,
  graph: DisplayGraph,
  graphHash: string,
): Record<string, Record<string, unknown>> {
  const executedAt = new Date().toISOString()
  const outputs: Record<string, Record<string, unknown>> = {}
  for (const node of Object.values(graph.nodes)) {
    const port = node.opId === 'text_panel' ? 'output' : 'value'
    const raw = node.opId === 'text_panel'
      ? node.params.text
      : node.opId === 'toggle'
        ? node.params.enabled
        : node.opId === 'number_const' || node.opId === 'json_panel'
          ? node.params.value
          : undefined
    if (raw === undefined || (node.opId !== 'number_const' && node.opId !== 'text_panel' && node.opId !== 'toggle' && node.opId !== 'json_panel')) {
      continue
    }
    const data = wrapWire(raw)
    runtime.outputs.write(node.id, port, {
      valid: true,
      executedAt,
      executedHash: graphHash,
      type: typeof raw === 'boolean' ? 'bool' : typeof raw,
      data,
    } as never)
    outputs[node.id] = { [port]: data }
  }
  return outputs
}

export function executionFromTrace(
  trace: readonly SceneCallRecord[],
  outputs: Record<string, Record<string, unknown>>,
  diagnostics: readonly SceneDiagnostic[],
  durationMs: number,
): ExecutionResult {
  const errors = diagnostics.filter((item) => item.severity === 'error')
  return {
    executionId: `scene-run-${Date.now()}`,
    status: errors.length > 0 ? 'error' : 'completed',
    outputs,
    durationMs,
    ...(errors[0] ? {
      error: { nodeId: errors[0]!.statementId, message: errors[0]!.message },
      failures: errors.map((item) => ({ nodeId: item.statementId, message: item.message })),
    } : {}),
  }
}

export async function runSceneProject(input: {
  projectId: string
  projectDir: string
  runtime: Runtime
  entryFile?: string
  sourceOverrides?: Record<string, string>
  implementations?: Record<string, HostImpl>
  actor?: string
  label?: string
  persistProjection?: boolean
}): Promise<SceneProjectRun> {
  const started = Date.now()
  let stored = await readSceneModule(input.projectDir, input.entryFile)
  const entryFile = input.entryFile ?? stored.file
  const incoming = input.sourceOverrides?.[entryFile] ?? stored.source
  const ordered = incoming.trim() ? orderReferencedBindings(incoming, entryFile) : incoming
  const sourceOverrides = { ...input.sourceOverrides }
  if (ordered !== incoming) {
    stored = await writeSceneModule(input.projectDir, entryFile, ordered, stored.state?.sourceMap ?? [])
    sourceOverrides[entryFile] = ordered
  }
  const result = await runSceneModule({
    projectDir: sceneRoot(input.projectDir),
    entryFile,
    sourceOverrides: Object.keys(sourceOverrides).length > 0 ? sourceOverrides : undefined,
    implementations: input.implementations ?? await firstBatchImplementations(),
  })
  const diagnostics = result.diagnostics
  const errors = diagnostics.some((item) => item.severity === 'error')
  const previous = lastGood.get(input.projectId)
  const projectedThisSource = result.trace.length > 0 || Object.keys(result.graph.nodes).length > 0
  // Keep the previous canvas only when this source could not run at all.
  // A recorded call that returned `{ error }` still belongs on the graph —
  // otherwise a palette drop writes `.scene.ts` and then vanishes.
  if (errors && previous && !projectedThisSource) {
    const current = getPipeline(input.runtime)?.nodes
    const currentCount = current ? Object.keys(current).length : 0
    if (input.persistProjection !== false && currentCount === 0) {
      await importDisplayGraphIncrementally(input.runtime, previous.graph, {
        actor: input.actor ?? 'scene-script:run',
        label: input.label ?? 'Restore last Scene Script projection',
      })
    }
    return {
      ok: false,
      reusedLastGood: true,
      result: previous.result,
      graph: previous.graph,
      sourceMap: previous.sourceMap,
      trace: previous.result.trace,
      diagnostics,
      execution: executionFromTrace(
        previous.result.trace,
        writeTraceOutputs(input.runtime, previous.result.trace, previous.graphHash),
        diagnostics,
        Date.now() - started,
      ),
    }
  }

  const layout = await readAuthoringLayout(input.projectDir)
  const sourceMap = sourceMapFromProjection(result.sourceMap)
  // Unpinned nodes already have data-flow positions from applyAutomaticDisplayLayout.
  const graph = applyStoredLayout(kernelGraphFromDisplay(result.graph), layout, sourceMap)
  const incomingNodes = Object.keys(graph.nodes ?? {}).length
  const current = getPipeline(input.runtime)?.nodes
  const currentCount = current ? Object.keys(current).length : 0
  const sourceCalls = inspectSceneSource(ordered, entryFile).filter((site) => site.kind === 'call').length
  const keepPreviousCanvas = incomingNodes === 0 && currentCount > 0 && !projectedThisSource && sourceCalls > 0
  if (input.persistProjection !== false && !keepPreviousCanvas) {
    await importDisplayGraphIncrementally(input.runtime, graph, {
      actor: input.actor ?? 'scene-script:run',
      label: input.label ?? 'Project Scene Script run',
    })
  }
  noteSceneProjection(input.projectId, stored.projectRevision ?? stored.revision)
  // Hash the source that actually ran. Topology + stored.revision misses a
  // slider settle: same node/edge ids, and `stored` can still hold the
  // pre-write revision while sourceOverrides already moved the plane.
  const graphHash = sceneRunExecutedHash(incoming || stored.source || stored.revision)
  const outputs = projectedThisSource || result.ok
    ? {
        ...writeTraceOutputs(input.runtime, result.trace, graphHash),
        ...writeLiteralOutputs(input.runtime, result.graph, graphHash),
      }
    : {}
  if (projectedThisSource || result.ok) {
    lastGood.set(input.projectId, { result, graph, sourceMap, graphHash })
  }
  return {
    ok: result.ok,
    reusedLastGood: false,
    result,
    graph,
    sourceMap,
    trace: result.trace,
    diagnostics,
    execution: executionFromTrace(result.trace, outputs, diagnostics, Date.now() - started),
  }
}

export function lastGoodSceneRun(projectId: string): LastGood | undefined {
  return lastGood.get(projectId)
}

/** Paired with releasing an idle project runtime. Persisted projection is untouched. */
export function releaseSceneRun(projectId: string): void {
  lastGood.delete(projectId)
}

export function sceneResultCaptures(trace: readonly SceneCallRecord[]): Array<{
  entityId: string
  kind: string
  functionName: string
  opId: string
}> {
  return trace.map((call) => ({
    entityId: call.id,
    kind: call.functionName,
    functionName: call.functionName,
    opId: call.functionName,
  }))
}
