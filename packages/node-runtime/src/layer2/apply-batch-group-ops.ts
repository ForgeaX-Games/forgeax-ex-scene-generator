import type { GraphFileV1 } from '../layer1/storage/types.js'
import type { ExposedPort } from '../layer1/types/graph.js'
import type { OpRegistry } from '../layer1/op-registry.js'
import type { OpAccess } from '../layer1/types/op-spec.js'
import { deriveGroupPorts } from './derive-group-ports.js'
import { GROUP_OP_ID } from './group-constants.js'
import type { Diagnostic, ExposedPortContract, ExposedPortPatch, Op } from './apply-batch-types.js'
import { autoNodePosition } from './apply-batch-classify.js'
import { requireIdentifier } from './apply-batch-validate.js'

type CreateGroupOp = Extract<Op, { type: 'createGroup' }>
type UpdateGroupOp = Extract<Op, { type: 'updateGroup' }>
type DeleteGroupOp = Extract<Op, { type: 'deleteGroup' }>
type UngroupOp = Extract<Op, { type: 'ungroup' }>

/**
 * Stable exposed-port name resolver, scoped to a single createGroup. A group is
 * a first-class battery: its outward port names are STABLE ids that do not
 * encode (and therefore never shift with) the inner node ids.
 *
 * Two modes:
 *   - CONTRACT mode (caller passed `op.exposedPorts`): the authoritative
 *     `portName` is whatever the contract bound to `(sourceNodeId,
 *     sourcePortName)`. This is the "drop a saved group template" path — the
 *     template carries the stable names minted at the group's birth, and we
 *     honour them verbatim so edges/overlay/exec all line up after id remap.
 *   - DERIVE mode (no contract — ordinary "select nodes → group"): mint a fresh
 *     sequential id per direction (`in_0`, `in_1`, … / `out_0`, `out_1`, …).
 *
 * In either mode the returned name is stable for a given `(sourceNodeId,
 * sourcePortName)` within this group: the resolver memoises so the boundary-edge
 * pass and the unconnected-port pass agree on one name per inner port.
 */
interface ExposedNameResolver {
  resolve(direction: 'in' | 'out', sourceNodeId: string, sourcePortName: string): string
}

export function makeExposedNameResolver(
  contract: { inputs?: readonly ExposedPortContract[]; outputs?: readonly ExposedPortContract[] } | undefined,
): ExposedNameResolver {
  // key: `${direction}\0${sourceNodeId}\0${sourcePortName}` → portName
  const contractByMapping = new Map<string, string>()
  // Track taken names per direction so DERIVE-mode allocation never collides
  // with a contract-supplied name (and so suffix counters stay monotonic).
  const takenIn = new Set<string>()
  const takenOut = new Set<string>()
  const memo = new Map<string, string>()
  let nextIn = 0
  let nextOut = 0

  const ingest = (direction: 'in' | 'out', entries: readonly ExposedPortContract[] | undefined): void => {
    if (!entries) return
    for (const e of entries) {
      contractByMapping.set(`${direction}\0${e.sourceNodeId}\0${e.sourcePortName}`, e.portName)
      ;(direction === 'in' ? takenIn : takenOut).add(e.portName)
    }
  }
  ingest('in', contract?.inputs)
  ingest('out', contract?.outputs)

  return {
    resolve(direction, sourceNodeId, sourcePortName) {
      const memoKey = `${direction}\0${sourceNodeId}\0${sourcePortName}`
      const cached = memo.get(memoKey)
      if (cached !== undefined) return cached
      const fromContract = contractByMapping.get(memoKey)
      if (fromContract !== undefined) {
        memo.set(memoKey, fromContract)
        return fromContract
      }
      // No contract entry for this mapping → mint a fresh stable id.
      const taken = direction === 'in' ? takenIn : takenOut
      let name: string
      do {
        name = direction === 'in' ? `in_${nextIn++}` : `out_${nextOut++}`
      } while (taken.has(name))
      taken.add(name)
      memo.set(memoKey, name)
      return name
    },
  }
}

