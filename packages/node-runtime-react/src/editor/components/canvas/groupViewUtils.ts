// Shared helpers for grouping / group-view (decoupling the duplicated dependency
// between the group-collapse and group-view canvas wiring). Ported from the
// legacy editor (components/canvas/groupViewUtils.ts) with imports retargeted
// onto the editor stores + sibling utils. Pure functions; no app coupling.
import { usePipelineStore } from '../../stores/index.js'
import { getPortTypeColor, type DomainPortTypes } from '../../utils/portTypes.js'
import { resolveNodeType, DEFAULT_BATTERY_WIDTH, estimateBatteryNodeWidth } from './canvasConstants.js'
import { RELAY_BATTERY_ID, RELAY_INPUT_PORT, RELAY_NODE_HEIGHT, RELAY_NODE_WIDTH, RELAY_OUTPUT_PORT } from './RelayNode.js'
import { stripGenCacheParams } from './groupStatus.js'
import type { Battery, NodeGroup, PipelineNode, PipelineEdge, ExposedPort } from '../../types.js'

/**
 * Generic node-meta shape: port exposure / tooltip / nested grouping logic all
 * operate on this shape. Plain batteries are full Battery; `__group__` nodes are
 * derived into the same shape (without dynamicInputs/Outputs).
 */
export type NodeMeta = Pick<Battery, 'inputs' | 'outputs'> & {
  dynamicInputs?: Battery['dynamicInputs']
  dynamicOutputs?: Battery['dynamicOutputs']
}

export type GroupPortDirection = 'input' | 'output'

export function sortGroupPorts<T extends ExposedPort>(ports: T[]): T[] {
  return [...ports].sort((a, b) => {
    const orderA = typeof a.order === 'number' ? a.order : ports.indexOf(a)
    const orderB = typeof b.order === 'number' ? b.order : ports.indexOf(b)
    return orderA - orderB
  })
}

export function getVisibleGroupPorts<T extends ExposedPort>(ports: T[]): T[] {
  return sortGroupPorts(ports).filter(port => !port.hidden)
}

export function getGroupPortDisplayLabel(port: ExposedPort, en: boolean): string {
  // portName is now an OPAQUE stable id (`in_0`, `out_1`, …) — it carries no
  // human meaning, so the readable fallback is the inner sourcePortName. Display
  // priority: explicit user override → derived portLabel → inner port name →
  // nested-group resolution → (last resort) the stable id.
  if (en) {
    const explicitEn = port.customLabelEn?.trim()
    if (explicitEn) return explicitEn
    if (port.portLabelEn) return port.portLabelEn
    const base = port.customLabel?.trim() || port.portLabel
    if (base) return base
    return resolveNestedSourceLabel(port, true) || port.sourcePortName || port.portName
  }
  const base = port.customLabel?.trim() || port.portLabel
  if (base) return base
  return resolveNestedSourceLabel(port, false) || port.sourcePortName || port.portName
}

/**
 * Resolve the human label of an exposed port whose source is a NESTED group.
 *
 * When a group is nested inside another, the parent's exposed port points at the
 * child `__group__` shadow node (whose id, by the kernel invariant, EQUALS the
 * child group id) and its `sourcePortName` is the child's OPAQUE stable id
 * (`in_1`/`out_0`). The human-readable `portLabel` is presentation-only and is
 * dropped on persistence, so after a reload the parent port would otherwise show
 * the meaningless stable id. Descend into the child group's matching exposed
 * port (recursively, for deeper nesting) and reuse its display label instead.
 * Returns undefined when the source is not a nested group.
 */
function resolveNestedSourceLabel(port: ExposedPort, en: boolean): string | undefined {
  if (!port.sourceNodeId || !port.sourcePortName) return undefined
  const { currentPipeline } = usePipelineStore.getState()
  const childGroup = (currentPipeline?.groups ?? []).find(g => g.id === port.sourceNodeId)
  if (!childGroup) return undefined
  const childPorts = port.sourcePortName.startsWith('out_')
    ? childGroup.exposedOutputs
    : childGroup.exposedInputs
  const childPort = childPorts.find(p => p.portName === port.sourcePortName)
  if (!childPort) return undefined
  return getGroupPortDisplayLabel(childPort, en)
}

