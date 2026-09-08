// Build an ordered Op[] that materialises a saved group template (a NodeGroup
// JSON, possibly carrying `_nestedGroups`) onto a graph, every id freshly minted
// so the SAME template can be instantiated many times into one graph without
// collision while keeping its exposed `portName`s stable (in_N/out_N — the
// group's outward battery contract).
//
// SAME-SOURCE NOTICE: this is the backend twin of the CLI's
// `packages/node-runtime-cli/src/commands/node-create-template.ts`
// (`buildTemplateOps`) and of `wb-scene-generator`'s identical lib. The remap +
// topological-ordering + op-build logic is kept byte-for-byte equivalent so all
// code paths produce identical batches. When you change one, change the others.
//
// The template is materialised through an ordered Op[] applied as a single
// atomic batch (via the runtime's applyBatch, same as POST /api/v1/batch):
//   - createNode for every leaf member (deepest groups first),
//   - connect for every inner edge,
//   - createGroup (child groups before their parent) with the AUTHORITATIVE
//     exposedPorts contract so the kernel honours the stable port names.
// We emit the batch directly (rather than via importPipelineGraph) because
// nested groups need the child `createGroup` to MINT the shadow node — importing
// would `createNode` the nested shadow first and then collide on `createGroup`.

import type { Op } from '@forgeax/node-runtime'

const GROUP_OP_ID = '__group__'

export interface RawPos {
  x: number
  y: number
}
interface RawNode {
  id: string
  opId: string
  name?: string
  position?: RawPos
  params?: Record<string, unknown>
}
interface RawEdge {
  id: string
  source: { nodeId: string; port: string }
  target: { nodeId: string; port: string }
}
interface RawExposedPort {
  portName: string
  portType?: string
  access?: 'item' | 'list' | 'tree'
  sourceNodeId: string
  sourcePortName: string
  hidden?: boolean
  order?: number
  customLabel?: string
  customLabelEn?: string
}
export interface RawGroup {
  id: string
  name?: string
  nameEn?: string
  nodes?: RawNode[]
  edges?: RawEdge[]
  position?: RawPos
  exposedInputs?: RawExposedPort[]
  exposedOutputs?: RawExposedPort[]
  _nestedGroups?: RawGroup[]
}

/** A single exposed port description returned to callers (AI/UI) for wiring. */
export interface ExposedPortInfo {
  portName: string
  portType?: string
}

