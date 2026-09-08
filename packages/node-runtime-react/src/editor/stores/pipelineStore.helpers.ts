// Pure helpers for the pipeline store — kept out of the store body so the
// store file reads as state + actions only.

import { formatIdAsLabel } from '../utils/batteryLabels.js'
import type { Battery, Pipeline, PipelineEdge, PipelineNode } from '../types.js'

type DynamicPort = { name: string; type: string; label: string; access?: string }

/** Resolve an output port's logical type from the live graph + battery catalog. */
export function resolveOutputPortType(
  pipeline: Pipeline | null,
  batteries: readonly Battery[],
  dynamicOutputPorts: Readonly<Record<string, readonly DynamicPort[]>>,
  nodeId: string,
  portId: string,
): string | undefined {
  if (!pipeline) return undefined
  const node = pipeline.nodes.find((n) => n.id === nodeId)
  if (!node) return undefined
  const dyn = dynamicOutputPorts[nodeId]?.find((p) => p.name === portId)
  if (dyn?.type) return dyn.type
  const battery = batteries.find((b) => b.id === node.batteryId)
  const spec = battery?.outputs.find((p) => p.name === portId)
  return spec?.type
}

/** Distinct output ports the editor hydrates for probes / tooltips. */
export function collectVisibleOutputPorts(
  pipeline: Pipeline,
  batteries: readonly Battery[],
  dynamicOutputPorts: Readonly<Record<string, readonly DynamicPort[]>>,
  scope: 'edges' | 'all',
): Array<{ nodeId: string; port: string }> {
  const seen = new Set<string>()
  const ports: Array<{ nodeId: string; port: string }> = []
  const addPort = (nodeId: string, port: string) => {
    const key = `${nodeId}\u0000${port}`
    if (seen.has(key)) return
    seen.add(key)
    ports.push({ nodeId, port })
  }
  for (const edge of pipeline.edges) {
    addPort(edge.source.nodeId, edge.source.port)
  }
  if (scope !== 'all') return ports

  const groupsById = new Map((pipeline.groups ?? []).map((g) => [g.id, g] as const))
  for (const node of pipeline.nodes) {
    if (node.batteryId === '__group__') {
      const groupId = typeof node.params?.groupId === 'string' ? node.params.groupId : node.id
      const group = groupsById.get(groupId)
      if (group) {
        for (const ep of group.exposedOutputs) {
          if (!ep.hidden) addPort(node.id, ep.portName)
        }
      }
    } else {
      const battery = batteries.find((b) => b.id === node.batteryId)
      if (battery && !battery.hideOutputs) {
        for (const port of battery.outputs) {
          if (!port.hidden) addPort(node.id, port.name)
        }
      }
    }
    for (const port of dynamicOutputPorts[node.id] ?? []) {
      addPort(node.id, port.name)
    }
  }
  return ports
}

/**
 * Output ports the editor deliberately never hydrates because the UI hides the
 * handle — sink batteries (`scene_output`: `hideOutputs`) and group ports marked
 * `hidden`. They still own a kernel output cache, and the renderer reads it, so
 * a stale one has to be able to trigger a re-execute on open even though no
 * probe / tooltip will ever ask for its value. Restricted to nodes with an
 * incoming edge: an unwired sink has nothing to compute, and treating its
 * permanently-empty cache as "stale" would re-run the graph on every open.
 */
export function collectHiddenOutputPorts(
  pipeline: Pipeline,
  batteries: readonly Battery[],
  dynamicOutputPorts: Readonly<Record<string, readonly DynamicPort[]>>,
): Array<{ nodeId: string; port: string }> {
  const visible = new Set(
    collectVisibleOutputPorts(pipeline, batteries, dynamicOutputPorts, 'all').map(
      ({ nodeId, port }) => `${nodeId}\u0000${port}`,
    ),
  )
  const wired = new Set(pipeline.edges.map((e) => e.target.nodeId))
  const groupsById = new Map((pipeline.groups ?? []).map((g) => [g.id, g] as const))
  const hidden: Array<{ nodeId: string; port: string }> = []
  for (const node of pipeline.nodes) {
    if (!wired.has(node.id)) continue
    let names: string[]
    if (node.batteryId === '__group__') {
      const groupId = typeof node.params?.groupId === 'string' ? node.params.groupId : node.id
      names = (groupsById.get(groupId)?.exposedOutputs ?? []).map((ep) => ep.portName)
    } else {
      names = (batteries.find((b) => b.id === node.batteryId)?.outputs ?? []).map((p) => p.name)
    }
    for (const port of names) {
      if (visible.has(`${node.id}\u0000${port}`)) continue
      hidden.push({ nodeId: node.id, port })
    }
  }
  return hidden
}