export function getGroupPortsForDirection(group: NodeGroup, direction: GroupPortDirection, visibleOnly = false): ExposedPort[] {
  const ports = direction === 'input' ? group.exposedInputs : group.exposedOutputs
  return visibleOnly ? getVisibleGroupPorts(ports) : sortGroupPorts(ports)
}

/**
 * Derive a virtual Battery meta from a NodeGroup: map exposedInputs/Outputs
 * directly into BatteryInput/Output shape. Exposed ports already carry
 * portName/portType/portLabel/options, so no extra inference is needed. Group
 * nodes have no dynamic-port configuration.
 */
export function deriveGroupVirtualMeta(group: NodeGroup): NodeMeta {
  return {
    inputs: getVisibleGroupPorts(group.exposedInputs).map(ep => ({
      name: ep.portName,
      type: ep.portType,
      required: false,
      description: '',
      label: ep.customLabel?.trim() || ep.portLabel,
      ...(ep.options?.length ? { options: ep.options } : {}),
    })),
    outputs: getVisibleGroupPorts(group.exposedOutputs).map(ep => ({
      name: ep.portName,
      type: ep.portType,
      description: '',
      label: ep.customLabel?.trim() || ep.portLabel,
    })),
  }
}

/**
 * Generic node-meta resolution: plain batteries are looked up in the battery
 * library; `__group__` nodes derive a virtual meta from pipeline.groups. Port
 * exposure / tooltip logic obtains a node's inputs/outputs through this function
 * uniformly, transparent to nested groups.
 */
export function getNodeMeta(nodeId: string): NodeMeta | undefined {
  const { currentPipeline, batteries } = usePipelineStore.getState()
  const pNode = currentPipeline?.nodes.find(n => n.id === nodeId)
  if (!pNode) return undefined
  if (pNode.batteryId === RELAY_BATTERY_ID) {
    const portType = typeof pNode.params?.portType === 'string' ? pNode.params.portType : 'any'
    return {
      inputs: [{ name: RELAY_INPUT_PORT, type: portType, required: false, description: '', label: 'input' }],
      outputs: [{ name: RELAY_OUTPUT_PORT, type: portType, description: '', label: 'output' }],
    }
  }
  if (pNode.batteryId === '__group__') {
    const groupId = pNode.params?.groupId
    if (typeof groupId !== 'string') return undefined
    const group = (currentPipeline?.groups ?? []).find(g => g.id === groupId)
    return group ? deriveGroupVirtualMeta(group) : undefined
  }
  return batteries.find(b => b.id === pNode.batteryId)
}

/**
 * Resolve the effective/default value of a group's exposed INPUT port by tracing
 * its `sourceNodeId`/`sourcePortName` into the group's inner node. A group's
 * shadow node carries no per-port params, so an unconnected exposed input would
 * otherwise read empty even though the inner port has a meaningful default — this
 * surfaces that inner default on the collapsed face and the inner-view shell,
 * matching how a plain battery's input port falls back to its `default`.
 *
 * Returns `{ value, isDefault }` (isDefault → a meta default, shown muted) or
 * undefined when nothing resolves. Recurses through nested `__group__` sources.
 */
