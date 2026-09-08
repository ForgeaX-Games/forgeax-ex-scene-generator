// Reconcile a desired pipeline graph against the kernel snapshot and emit a
// minimal Op[] batch. Single source for group/ungroup/boundary algebra — the
// editor transport layer maps UI Pipeline → DesiredPipelineInput and delegates here.

import type { ExposedPort, GraphEdge, GraphNode, NodeGroup as KernelNodeGroup } from '../layer1/types/graph.js'
import type { PipelineSnapshot } from './queries.js'
import { GROUP_OP_ID } from './group-constants.js'
import type { Op } from './apply-batch.js'

// diffPipelineToOps — reconcile a desired graph against the kernel snapshot. ────────────────────────────────────────

function paramsEqual(
  a: Record<string, unknown> | null | undefined,
  b: Record<string, unknown> | null | undefined,
): boolean {
  // A node may arrive with missing params (legacy graph, relay/panel node created
  // without a params object); treat null/undefined as an empty bag so the diff
  // never throws (`Object.keys(null)` → "Cannot convert undefined or null to object",
  // which aborted the whole persist).
  const sa = a ?? {}
  const sb = b ?? {}
  const ka = Object.keys(sa)
  const kb = Object.keys(sb)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    if (!Object.is(sa[k], sb[k])) {
      // Fall back to structural compare for nested values.
      if (JSON.stringify(sa[k]) !== JSON.stringify(sb[k])) return false
    }
  }
  return true
}

/**
 * Order-insensitive equality for a group's internal member-to-member edges.
 * Compares by a canonical `id|src.port>tgt.port` signature so a pure reorder is
 * not seen as a change but an added/removed/rewired edge is.
 */
function innerEdgesEqual(a: readonly GraphEdge[], b: readonly GraphEdge[]): boolean {
  if (a.length !== b.length) return false
  const sig = (e: GraphEdge) => `${e.id}\u0000${e.source.nodeId}.${e.source.port}\u0000${e.target.nodeId}.${e.target.port}`
  const sa = a.map(sig).sort()
  const sb = b.map(sig).sort()
  return sa.every((s, i) => s === sb[i])
}

/**
 * Order-insensitive equality for a group's inner member nodes. We compare ONLY
 * the membership (set of ids) and each member's `params`, because those are the
 * sole things an inner-view edit can change for an existing member:
 *   - add / remove a member → the id set (and length) differs
 *   - edit an inner node's params → params differ
 * `opId` is deliberately NOT compared (inner editing never changes a node's
 * battery type, and the editor↔kernel shapes name it differently —
 * batteryId vs opId). `name` is also NOT compared (the editor defaults an
 * absent name to the node id, so a kernel node with no name would otherwise
 * read as a spurious change on every persist).
 */
function innerNodesEqual(a: readonly GraphNode[], b: readonly GraphNode[]): boolean {
  if (a.length !== b.length) return false
  const byId = new Map(b.map((n) => [n.id, n] as const))
  for (const n of a) {
    const m = byId.get(n.id)
    if (!m) return false
    if (!paramsEqual(n.params, m.params)) return false
    if ((n.previewEnabled ?? true) !== (m.previewEnabled ?? true)) return false
  }
  return true
}

/** Structural equality for an inner-layout map (key → {x,y}). */
function innerLayoutEqual(
  a: Record<string, { x: number; y: number }> | undefined,
  b: Record<string, { x: number; y: number }> | undefined,
): boolean {
  const sa = a ?? {}
  const sb = b ?? {}
  const ka = Object.keys(sa)
  const kb = Object.keys(sb)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    const pa = sa[k]
    const pb = sb[k]
    if (!pb || pa.x !== pb.x || pa.y !== pb.y) return false
  }
  return true
}

/** The `exposedPorts` patch payload carried by an `updateGroup` op. */
type ExposedPortsPatch = NonNullable<Extract<Op, { type: 'updateGroup' }>['exposedPorts']>
type ExposedPortPatch = NonNullable<ExposedPortsPatch['inputs']>[number]

/** The authoritative `exposedPorts` contract carried by a `createGroup` op. */
type ExposedPortsContract = NonNullable<Extract<Op, { type: 'createGroup' }>['exposedPorts']>
type ExposedPortContract = NonNullable<ExposedPortsContract['inputs']>[number]

