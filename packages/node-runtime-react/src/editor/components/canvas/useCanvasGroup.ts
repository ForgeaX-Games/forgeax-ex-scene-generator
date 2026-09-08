// Grouping hook: provides groupSelectedNodes (collapse) and ungroupNode (expand).
// Ported from the legacy editor (components/canvas/useCanvasGroup.ts).
//
// Exposed-port rules:
//   - Exposed inputs: for each input port of each selected node, expose it when
//       (1) the node is not a text_panel,
//       (2) the port has no upstream edge from inside the selection,
//       (3) it is not an unconnected dynamic-input slot (dynamicInputs.prefix);
//     i.e. ports with an external edge + unconnected fixed inputs.
//   - Exposed outputs: every output port of the "sink" nodes (no outgoing edge
//     inside the selection).
//   - External edges (outside→inside or inside→outside) are kept, with their
//     endpoints redirected to the GroupNode's exposed ports.
// ungroupNode reverses all of the above.
import { useCallback } from 'react'
import type { Node, Edge } from '../../xyflow.js'
import { deriveGroupPorts } from '@forgeax/node-runtime/derive-group-ports'
import { usePipelineStore } from '../../stores/index.js'
import { useHistoryStore } from '../../stores/index.js'
import { getEditorTransport } from '../../transport/index.js'
import type { NodeGroup, ExposedPort, PipelineNode, PipelineEdge } from '../../types.js'
import { buildGroupNodeData } from './GroupNode.js'
import { getPortTypeColor, type DomainPortTypes } from '../../utils/portTypes.js'
import { formatIdAsLabel } from '../../utils/batteryLabels.js'
import {
  resolveNodeType,
  DEFAULT_BATTERY_WIDTH,
  DEFAULT_GROUP_WIDTH,
  estimateBatteryNodeWidth,
  estimateGroupNodeWidth,
} from './canvasConstants.js'
import { getGroupPortDisplayLabel, getNodeMeta } from './groupViewUtils.js'
import { RELAY_BATTERY_ID, RELAY_NODE_HEIGHT, RELAY_NODE_WIDTH } from './RelayNode.js'

// Resolve an edge color from the source node + source port via battery metadata;
// fall back to the accent color.
function resolveEdgeColor(sourceNodeId: string, sourcePort: string, domainPortTypes?: DomainPortTypes): string {
  const { currentPipeline, batteries } = usePipelineStore.getState()
  const pNode = currentPipeline?.nodes.find((n) => n.id === sourceNodeId)
  if (pNode?.batteryId === RELAY_BATTERY_ID) {
    const portType = typeof pNode.params?.portType === 'string' ? pNode.params.portType : 'any'
    return portType === 'any' ? 'var(--color-accent)' : getPortTypeColor(portType, domainPortTypes)
  }
  const battery = batteries.find((b) => b.id === pNode?.batteryId)
  const port = battery?.outputs?.find((o) => o.name === sourcePort)
  return port ? getPortTypeColor(port.type, domainPortTypes) : 'var(--color-accent)'
}

