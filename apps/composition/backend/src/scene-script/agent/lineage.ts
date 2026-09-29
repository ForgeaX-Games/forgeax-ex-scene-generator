import { stableHash, type ResultLineage, type SourceMapEntry } from '@forgeax/scene-authoring'
import type { ExecutionResult } from '@forgeax/node-runtime'
import {
  childrenOf,
  parseScenePort,
  pathOf,
} from '../../../../vendor/dist/shared/types/scene/index.js'

function sceneItems(value: unknown, out: unknown[] = []): unknown[] {
  if (Array.isArray(value)) {
    for (const item of value) sceneItems(item, out)
  } else if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (Array.isArray(record.items)) sceneItems(record.items, out)
    else if(parseScenePort(value)) out.push(value)
  }
  return out
}

function sceneNodeRefs(value: unknown): ResultLineage['sceneNodes'] {
  const refs: ResultLineage['sceneNodes'] = []
  const seen = new Set<string>()
  sceneItems(value).forEach((item, graphIndex) => {
    const port = parseScenePort(item)
    if (!port) return
    const visit = (id: string): void => {
      const path = pathOf(port.graph, id) ?? port.focusOrigin ?? '/'
      const key = `${graphIndex}\0${id}\0${path}`
      if (!seen.has(key)) {
        seen.add(key)
        refs.push({ id, path, ...(graphIndex ? { graphIndex } : {}) })
      }
      for (const child of childrenOf(port.graph, id)) visit(child.id)
    }
    visit(port.focus)
  })
  return refs.sort((a, b) =>
    (a.graphIndex ?? 0) - (b.graphIndex ?? 0)
    || a.path.localeCompare(b.path)
    || a.id.localeCompare(b.id))
}

function preferArgumentEntry(entries: readonly SourceMapEntry[]): SourceMapEntry | undefined {
  return entries.find((entry) => entry.argument) ?? entries[0]
}

/** Public graph id is `@scene-id` / entityId. `runtimeNodeIds` are group/repeat internals. */
export function sourceEntryFor(sourceMap: readonly SourceMapEntry[], runtimeNodeId: string): SourceMapEntry | undefined {
  const exact = sourceMap.filter((entry) => entry.entityId === runtimeNodeId)
  if (exact.length > 0) return preferArgumentEntry(exact)
  return preferArgumentEntry(sourceMap.filter((entry) => entry.runtimeNodeIds.includes(runtimeNodeId)))
}

/** Build bounded lineage only; result values remain in the output cache. */
export function buildExecutionLineage(
  result: ExecutionResult,
  sourceMap: readonly SourceMapEntry[],
  readOutput: (nodeId: string, port: string) => unknown,
): ResultLineage[] {
  const lineage: ResultLineage[] = []
  for (const [nodeId, ports] of Object.entries(result.resultMetadata ?? {})) {
    const source = sourceEntryFor(sourceMap, nodeId)
    if (!source) continue
    for (const [port, metadata] of Object.entries(ports)) {
      const value = result.outputs[nodeId]?.[port] ?? readOutput(nodeId, port)
      const sceneNodes = metadata.outputType === 'scene' || metadata.outputType === 'any'
        ? sceneNodeRefs(value)
        : []
      const lineageId = `result:${stableHash(`${nodeId}\0${port}\0${source.moduleId}\0${source.statementId}`)}`
      lineage.push({
        lineageId,
        runtime: {
          nodeId,
          port,
          ...(source.runtimeEdgeIds.length ? { edgeIds: [...source.runtimeEdgeIds].sort() } : {}),
        },
        authoring: {
          moduleId: source.moduleId,
          file: source.file,
          statementId: source.statementId,
          entityId: source.entityId,
          source: source.source,
          ...(source.definitionId ? { definitionId: source.definitionId } : {}),
          ...(source.definitionVersion ? { definitionVersion: source.definitionVersion } : {}),
          ...(source.instancePath ? { instancePath: source.instancePath } : {}),
          ...(source.runtimeOrigins?.[nodeId] ? { runtimeOrigin: source.runtimeOrigins[nodeId] } : {}),
        },
        sceneNodes,
        bakedLayers: [],
        summary: {
          sceneNodeCount: sceneNodes.length,
          bakedLayerCount: 0,
          payload: 'reference-only',
        },
      })
    }
  }
  return lineage.sort((a, b) => a.lineageId.localeCompare(b.lineageId))
}

export function attachBakedLayers(
  lineage: readonly ResultLineage[],
  mappings: ReadonlyArray<{ sourcePath: string; bakedPath: string }>,
): ResultLineage[] {
  return lineage.map((entry) => {
    const additions = mappings.flatMap(({ sourcePath, bakedPath }) => {
      const scene = entry.sceneNodes.find((node) => node.path === sourcePath)
      return scene ? [{
        id: bakedPath,
        path: bakedPath,
        sourceSceneNodeId: scene.id,
        sourceScenePath: scene.path,
        cellSource: { kind: 'scene-node-content' as const, ref: `scene-node:${scene.id}/content` },
      }] : []
    })
    const bakedLayers = [...new Map(
      [...entry.bakedLayers, ...additions].map((layer) => [layer.id, layer]),
    ).values()].sort((a, b) => a.path.localeCompare(b.path))
    return {
      ...entry,
      bakedLayers,
      summary: { ...entry.summary, bakedLayerCount: bakedLayers.length },
    }
  })
}

export interface LineageQuery {
  sceneNodeId?: string
  path?: string
  bakedLayerId?: string
  runtimeNodeId?: string
}

export function queryResultLineage(
  lineage: readonly ResultLineage[],
  query: LineageQuery,
): ResultLineage[] {
  return lineage.filter((entry) =>
    (query.sceneNodeId ? entry.sceneNodes.some((node) => node.id === query.sceneNodeId) : false)
    || (query.path
      ? entry.sceneNodes.some((node) => node.path === query.path)
        || entry.bakedLayers.some((layer) => layer.path === query.path)
      : false)
    || (query.bakedLayerId
      ? entry.bakedLayers.some((layer) => layer.id === query.bakedLayerId || layer.path === query.bakedLayerId)
      : false)
    || (query.runtimeNodeId
      ? entry.runtime.nodeId === query.runtimeNodeId || entry.authoring.entityId === query.runtimeNodeId
      : false))
}