/**
 * Build the AUTHORITATIVE exposed-port contract for a createGroup op from a
 * group's exposed ports. Group = first-class battery: the `portName` carried on
 * each ExposedPort is a STABLE id (minted once at the group's birth, preserved
 * verbatim across template remap), so we hand it to the kernel as the boundary
 * identity together with its inner mapping (sourceNodeId/sourcePortName) and any
 * presentation overlay. The kernel rewrites boundary edges to these stable names
 * instead of re-deriving from the (volatile) inner node id — the fix for the
 * "drop a saved group → ports disconnect / no result" bug.
 *
 * Always returns a contract when the group has any exposed port, so both
 * "select nodes → group" and "drop a saved template" travel the same
 * stable-name path. Returns undefined only for a degenerate portless group.
 */
function buildCreateGroupContract(group: KernelNodeGroup): ExposedPortsContract | undefined {
  const collect = (ports: readonly ExposedPort[]): ExposedPortContract[] =>
    ports.map((port) => ({
      portName: port.portName,
      sourceNodeId: port.sourceNodeId,
      sourcePortName: port.sourcePortName,
      ...(port.portType !== undefined ? { portType: port.portType } : {}),
      ...(port.hidden !== undefined ? { hidden: port.hidden } : {}),
      ...(port.order !== undefined ? { order: port.order } : {}),
      ...(port.customLabel !== undefined ? { customLabel: port.customLabel } : {}),
      ...(port.customLabelEn !== undefined ? { customLabelEn: port.customLabelEn } : {}),
    }))
  const inputs = collect(group.exposedInputs)
  const outputs = collect(group.exposedOutputs)
  if (inputs.length === 0 && outputs.length === 0) return undefined
  return { ...(inputs.length ? { inputs } : {}), ...(outputs.length ? { outputs } : {}) }
}

/**
 * Diff the presentation overlay (hidden / order / customLabel*) of a desired
 * editor group against the current kernel group, per direction, keyed by
 * portName. Emits only the fields that actually changed, so a persist that did
 * not touch any overlay produces no `exposedPorts` patch (and thus no spurious
 * `graph:applied` re-pull). Returns `undefined` when nothing changed.
 *
 * When `current` is unknown (no kernel group snapshot supplied) we fall back to
 * sending any overlay field the desired port defines, so the very first
 * persist after a hide/reorder still reaches the kernel; applyUpdateGroup is
 * idempotent by portName so a redundant resend is harmless.
 */
function diffExposedPortOverlay(
  desired: KernelNodeGroup,
  current: KernelNodeGroup | undefined,
): ExposedPortsPatch | undefined {
  const inputs = diffOverlayDirection(desired.exposedInputs, current?.exposedInputs)
  const outputs = diffOverlayDirection(desired.exposedOutputs, current?.exposedOutputs)
  if (!inputs && !outputs) return undefined
  return { ...(inputs ? { inputs } : {}), ...(outputs ? { outputs } : {}) }
}

/** The full exposed-port wiring payload carried by an `updateGroup` op. */
type ExposedWiring = NonNullable<Extract<Op, { type: 'updateGroup' }>['exposedWiring']>

/**
 * True when the exposed-port SET or wiring authority changed between the desired
 * (editor) and current (kernel) port arrays — i.e. a shell add / true-delete /
 * rebind, which the overlay-only patch cannot express. Pure overlay edits
 * (hidden / order / customLabel) are ignored here; they travel via
 * `diffExposedPortOverlay`.
 */
function exposedWiringChanged(
  desired: readonly ExposedPort[],
  current: readonly ExposedPort[],
): boolean {
  if (desired.length !== current.length) return true
  const curByName = new Map(current.map((p) => [p.portName, p] as const))
  for (const p of desired) {
    const cur = curByName.get(p.portName)
    if (!cur) return true
    if (cur.sourceNodeId !== p.sourceNodeId) return true
    if (cur.sourcePortName !== p.sourcePortName) return true
    if (cur.portType !== p.portType) return true
    if ((cur.access ?? undefined) !== (p.access ?? undefined)) return true
  }
  return false
}