export function resolveGroupExposedInputValue(
  group: NodeGroup,
  port: ExposedPort,
): { value: unknown; isDefault: boolean } | undefined {
  const { batteries, currentPipeline } = usePipelineStore.getState()
  const allGroups = currentPipeline?.groups ?? []
  const seen = new Set<string>()

  function resolve(g: NodeGroup, sourceNodeId: string, sourcePortName: string): { value: unknown; isDefault: boolean } | undefined {
    if (!sourceNodeId || !sourcePortName) return undefined
    const inner = g.nodes.find(n => n.id === sourceNodeId)
    if (!inner) return undefined

    // A user-set inner param overrides the meta default → treat it as a value.
    if (inner.params && inner.params[sourcePortName] !== undefined) {
      return { value: inner.params[sourcePortName], isDefault: false }
    }

    // Nested group source: descend into the child group's matching exposed input.
    if (inner.batteryId === '__group__') {
      const childId = typeof inner.params?.groupId === 'string' ? inner.params.groupId : ''
      if (!childId || seen.has(childId)) return undefined
      seen.add(childId)
      const child = allGroups.find(cg => cg.id === childId) ?? g._nestedGroups?.find(cg => cg.id === childId)
      const childPort = child?.exposedInputs.find(p => p.portName === sourcePortName)
      if (!child || !childPort) return undefined
      return resolve(child, childPort.sourceNodeId, childPort.sourcePortName)
    }

    // Plain battery: fall back to the catalog input port's meta default.
    const battery = batteries.find(b => b.id === inner.batteryId)
    const metaPort = battery?.inputs.find(p => p.name === sourcePortName)
    if (metaPort && metaPort.default !== undefined) {
      return { value: metaPort.default, isDefault: true }
    }
    return undefined
  }

  return resolve(group, port.sourceNodeId, port.sourcePortName)
}

/** Generate a unique id (prefix + timestamp + random suffix). */
function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

/**
 * Deep-clone a NodeGroup and remap all internal ids to avoid collisions between
 * multiple instances. Also updates position to the supplied new position.
 *
 * groupIdMap covers the nested case: a parent group's `__group__` child nodes
 * carry params.groupId which must also be remapped to the new groupId (otherwise
 * the parent -> child reference breaks).
 */