/** Visible output ports with no hydrated value in the editor cache. */
export function listMissingVisibleOutputPorts(
  pipeline: Pipeline,
  batteries: readonly Battery[],
  dynamicOutputPorts: Readonly<Record<string, readonly DynamicPort[]>>,
  nodeOutputs: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): Array<{ nodeId: string; port: string }> {
  return collectVisibleOutputPorts(pipeline, batteries, dynamicOutputPorts, 'all').filter(
    ({ nodeId, port }) => nodeOutputs[nodeId]?.[port] === undefined,
  )
}

/**
 * BFS the set of downstream node ids reachable from startId (inclusive).
 * Used to scope incremental execution to the affected sub-graph.
 */
export function getDownstreamIds(startId: string, edges: PipelineEdge[]): string[] {
  const visited = new Set<string>([startId])
  const queue = [startId]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const edge of edges) {
      if (edge.source.nodeId === current && !visited.has(edge.target.nodeId)) {
        visited.add(edge.target.nodeId)
        queue.push(edge.target.nodeId)
      }
    }
  }
  return Array.from(visited)
}

/** English display name for history `labelEn` so AI/programmatic ops never leak zh names. */
export function nodeNameEn(node: { name?: string; batteryId?: string }, batteries: readonly Battery[]): string {
  const battery = batteries.find((b) => b.id === node.batteryId)
  if (battery?.nameEn) return battery.nameEn
  if (node.batteryId && node.batteryId !== '__group__') return formatIdAsLabel(node.batteryId)
  return node.name ?? node.batteryId ?? 'node'
}

/** Carry `previewEnabled` across snapshot reloads when the incoming node omits it. */
export function carryPreviewEnabledNodes(
  prevNodes: ReadonlyArray<PipelineNode> | undefined,
  pipeline: Pipeline,
): PipelineNode[] {
  const prevPreview = new Map(
    (prevNodes ?? []).map((n) => [n.id, n.previewEnabled] as const),
  )
  return pipeline.nodes.map((n) => {
    if (n.previewEnabled !== undefined) return n
    const prev = prevPreview.get(n.id)
    return prev !== undefined ? { ...n, previewEnabled: prev } : n
  })
}

const VALUE_COMPARE_BUDGET = 64 * 1024

function exceedsCompareBudget(value: unknown, budget: number): boolean {
  let size = 0
  const stack: unknown[] = [value]
  while (stack.length > 0) {
    const cur = stack.pop()
    if (cur === null || cur === undefined) size += 4
    else if (typeof cur === 'string') size += cur.length + 2
    else if (typeof cur === 'number' || typeof cur === 'boolean') size += 8
    else if (Array.isArray(cur)) {
      size += 2
      for (const el of cur) stack.push(el)
    } else if (typeof cur === 'object') {
      for (const k in cur as Record<string, unknown>) {
        size += k.length + 3
        stack.push((cur as Record<string, unknown>)[k])
      }
    }
    if (size > budget) return true
  }
  return false
}

/**
 * Cheap equality for a cached output port value. Primitives short-circuit via
 * Object.is; small objects/arrays compare via JSON; large scene/voxel values
 * skip the compare (treated as changed) so we never stringify multi-MB trees.
 */
export function outputValuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (exceedsCompareBudget(a, VALUE_COMPARE_BUDGET) || exceedsCompareBudget(b, VALUE_COMPARE_BUDGET)) {
    return false
  }
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

/** A fresh, empty working pipeline created when the first node is added. */
export function createEmptyPipeline(): Pipeline {
  const now = new Date().toISOString()
  return {
    id: `pipeline-${Date.now()}`,
    name: 'untitled-pipeline',
    description: '',
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    status: 'idle',
    createdAt: now,
    updatedAt: now,
  }
}