// Resolve a member node's port to its real { type, access } from the OpSpec so the group
// boundary mirrors the inner tier instead of a hardcoded `any`, falling back to { type: 'any' }
// when the registry or the port/op is unknown.
export function resolveBoundaryPort(
  registry: OpRegistry | undefined,
  node: GraphFileV1['nodes'][string] | undefined,
  portName: string,
  direction: 'in' | 'out',
  groups?: GraphFileV1['groups'],
): { portType: string; access?: OpAccess } {
  if (!node) return { portType: 'any' }
  // A __group__ member's wiring tier lives on its sub-group's exposed ports,
  // not in the OpRegistry (which has no per-instance __group__ spec). The child
  // group id is stored on the shadow node's params.groupId (see applyCreateGroup).
  if (node.opId === GROUP_OP_ID) {
    const childId = typeof node.params?.groupId === 'string' ? node.params.groupId : ''
    const child = groups?.[childId]
    const list = direction === 'in' ? child?.exposedInputs : child?.exposedOutputs
    const ep = list?.find((p) => p.portName === portName)
    if (ep) return ep.access !== undefined ? { portType: ep.portType, access: ep.access } : { portType: ep.portType }
    return { portType: 'any' }
  }
  if (!registry) return { portType: 'any' }
  const spec = registry.get(node.opId)
  if (!spec) return { portType: 'any' }
  const ports = direction === 'in' ? spec.inputs : spec.outputs
  const port = ports.find((p) => p.name === portName)
  if (port) {
    return port.access !== undefined ? { portType: port.type, access: port.access } : { portType: port.type }
  }
  // Dynamic ports (e.g. tree_merge's `item_0`) aren't enumerated statically;
  // derive their tier from the dynamic-port template instead.
  const dyn = direction === 'in' ? spec.dynamicInputs : spec.dynamicOutputs
  if (dyn && portName.startsWith(dyn.prefix)) {
    return dyn.access !== undefined ? { portType: dyn.type, access: dyn.access } : { portType: dyn.type }
  }
  return { portType: 'any' }
}