export function remapGroupIds(
  group: NodeGroup,
  newPosition: { x: number; y: number },
  groupIdMap?: Record<string, string>,
): NodeGroup {
  const newGroupId = groupIdMap?.[group.id] ?? `group_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const nodeIdMap: Record<string, string> = {}

  const newNodes: PipelineNode[] = group.nodes.map(n => {
    // A nested `__group__` member must preserve the kernel invariant
    // "shadow node id === group id": its new node id is the SAME fresh id minted
    // for its child group (via groupIdMap), and params.groupId points at that
    // same id. This is what lets the persist path emit a child-first
    // `createGroup` whose minted shadow id matches the parent's `memberNodeIds`
    // entry (mirrors the backend `buildTemplateOps`). Previously the member got
    // an unrelated `node-*` id while only params.groupId was remapped, so the
    // child group was never persisted to the flat registry and its nodes went
    // invisible in the parent's inner view after a reload. Leaf members get an
    // ordinary fresh node id.
    let newId: string
    let params = n.params
    if (n.batteryId === '__group__' && groupIdMap) {
      const old = typeof n.params?.groupId === 'string' ? n.params.groupId : ''
      const mappedGroupId = groupIdMap[old]
      if (mappedGroupId) {
        newId = mappedGroupId
        params = { ...n.params, groupId: mappedGroupId }
      } else if (old) {
        // The child group is NOT in the remap (the bundle arrived without its
        // `_nestedGroups` def). Keep the ORIGINAL group id so the shadow still
        // resolves to a real group rather than minting an unrelated `node-…` id:
        // a `node-` id would match no group def, so the persist would emit a
        // createGroup member / connects the kernel never creates and reject the
        // whole batch ("member/connect.* does not exist"), making the dropped
        // group vanish. `loadGroup` now hydrates `_nestedGroups` so this branch
        // is a safety net rather than the normal path.
        newId = old
        params = { ...n.params, groupId: old }
      } else {
        newId = genId('node')
      }
    } else {
      newId = genId('node')
    }
    nodeIdMap[n.id] = newId
    // A duplicate starts with NO cached generation result: strip the volatile
    // `_gen_*` Run cache so a copied image_gen doesn't carry the source's image.
    return { ...n, id: newId, params: stripGenCacheParams(params) }
  })

  const newEdges: PipelineEdge[] = group.edges.map(e => ({
    ...e,
    id: genId('edge'),
    source: { ...e.source, nodeId: nodeIdMap[e.source.nodeId] ?? e.source.nodeId },
    target: { ...e.target, nodeId: nodeIdMap[e.target.nodeId] ?? e.target.nodeId },
  }))

  // Stable port names ARE the group's outward identity (a first-class battery
  // contract), so they MUST survive the remap untouched — only the inner
  // mapping (sourceNodeId) follows the new member ids. This is the crux of the
  // fix: previously portName embedded the old node id and went stale on remap,
  // stranding edges and inputs ("no result" / disconnect on reload).
  const remapPorts = (ports: ExposedPort[]): ExposedPort[] =>
    ports.map(p => ({ ...p, sourceNodeId: nodeIdMap[p.sourceNodeId] ?? p.sourceNodeId }))

  const newInnerLayout: Record<string, { x: number; y: number }> = {}
  if (group.innerLayout) {
    for (const [oldId, pos] of Object.entries(group.innerLayout)) {
      newInnerLayout[nodeIdMap[oldId] ?? oldId] = pos
    }
  }

  return {
    ...group,
    id: newGroupId,
    position: newPosition,
    nodes: newNodes,
    edges: newEdges,
    exposedInputs: remapPorts(group.exposedInputs),
    exposedOutputs: remapPorts(group.exposedOutputs),
    innerLayout: newInnerLayout,
  }
}

/**
 * Collect a group's nested dependency snapshot (recursively find all `__group__`
 * child nodes' groupId, look up the corresponding NodeGroup, dedupe and flatten).
 * Used when saving a parent group to bundle its dependencies.
 *
 * @param root   parent group
 * @param lookup resolve a NodeGroup by groupId (usually pipeline.groups find closure)
 * @returns      unique nested dependency snapshots (excluding root itself)
 */
export function collectNestedDependencies(
  root: NodeGroup,
  lookup: (groupId: string) => NodeGroup | undefined,
): NodeGroup[] {
  const seen = new Set<string>([root.id])
  const out: NodeGroup[] = []
  const visit = (g: NodeGroup) => {
    for (const n of g.nodes) {
      if (n.batteryId !== '__group__') continue
      const gid = typeof n.params?.groupId === 'string' ? n.params.groupId : ''
      if (!gid || seen.has(gid)) continue
      const child = lookup(gid)
      if (!child) continue
      seen.add(gid)
      out.push(child)
      visit(child)
    }
  }
  visit(root)
  return out
}

/**
 * Expand a NodeGroup loaded from disk into an array ready to splice into
 * pipeline.groups: [root (with _nestedGroups stripped), ...nested deps]. Used by
 * both session restore and opening a pipeline file to restore nested deps.
 */
export function expandLoadedGroupBundle(loaded: NodeGroup): NodeGroup[] {
  const deps = loaded._nestedGroups ?? []
  const { _nestedGroups: _omit, ...rest } = loaded
  void _omit
  return [rest as NodeGroup, ...deps]
}

/**
 * When dropping a group with nested dependencies, remap the whole dependency
 * tree (root + _nestedGroups) to fresh ids consistently. The parent group's
 * `__group__` child nodes' params.groupId auto-point to the new ids (via
 * groupIdMap).
 *
 * Returns { root, deps }: root is the remapped parent group (bound to
 * newPosition); deps are the remapped dependencies (each keeping its original
 * position; layout inside group view is decided by innerLayout).
 */
export function remapGroupBundle(
  root: NodeGroup,
  deps: NodeGroup[],
  newPosition: { x: number; y: number },
): { root: NodeGroup; deps: NodeGroup[] } {
  const groupIdMap: Record<string, string> = {}
  const allOldIds = [root.id, ...deps.map(d => d.id)]
  for (const oldId of allOldIds) {
    groupIdMap[oldId] = `group_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  }
  const newRoot = remapGroupIds(root, newPosition, groupIdMap)
  const newDeps = deps.map(d => remapGroupIds(d, d.position, groupIdMap))
  return { root: newRoot, deps: newDeps }
}

