// Mappers between the kernel graph model (GraphNode/GraphEdge/OpSpec/NodeGroup)
// and the editor UI model (PipelineNode/PipelineEdge/Battery/NodeGroup).
//
// The kernel is the source of truth; the editor holds a UI-superset Pipeline.
// On read we project the kernel snapshot into the editor model; on write we
// diff the editor Pipeline against the kernel snapshot and emit a minimal Op[].

import {
  diffPipelineToOps as kernelDiffPipelineToOps,
} from '@forgeax/node-runtime/diff-pipeline'
import type {
  GraphEdge,
  GraphNode,
  NodeGroup as KernelNodeGroup,
  Op,
  OpSpec,
  PipelineSnapshot,
} from '@forgeax/node-runtime'

import { GROUP_BATTERY_ID } from '../types.js'
import type {
  Battery,
  BatteryPort,
  CanvasAnnotation,
  CanvasFrame,
  ExposedPort,
  NodeGroup,
  Pipeline,
  PipelineEdge,
  PipelineNode,
  Viewport,
} from '../types.js'

const KERNEL_GROUP_OP_ID = '__group__'

// ── Battery catalog (OpSpec → Battery) ───────────────────────────────────

function toBatteryPort(p: { name: string; type: string; label?: string; description?: string; descriptionEn?: string; options?: string[]; required?: boolean; default?: unknown; access?: 'item' | 'list' | 'tree' }): BatteryPort {
  return {
    name: p.name,
    type: p.type,
    label: p.label,
    description: p.description,
    descriptionEn: p.descriptionEn,
    options: p.options,
    required: p.required,
    default: p.default as unknown,
    access: p.access,
  }
}

/**
 * Project a kernel OpSpec into the editor's Battery catalog entry. The op id is
 * namespaced (e.g. 'scene.csg.union'); the segment before the first dot is
 * used as the default category when the spec carries no explicit grouping.
 */
export function opSpecToBattery(spec: OpSpec): Battery {
  // The kernel OpSpec carries no UI grouping, but a domain backend may re-attach
  // `category` / `displayGroup` hints on the wire (see scene-generator's ops
  // route). Prefer those; otherwise fall back to the op-id namespace.
  const ui = spec as OpSpec & {
    category?: string
    displayGroup?: string
    type?: string
    nodeType?: string
    hideOutputs?: boolean
    iconSvg?: string
    sourcePath?: string
    sourceFiles?: string[]
    manualTrigger?: boolean
    sceneScriptStatus?: Battery['sceneScriptStatus']
    sceneScriptFunctionName?: string
    sceneScriptPassedGates?: string[]
    sceneScriptMissingGates?: string[]
  }
  const category = ui.category ?? (spec.id.includes('.') ? spec.id.split('.')[0] : 'general')
  const displayGroup = ui.displayGroup ?? category
  return {
    id: spec.id,
    name: spec.name ?? spec.id,
    nameEn: spec.nameEn,
    type: 'ts',
    category,
    description: spec.description ?? '',
    descriptionEn: spec.descriptionEn,
    version: '1.0.0',
    // OpSpec ports/params are optional on the wire — some ops ship only inputs,
    // or omit params entirely. Guard each before mapping so one bare spec can't
    // crash the whole battery catalog load (→ an empty BatteryBar).
    inputs: (spec.inputs ?? []).map(toBatteryPort),
    outputs: (spec.outputs ?? []).map(toBatteryPort),
    params: (spec.params ?? []).map(p => ({
      name: p.name,
      // OpParam.type is a free PortType string; narrow to the UI enum, defaulting to 'string'.
      type: (['string', 'number', 'boolean', 'select'].includes(p.type) ? p.type : 'string') as Battery['params'][number]['type'],
      default: p.default as unknown,
      description: p.description,
      options: p.options,
      min: p.min,
      max: p.max,
      label: p.label,
    })),
    dynamicInputs: spec.dynamicInputs,
    dynamicOutputs: spec.dynamicOutputs,
    lacing: spec.lacing,
    principal: spec.principal,
    ...(spec.manualTrigger !== undefined ? { manualTrigger: spec.manualTrigger } : {}),
    displayGroup,
    // UI render hints re-attached by a domain backend on the wire (e.g. from
    // meta.frontend.nodeType / .hideOutputs). Only set when present so plain
    // batteries keep their type-derived defaults.
    ...(ui.nodeType ? { nodeType: ui.nodeType } : {}),
    ...(ui.hideOutputs !== undefined ? { hideOutputs: ui.hideOutputs } : {}),
    ...(ui.iconSvg !== undefined ? { iconSvg: ui.iconSvg } : {}),
    ...(ui.sourcePath !== undefined ? { sourcePath: ui.sourcePath } : {}),
    ...(ui.sourceFiles !== undefined ? { sourceFiles: ui.sourceFiles } : {}),
    ...(ui.sceneScriptStatus !== undefined ? { sceneScriptStatus: ui.sceneScriptStatus } : {}),
    ...(ui.sceneScriptFunctionName !== undefined ? { sceneScriptFunctionName: ui.sceneScriptFunctionName } : {}),
    ...(ui.sceneScriptPassedGates !== undefined ? { sceneScriptPassedGates: ui.sceneScriptPassedGates } : {}),
    ...(ui.sceneScriptMissingGates !== undefined ? { sceneScriptMissingGates: ui.sceneScriptMissingGates } : {}),
    // The shared prompt-substitution op is execution-only: nodes reference it
    // (so it must stay in the catalog for reload resolution), but it must NOT
    // appear as a draggable palette entry — saved prompts surface it instead.
    ...(spec.id === 'prompt_template' ? { paletteHidden: true } : {}),
  }
}

