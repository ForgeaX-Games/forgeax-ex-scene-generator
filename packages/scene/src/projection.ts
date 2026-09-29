import { isSceneTree, isShapeTree, stableEntityId, type TsShapeLayer } from '@forgeax/scene-authoring'

import { HOST_FUNCTION_OP_IDS, hostResultError, primaryOutputPort, type HostFunctionName, type SceneCallRecord } from './host.js'
import { inspectArgReferences, type SceneInspectArg, type SceneInspectSite } from './inspect.js'
import { applyAutomaticDisplayLayout } from './projection-layout.js'

export interface DisplayNode {
  id: string
  opId: string
  functionName: string
  name: string
  params: Record<string, unknown>
  position: { x: number; y: number }
  status: 'completed' | 'error'
  /** Canvas name of the TypeScript shape this call produced. */
  valueShape: TsShapeLayer
  /** `.scene.ts` that recorded this call. Nested modules sit on their own row. */
  moduleFile?: string
}

export interface DisplayEdge {
  id: string
  source: { nodeId: string; port: string }
  target: { nodeId: string; port: string }
}

export interface DisplayGraph {
  nodes: Record<string, DisplayNode>
  edges: Record<string, DisplayEdge>
}

export interface SourceMapProjection {
  moduleId: string
  file: string
  statementId: string
  source: { file: string; start: number; end: number; line: number; column: number; statementId: string }
  entityId: string
  runtimeNodeIds: string[]
  runtimeEdgeIds: string[]
  argument?: string
}

export function opIdForFunction(functionName: string): string {
  if (functionName in HOST_FUNCTION_OP_IDS) return HOST_FUNCTION_OP_IDS[functionName as HostFunctionName]
  if (functionName.startsWith('local/')) return functionName
  return functionName.includes('/') ? functionName : `local/${functionName}`
}

function shapeLayerOf(result: unknown): TsShapeLayer {
  if (isSceneTree(result)) return 'scene'
  if (result && typeof result === 'object' && isSceneTree((result as { scene?: unknown }).scene)) return 'scene'
  if (isShapeTree(result)) return 'tree'
  if (Array.isArray(result)) return 'list'
  return 'item'
}

function literalParams(args: Record<string, unknown>, refs: SceneCallRecord['argRefs']): Record<string, unknown> {
  const referenced = new Set(refs.map((item) => item.arg))
  return Object.fromEntries(
    Object.entries(args).filter(([key, value]) => {
      if (referenced.has(key)) return false
      if (Array.isArray(value)) return true
      if (value && typeof value === 'object') {
        return typeof (value as { kind?: unknown }).kind !== 'string'
      }
      return typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean'
    }),
  )
}

function literalOutputPort(opId: string): string {
  return opId === 'text_panel' ? 'output' : 'value'
}

function literalNodeFields(value: string | number | boolean | object): {
  opId: string
  functionName: string
  params: Record<string, unknown>
} {
  if (typeof value === 'string') return { opId: 'text_panel', functionName: 'textPanel', params: { text: value } }
  if (typeof value === 'boolean') return { opId: 'toggle', functionName: 'booleanValue', params: { enabled: value } }
  if (value && typeof value === 'object') return { opId: 'json_panel', functionName: 'jsonPanel', params: { value } }
  return { opId: 'number_const', functionName: 'numberValue', params: { value } }
}

function edgeIdOf(from: string, port: string, to: string, arg: string): string {
  return `${from}:${port}->${to}:${arg}`
}

/** Closed option ports stay on the battery dropdown. `kind` is always an enum. */
export function isEnumLiteralArgument(
  functionName: string | undefined,
  arg: string,
  extra?: Iterable<string>,
): boolean {
  if (arg === 'kind') return true
  if (!functionName || !extra) return false
  const wanted = `${functionName}:${arg}`
  for (const item of extra) {
    if (item === wanted) return true
  }
  return false
}