/**
 * Duplicate a LIVE canvas group (Ctrl+drag / Ctrl+V) together with the nested
 * child groups it references, minting fresh ids for the whole tree. The caller
 * must register every returned dep with `addGroup` alongside the root.
 *
 * Duplicating with a bare `remapGroupIds` is not enough once the group has a
 * `__group__` member: the member gets an unrelated `node-…` id while its
 * `params.groupId` still points at the SOURCE's child group, breaking the
 * kernel invariant "member shadow id === group id". The persist diff then emits
 * a `createGroup` whose member was never created (a nested child's shadow does
 * not exist at top level), the kernel rejects the WHOLE batch, and every node
 * in that paste is lost on refresh and never executes.
 */
export function duplicateGroupTree(
  source: NodeGroup,
  newPosition: { x: number; y: number },
  groups: readonly NodeGroup[] | undefined,
): { root: NodeGroup; deps: NodeGroup[] } {
  const deps = collectNestedDependencies(source, gid => (groups ?? []).find(g => g.id === gid))
  return remapGroupBundle(source, deps, newPosition)
}

/**
 * Resolve an edge color from a source node id + source port name, using node
 * snapshots or battery metadata. contextNodes is for group view: inner nodes are
 * not at the currentPipeline.nodes root level and must be resolved from the
 * group.nodes snapshot.
 */
export function resolveEdgeColorFromStore(
  sourceNodeId: string,
  sourcePort: string,
  contextNodes?: PipelineNode[],
  domainPortTypes?: DomainPortTypes,
): string {
  const { currentPipeline, batteries } = usePipelineStore.getState()
  const pNode = contextNodes?.find(n => n.id === sourceNodeId)
    ?? currentPipeline?.nodes.find(n => n.id === sourceNodeId)
  if (pNode?.batteryId === RELAY_BATTERY_ID) {
    const portType = typeof pNode.params?.portType === 'string' ? pNode.params.portType : 'any'
    return portType === 'any' ? 'var(--color-accent)' : getPortTypeColor(portType, domainPortTypes)
  }
  if (pNode?.batteryId === '__group__') {
    const groupId = typeof pNode.params?.groupId === 'string' ? pNode.params.groupId : ''
    const group = (currentPipeline?.groups ?? []).find(g => g.id === groupId)
    const exposed = group?.exposedOutputs.find(p => p.portName === sourcePort)
    if (exposed) return getPortTypeColor(exposed.portType, domainPortTypes)
  }
  const battery = batteries.find(b => b.id === pNode?.batteryId)
  const port = battery?.outputs?.find(o => o.name === sourcePort)
  return port ? getPortTypeColor(port.type, domainPortTypes) : 'var(--color-accent)'
}

/**
 * Determine a node's ReactFlow nodeType and style from battery metadata,
 * consistent with session restore.
 */
export function resolveNodeTypeAndStyleFromStore(batteryId: string): { type: string; style: Record<string, number> } {
  if (batteryId === RELAY_BATTERY_ID) {
    return { type: 'relay', style: { width: RELAY_NODE_WIDTH, height: RELAY_NODE_HEIGHT } }
  }

  const { batteries } = usePipelineStore.getState()
  const battery = batteries.find(b => b.id === batteryId)
  if (!battery) return { type: 'battery', style: { width: DEFAULT_BATTERY_WIDTH } }

  const nodeType = resolveNodeType(battery)
  const specialStyles: Record<string, Record<string, number>> = {
    text_panel:   { width: DEFAULT_BATTERY_WIDTH, height: 150 },
    json_panel:   { width: DEFAULT_BATTERY_WIDTH, height: 168 },
    ai_battery:   { width: DEFAULT_BATTERY_WIDTH },
    json_battery: { width: DEFAULT_BATTERY_WIDTH, height: 200 },
    battery:      { width: DEFAULT_BATTERY_WIDTH },
  }
  const style = {
    ...(specialStyles[nodeType] ?? { width: DEFAULT_BATTERY_WIDTH }),
    width: estimateBatteryNodeWidth(battery, (specialStyles[nodeType]?.width as number | undefined) ?? DEFAULT_BATTERY_WIDTH),
  }
  return { type: nodeType, style }
}