// ── Graph nodes / edges ──────────────────────────────────────────────────

export function graphNodeToPipelineNode(n: GraphNode): PipelineNode {
  return {
    id: n.id,
    batteryId: n.opId,
    name: n.name ?? n.id,
    position: n.position,
    params: { ...n.params },
    status: n.status,
    ...(n.previewEnabled !== undefined ? { previewEnabled: n.previewEnabled } : {}),
  }
}

export function graphEdgeToPipelineEdge(e: GraphEdge): PipelineEdge {
  return { id: e.id, source: { ...e.source }, target: { ...e.target } }
}

export function kernelGroupToEditorGroup(g: KernelNodeGroup): NodeGroup {
  return {
    id: g.id,
    name: g.name,
    nameEn: g.nameEn,
    nodes: g.nodes.map(graphNodeToPipelineNode),
    edges: g.edges.map(graphEdgeToPipelineEdge),
    position: g.position,
    exposedInputs: g.exposedInputs.map(p => ({ ...p } as ExposedPort)),
    exposedOutputs: g.exposedOutputs.map(p => ({ ...p } as ExposedPort)),
    _nestedGroups: g._nestedGroups?.map(kernelGroupToEditorGroup),
  }
}

export function pipelineNodeToGraphNode(n: PipelineNode): GraphNode {
  return {
    id: n.id,
    opId: n.batteryId,
    name: n.name,
    position: n.position,
    params: { ...n.params },
    status: n.status,
    ...(n.previewEnabled !== undefined ? { previewEnabled: n.previewEnabled } : {}),
  }
}

export function pipelineEdgeToGraphEdge(e: PipelineEdge): GraphEdge {
  return { id: e.id, source: { ...e.source }, target: { ...e.target } }
}

export function editorGroupToKernelGroup(g: NodeGroup): KernelNodeGroup {
  const nodes = g.nodes.map(pipelineNodeToGraphNode)
  // Enforce the per-group invariant before the diff turns these into ops: a
  // group's edges + exposed-port inner mappings may ONLY reference the group's
  // own member nodes. Saved group batteries can accrue DANGLING references when
  // an inner node is removed through a path that does not also prune its wires
  // (or the file pre-dates such cleanup). The diff would faithfully emit a
  // `connect` (or member/port mapping) for each phantom endpoint, and the
  // kernel's applyBatch rejects the WHOLE batch ("connect.target.nodeId X does
  // not exist"), so the dropped group never persists and its node vanishes on
  // the next refetch. Prune them here so one corrupt edge can't poison persist.
  const memberIds = new Set(nodes.map((n) => n.id))
  const edges = g.edges.filter((e) => memberIds.has(e.source.nodeId) && memberIds.has(e.target.nodeId))
  const keepPort = (p: ExposedPort): boolean => !p.sourceNodeId || memberIds.has(p.sourceNodeId)
  return {
    id: g.id,
    name: g.name,
    nameEn: g.nameEn,
    nodes,
    edges: edges.map(pipelineEdgeToGraphEdge),
    position: g.position,
    exposedInputs: g.exposedInputs.filter(keepPort).map((p) => ({ ...p })),
    exposedOutputs: g.exposedOutputs.filter(keepPort).map((p) => ({ ...p })),
    _nestedGroups: g._nestedGroups?.map(editorGroupToKernelGroup),
  }
}