/**
 * Diff the exposed-port wiring (full set replacement) of a desired editor group
 * against the current kernel group, per direction. Returns the FULL desired
 * arrays (overlay rides along) for any direction whose set/wiring changed, so
 * `applyUpdateGroup` can replace it wholesale. Returns `undefined` when only the
 * overlay (or nothing) changed — that path stays on the lightweight patch.
 */
function diffExposedPortWiring(
  desired: KernelNodeGroup,
  current: KernelNodeGroup,
): ExposedWiring | undefined {
  const clone = (ports: readonly ExposedPort[]): ExposedPort[] => ports.map((p) => ({ ...p }))
  const inputs = exposedWiringChanged(desired.exposedInputs, current.exposedInputs)
    ? clone(desired.exposedInputs)
    : undefined
  const outputs = exposedWiringChanged(desired.exposedOutputs, current.exposedOutputs)
    ? clone(desired.exposedOutputs)
    : undefined
  if (!inputs && !outputs) return undefined
  return { ...(inputs ? { inputs } : {}), ...(outputs ? { outputs } : {}) }
}

function diffOverlayDirection(
  desired: readonly ExposedPort[],
  current: readonly { portName: string; hidden?: boolean; order?: number; customLabel?: string; customLabelEn?: string }[] | undefined,
): ExposedPortPatch[] | undefined {
  const curByName = current ? new Map(current.map((p) => [p.portName, p] as const)) : undefined
  const patches: ExposedPortPatch[] = []
  for (const port of desired) {
    const cur = curByName?.get(port.portName)
    // No current snapshot → always (re)send any defined overlay; else only send
    // the fields whose value differs. applyUpdateGroup is idempotent by portName
    // so a redundant resend is harmless. Fields are assigned explicitly (not via
    // a dynamic key loop) to stay type-safe under tsc -b.
    const wants = (key: 'hidden' | 'order' | 'customLabel' | 'customLabelEn'): boolean =>
      port[key] !== undefined && (cur === undefined || cur[key] !== port[key])
    let patch: ExposedPortPatch | undefined
    if (wants('hidden')) patch = { ...(patch ?? { portName: port.portName }), hidden: port.hidden }
    if (wants('order')) patch = { ...(patch ?? { portName: port.portName }), order: port.order }
    if (wants('customLabel')) patch = { ...(patch ?? { portName: port.portName }), customLabel: port.customLabel }
    if (wants('customLabelEn')) patch = { ...(patch ?? { portName: port.portName }), customLabelEn: port.customLabelEn }
    if (patch) patches.push(patch)
  }
  return patches.length > 0 ? patches : undefined
}

/**
 *
 * Covers plain nodes/edges (create/update/delete/connect/disconnect). Group
 * shadow nodes (opId === '__group__') are skipped here — group structure
 * is mutated through dedicated group ops (see apiAdapter.saveGroup).
 */
export interface DesiredPipelineInput {
  nodes: readonly GraphNode[]
  edges: readonly GraphEdge[]
  groups?: readonly KernelNodeGroup[]
  annotations?: unknown[]
  frames?: unknown[]
}