export function applyCreateGroup(
  graph: GraphFileV1,
  op: CreateGroupOp,
  opIndex: number,
  registry?: OpRegistry,
): { error?: Diagnostic } {
  // Same zombie-node risk as createNode's `nodeId` (see the 2026-07-01 postmortem
  // note on `requireIdentifier` above): `groupId` is the object key for both
  // `graph.nodes` and `graph.groups`, so a missing/mistyped field would otherwise
  // silently key a group under the string "undefined".
  const idErr = requireIdentifier(op as unknown as Record<string, unknown>, 'groupId', 'createGroup', opIndex)
  if (idErr) return { error: idErr }
  if (graph.nodes[op.groupId]) {
    return { error: { opIndex, severity: 'error', message: `node ${op.groupId} already exists` } }
  }
  if (graph.groups?.[op.groupId]) {
    return { error: { opIndex, severity: 'error', message: `group ${op.groupId} already exists` } }
  }
  if (op.memberNodeIds.length === 0) {
    return { error: { opIndex, severity: 'error', message: 'createGroup requires at least one member' } }
  }
  for (const id of op.memberNodeIds) {
    const node = graph.nodes[id]
    if (!node) {
      return { error: { opIndex, severity: 'error', message: `member ${id} does not exist` } }
    }
  }

  // Move members out of graph.nodes. Keep a lookup so boundary-port type/access
  // can still be resolved from the inner OpSpec after deletion.
  const memberById = new Map<string, GraphFileV1['nodes'][string]>()
  const innerNodes = op.memberNodeIds.map((id) => {
    const n = graph.nodes[id]!
    memberById.set(id, n)
    delete graph.nodes[id]
    return n
  })

  // Stable port-name resolver: honour the caller's authoritative contract when
  // present (template re-instantiation), else mint fresh sequential ids.
  const nameResolver = makeExposedNameResolver(op.exposedPorts)

  // Partition edges by boundary and track internal wiring for port exposure.
  const innerEdges: GraphFileV1['edges'][string][] = []
  const exposedInputs: Array<{
    portName: string
    portType: string
    access?: OpAccess
    sourceNodeId: string
    sourcePortName: string
  }> = []
  const exposedOutputs: typeof exposedInputs = []
  const hasInternalOutgoing = new Set<string>()
  const portHasInternalIn = new Set<string>()
  const exposedInputSet = new Set<string>()
  const exposedOutputSet = new Set<string>()

  // Shared derivation (single authority, reused by the editor). Wiring tier is
  // resolved from the inner member's OpSpec via resolveBoundaryPort.
  const derived = deriveGroupPorts({
    memberNodeIds: op.memberNodeIds,
    nodes: new Map(op.memberNodeIds.map((id) => [id, { id, opId: memberById.get(id)!.opId }])),
    edges: Object.entries(graph.edges).map(([id, e]) => ({ id, source: e.source, target: e.target })),
    resolvePortTier: (nodeId, port, dir) => resolveBoundaryPort(registry, memberById.get(nodeId), port, dir, graph.groups),
  })

  for (const id of derived.internalEdgeIds) {
    const e = graph.edges[id]!
    hasInternalOutgoing.add(e.source.nodeId)
    portHasInternalIn.add(`${e.target.nodeId}\0${e.target.port}`)
    innerEdges.push(e)
    delete graph.edges[id]
  }

  // CONTRACT is AUTHORITATIVE: when present, MATERIALIZE every contract port up
  // front (not just rename derived ones). A freshly-dropped template has NO
  // boundary edges, so `derived` is empty — yet its ports must still surface.
  // Each contract entry's omitted wiring tier is resolved from the inner
  // member's OpSpec; explicit template portType/access remains authoritative.
  // A stale entry whose sourceNodeId is not a member is dropped (advisory). We
  // record the mapping key -> portName so the
  // derived boundary pass below reuses the contract name (no dupes) for ports
  // that DO have a boundary edge.
  const contractInName = new Map<string, string>() // `${sourceNodeId}\0${sourcePortName}` -> portName
  const contractOutName = new Map<string, string>()
  if (op.exposedPorts) {
    for (const c of op.exposedPorts.inputs ?? []) {
      const member = memberById.get(c.sourceNodeId)
      if (!member) continue // genuinely stale entry (sourceNodeId not a member)
      const tier = resolveBoundaryPort(registry, member, c.sourcePortName, 'in', graph.groups)
      if (exposedInputSet.has(c.portName)) continue
      exposedInputSet.add(c.portName)
      contractInName.set(`${c.sourceNodeId}\0${c.sourcePortName}`, c.portName)
      exposedInputs.push({
        portName: c.portName,
        portType: c.portType ?? tier.portType,
        ...((c.access ?? tier.access) !== undefined ? { access: c.access ?? tier.access } : {}),
        sourceNodeId: c.sourceNodeId,
        sourcePortName: c.sourcePortName,
      })
    }
    for (const c of op.exposedPorts.outputs ?? []) {
      const member = memberById.get(c.sourceNodeId)
      if (!member) continue
      const tier = resolveBoundaryPort(registry, member, c.sourcePortName, 'out', graph.groups)
      if (exposedOutputSet.has(c.portName)) continue
      exposedOutputSet.add(c.portName)
      contractOutName.set(`${c.sourceNodeId}\0${c.sourcePortName}`, c.portName)
      exposedOutputs.push({
        portName: c.portName,
        portType: c.portType ?? tier.portType,
        ...((c.access ?? tier.access) !== undefined ? { access: c.access ?? tier.access } : {}),
        sourceNodeId: c.sourceNodeId,
        sourcePortName: c.sourcePortName,
      })
    }
  }

  // Honour an authoritative contract's port NAMES (template re-instantiation) by
  // remapping derived sequential names -> contract names per boundary mapping.
  // A derived boundary port already materialized from the contract reuses its
  // contract portName (so the rewrite below points at it) and is NOT re-added.
  const renameIn = new Map<string, string>()
  const renameOut = new Map<string, string>()
  for (const p of derived.exposedInputs) {
    const contractName = contractInName.get(`${p.sourceNodeId}\0${p.sourcePortName}`)
    if (contractName !== undefined) {
      // Already materialized from the contract; reuse its name for the rewrite,
      // don't add a duplicate exposed entry.
      renameIn.set(p.portName, contractName)
      continue
    }
    const name = nameResolver.resolve('in', p.sourceNodeId, p.sourcePortName)
    renameIn.set(p.portName, name)
    if (exposedInputSet.has(name)) continue
    exposedInputSet.add(name)
    exposedInputs.push({ ...p, portName: name })
  }
  for (const p of derived.exposedOutputs) {
    const contractName = contractOutName.get(`${p.sourceNodeId}\0${p.sourcePortName}`)
    if (contractName !== undefined) {
      renameOut.set(p.portName, contractName)
      continue
    }
    const name = nameResolver.resolve('out', p.sourceNodeId, p.sourcePortName)
    renameOut.set(p.portName, name)
    if (exposedOutputSet.has(name)) continue
    exposedOutputSet.add(name)
    exposedOutputs.push({ ...p, portName: name })
  }
  for (const rw of derived.boundaryRewrites) {
    const e = graph.edges[rw.edgeId]
    if (!e) continue
    if (rw.endpoint === 'source') {
      graph.edges[rw.edgeId] = { ...e, source: { nodeId: op.groupId, port: renameOut.get(rw.portName)! } }
    } else {
      graph.edges[rw.edgeId] = { ...e, target: { nodeId: op.groupId, port: renameIn.get(rw.portName)! } }
    }
  }

  // Expose unconnected input ports (no internal upstream) and all output
  // ports of sink nodes (no internal outgoing edge). This is a FALLBACK only:
  // when the caller hands an authoritative `exposedPorts` contract (frontend
  // "select nodes → group" and template re-instantiation BOTH do), that contract
  // is the single source of truth for the boundary — the kernel must NOT invent
  // extra ports beyond it. Auto-supplementing here previously leaked every
  // member's unconnected input port as a phantom `any` slot (e.g. inner Panel
  // `input` ports surfaced as in_2/in_3/in_4), polluting the group surface and
  // showing "any / no result". Only derive a surface when NO contract is given
  // (bare createGroup: some tests, or grouping nodes with zero connections).
  if (registry && !op.exposedPorts) {
    const sinkNodes = new Set(op.memberNodeIds.filter((id) => !hasInternalOutgoing.has(id)))
    for (const id of op.memberNodeIds) {
      const node = memberById.get(id)
      if (!node) continue
      const spec = registry.get(node.opId)
      if (!spec) continue
      for (const inp of spec.inputs) {
        if (portHasInternalIn.has(`${id}\0${inp.name}`)) continue
        const portName = nameResolver.resolve('in', id, inp.name)
        if (exposedInputSet.has(portName)) continue
        exposedInputSet.add(portName)
        exposedInputs.push({
          portName,
          portType: inp.type,
          ...(inp.access !== undefined ? { access: inp.access } : {}),
          sourceNodeId: id,
          sourcePortName: inp.name,
        })
      }
      if (sinkNodes.has(id)) {
        for (const out of spec.outputs) {
          const portName = nameResolver.resolve('out', id, out.name)
          if (exposedOutputSet.has(portName)) continue
          exposedOutputSet.add(portName)
          exposedOutputs.push({
            portName,
            portType: out.type,
            ...(out.access !== undefined ? { access: out.access } : {}),
            sourceNodeId: id,
            sourcePortName: out.name,
          })
        }
      }
    }
  }

  // Create the group shadow node + sub-graph entry.
  const shadowPosition = op.position ?? autoNodePosition(graph)
  graph.nodes[op.groupId] = {
    id: op.groupId,
    opId: GROUP_OP_ID,
    name: op.name,
    position: shadowPosition,
    params: { groupId: op.groupId },
  }
  if (!graph.groups) graph.groups = {}
  graph.groups[op.groupId] = {
    id: op.groupId,
    name: op.name,
    nameEn: op.nameEn,
    nodes: innerNodes,
    edges: innerEdges,
    position: shadowPosition,
    exposedInputs,
    exposedOutputs,
  }
  // Seed the persisted presentation overlay from the authoritative contract
  // (drag-a-saved-group-back path). The contract's stable portNames are exactly
  // the names just assigned above (nameResolver honoured them), so this lands by
  // portName. Wiring authority (portType/access/source*) stays derived from the
  // live topology. No-op for ordinary "select nodes → group" (op.exposedPorts
  // undefined).
  if (op.exposedPorts) {
    patchExposedPortOverlay(graph.groups[op.groupId]!.exposedInputs, op.exposedPorts.inputs)
    patchExposedPortOverlay(graph.groups[op.groupId]!.exposedOutputs, op.exposedPorts.outputs)
  }
  return {}
}