/**
 * Build the editor Pipeline from a kernel snapshot (+ optional resolved
 * groups). Preserves identity of the supplied id/name where the caller has a
 * richer prior pipeline.
 */
export function snapshotToPipeline(
  snap: PipelineSnapshot,
  opts: { name?: string; description?: string; groups?: readonly KernelNodeGroup[] } = {},
): Pipeline {
  const nodes = Object.values(snap.nodes).map(graphNodeToPipelineNode)
  const edges = Object.values(snap.edges).map(graphEdgeToPipelineEdge)
  // Layout metadata (viewport / annotations / frames) round-trips through
  // graph.metadata — written by importPipelineGraph / persistViewport, read
  // here so the editor restores the imported canvas exactly (faithful to the
  // legacy normalizePipeline, which preserved these UI-only fields).
  const meta = (snap.metadata ?? {}) as {
    viewport?: Viewport
    annotations?: CanvasAnnotation[]
    frames?: CanvasFrame[]
  }
  return {
    id: snap.id,
    name: opts.name ?? snap.id,
    description: opts.description ?? '',
    nodes,
    edges,
    viewport: meta.viewport ?? { x: 0, y: 0, zoom: 1 },
    status: 'idle',
    createdAt: snap.createdAt,
    updatedAt: snap.updatedAt,
    groups: opts.groups?.map(kernelGroupToEditorGroup),
    ...(meta.annotations !== undefined ? { annotations: meta.annotations } : {}),
    ...(meta.frames !== undefined ? { frames: meta.frames } : {}),
  }
}

// ── Diff (editor Pipeline → Op[]) ────────────────────────────────────────
// UI Pipeline is mapped to kernel DesiredPipelineInput; group/ungroup algebra lives
// in @forgeax/node-runtime layer2/diff-pipeline.ts (single source).

export function diffPipelineToOps(
  desired: Pipeline,
  current: PipelineSnapshot | null,
  currentGroups?: readonly KernelNodeGroup[] | null,
): Op[] {
  return kernelDiffPipelineToOps(
    {
      nodes: desired.nodes.map(pipelineNodeToGraphNode),
      edges: desired.edges.map(pipelineEdgeToGraphEdge),
      ...(desired.groups ? { groups: desired.groups.map(editorGroupToKernelGroup) } : {}),
      ...(desired.annotations !== undefined ? { annotations: desired.annotations } : {}),
      ...(desired.frames !== undefined ? { frames: desired.frames } : {}),
    },
    current,
    currentGroups,
  )
}

// ── Import (whole editor Pipeline → ordered Op[]) ─────────────────────────
//
// The browser-side counterpart of the kernel `importPipelineGraph`: turns a
// whole legacy-shaped editor Pipeline into a single ordered Op[] the editor can
// submit through applyBatch (which then flows through the standard live-sync
// cascade). Use this for an inline graph chosen in the editor; the server route
// (importPipelineFile) is preferred when loading a template file headlessly.

export interface LegacyPipelineToOpsOptions {
  /** 'replace' (default): delete the current graph first. 'merge': additive. */
  mode?: 'replace' | 'merge'
  /** Current kernel snapshot — required to emit deletes (replace) / detect collisions (merge). */
  current?: PipelineSnapshot | null
  /** Auto-remap incoming ids that collide with the current graph (merge). Default: mode === 'merge'. */
  remapIds?: boolean
  /** Explicit incoming-id → new-id map, applied before collision handling. */
  idRemap?: Record<string, string>
  /** opId validator (e.g. against the loaded battery catalog). Unknown ids become diagnostics. */
  validateOps?: (opId: string) => boolean
}