export function diffPipelineToOps(
  desired: DesiredPipelineInput,
  current: PipelineSnapshot | null,
  currentGroups?: readonly KernelNodeGroup[] | null,
): Op[] {
  const ops: Op[] = []
  const curNodes = current?.nodes ?? {}
  const curEdges = current?.edges ?? {}
  const curGroupsById = new Map((currentGroups ?? []).map((g) => [g.id, g] as const))
  const newGroups: Array<{ shadowId: string; group: KernelNodeGroup; position: { x: number; y: number }; name: string; nameEn?: string }> = []
  const existingGroups: Array<{ shadowId: string; group: KernelNodeGroup; position: { x: number; y: number }; name: string; nameEn?: string }> = []
  const deletedGroupIds = new Set<string>()
  const deletedNodeIds = new Set<string>()

  // Pre-pass: collect all desired top-level node ids (group shadows included)
  // so ungroup detection below can see the restored inner members before we
  // emit createNode ops for them — AND so the group-classification loop can
  // skip restored nested shadows (see the guard there).
  const desiredNodeIds = new Set<string>()
  for (const node of desired.nodes) desiredNodeIds.add(node.id)

  // Pre-pass: a kernel group shadow that is absent from the top-level desired
  // nodes is NOT necessarily deleted — it may have been NESTED as a member of a
  // (possibly new) parent group, where it lives inside `desired.groups[].nodes`
  // rather than at top level. Collect every node id that appears as a member of
  // ANY desired group whose parent shadow IS still present in the desired graph
  // (i.e. a real, surviving parent — not itself a deleted group). The deleted-
  // group loop below must PRESERVE such children: nesting keeps the child's flat
  // registry entry and the parent's createGroup references it as a member. The
  // OLD code emitted `deleteGroup child` BEFORE the parent's `createGroup`, so by
  // the time createGroup ran the member no longer existed → "member X does not
  // exist" op-validation failure (the "nest group batteries → no result" bug).
  const nestedIntoSurvivingParent = new Set<string>()
  for (const g of desired.groups ?? []) {
    // The group's own shadow must survive in the desired graph for it to be a
    // real parent (a group whose shadow is gone is itself being deleted/ungrouped
    // and its members are handled by those paths).
    if (!desiredNodeIds.has(g.id)) continue
    for (const member of g.nodes) nestedIntoSurvivingParent.add(member.id)
  }

  // Deleted groups (present in kernel, absent in desired). Two distinct cases:
  //   • UNGROUP — the group's former member nodes are now present as top-level
  //     nodes in the desired graph. Emit the kernel-native `ungroup` op: it
  //     restores inner nodes + inner edges and REWRITES the boundary edges back
  //     to the inner endpoints IN PLACE (ids preserved). We then treat those
  //     inner nodes / inner edges / boundary edges as kernel-owned so the rest
  //     of this diff does NOT try to re-create them — re-creating the inner
  //     nodes would COLLIDE (applyUngroup re-introduces them), and re-creating
  //     the boundary edges is unnecessary (the kernel rewrites them in place,
  //     same ids). The OLD path emitted deleteGroup instead, whose cascade
  //     dropped the boundary edges while the diff skipped re-adding them (their
  //     ids already existed pre-delete) — the ungroup-disconnect bug.
  //   • DELETE COMPOSITE — the members are gone too (the user deleted the whole
  //     group node). Cascade-delete via `deleteGroup`.
  // This block runs BEFORE the group-classification loop so the latter can see
  // `ungroupedInnerNodeIds` and skip restored nested shadows. The classification
  // loop never feeds this block (it only reads desired nodes + the kernel
  // snapshot), so the reordering is behaviour-preserving for the non-nested case.
  const ungroupedInnerNodeIds = new Set<string>()
  const ungroupedInnerEdgeIds = new Set<string>()
  for (const [id, kn] of Object.entries(curNodes) as Array<[string, GraphNode]>) {
    if (kn.opId !== GROUP_OP_ID) continue
    if (desiredNodeIds.has(id)) continue
    // A child group nested into a surviving parent is NOT deleted — it becomes a
    // __group__ member of that parent (flat registry keeps its entry; the
    // parent's createGroup references it). Skipping it here prevents the
    // delete-before-createGroup ordering that stranded the member.
    if (nestedIntoSurvivingParent.has(id)) continue
    const kernelGroup = curGroupsById.get(id)
    const memberIds = kernelGroup?.nodes.map((n) => n.id) ?? []
    const isUngroup =
      memberIds.length > 0 && memberIds.every((mid) => desiredNodeIds.has(mid))
    if (isUngroup && kernelGroup) {
      ops.push({ type: 'ungroup', groupId: id })
      // A restored member may itself be a __group__ shadow (nested group). It is
      // part of kernelGroup.nodes, so the kernel's ungroup op re-introduces it
      // at top level and its sub-group entry persists in the flat registry. We
      // record every member id here so neither the createNode loop NOR the
      // group-classification loop emits a fresh createNode/createGroup for it (a
      // redundant createGroup would collide — `group already exists`).
      for (const n of kernelGroup.nodes) ungroupedInnerNodeIds.add(n.id)
      for (const e of kernelGroup.edges) ungroupedInnerEdgeIds.add(e.id)
      // Boundary edges currently wired to the group shadow are rewritten (not
      // deleted) by applyUngroup; the editor's restored copies reuse the same
      // ids (sans `_redir`), so mark them kernel-owned to avoid a redundant
      // connect that the kernel would reject as a duplicate.
      for (const [edgeId, edge] of Object.entries(curEdges) as Array<[string, GraphEdge]>) {
        if (!edge) continue
        if (edge.source.nodeId === id || edge.target.nodeId === id) {
          ungroupedInnerEdgeIds.add(edgeId.replace(/_redir$/, ''))
        }
      }
    } else {
      deletedGroupIds.add(id)
      ops.push({ type: 'deleteGroup', groupId: id })
    }
  }

  for (const node of desired.nodes) {
    if (node.opId !== GROUP_OP_ID) continue
    // A restored nested shadow promoted by the kernel `ungroup` op above is
    // kernel-owned: the ungroup re-introduces it as a top-level node and its
    // sub-group entry stays in the flat registry. It is absent from the
    // top-level `curNodes` snapshot (it was deleted into its parent at create
    // time), which would otherwise route it to `newGroups` → a redundant
    // createGroup the kernel rejects as already-existing. Skip it entirely so it
    // becomes neither a new nor an existing group.
    if (ungroupedInnerNodeIds.has(node.id)) continue
    const groupId = typeof node.params?.groupId === 'string' ? node.params.groupId : node.id
    const group = (desired.groups ?? []).find((g) => g.id === groupId)
    if (!group) continue
    const entry = {
      shadowId: node.id,
      group,
      position: node.position ?? group.position,
      // The KernelNodeGroup is the SSOT for the group name: renameGroup (e.g. the
      // save-as-template dialog) updates group.name but NOT the `__group__`
      // shadow node's mirror `name`, so a stale shadow name must never mask the
      // authoritative group name. (Falling back to node.name only when the
      // group has no name keeps freshly-built shadows working.) Prioritising
      // node.name here was why a renamed group still persisted "Group Node" to
      // the live kernel group and a later drag-out showed it.
      name: group.name || node.name || node.id,
      nameEn: group.nameEn,
    }
    if (curNodes[node.id]?.opId === GROUP_OP_ID) existingGroups.push(entry)
    else newGroups.push(entry)
  }
  const newGroupIds = new Set(newGroups.map((g) => g.shadowId))
  const newGroupMemberIds = new Set(newGroups.flatMap((g) => g.group.nodes.map((n) => n.id)))

  for (const node of desired.nodes) {
    if (node.opId === GROUP_OP_ID) {
      // Group shadow nodes are owned by group ops.
      continue
    }
    // Ungrouped members are re-introduced by the kernel `ungroup` op above —
    // emitting createNode here would collide with that restore.
    if (ungroupedInnerNodeIds.has(node.id)) continue
    const existing = curNodes[node.id]
    if (!existing) {
      ops.push({
        type: 'createNode',
        nodeId: node.id,
        opId: node.opId,
        position: node.position,
        params: { ...node.params },
        ...(node.previewEnabled !== undefined ? { previewEnabled: node.previewEnabled } : {}),
      })
    } else {
      const positionChanged =
        existing.position.x !== node.position.x || existing.position.y !== node.position.y
      const paramsChanged = !paramsEqual(existing.params, node.params)
      const previewEnabledChanged = (existing.previewEnabled ?? true) !== (node.previewEnabled ?? true)
      if (positionChanged || paramsChanged || previewEnabledChanged) {
        const op: Extract<Op, { type: 'updateNode' }> = { type: 'updateNode', nodeId: node.id }
        if (paramsChanged) op.params = { ...node.params }
        if (positionChanged) op.position = node.position
        if (previewEnabledChanged) op.previewEnabled = node.previewEnabled ?? true
        ops.push(op)
      }
    }
  }

  // Deleted nodes (present in kernel, absent in desired). Skip kernel group
  // shadow nodes — those are handled by deleteGroup above.
  for (const [id, kn] of Object.entries(curNodes) as Array<[string, GraphNode]>) {
    if (kn.opId === GROUP_OP_ID) continue
    if (newGroupMemberIds.has(id)) continue
    if (!desiredNodeIds.has(id)) {
      deletedNodeIds.add(id)
      ops.push({ type: 'deleteNode', nodeId: id })
    }
  }

  // Edges.
  const desiredEdgeIds = new Set<string>()
  for (const edge of desired.edges) {
    const baseId = edge.id.replace(/_redir$/, '')
    desiredEdgeIds.add(edge.id)
    desiredEdgeIds.add(baseId)
    if (newGroupIds.has(edge.source.nodeId) || newGroupIds.has(edge.target.nodeId)) continue
    // Inner + boundary edges of an ungrouped group are restored/rewritten in
    // place by the kernel `ungroup` op (ids preserved) — do not re-emit connect.
    if (ungroupedInnerEdgeIds.has(baseId)) continue
    if (!curEdges[edge.id] && !curEdges[baseId]) {
      ops.push({
        type: 'connect',
        edgeId: edge.id,
        source: { ...edge.source },
        target: { ...edge.target },
      })
    }
  }
  for (const id of Object.keys(curEdges)) {
    const edge = curEdges[id]
    if (edge && (deletedGroupIds.has(edge.source.nodeId) || deletedGroupIds.has(edge.target.nodeId))) continue
    if (edge && (deletedNodeIds.has(edge.source.nodeId) || deletedNodeIds.has(edge.target.nodeId))) continue
    if (edge && (newGroupMemberIds.has(edge.source.nodeId) || newGroupMemberIds.has(edge.target.nodeId))) continue
    // Boundary edges of an ungrouped group are rewritten in place by the kernel
    // (same id) — do not disconnect them.
    if (ungroupedInnerEdgeIds.has(id.replace(/_redir$/, ''))) continue
    if (!desiredEdgeIds.has(id)) ops.push({ type: 'disconnect', edgeId: id })
  }

  // Nested dependency groups (a dropped template / saved group with child
  // groups). A group we are about to create may contain `__group__` MEMBERS that
  // point — via the kernel invariant "member shadow id === child group id" — at
  // child groups present in `desired.groups` but WITHOUT a top-level shadow of
  // their own. The kernel's flat registry (`graph.groups`) must hold an entry
  // for every such child: both the executor and the editor's inner view resolve
  // a group strictly by `params.groupId` against that flat registry. So emit a
  // child-first `createGroup` for the whole dependency tree BEFORE the parent's
  // createGroup, mirroring the backend `buildTemplateOps` the AI instantiate
  // route uses. Without this, a dropped nested template persisted only its root;
  // on the next `getPipeline` re-pull the children were gone from
  // `currentPipeline.groups`, so the parent's inner view failed the lookup and
  // those nested group nodes rendered as nothing (filtered out).
  const desiredGroupsById = new Map((desired.groups ?? []).map((g) => [g.id, g] as const))
  const nestedToCreate: KernelNodeGroup[] = []
  const nestedSeen = new Set<string>()
  const collectNestedDeps = (group: KernelNodeGroup): void => {
    for (const m of group.nodes) {
      if (m.opId !== GROUP_OP_ID) continue
      const childId = typeof m.params?.groupId === 'string' ? (m.params.groupId as string) : m.id
      if (nestedSeen.has(childId)) continue
      if (curGroupsById.has(childId)) continue // already a kernel group (skip re-create)
      if (curNodes[childId]?.opId === GROUP_OP_ID) continue
      if (newGroupIds.has(childId)) continue // a top-level new group, handled by the newGroups loop
      const childGroup = desiredGroupsById.get(childId)
      if (!childGroup) continue
      nestedSeen.add(childId)
      collectNestedDeps(childGroup) // deepest first so a child createGroup precedes its parent's
      nestedToCreate.push(childGroup)
    }
  }
  for (const { group } of newGroups) collectNestedDeps(group)

  for (const group of nestedToCreate) {
    for (const n of group.nodes) {
      // A nested `__group__` member's shadow is minted by ITS OWN createGroup
      // (emitted earlier in this child-first list), so never createNode it.
      if (n.opId === GROUP_OP_ID) continue
      if (curNodes[n.id]) continue
      ops.push({
        type: 'createNode',
        nodeId: n.id,
        opId: n.opId,
        position: n.position,
        params: { ...n.params },
        ...(n.name !== undefined ? { name: n.name } : {}),
        ...(n.previewEnabled !== undefined ? { previewEnabled: n.previewEnabled } : {}),
      })
    }
    for (const e of group.edges) {
      if (curEdges[e.id]) continue
      ops.push({ type: 'connect', edgeId: e.id, source: { ...e.source }, target: { ...e.target } })
    }
    const exposedPorts = buildCreateGroupContract(group)
    ops.push({
      type: 'createGroup',
      groupId: group.id,
      name: group.name || group.id,
      nameEn: group.nameEn,
      position: group.position,
      memberNodeIds: group.nodes.map((n) => n.id),
      ...(exposedPorts ? { exposedPorts } : {}),
    })
  }

  // Newly-created group shadows in the editor need to become real kernel groups.
  // If the group came from a template, its inner nodes/edges may not exist in
  // the current kernel graph yet, so create them first, then collapse via
  // createGroup. For ordinary "select nodes -> group", these are already
  // present and this prelude is empty.
  for (const { group } of newGroups) {
    for (const n of group.nodes) {
      if (curNodes[n.id]) continue
      // A nested `__group__` member's shadow is minted by its child createGroup
      // emitted above — never createNode it as a plain node (that would leave it
      // group-less and strand its sub-graph).
      if (n.opId === GROUP_OP_ID) continue
      ops.push({
        type: 'createNode',
        nodeId: n.id,
        opId: n.opId,
        position: n.position,
        params: { ...n.params },
        ...(n.name !== undefined ? { name: n.name } : {}),
        ...(n.previewEnabled !== undefined ? { previewEnabled: n.previewEnabled } : {}),
      })
    }
    for (const e of group.edges) {
      if (curEdges[e.id]) continue
      ops.push({
        type: 'connect',
        edgeId: e.id,
        source: { ...e.source },
        target: { ...e.target },
      })
    }
  }

  for (const { shadowId, group, position, name, nameEn } of newGroups) {
    // Hand the kernel the authoritative exposed-port contract: stable portNames
    // + inner mapping + overlay. The kernel rewrites boundary edges to these
    // stable names instead of re-deriving from inner node ids, so a group keeps
    // its outward identity across template remap (fixes the drop-a-saved-group
    // disconnect / no-result bug). Same path for "select nodes -> group".
    const exposedPorts = buildCreateGroupContract(group)
    ops.push({
      type: 'createGroup',
      groupId: shadowId,
      name,
      nameEn,
      position,
      memberNodeIds: group.nodes.map((n) => n.id),
      ...(exposedPorts ? { exposedPorts } : {}),
    })
  }

  // Boundary wires to/from a freshly-created group shadow cannot be emitted in the
  // upfront edge loop above: createGroup has not minted the shadow yet and that
  // loop deliberately skips any edge touching newGroupIds. Emit them here,
  // immediately after the shadow exists, so a drop+connect in the same persist
  // (or a connect that races the drop's debounced persist) still lands the
  // wire in the kernel — without this, the editor shows the edge but execute
  // sees no upstream input and the group outputs nothing.
  for (const edge of desired.edges) {
    const baseId = edge.id.replace(/_redir$/, '')
    const touchesNewGroup =
      newGroupIds.has(edge.source.nodeId) || newGroupIds.has(edge.target.nodeId)
    if (!touchesNewGroup) continue
    // Pure inner member edges are created in the group prelude above; re-emitting
    // a connect for them here would collide with the kernel's packed inner edges.
    if (newGroupMemberIds.has(edge.source.nodeId) && newGroupMemberIds.has(edge.target.nodeId)) continue
    if (ungroupedInnerEdgeIds.has(baseId)) continue
    if (!curEdges[edge.id] && !curEdges[baseId]) {
      ops.push({
        type: 'connect',
        edgeId: edge.id,
        source: { ...edge.source },
        target: { ...edge.target },
      })
    }
  }

  for (const { shadowId, group, position, name, nameEn } of existingGroups) {
    const currentNode = curNodes[shadowId]
    if (!currentNode) continue
    const kernelGroup = curGroupsById.get(shadowId)
    const positionChanged =
      currentNode.position.x !== position.x || currentNode.position.y !== position.y
    const nameChanged = currentNode.name !== name
    // Compare against the kernel value, never "is it set at all": every group
    // that carries an English name would otherwise diff as changed on every
    // persist, and each no-op updateGroup invalidates the group's output cache
    // plus its whole downstream.
    const nameEnChanged = nameEn !== undefined && nameEn !== kernelGroup?.nameEn
    // Structural wiring change (shell add/delete/rebind) replaces the port set
    // wholesale and carries overlay inline; only fall back to the lightweight
    // overlay patch when the set/wiring is unchanged.
    const exposedWiring = kernelGroup ? diffExposedPortWiring(group, kernelGroup) : undefined
    const exposedPorts = exposedWiring ? undefined : diffExposedPortOverlay(group, kernelGroup)

    // Inner sub-graph edits made in the group's internal view (connect /
    // disconnect inner edges, inner node param edits, inner node moves). These
    // are flushed into the editor group on exit but were never diffed against
    // the kernel sub-graph, so the post-exit re-pull reverted them. Compare each
    // against the kernel group and ship the full replacement array when changed.
    const desiredInnerEdges = group.edges
    const desiredInnerNodes = group.nodes
    const edgesChanged = kernelGroup ? !innerEdgesEqual(kernelGroup.edges, desiredInnerEdges) : false
    const nodesChanged = kernelGroup ? !innerNodesEqual(kernelGroup.nodes, desiredInnerNodes) : false
    const layoutChanged = kernelGroup ? !innerLayoutEqual(kernelGroup.innerLayout, group.innerLayout) : false

    if (
      positionChanged || nameChanged || nameEnChanged || exposedPorts || exposedWiring ||
      edgesChanged || nodesChanged || layoutChanged
    ) {
      ops.push({
        type: 'updateGroup',
        groupId: shadowId,
        ...(nameChanged ? { name } : {}),
        ...(nameEnChanged ? { nameEn } : {}),
        ...(positionChanged ? { position } : {}),
        ...(exposedPorts ? { exposedPorts } : {}),
        ...(exposedWiring ? { exposedWiring } : {}),
        ...(edgesChanged ? { edges: desiredInnerEdges } : {}),
        ...(nodesChanged ? { nodes: desiredInnerNodes } : {}),
        ...(layoutChanged ? { innerLayout: { ...(group.innerLayout ?? {}) } } : {}),
      })
    }
  }

  // Group shadow nodes are created / positioned / named / re-wired exclusively
  // by the group ops above, so the main node loop skips them. But their
  // free-form `params` bag is NOT touched by createGroup/updateGroup —
  // createGroup hardcodes `params: { groupId }` and never round-trips anything
  // else. The editor stores save-status PROVENANCE there (source library
  // category/name + content hash + isTemplate), so without an explicit sync
  // that provenance is dropped on the next `getPipeline` re-pull and the
  // group's save badge flips back to `unsaved`. Emit a params-only `updateNode`
  // for any shadow whose desired params differ from the kernel's. This pass
  // runs AFTER createGroup so the node exists when the op applies; for brand-new
  // groups the kernel will hold just `{ groupId }`, so a freshly-saved /
  // dragged-out group always lands its provenance here.
  for (const { shadowId } of [...newGroups, ...existingGroups]) {
    const desiredNode = desired.nodes.find((n) => n.id === shadowId)
    if (!desiredNode) continue
    const desiredParams = desiredNode.params ?? {}
    // New groups are not in curNodes yet; createGroup will set `{ groupId }`.
    const kernelParams = curNodes[shadowId]?.params ?? { groupId: shadowId }
    if (!paramsEqual(kernelParams, desiredParams)) {
      ops.push({ type: 'updateNode', nodeId: shadowId, params: { ...desiredParams } })
    }
  }

  // Persist annotations and frames via metadata ops so they survive the
  // graph:applied → loadPipeline round-trip (previously only the import path
  // emitted these, causing frames/annotations to vanish after any op that
  // triggered a live-sync refetch, e.g. copy-paste).
  const curMeta = (current?.metadata ?? {}) as { annotations?: unknown[]; frames?: unknown[] }
  const desiredAnnotations = desired.annotations ?? []
  const currentAnnotations = curMeta.annotations ?? []
  if (JSON.stringify(desiredAnnotations) !== JSON.stringify(currentAnnotations)) {
    ops.push({ type: 'setMetadata', key: 'annotations', value: desiredAnnotations })
  }
  const desiredFrames = desired.frames ?? []
  const currentFrames = curMeta.frames ?? []
  if (JSON.stringify(desiredFrames) !== JSON.stringify(currentFrames)) {
    ops.push({ type: 'setMetadata', key: 'frames', value: desiredFrames })
  }

  return ops
}