export function applyUpdateGroup(graph: GraphFileV1, op: UpdateGroupOp, opIndex: number): { error?: Diagnostic } {
  const idErr = requireIdentifier(op as unknown as Record<string, unknown>, 'groupId', 'updateGroup', opIndex)
  if (idErr) return { error: idErr }
  const group = graph.groups?.[op.groupId]
  if (!group) {
    return { error: { opIndex, severity: 'error', message: `group ${op.groupId} does not exist` } }
  }
  const node = graph.nodes[op.groupId]
  if (!node) {
    return { error: { opIndex, severity: 'error', message: `group shadow node ${op.groupId} missing — graph corrupt` } }
  }
  if (op.name !== undefined) {
    group.name = op.name
    node.name = op.name
  }
  if (op.nameEn !== undefined) {
    group.nameEn = op.nameEn
  }
  if (op.position !== undefined) {
    group.position = op.position
    node.position = op.position
  }
  // Structural exposed-port replacement (shell add / true-delete / rebind) must
  // run BEFORE the overlay patch: it carries its own overlay inline, and the
  // editor only ever sends one of the two for a given direction.
  if (op.exposedWiring) {
    if (op.exposedWiring.inputs !== undefined) {
      group.exposedInputs = op.exposedWiring.inputs.map((p) => ({ ...p }))
    }
    if (op.exposedWiring.outputs !== undefined) {
      group.exposedOutputs = op.exposedWiring.outputs.map((p) => ({ ...p }))
    }
  }
  if (op.exposedPorts) {
    patchExposedPortOverlay(group.exposedInputs, op.exposedPorts.inputs)
    patchExposedPortOverlay(group.exposedOutputs, op.exposedPorts.outputs)
  }
  // Inner sub-graph edits (internal-view connect/disconnect, inner node param
  // edits, inner node moves). Each provided field replaces the group's wholesale
  // so the editor's flushed post-edit arrays become the new SSOT. Member ids are
  // owned by createGroup/ungroup; this op only rewrites the wiring/params/layout
  // of an existing group's interior, so exposed ports are left untouched (their
  // overlay is patched via `exposedPorts` above; their wiring authority stays as
  // derived at createGroup time).
  if (op.nodes !== undefined) {
    group.nodes = op.nodes.map((n) => ({ ...n }))
  }
  if (op.edges !== undefined) {
    group.edges = op.edges.map((e) => ({ ...e }))
  }
  if (op.innerLayout !== undefined) {
    group.innerLayout = { ...op.innerLayout }
  }
  return {}
}