export interface LegacyPipelineToOpsResult {
  ops: Op[]
  /** Incoming node id → final (possibly remapped) node id. */
  nodeIdMap: Record<string, string>
  diagnostics: Array<{ nodeId: string; opId: string; message: string }>
}

type ExposedPortContract = NonNullable<
  NonNullable<Extract<Op, { type: 'createGroup' }>['exposedPorts']>['inputs']
>[number]

/** Flatten editor group shadow nodes + their sub-graphs into plain nodes/edges + group specs. */
function flattenEditorGroups(pipeline: Pipeline): {
  nodes: PipelineNode[]
  edges: PipelineEdge[]
  groups: Array<{ id: string; name: string; nameEn?: string; position: { x: number; y: number }; memberNodeIds: string[]; exposedInputs: ExposedPort[]; exposedOutputs: ExposedPort[] }>
} {
  const groupsById = new Map((pipeline.groups ?? []).map((g) => [g.id, g] as const))
  const shadowToGroup = new Map<string, NodeGroup>()
  const plainNodes: PipelineNode[] = []
  for (const n of pipeline.nodes) {
    if (n.batteryId === GROUP_BATTERY_ID) {
      const groupId = typeof n.params?.groupId === 'string' ? (n.params.groupId as string) : n.id
      const g = groupsById.get(groupId)
      if (g) {
        shadowToGroup.set(n.id, g)
        continue
      }
    }
    plainNodes.push(n)
  }

  const nodes: PipelineNode[] = [...plainNodes]
  for (const g of shadowToGroup.values()) for (const m of g.nodes) nodes.push(m)

  const exposedIn = new Map<string, Map<string, { nodeId: string; port: string }>>()
  const exposedOut = new Map<string, Map<string, { nodeId: string; port: string }>>()
  for (const [shadowId, g] of shadowToGroup) {
    exposedIn.set(shadowId, new Map(g.exposedInputs.map((p) => [p.portName, { nodeId: p.sourceNodeId, port: p.sourcePortName }])))
    exposedOut.set(shadowId, new Map(g.exposedOutputs.map((p) => [p.portName, { nodeId: p.sourceNodeId, port: p.sourcePortName }])))
  }

  const edges: PipelineEdge[] = []
  for (const e of pipeline.edges) {
    let source = { ...e.source }
    let target = { ...e.target }
    if (shadowToGroup.has(e.source.nodeId)) {
      const inner = exposedOut.get(e.source.nodeId)?.get(e.source.port)
      if (inner) source = { ...inner }
    }
    if (shadowToGroup.has(e.target.nodeId)) {
      const inner = exposedIn.get(e.target.nodeId)?.get(e.target.port)
      if (inner) target = { ...inner }
    }
    edges.push({ id: e.id, source, target })
  }
  for (const g of shadowToGroup.values()) for (const e of g.edges) edges.push({ id: e.id, source: { ...e.source }, target: { ...e.target } })

  const groups = Array.from(shadowToGroup.entries()).map(([shadowId, g]) => ({
    id: shadowId,
    name: g.name,
    nameEn: g.nameEn,
    position: pipeline.nodes.find((n) => n.id === shadowId)?.position ?? g.position,
    memberNodeIds: g.nodes.map((m) => m.id),
    exposedInputs: g.exposedInputs,
    exposedOutputs: g.exposedOutputs,
  }))

  return { nodes, edges, groups }
}

function uniqueId(base: string, reserved: ReadonlySet<string>): string {
  let i = 2
  let candidate = `${base}-${i}`
  while (reserved.has(candidate)) candidate = `${base}-${++i}`
  return candidate
}