export interface BuildTemplateOpsResult {
  ops: Op[]
  rootGroupId: string
  exposedInputs: ExposedPortInfo[]
  exposedOutputs: ExposedPortInfo[]
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Build a single ordered Op[] that materialises `root` + its nested deps onto a
 * graph, every id freshly minted. Returns the ops plus the new root group id and
 * shadow node id (they are identical — the kernel keys the shadow on the group id).
 */
export function buildTemplateOps(
  root: RawGroup,
  deps: RawGroup[],
  rootPosition: RawPos | undefined,
  explicitGroupId: string | undefined,
): BuildTemplateOpsResult {
  const allGroups = [root, ...deps]
  const tag = Math.random().toString(36).slice(2, 8)

  // 1) Fresh group ids (root may be pinned via explicitGroupId). The shadow node
  //    id equals the group id (kernel invariant), so this map doubles as the
  //    node-id map for nested `__group__` members.
  const groupIdMap: Record<string, string> = {}
  groupIdMap[root.id] = explicitGroupId ?? uid('group')
  for (const d of deps) groupIdMap[d.id] = uid('group')

  // 2) Fresh ids for every NON-group leaf member, across root + deps. A nested
  //    `__group__` member maps to its child group's (already-fresh) id instead.
  const nodeIdMap: Record<string, string> = {}
  for (const g of allGroups) {
    for (const n of g.nodes ?? []) {
      if (n.opId === GROUP_OP_ID) {
        const childOld = typeof n.params?.groupId === 'string' ? n.params.groupId : n.id
        nodeIdMap[n.id] = groupIdMap[childOld] ?? groupIdMap[n.id] ?? uid('node')
      } else {
        nodeIdMap[n.id] = `node_${tag}_${Math.random().toString(36).slice(2, 8)}`
      }
    }
  }
  const mapNode = (id: string): string => nodeIdMap[id] ?? groupIdMap[id] ?? id

  // 3) Order groups so a child is created before any parent that references it.
  //    Parent → child dependency: a group whose members include a `__group__`
  //    pointing at another group must come AFTER that child.
  const byOldId = new Map(allGroups.map((g) => [g.id, g] as const))
  const childrenOf = (g: RawGroup): string[] =>
    (g.nodes ?? [])
      .filter((n) => n.opId === GROUP_OP_ID)
      .map((n) => (typeof n.params?.groupId === 'string' ? n.params.groupId : n.id))
      .filter((cid) => byOldId.has(cid))
  const ordered: RawGroup[] = []
  const seen = new Set<string>()
  const visit = (g: RawGroup): void => {
    if (seen.has(g.id)) return
    seen.add(g.id)
    for (const cid of childrenOf(g)) {
      const child = byOldId.get(cid)
      if (child) visit(child)
    }
    ordered.push(g)
  }
  for (const g of allGroups) visit(g)

  // 4) Emit ops child-first. For each group: createNode its leaf members,
  //    connect its inner edges (every endpoint — leaf or already-created child
  //    shadow — now exists), then createGroup (which packs members + internal
  //    edges away and rewrites boundary edges to stable exposed ports). Doing
  //    this per group, child before parent, is what makes nested groups work:
  //    a child's shadow node exists by the time the parent connects to / groups
  //    it.
  const ops: Op[] = []
  const remapContract = (ports: RawExposedPort[] | undefined) =>
    (ports ?? []).map((p) => ({
      portName: p.portName, // STABLE outward identity — never remapped.
      sourceNodeId: mapNode(p.sourceNodeId),
      sourcePortName: p.sourcePortName,
      ...(p.portType !== undefined ? { portType: p.portType } : {}),
      ...(p.hidden !== undefined ? { hidden: p.hidden } : {}),
      ...(p.order !== undefined ? { order: p.order } : {}),
      ...(p.customLabel !== undefined ? { customLabel: p.customLabel } : {}),
      ...(p.customLabelEn !== undefined ? { customLabelEn: p.customLabelEn } : {}),
    }))
  for (const g of ordered) {
    for (const n of g.nodes ?? []) {
      if (n.opId === GROUP_OP_ID) continue // minted by the child's createGroup
      ops.push({
        type: 'createNode',
        nodeId: mapNode(n.id),
        opId: n.opId,
        position: n.position ?? { x: 0, y: 0 },
        params: { ...(n.params ?? {}) },
        ...(n.name !== undefined ? { name: n.name } : {}),
      } as Op)
    }
    for (const e of g.edges ?? []) {
      ops.push({
        type: 'connect',
        edgeId: `edge_${tag}_${Math.random().toString(36).slice(2, 8)}`,
        source: { nodeId: mapNode(e.source.nodeId), port: e.source.port },
        target: { nodeId: mapNode(e.target.nodeId), port: e.target.port },
      } as Op)
    }
    const memberIds = (g.nodes ?? []).map((n) => mapNode(n.id))
    const inputs = remapContract(g.exposedInputs)
    const outputs = remapContract(g.exposedOutputs)
    const exposedPorts =
      inputs.length || outputs.length
        ? { ...(inputs.length ? { inputs } : {}), ...(outputs.length ? { outputs } : {}) }
        : undefined
    const isRoot = g.id === root.id
    ops.push({
      type: 'createGroup',
      groupId: groupIdMap[g.id]!,
      name: g.name ?? g.id,
      ...(g.nameEn !== undefined ? { nameEn: g.nameEn } : {}),
      ...(isRoot && rootPosition === undefined
        ? {}
        : { position: isRoot ? rootPosition! : (g.position ?? { x: 0, y: 0 }) }),
      memberNodeIds: memberIds,
      ...(exposedPorts ? { exposedPorts } : {}),
    } as Op)
  }

  const portInfo = (ports: RawExposedPort[] | undefined): ExposedPortInfo[] =>
    (ports ?? []).map((p) => ({
      portName: p.portName,
      ...(p.portType !== undefined ? { portType: p.portType } : {}),
    }))

  return {
    ops,
    rootGroupId: groupIdMap[root.id]!,
    exposedInputs: portInfo(root.exposedInputs),
    exposedOutputs: portInfo(root.exposedOutputs),
  }
}

/**
 * Normalise a parsed template file into `{ root, deps }`. Accepts a bare
 * NodeGroup or a `{ graph: NodeGroup }` wrapper (symmetry with import file
 * shape). `_nestedGroups` is split off as deps. Returns null when the parsed
 * value isn't a NodeGroup-shaped object.
 */
export function splitTemplate(parsed: unknown): { root: RawGroup; deps: RawGroup[] } | null {
  const obj = parsed as (RawGroup & { graph?: RawGroup }) | null
  if (!obj || typeof obj !== 'object') return null
  const raw = (obj.nodes || obj.exposedInputs || obj.exposedOutputs ? obj : obj.graph) as RawGroup | undefined
  if (!raw || (!raw.nodes && !raw.exposedInputs && !raw.exposedOutputs)) return null
  const deps = raw._nestedGroups ?? []
  const { _nestedGroups, ...root } = raw
  void _nestedGroups
  return { root: root as RawGroup, deps: deps as RawGroup[] }
}