export function projectTraceToDisplayGraph(input: {
  trace: readonly SceneCallRecord[]
  layout?: Record<string, { x: number; y: number }>
  sites?: readonly SceneInspectSite[]
  file?: string
  /** Extra `functionName:arg` keys from battery `options`. `kind` is implied. */
  enumArguments?: Iterable<string>
}): { graph: DisplayGraph; sourceMap: SourceMapProjection[] } {
  const nodes: Record<string, DisplayNode> = {}
  const edges: Record<string, DisplayEdge> = {}
  const sourceMap: SourceMapProjection[] = []
  const file = input.file ?? 'main.scene.ts'
  const siteById = new Map((input.sites ?? []).map((site) => [site.id, site]))
  const moduleFiles = [...new Set(input.trace.map((call) => call.source?.file ?? file))]
  const moduleRow = new Map(moduleFiles.map((name, index) => [name, index]))
  const columnByModule = new Map<string, number>()

  for (const call of input.trace) {
    const site = siteById.get(call.id)
    const moduleFile = call.source?.file ?? file
    const column = columnByModule.get(moduleFile) ?? 0
    columnByModule.set(moduleFile, column + 1)
    const row = moduleRow.get(moduleFile) ?? 0
    const position = input.layout?.[call.id] ?? { x: 80 + column * 280, y: 80 + row * 180 }
    nodes[call.id] = {
      id: call.id,
      opId: opIdForFunction(call.functionName),
      functionName: call.functionName,
      name: call.functionName,
      params: literalParams(call.args, call.argRefs),
      position,
      status: hostResultError(call.result) ? 'error' : 'completed',
      valueShape: shapeLayerOf(call.result),
      moduleFile,
    }
    for (const ref of call.argRefs) {
      const edgeId = `${ref.from}:${ref.port}->${call.id}:${ref.arg}`
      edges[edgeId] = {
        id: edgeId,
        source: { nodeId: ref.from, port: ref.port },
        target: { nodeId: call.id, port: ref.arg },
      }
    }
    sourceMap.push({
      moduleId: file,
      file: call.source?.file ?? file,
      statementId: call.id,
      source: {
        file: call.source?.file ?? file,
        start: site?.span.start ?? 0,
        end: site?.span.end ?? 0,
        line: call.source?.line ?? site?.span.line ?? 1,
        column: call.source?.column ?? site?.span.column ?? 1,
        statementId: call.id,
      },
      entityId: call.id,
      runtimeNodeIds: [call.id],
      runtimeEdgeIds: call.argRefs.map((ref) => `${ref.from}:${ref.port}->${call.id}:${ref.arg}`),
    })
  }

  for (const site of input.sites ?? []) {
    if (site.kind !== 'call' || nodes[site.id] || !site.functionName) continue
    const moduleFile = file
    const column = columnByModule.get(moduleFile) ?? 0
    columnByModule.set(moduleFile, column + 1)
    const row = moduleRow.get(moduleFile) ?? 0
    nodes[site.id] = {
      id: site.id,
      opId: opIdForFunction(site.functionName),
      functionName: site.functionName,
      name: site.functionName,
      params: Object.fromEntries(
        Object.entries(site.args)
          .filter(([, info]) => info.kind === 'literal' && info.value !== undefined)
          .map(([key, info]) => [key, info.value]),
      ),
      position: input.layout?.[site.id] ?? { x: 80 + column * 280, y: 80 + row * 180 },
      status: 'error',
      valueShape: 'item',
      moduleFile,
    }
    sourceMap.push({
      moduleId: file,
      file,
      statementId: site.id,
      source: {
        file,
        start: site.span.start,
        end: site.span.end,
        line: site.span.line,
        column: site.span.column,
        statementId: site.id,
      },
      entityId: site.id,
      runtimeNodeIds: [site.id],
      runtimeEdgeIds: [],
    })
  }

  wireInspectCallReferences({
    nodes,
    edges,
    sourceMap,
    sites: input.sites ?? [],
  })

  for (const site of input.sites ?? []) {
    if (site.kind !== 'literal' || nodes[site.id] || site.value === undefined) continue
    const fields = literalNodeFields(site.value)
    nodes[site.id] = {
      id: site.id,
      opId: fields.opId,
      functionName: fields.functionName,
      name: site.binding ?? (typeof site.value === 'object' ? 'json' : String(site.value)),
      params: fields.params,
      position: input.layout?.[site.id] ?? { x: 80, y: 80 + Object.keys(nodes).length * 40 },
      status: 'completed',
      valueShape: 'item',
      moduleFile: file,
    }
    sourceMap.push({
      moduleId: file,
      file,
      statementId: site.id,
      source: {
        file,
        start: site.span.start,
        end: site.span.end,
        line: site.span.line,
        column: site.span.column,
        statementId: site.id,
      },
      entityId: site.id,
      runtimeNodeIds: [site.id],
      runtimeEdgeIds: [],
    })
  }

  wireLiteralArguments({
    nodes,
    edges,
    sourceMap,
    sites: input.sites ?? [],
    layout: input.layout,
    file,
    enumArguments: input.enumArguments,
  })

  applyAutomaticDisplayLayout(nodes, edges, input.layout)

  return { graph: { nodes, edges }, sourceMap }
}