// Resolve the ReactFlow nodeType + style from battery metadata (kept in sync
// with session restore).
function resolveNodeTypeAndStyle(batteryId: string): { type: string; style: Record<string, number> } {
  if (batteryId === RELAY_BATTERY_ID) {
    return { type: 'relay', style: { width: RELAY_NODE_WIDTH, height: RELAY_NODE_HEIGHT } }
  }

  const { batteries } = usePipelineStore.getState()
  const battery = batteries.find((b) => b.id === batteryId)
  if (!battery) return { type: 'battery', style: { width: DEFAULT_BATTERY_WIDTH } }

  const nodeType = resolveNodeType(battery)
  const specialStyles: Record<string, Record<string, number>> = {
    text_panel:   { width: DEFAULT_BATTERY_WIDTH, height: 150 },
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

// Generate a unique group id.
function genGroupId(): string {
  return `group_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

interface UseCanvasGroupParams {
  nodes: Node[]
  edges: Edge[]
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>
  domainPortTypes?: DomainPortTypes
}

export function useCanvasGroup({ nodes, edges, setNodes, setEdges, domainPortTypes }: UseCanvasGroupParams) {
  const addNode      = usePipelineStore((s) => s.addNode)
  const removeNode   = usePipelineStore((s) => s.removeNode)
  const addEdge      = usePipelineStore((s) => s.addEdge)
  const removeEdge   = usePipelineStore((s) => s.removeEdge)
  const addGroup     = usePipelineStore((s) => s.addGroup)
  const removeGroup  = usePipelineStore((s) => s.removeGroup)

  // Collapse the nodes in selectedNodeIds into one GroupNode.
  const groupSelectedNodes = useCallback(
    async (selectedNodeIds: string[], onUngroup: (groupId: string) => void, onEnterGroup?: (groupId: string) => void) => {
      if (selectedNodeIds.length < 2) return

      const { currentPipeline } = usePipelineStore.getState()
      if (!currentPipeline) return

      // Nested grouping: __group__ children are treated as ordinary batteries
      // (meta derived by deriveGroupVirtualMeta); port exposure / boundary
      // handling is transparent to them. Drop ids with no matching PipelineNode.
      const validIds = selectedNodeIds.filter((id) => currentPipeline.nodes.some((n) => n.id === id))
      if (validIds.length < 2) return
      const cleanIds = validIds

      const transport = getEditorTransport()
      if (transport.api.supportsSceneAuthoringCommands() && await transport.api.isCanonicalSceneProject()) {
        const requested = globalThis.window?.prompt('Definition name', 'ExtractedGroup')
        if (!requested) return
        const name = requested.replace(/[^A-Za-z0-9_$]/g, '')
        if (!name) return
        const defaultFile = `groups/${name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}.scene.ts`
        const file = globalThis.window?.prompt('Definition file', defaultFile)
        if (!file) return
        const seal = globalThis.window?.confirm('Seal this definition after grouping?') ?? true
        try {
          await transport.api.applySceneAuthoringCommands([{
            type: 'wrapInGroup',
            statementIds: cleanIds,
            meta: { name, file, seal, confirmed: true },
          }], `Extract ${name} Definition`)
        } catch (error) {
          console.error('[Group] canonical Extract Definition failed:', error)
        }
        return
      }

      const selectedSet = new Set(cleanIds)
      const allEdges = currentPipeline.edges

      // ── Connected-boundary classification + stable naming ─────────────────
      // The shared `deriveGroupPorts` is the SINGLE authority for boundary-edge
      // classification, `internalEdgeIds`, and stable names of CONNECTED
      // boundary ports (`in_N`/`out_N`). The kernel uses the same function, so
      // frontend and kernel can never disagree on these names (the root cause
      // of the prior naming-drift "no result" bug). The frontend's richer
      // presentation policy (unconnected inputs, sink outputs, labels, sorting)
      // layers on top, reusing the name allocators seeded below.
      const derived = deriveGroupPorts({
        memberNodeIds: cleanIds,
        nodes: new Map(cleanIds.map((id) => {
          const pn = currentPipeline.nodes.find((n) => n.id === id)
          return [id, { id, opId: pn?.batteryId ?? '' }]
        })),
        edges: allEdges,
        resolvePortTier: (nodeId, port, dir) => {
          const meta = getNodeMeta(nodeId)
          const list = dir === 'in' ? meta?.inputs : meta?.outputs
          const p = list?.find((x) => x.name === port)
          return { portType: p?.type ?? 'any' }
        },
      })
      const internalEdgeIds = new Set(derived.internalEdgeIds)

      // Helper sets the frontend fallback blocks still need, derived from
      // `allEdges` (replacing what the deleted manual loop produced).
      const externalEdges = allEdges.filter((e) => {
        const s = selectedSet.has(e.source.nodeId)
        const t = selectedSet.has(e.target.nodeId)
        return (s && !t) || (!s && t)
      })
      const hasInternalOutgoing = new Set<string>()  // node-level: has an outgoing edge inside the selection
      const portHasInternalIn = new Set<string>()    // "nodeId__port": target port has an internal upstream
      const portHasAnyEdge    = new Set<string>()    // "nodeId__port": target port has any edge
      for (const edge of allEdges) {
        const srcIn = selectedSet.has(edge.source.nodeId)
        const tgtIn = selectedSet.has(edge.target.nodeId)
        if (srcIn && tgtIn) {
          hasInternalOutgoing.add(edge.source.nodeId)
          const tgtKey = `${edge.target.nodeId}__${edge.target.port}`
          portHasInternalIn.add(tgtKey)
          portHasAnyEdge.add(tgtKey)
        } else if (!srcIn && tgtIn) {
          portHasAnyEdge.add(`${edge.target.nodeId}__${edge.target.port}`)
        }
      }

      // Sink nodes (no outgoing edge inside the selection) → output exposure.
      const sinkNodes = cleanIds.filter((id) => !hasInternalOutgoing.has(id))

      // Node meta (ordinary batteries from the catalog; nested __group__ nodes
      // get a derived virtual meta).
      const getBatteryMeta = (nodeId: string) => getNodeMeta(nodeId)

      const resolveExposedPortLabels = (
        nodeId: string,
        direction: 'input' | 'output',
        portName: string,
        fallbackLabel?: string,
      ): { portLabel: string; portLabelEn: string } => {
        const pNode = currentPipeline.nodes.find((n) => n.id === nodeId)
        if (pNode?.batteryId === '__group__') {
          const childGroupId = typeof pNode.params?.groupId === 'string' ? pNode.params.groupId : ''
          const childGroup = (currentPipeline.groups ?? []).find((g) => g.id === childGroupId)
          const childPort = (direction === 'input' ? childGroup?.exposedInputs : childGroup?.exposedOutputs)
            ?.find((port) => port.portName === portName)
          if (childPort) {
            return {
              portLabel: getGroupPortDisplayLabel(childPort, false),
              portLabelEn: getGroupPortDisplayLabel(childPort, true),
            }
          }
        }
        return {
          portLabel: fallbackLabel || portName,
          portLabelEn: formatIdAsLabel(portName),
        }
      }

      // ── Build exposed-port maps (portKey → ExposedPort) ────────────────────
      const exposedInputsMap  = new Map<string, ExposedPort>()
      const exposedOutputsMap = new Map<string, ExposedPort>()

      // Stable port-name allocator. A group is a first-class battery: its
      // outward port names are topology-independent stable ids (`in_0`, `out_0`,
      // …) that DON'T encode the inner node id, so they survive template remap
      // unchanged (the kernel honours them via the createGroup contract). Keyed
      // by `${nodeId}__${port}` so the same inner port always maps to one name.
      //
      // Seed the maps/counters from the shared `deriveGroupPorts` result so the
      // CONNECTED boundary ports get EXACTLY the kernel's names; the frontend's
      // fallback ports (unconnected inputs / sink outputs) then continue the
      // same sequence via the allocators below.
      const inNameByKey  = new Map<string, string>()
      const outNameByKey = new Map<string, string>()
      let nextInIdx = 0
      let nextOutIdx = 0
      for (const p of derived.exposedInputs) {
        inNameByKey.set(`${p.sourceNodeId}__${p.sourcePortName}`, p.portName)
        nextInIdx = Math.max(nextInIdx, Number(p.portName.slice(3)) + 1)
      }
      for (const p of derived.exposedOutputs) {
        outNameByKey.set(`${p.sourceNodeId}__${p.sourcePortName}`, p.portName)
        nextOutIdx = Math.max(nextOutIdx, Number(p.portName.slice(4)) + 1)
      }
      const allocInName = (key: string): string => {
        const existing = inNameByKey.get(key)
        if (existing) return existing
        const name = `in_${nextInIdx++}`
        inNameByKey.set(key, name)
        return name
      }
      const allocOutName = (key: string): string => {
        const existing = outNameByKey.get(key)
        if (existing) return existing
        const name = `out_${nextOutIdx++}`
        outNameByKey.set(key, name)
        return name
      }

      // Exposed inputs: for each input port of each selected node, expose it when
      // (1) batteryId !== 'text_panel', (2) no internal upstream edge,
      // (3) if dynamic (name starts with prefix) it must be connected.
      for (const nodeId of cleanIds) {
        const pNode = currentPipeline.nodes.find((n) => n.id === nodeId)
        if (!pNode || pNode.batteryId === 'text_panel') continue
        const meta = getBatteryMeta(nodeId)
        const inputs = meta?.inputs ?? []
        const dynPrefix = meta?.dynamicInputs?.prefix
        for (const port of inputs) {
          const key = `${nodeId}__${port.name}`
          if (portHasInternalIn.has(key)) continue
          const isDynamic = !!dynPrefix && port.name.startsWith(dynPrefix)
          if (isDynamic && !portHasAnyEdge.has(key)) continue
          if (!exposedInputsMap.has(key)) {
            const labels = resolveExposedPortLabels(nodeId, 'input', port.name, port.label || port.name)
            exposedInputsMap.set(key, {
              portName: allocInName(key),
              portType: port.type ?? 'any',
              portLabel: labels.portLabel,
              portLabelEn: labels.portLabelEn,
              sourceNodeId: nodeId,
              sourcePortName: port.name,
              ...(port.options?.length ? { options: port.options } : {}),
            })
          }
        }
      }

      // Supplement: external-input ports not declared in meta (runtime-extended
      // dynamic ports).
      for (const edge of externalEdges) {
        if (!selectedSet.has(edge.source.nodeId) && selectedSet.has(edge.target.nodeId)) {
          const tgtPNode = currentPipeline.nodes.find((n) => n.id === edge.target.nodeId)
          if (tgtPNode?.batteryId === 'text_panel') continue
          const key = `${edge.target.nodeId}__${edge.target.port}`
          if (!exposedInputsMap.has(key)) {
            const meta = getBatteryMeta(edge.target.nodeId)
            const portMeta = meta?.inputs.find((p) => p.name === edge.target.port)
            const labels = resolveExposedPortLabels(edge.target.nodeId, 'input', edge.target.port, portMeta?.label || portMeta?.name || edge.target.port)
            exposedInputsMap.set(key, {
              portName: allocInName(key),
              portType: portMeta?.type ?? 'any',
              portLabel: labels.portLabel,
              portLabelEn: labels.portLabelEn,
              sourceNodeId: edge.target.nodeId,
              sourcePortName: edge.target.port,
              ...(portMeta?.options?.length ? { options: portMeta.options } : {}),
            })
          }
        }
      }

      // Exposed outputs: all output ports of the sink nodes.
      for (const nodeId of sinkNodes) {
        const meta = getBatteryMeta(nodeId)
        const outputs = meta?.outputs ?? []
        for (const port of outputs) {
          const key = `${nodeId}__${port.name}`
          if (!exposedOutputsMap.has(key)) {
            const labels = resolveExposedPortLabels(nodeId, 'output', port.name, port.label || port.name)
            exposedOutputsMap.set(key, {
              portName: allocOutName(key),
              portType: port.type ?? 'any',
              portLabel: labels.portLabel,
              portLabelEn: labels.portLabelEn,
              sourceNodeId: nodeId,
              sourcePortName: port.name,
            })
          }
        }
      }

      // External-output port supplement (so external edges can redirect to the
      // GroupNode's exposed ports).
      for (const edge of externalEdges) {
        if (selectedSet.has(edge.source.nodeId) && !selectedSet.has(edge.target.nodeId)) {
          const key = `${edge.source.nodeId}__${edge.source.port}`
          if (!exposedOutputsMap.has(key)) {
            const meta = getBatteryMeta(edge.source.nodeId)
            const portMeta = meta?.outputs.find((p) => p.name === edge.source.port)
            const labels = resolveExposedPortLabels(edge.source.nodeId, 'output', edge.source.port, portMeta?.label || portMeta?.name || edge.source.port)
            exposedOutputsMap.set(key, {
              portName: allocOutName(key),
              portType: portMeta?.type ?? 'any',
              portLabel: labels.portLabel,
              portLabelEn: labels.portLabelEn,
              sourceNodeId: edge.source.nodeId,
              sourcePortName: edge.source.port,
            })
          }
        }
      }

      // Input-port ordering: grid/name-list → ordinary → random seed.
      const sortExposedInputs = (ports: ExposedPort[]): ExposedPort[] => {
        const isGridOrNameList = (p: ExposedPort) => {
          const label = p.portLabel ?? ''
          const name  = p.sourcePortName ?? ''
          return label.includes('网格列表') || label.includes('名称清单') ||
                 name === 'gridList'        || name === 'nameList' ||
                 name === 'grid_list'       || name === 'name_list'
        }
        const isSeed = (p: ExposedPort) => {
          const label = p.portLabel ?? ''
          const name  = p.sourcePortName ?? ''
          return label.includes('随机种子') || label.includes('种子') || name === 'seed'
        }
        const front  = ports.filter((p) => isGridOrNameList(p))
        const middle = ports.filter((p) => !isGridOrNameList(p) && !isSeed(p))
        const back   = ports.filter((p) => isSeed(p))
        return [...front, ...middle, ...back]
      }

      const exposedInputs  = sortExposedInputs(Array.from(exposedInputsMap.values()))
      const exposedOutputs = Array.from(exposedOutputsMap.values())

      // GroupNode position = the geometric center of the selected nodes.
      const selectedRfNodes = nodes.filter((n) => selectedSet.has(n.id))
      const avgX = selectedRfNodes.reduce((s, n) => s + n.position.x, 0) / selectedRfNodes.length
      const avgY = selectedRfNodes.reduce((s, n) => s + n.position.y, 0) / selectedRfNodes.length

      const groupId = genGroupId()
      const groupName = 'Group Node'

      // Build the NodeGroup snapshot.
      const subNodes = currentPipeline.nodes.filter((n) => selectedSet.has(n.id))
      const subEdges = allEdges.filter((e) => internalEdgeIds.has(e.id))

      // Record the current RF positions to restore the layout on group entry.
      const innerLayout: Record<string, { x: number; y: number }> = {}
      for (const rfNode of selectedRfNodes) {
        innerLayout[rfNode.id] = { x: rfNode.position.x, y: rfNode.position.y }
      }

      const group: NodeGroup = {
        id: groupId,
        name: groupName,
        nodes: subNodes,
        edges: subEdges,
        position: { x: avgX, y: avgY },
        exposedInputs,
        exposedOutputs,
        innerLayout,
      }

      useHistoryStore.getState().record('group_nodes', currentPipeline, {
        label: `成组（${cleanIds.length} 个节点）`,
        labelEn: `Group (${cleanIds.length} node(s))`,
        nodeIds: cleanIds,
      })

      // Remove the sub-nodes and all edges touching them from the store.
      for (const nodeId of cleanIds) removeNode(nodeId)

      // Add the GroupNode composite node to the store.
      const groupPipelineNode: PipelineNode = {
        id: groupId,
        batteryId: '__group__',
        name: groupName,
        position: { x: avgX, y: avgY },
        params: { groupId },
      }
      addGroup(group)
      addNode(groupPipelineNode)

      // Redirect external edges: endpoints become the GroupNode's exposed ports.
      for (const edge of externalEdges) {
        const srcIn = selectedSet.has(edge.source.nodeId)
        const tgtIn = selectedSet.has(edge.target.nodeId)

        if (!srcIn && tgtIn) {
          const inKey = `${edge.target.nodeId}__${edge.target.port}`
          const exposed = exposedInputsMap.get(inKey)
          if (!exposed) continue
          addEdge({
            id: `${edge.id}_redir`,
            source: edge.source,
            target: { nodeId: groupId, port: exposed.portName },
          })
        } else if (srcIn && !tgtIn) {
          const outKey = `${edge.source.nodeId}__${edge.source.port}`
          const exposed = exposedOutputsMap.get(outKey)
          if (!exposed) continue
          addEdge({
            id: `${edge.id}_redir`,
            source: { nodeId: groupId, port: exposed.portName },
            target: edge.target,
          })
        }
      }

      // Update ReactFlow local state.
      const groupRfData = buildGroupNodeData(group, onUngroup, onEnterGroup)
      const groupRfNode: Node = {
        id: groupId,
        type: 'group',
        position: { x: avgX, y: avgY },
        style: { width: estimateGroupNodeWidth(group, usePipelineStore.getState().batteries) },
        data: groupRfData,
        selected: false,
      }

      setNodes((nds) => {
        const remaining = nds.filter((n) => !selectedSet.has(n.id))
        return [...remaining, groupRfNode]
      })

      // Rebuild ReactFlow edges:
      // - drop every edge touching a sub-node (internal + external),
      // - add the redirected external edges, inheriting color from the original
      //   edge style rather than re-deriving it.
      // NOTE: externalEdges are PipelineEdge (source/target are objects), while
      // ReactFlow Edge source/target are strings — access .nodeId accordingly.
      setEdges((eds) => {
        const kept = eds.filter((e) => !selectedSet.has(e.source) && !selectedSet.has(e.target))
        const edgeStyleMap = new Map(eds.map((e) => [e.id, e.style]))
        const redirected: Edge[] = externalEdges.flatMap((pipelineEdge) => {
          const srcIn = selectedSet.has(pipelineEdge.source.nodeId)
          const tgtIn = selectedSet.has(pipelineEdge.target.nodeId)
          const originalStyle = edgeStyleMap.get(pipelineEdge.id)
          const color = (originalStyle?.stroke as string | undefined) ?? 'var(--color-accent)'
          if (!srcIn && tgtIn) {
            const inKey = `${pipelineEdge.target.nodeId}__${pipelineEdge.target.port}`
            const exposed = exposedInputsMap.get(inKey)
            if (!exposed) return []
            return [{
              id: `${pipelineEdge.id}_redir`,
              source: pipelineEdge.source.nodeId,
              sourceHandle: pipelineEdge.source.port,
              target: groupId,
              targetHandle: exposed.portName,
              animated: false,
              style: { stroke: color, strokeWidth: 2 },
            } as Edge]
          } else if (srcIn && !tgtIn) {
            const outKey = `${pipelineEdge.source.nodeId}__${pipelineEdge.source.port}`
            const exposed = exposedOutputsMap.get(outKey)
            if (!exposed) return []
            return [{
              id: `${pipelineEdge.id}_redir`,
              source: groupId,
              sourceHandle: exposed.portName,
              target: pipelineEdge.target.nodeId,
              targetHandle: pipelineEdge.target.port,
              animated: false,
              style: { stroke: color, strokeWidth: 2 },
            } as Edge]
          }
          return []
        })
        return [...kept, ...redirected]
      })

      // After grouping: persist the session (the group snapshot is in memory via
      // addGroup; session.json will save it) and recompute. Saving to the battery
      // library is a manual action via the GroupNode "save" button.
      //
      // MUST await the persist before executing: the createGroup op (member
      // deletion + boundary-edge redirect) is still in flight on the persist
      // queue, so a `{ persist: false }` execute that fires concurrently races
      // ahead and runs the kernel's OLD graph — the group node does not exist
      // yet, so its exposed outputs come back empty ("no result") even though
      // the inner nodes' pre-group cached outputs still show on the probes. Same
      // race the drop-a-saved-group path already guards against in useCanvasDrop.
      //
      // Execute INCREMENTALLY (fullExec=false): grouping only re-encapsulates
      // existing nodes, so the only things that need recomputing are the group
      // node and its downstream closure (boundary upstream inputs hydrate from
      // cache, exactly like a freshly-connected edge). A full-graph execute here
      // would needlessly run every UNRELATED branch too — and if any such branch
      // errors (e.g. a stale/disconnected source node), the kernel aborts the
      // WHOLE pipeline before it reaches this group, leaving its outputs empty
      // ("no result") for a reason that has nothing to do with the group.
      setTimeout(() => {
        void usePipelineStore.getState().persistSession()
          .then(() => usePipelineStore.getState().incrementalExecute(groupId, false, { persist: false }))
      }, 50)
    },
    [nodes, edges, addNode, removeNode, addEdge, removeEdge, addGroup, setNodes, setEdges],
  )

  // Expand a GroupNode back into its inner sub-nodes and edges.
  const ungroupNode = useCallback(
    async (groupId: string, onUngroup: (gid: string) => void) => {
      const { currentPipeline } = usePipelineStore.getState()
      if (!currentPipeline) return

      const transport = getEditorTransport()
      if (transport.api.supportsSceneAuthoringCommands() && await transport.api.isCanonicalSceneProject()) {
        try {
          // Canvas group ids are runtime entity ids, not Authoring statement ids.
          // Route through the semantic adapter so it resolves the source-map
          // entry before issuing the canonical `ungroup` command.
          await transport.api.ungroup(groupId)
        } catch (error) {
          console.error('[Group] canonical Inline Definition failed:', error)
        }
        return
      }

      const group = (currentPipeline.groups ?? []).find((g) => g.id === groupId)
      if (!group) {
        console.warn('[Group] ungroupNode: group not found:', groupId)
        return
      }

      useHistoryStore.getState().record('ungroup_nodes', currentPipeline, {
        label: `取消成组：${group.name}`,
        labelEn: `Ungroup: ${group.nameEn ?? group.name}`,
      })

      // Translate restored members by how far the group node was moved on the
      // canvas SINCE it was created. group.position is the group's position at
      // creation time (the geometric center of the original members); the live
      // RF node carries its CURRENT canvas position. Without this offset, every
      // member snaps back to its create-time absolute coordinate, so a group the
      // user dragged across the canvas "teleports" its contents back to where it
      // was first formed. We offset by the delta so the members reappear exactly
      // under the group node where the user sees it.
      const liveGroupNode = nodes.find((n) => n.id === groupId)
      const dx = liveGroupNode ? liveGroupNode.position.x - group.position.x : 0
      const dy = liveGroupNode ? liveGroupNode.position.y - group.position.y : 0
      const offsetPos = (p: { x: number; y: number }) => ({ x: p.x + dx, y: p.y + dy })

      // External (redirected) edges currently connected to the GroupNode.
      const redirEdgesIn  = currentPipeline.edges.filter((e) => e.target.nodeId === groupId)
      const redirEdgesOut = currentPipeline.edges.filter((e) => e.source.nodeId === groupId)

      // Remove the GroupNode + its redirected edges (cascade removes groupId edges).
      removeNode(groupId)
      removeGroup(groupId)

      // Restore sub-nodes (translated by the group's on-canvas drift).
      for (const n of group.nodes) addNode({ ...n, position: offsetPos(n.position) })

      // Restore internal edges.
      for (const e of group.edges) addEdge(e)

      // Restore external edges (map the GroupNode exposed ports back to the
      // original sub-node ports).
      for (const rEdge of [...redirEdgesIn, ...redirEdgesOut]) {
        if (rEdge.target.nodeId === groupId) {
          const exposed = group.exposedInputs.find((p) => p.portName === rEdge.target.port)
          if (!exposed) continue
          const restoredEdge: PipelineEdge = {
            id: rEdge.id.replace('_redir', ''),
            source: rEdge.source,
            target: { nodeId: exposed.sourceNodeId, port: exposed.sourcePortName },
          }
          addEdge(restoredEdge)
        }
        if (rEdge.source.nodeId === groupId) {
          const exposed = group.exposedOutputs.find((p) => p.portName === rEdge.source.port)
          if (!exposed) continue
          const restoredEdge: PipelineEdge = {
            id: rEdge.id.replace('_redir', ''),
            source: { nodeId: exposed.sourceNodeId, port: exposed.sourcePortName },
            target: rEdge.target,
          }
          addEdge(restoredEdge)
        }
      }

      // Update ReactFlow local state. Nested case: a sub-node may itself be a
      // __group__, which must be rebuilt as a GroupNode RF node.
      setNodes((nds) => {
        const { batteries, currentPipeline: pipe } = usePipelineStore.getState()
        const without = nds.filter((n) => n.id !== groupId)
        const restoredRf = group.nodes.map((n) => {
          if (n.batteryId === '__group__') {
            const innerGroupId = typeof n.params?.groupId === 'string' ? n.params.groupId : ''
            const innerGroup = (pipe?.groups ?? []).find((g) => g.id === innerGroupId)
            if (!innerGroup) return null
            return {
              id: n.id,
              type: 'group',
              position: offsetPos(n.position),
              style: { width: estimateGroupNodeWidth(group, batteries, DEFAULT_GROUP_WIDTH) },
              data: buildGroupNodeData(innerGroup, onUngroup),
              selected: false,
            }
          }
          if (n.batteryId === RELAY_BATTERY_ID) {
            return {
              id: n.id,
              type: 'relay',
              position: offsetPos(n.position),
              style: { width: RELAY_NODE_WIDTH, height: RELAY_NODE_HEIGHT },
              data: { portType: typeof n.params?.portType === 'string' ? n.params.portType : 'any' },
              selected: false,
            }
          }
          const battery = batteries.find((b) => b.id === n.batteryId)
          if (!battery) return null
          const { type: nodeType, style } = resolveNodeTypeAndStyle(n.batteryId)
          return {
            id: n.id,
            type: nodeType,
            position: offsetPos(n.position),
            style,
            data: { battery, params: n.params || {} },
            selected: false,
          }
        }).filter(Boolean) as Node[]
        return [...without, ...restoredRf]
      })

      // Rebuild edges. Color policy:
      //   internal edges: source is a sub-node (addNode done) → derive from meta.
      //   external edges: the redir edge color was set correctly at group time →
      //     inherit it (the GroupNode has no port metadata to derive from).
      setEdges((eds) => {
        const redirStyleMap = new Map(eds.map((e) => [e.id, e.style]))
        const kept = eds.filter((e) => e.source !== groupId && e.target !== groupId)
        const restoredInternal = group.edges.map((e) => ({
          id: e.id,
          source: e.source.nodeId,
          target: e.target.nodeId,
          sourceHandle: e.source.port,
          targetHandle: e.target.port,
          animated: false,
          style: { stroke: resolveEdgeColor(e.source.nodeId, e.source.port, domainPortTypes), strokeWidth: 2 },
        }))
        const restoredExternal: Edge[] = []
        for (const rEdge of [...redirEdgesIn, ...redirEdgesOut]) {
          if (rEdge.target.nodeId === groupId) {
            const exposed = group.exposedInputs.find((p) => p.portName === rEdge.target.port)
            if (!exposed) continue
            const redirStyle = redirStyleMap.get(rEdge.id)
            const color = (redirStyle?.stroke as string | undefined) ?? resolveEdgeColor(rEdge.source.nodeId, rEdge.source.port, domainPortTypes)
            restoredExternal.push({
              id: rEdge.id.replace('_redir', ''),
              source: rEdge.source.nodeId,
              sourceHandle: rEdge.source.port,
              target: exposed.sourceNodeId,
              targetHandle: exposed.sourcePortName,
              animated: false,
              style: { stroke: color, strokeWidth: 2 },
            } as unknown as Edge)
          }
          if (rEdge.source.nodeId === groupId) {
            const exposed = group.exposedOutputs.find((p) => p.portName === rEdge.source.port)
            if (!exposed) continue
            const redirStyle = redirStyleMap.get(rEdge.id)
            const color = (redirStyle?.stroke as string | undefined) ?? resolveEdgeColor(exposed.sourceNodeId, exposed.sourcePortName, domainPortTypes)
            restoredExternal.push({
              id: rEdge.id.replace('_redir', ''),
              source: exposed.sourceNodeId,
              sourceHandle: exposed.sourcePortName,
              target: rEdge.target.nodeId,
              targetHandle: rEdge.target.port,
              animated: false,
              style: { stroke: color, strokeWidth: 2 },
            } as unknown as Edge)
          }
        }
        return [...kept, ...restoredInternal, ...restoredExternal]
      })

      // Ungroup restores the inner sub-nodes; recompute them + their downstream
      // closure. Execute INCREMENTALLY from the first restored node (boundary
      // upstream hydrates from cache) — a full-graph execute would needlessly run
      // unrelated branches and let any unrelated error abort the whole pipeline.
      // Await the persist first so execute never races ahead of the in-flight
      // ungroup op (same ordering guarantee as the grouping path above).
      const firstNodeId = group.nodes[0]?.id
      if (firstNodeId) {
        setTimeout(() => {
          void usePipelineStore.getState().persistSession()
            .then(() =>
              usePipelineStore.getState().incrementalExecute(firstNodeId, false, { persist: false }),
            )
        }, 50)
      }
    },
    [addNode, removeNode, addEdge, removeEdge, addGroup, removeGroup, setNodes, setEdges],
  )

  return { groupSelectedNodes, ungroupNode }
}