export function legacyPipelineToOps(
  pipeline: Pipeline,
  opts: LegacyPipelineToOpsOptions = {},
): LegacyPipelineToOpsResult {
  const mode = opts.mode ?? 'replace'
  const { nodes, edges, groups } = flattenEditorGroups(pipeline)
  const diagnostics: Array<{ nodeId: string; opId: string; message: string }> = []

  if (opts.validateOps) {
    for (const n of nodes) {
      if (!opts.validateOps(n.batteryId)) {
        diagnostics.push({ nodeId: n.id, opId: n.batteryId, message: `unknown opId '${n.batteryId}'` })
      }
    }
  }
  if (diagnostics.length > 0) return { ops: [], nodeIdMap: {}, diagnostics }

  const curNodes = opts.current?.nodes ?? {}
  const curEdges = opts.current?.edges ?? {}
  const reserved = new Set<string>(mode === 'merge' ? Object.keys(curNodes) : [])
  const autoRemap = opts.remapIds ?? mode === 'merge'
  const idRemap = opts.idRemap ?? {}

  const nodeIdMap: Record<string, string> = {}
  for (const incoming of [...nodes.map((n) => n.id), ...groups.map((g) => g.id)]) {
    if (nodeIdMap[incoming] !== undefined) continue
    let desired = idRemap[incoming] ?? incoming
    if (reserved.has(desired) && autoRemap) desired = uniqueId(desired, reserved)
    reserved.add(desired)
    nodeIdMap[incoming] = desired
  }
  const remapNode = (id: string): string => nodeIdMap[id] ?? id

  const edgeReserved = new Set<string>(mode === 'merge' ? Object.keys(curEdges) : [])
  const remapEdge = (id: string): string => {
    let desired = id
    if (edgeReserved.has(desired)) desired = uniqueId(desired, edgeReserved)
    edgeReserved.add(desired)
    return desired
  }

  const ops: Op[] = []
  if (mode === 'replace') {
    for (const [id, kn] of Object.entries(curNodes)) {
      if (kn.opId === KERNEL_GROUP_OP_ID) continue
      ops.push({ type: 'deleteNode', nodeId: id })
    }
  }
  for (const n of nodes) {
    ops.push({
      type: 'createNode',
      nodeId: remapNode(n.id),
      opId: n.batteryId,
      position: n.position,
      params: { ...n.params },
      ...(n.name !== undefined ? { name: n.name } : {}),
    })
  }
  for (const e of edges) {
    ops.push({
      type: 'connect',
      edgeId: remapEdge(e.id),
      source: { nodeId: remapNode(e.source.nodeId), port: e.source.port },
      target: { nodeId: remapNode(e.target.nodeId), port: e.target.port },
    })
  }
  for (const g of groups) {
    // Carry the authoritative exposed-port contract through import so the group
    // keeps its stable outward portNames (and overlay) after id remap, instead
    // of the kernel minting fresh sequential names that would strand the
    // boundary edges / drop hide-reorder-rename. sourceNodeId is remapped to the
    // post-import member id; portName stays the stable id.
    const remapContract = (ports: readonly ExposedPort[]): ExposedPortContract[] =>
      ports.map((p) => ({
        portName: p.portName,
        sourceNodeId: remapNode(p.sourceNodeId),
        sourcePortName: p.sourcePortName,
        ...(p.portType !== undefined ? { portType: p.portType } : {}),
        ...(p.hidden !== undefined ? { hidden: p.hidden } : {}),
        ...(p.order !== undefined ? { order: p.order } : {}),
        ...(p.customLabel !== undefined ? { customLabel: p.customLabel } : {}),
        ...(p.customLabelEn !== undefined ? { customLabelEn: p.customLabelEn } : {}),
      }))
    const inputs = remapContract(g.exposedInputs)
    const outputs = remapContract(g.exposedOutputs)
    const exposedPorts =
      inputs.length || outputs.length
        ? { ...(inputs.length ? { inputs } : {}), ...(outputs.length ? { outputs } : {}) }
        : undefined
    ops.push({
      type: 'createGroup',
      groupId: remapNode(g.id),
      name: g.name,
      nameEn: g.nameEn,
      position: g.position,
      memberNodeIds: g.memberNodeIds.map(remapNode),
      ...(exposedPorts ? { exposedPorts } : {}),
    })
  }
  if (mode === 'replace') {
    ops.push({ type: 'setMetadata', key: 'viewport', value: pipeline.viewport })
    if (pipeline.annotations !== undefined) ops.push({ type: 'setMetadata', key: 'annotations', value: pipeline.annotations })
    if (pipeline.frames !== undefined) ops.push({ type: 'setMetadata', key: 'frames', value: pipeline.frames })
  }

  return { ops, nodeIdMap, diagnostics }
}