/**
 * Apply presentation-overlay patches onto an exposed-port array in place,
 * matching by `portName`. Only the overlay fields are written; the wiring
 * authority is left untouched. Unknown portNames are ignored (the port set is
 * owned by createGroup/ungroup). A patch field left `undefined` is a no-op so
 * callers can send sparse patches.
 */
export function patchExposedPortOverlay(
  ports: ExposedPort[],
  patches: readonly ExposedPortPatch[] | undefined,
): void {
  if (!patches || patches.length === 0) return
  const byName = new Map(ports.map((p) => [p.portName, p] as const))
  for (const patch of patches) {
    const port = byName.get(patch.portName)
    if (!port) continue
    if (patch.hidden !== undefined) port.hidden = patch.hidden
    if (patch.order !== undefined) port.order = patch.order
    if (patch.customLabel !== undefined) port.customLabel = patch.customLabel
    if (patch.customLabelEn !== undefined) port.customLabelEn = patch.customLabelEn
  }
}

export function applyDeleteGroup(graph: GraphFileV1, op: DeleteGroupOp, opIndex: number): { error?: Diagnostic } {
  const idErr = requireIdentifier(op as unknown as Record<string, unknown>, 'groupId', 'deleteGroup', opIndex)
  if (idErr) return { error: idErr }
  const group = graph.groups?.[op.groupId]
  const node = graph.nodes[op.groupId]
  if (!group && !node) {
    return { error: { opIndex, severity: 'error', message: `group ${op.groupId} does not exist` } }
  }
  if (node && node.opId !== GROUP_OP_ID) {
    return { error: { opIndex, severity: 'error', message: `node ${op.groupId} is not a group` } }
  }

  delete graph.nodes[op.groupId]
  if (graph.groups) delete graph.groups[op.groupId]
  for (const [edgeId, edge] of Object.entries(graph.edges)) {
    if (edge.source.nodeId === op.groupId || edge.target.nodeId === op.groupId) {
      delete graph.edges[edgeId]
    }
  }
  return {}
}