function wireInspectCallReferences(input: {
  nodes: Record<string, DisplayNode>
  edges: Record<string, DisplayEdge>
  sourceMap: SourceMapProjection[]
  sites: readonly SceneInspectSite[]
}): void {
  const byBinding = new Map<string, SceneInspectSite>()
  for (const site of input.sites) {
    if (site.binding) byBinding.set(site.binding, site)
  }
  for (const site of input.sites) {
    if (site.kind !== 'call' || !input.nodes[site.id]) continue
    for (const [arg, info] of Object.entries(site.args)) {
      for (const ref of inspectArgReferences(info)) {
        if (!ref.binding) continue
        const from = byBinding.get(ref.binding)
        if (!from || !input.nodes[from.id]) continue
        connect(
          input.edges,
          input.sourceMap,
          from.id,
          ref.output ?? primaryOutputPort(from.functionName) ?? 'value',
          site.id,
          arg,
        )
      }
    }
  }
}

function rememberEdge(sourceMap: SourceMapProjection[], nodeId: string, edgeId: string): void {
  const entry = sourceMap.find((item) => item.entityId === nodeId || item.runtimeNodeIds.includes(nodeId))
  if (entry && !entry.runtimeEdgeIds.includes(edgeId)) entry.runtimeEdgeIds.push(edgeId)
}

function connect(
  edges: Record<string, DisplayEdge>,
  sourceMap: SourceMapProjection[],
  from: string,
  port: string,
  to: string,
  arg: string,
): void {
  const id = edgeIdOf(from, port, to, arg)
  if (edges[id]) return
  edges[id] = {
    id,
    source: { nodeId: from, port },
    target: { nodeId: to, port: arg },
  }
  rememberEdge(sourceMap, from, id)
  rememberEdge(sourceMap, to, id)
}

function wireLiteralArguments(input: {
  nodes: Record<string, DisplayNode>
  edges: Record<string, DisplayEdge>
  sourceMap: SourceMapProjection[]
  sites: readonly SceneInspectSite[]
  layout?: Record<string, { x: number; y: number }>
  file: string
  enumArguments?: Iterable<string>
}): void {
  const literalByBinding = new Map<string, SceneInspectSite>()
  for (const site of input.sites) {
    if (site.kind === 'literal' && site.binding) literalByBinding.set(site.binding, site)
  }

  for (const site of input.sites) {
    if (site.kind !== 'call' || !input.nodes[site.id]) continue
    const parent = input.nodes[site.id]!
    let helperIndex = 0
    for (const [arg, info] of Object.entries(site.args)) {
      const source = literalSource(info, literalByBinding, site, arg, input.enumArguments)
      if (!source) continue
      if (!input.nodes[source.id]) {
        const fields = literalNodeFields(source.value)
        input.nodes[source.id] = {
          id: source.id,
          opId: fields.opId,
          functionName: fields.functionName,
          name: source.binding ?? String(source.value),
          params: fields.params,
          position: input.layout?.[source.id] ?? {
            x: parent.position.x - 220,
            y: parent.position.y + helperIndex * 48,
          },
          status: 'completed',
          valueShape: 'item',
          moduleFile: parent.moduleFile ?? input.file,
        }
        input.sourceMap.push({
          moduleId: input.file,
          file: parent.moduleFile ?? input.file,
          statementId: site.id,
          source: {
            file: parent.moduleFile ?? input.file,
            start: site.span.start,
            end: site.span.end,
            line: site.span.line,
            column: site.span.column,
            statementId: site.id,
          },
          entityId: source.id,
          runtimeNodeIds: [source.id],
          runtimeEdgeIds: [],
          argument: arg,
        })
      }
      helperIndex += 1
      const sourceNode = input.nodes[source.id]
      if (!sourceNode) continue
      connect(input.edges, input.sourceMap, source.id, literalOutputPort(sourceNode.opId), site.id, arg)
      delete parent.params[arg]
    }
  }
}

function literalSource(
  info: SceneInspectArg,
  literalByBinding: Map<string, SceneInspectSite>,
  site: SceneInspectSite,
  arg: string,
  enumArguments?: Iterable<string>,
): { id: string; value: string | number | boolean | object; binding?: string } | undefined {
  if (info.kind === 'reference' && info.binding) {
    const named = literalByBinding.get(info.binding)
    if (!named || named.value === undefined) return undefined
    return { id: named.id, value: named.value, binding: named.binding }
  }
  if (info.kind === 'literal' && info.value !== undefined) {
    if (typeof info.value === 'string' && isEnumLiteralArgument(site.functionName, arg, enumArguments)) {
      return undefined
    }
    return {
      id: stableEntityId('stmt', `${site.id}:${arg}:literal`),
      value: info.value,
    }
  }
  return undefined
}

export function displayGraphToKernel(graph: DisplayGraph): {
  nodes: Record<string, {
    id: string
    opId: string
    name: string
    position: { x: number; y: number }
    params: Record<string, unknown>
    status: DisplayNode['status']
  }>
  edges: Record<string, DisplayEdge>
} {
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