export function applyUngroup(graph: GraphFileV1, op: UngroupOp, opIndex: number): { error?: Diagnostic } {
  const idErr = requireIdentifier(op as unknown as Record<string, unknown>, 'groupId', 'ungroup', opIndex)
  if (idErr) return { error: idErr }
  const group = graph.groups?.[op.groupId]
  if (!group) {
    return { error: { opIndex, severity: 'error', message: `group ${op.groupId} does not exist` } }
  }
  // Restore inner nodes.
  for (const inner of group.nodes) {
    if (graph.nodes[inner.id]) {
      return { error: { opIndex, severity: 'error', message: `cannot ungroup: node ${inner.id} re-introduced collides with existing top-level node` } }
    }
    graph.nodes[inner.id] = inner
  }
  // Restore inner edges.
  for (const inner of group.edges) {
    if (graph.edges[inner.id]) {
      return { error: { opIndex, severity: 'error', message: `cannot ungroup: edge ${inner.id} collides` } }
    }
    graph.edges[inner.id] = inner
  }
  // Rewrite outer edges that referenced the group via exposed ports.
  const inMap = new Map(group.exposedInputs.map((p) => [p.portName, p] as const))
  const outMap = new Map(group.exposedOutputs.map((p) => [p.portName, p] as const))
  for (const [edgeId, edge] of Object.entries(graph.edges)) {
    if (edge.source.nodeId === op.groupId) {
      const exposed = outMap.get(edge.source.port)
      if (exposed) {
        graph.edges[edgeId] = {
          ...edge,
          source: { nodeId: exposed.sourceNodeId, port: exposed.sourcePortName },
        }
      }
    }
    if (edge.target.nodeId === op.groupId) {
      const exposed = inMap.get(edge.target.port)
      if (exposed) {
        graph.edges[edgeId] = {
          ...edge,
          target: { nodeId: exposed.sourceNodeId, port: exposed.sourcePortName },
        }
      }
    }
  }
  // Delete the group shadow node + entry.
  delete graph.nodes[op.groupId]
  if (graph.groups) delete graph.groups[op.groupId]
  return {}
}
