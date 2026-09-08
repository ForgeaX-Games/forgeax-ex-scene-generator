// Group-view navigation hook. Ported from the legacy editor
// (components/canvas/useCanvasGroupView.ts).
// Responsibilities:
//   1. Decide what the canvas shows based on pipelineStore.groupViewStack
//      (outer nodes OR a group's inner nodes).
//   2. On group entry, build innerNodes + innerEdges (incl. external context nodes).
//   3. Track live inner edits via refs, flushing them back to the store on exit.
//   4. Provide the breadcrumb navigation data.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Node, Edge, ReactFlowInstance } from '../../xyflow.js'
import { enqueueGroupParamExecute, usePipelineStore, setGroupInnerSink } from '../../stores/index.js'
import { getPortTypeColor, type DomainPortTypes } from '../../utils/portTypes.js'
import { DEFAULT_BATTERY_WIDTH, DEFAULT_GROUP_WIDTH, estimateBatteryNodeWidth, estimateGroupNodeWidth } from './canvasConstants.js'
import type { NodeGroup, PipelineEdge, PipelineNode } from '../../types.js'
import { getVisibleGroupPorts, resolveEdgeColorFromStore, resolveNodeTypeAndStyleFromStore, sortGroupPorts } from './groupViewUtils.js'
import type { BreadcrumbItem } from './GroupBreadcrumb.js'
import { RELAY_BATTERY_ID, RELAY_NODE_HEIGHT, RELAY_NODE_WIDTH } from './RelayNode.js'
import { buildGroupNodeData } from './GroupNode.js'

export interface UseCanvasGroupViewParams {
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>
  reactFlowInstance: ReactFlowInstance | null
  /** Build the outer nodes (root or parent level), rebuilt after exiting a group view. */
  buildOuterNodes: () => Node[]
  buildOuterEdges: () => Edge[]
  /** Ungroup callback (for GroupNode). */
  onUngroup: (groupId: string) => void
  onEnterGroup: (groupId: string) => void
  /** Domain port types for inner-view edge/boundary colouring. */
  domainPortTypes?: DomainPortTypes
}

export interface UseCanvasGroupViewReturn {
  isInGroupView: boolean
  currentGroupId: string | null
  currentGroup: NodeGroup | null
  breadcrumbs: BreadcrumbItem[]
  /** Called on inner node position change (innerLayout tracking). */
  syncInnerNodePosition: (nodeId: string, position: { x: number; y: number }) => void
  /** Called when a new inner node is added to the current group view. */
  syncInnerNodeAdd: (node: PipelineNode) => void
  /** Called when an inner node's param changes; returns whether the id was handled. */
  syncInnerNodeParam: (nodeId: string, key: string, value: unknown) => boolean
  /** Called when inner nodes are deleted from the current group view. */
  syncInnerNodesDelete: (nodes: Node[]) => void
  /** Called when an inner edge is added. */
  syncInnerEdgeAdd: (edge: PipelineEdge) => void
  /** Called when an inner edge is removed. */
  syncInnerEdgeRemove: (edgeId: string) => void
  /** Enter a group view. */
  enterGroupView: (groupId: string) => void
  /** Exit the group view (return to the parent level). */
  exitGroupView: () => void
  /** Breadcrumb cross-level jump: depth=0 returns to root; depth=N keeps the first N levels. */
  jumpToGroupViewDepth: (depth: number) => void
  /** Rebuild the inner canvas from the store after a structural exposed-port change. */
  rebuildInnerView: () => void
}

import {
  BOUNDARY_INPUT_PREFIX,
  BOUNDARY_OUTPUT_PREFIX,
  makeGroupContextNodeId,
} from './groupBoundaryIds.js'
import {
  BOUNDARY_EDGE_PREFIX,
  BOUNDARY_MAP_PREFIX,
  CONTEXT_GAP_X,
  CONTEXT_MIN_GAP_Y,
  CONTEXT_LABEL_OVERHANG_Y,
  GROUP_NODE_MIN_HEIGHT,
  SHELL_WIDTH,
  SHELL_GAP_X,
  estimateShellHeight,
  isGroupContextInputNodeId,
  isGroupContextOutputNodeId,
  getGroupContextInputSourceNodeId,
  getGroupContextOutputTargetNodeId,
  isBoundaryInputNodeId,
  isBoundaryOutputNodeId,
  getGroupIdFromBoundaryNodeId,
  isBoundaryNodeId,
  isBoundaryEdge,
  computeNodeBounds,
  clamp,
  estimateBatteryNodeHeight,
  estimateGroupNodeHeight,
  resolveGroupContainer,
} from './groupViewLayout.js'

export { BOUNDARY_INPUT_PREFIX, BOUNDARY_OUTPUT_PREFIX, makeGroupContextNodeId }
export {
  BOUNDARY_EDGE_PREFIX,
  BOUNDARY_MAP_PREFIX,
  isGroupContextInputNodeId,
  isGroupContextOutputNodeId,
  getGroupContextInputSourceNodeId,
  getGroupContextOutputTargetNodeId,
  isBoundaryInputNodeId,
  isBoundaryOutputNodeId,
  getGroupIdFromBoundaryNodeId,
}

export function useCanvasGroupView({
  setNodes,
  setEdges,
  reactFlowInstance,
  buildOuterNodes,
  buildOuterEdges,
  onUngroup,
  onEnterGroup,
  domainPortTypes,
}: UseCanvasGroupViewParams): UseCanvasGroupViewReturn {
  const groupViewStack = usePipelineStore((s) => s.groupViewStack)
  const enterGroupViewStore = usePipelineStore((s) => s.enterGroupView)
  const exitGroupViewStore = usePipelineStore((s) => s.exitGroupView)
  const popGroupViewToStore = usePipelineStore((s) => s.popGroupViewTo)
  const updateGroup = usePipelineStore((s) => s.updateGroup)
  const removeEdge = usePipelineStore((s) => s.removeEdge)
  const schedulePersistSession = usePipelineStore((s) => s.schedulePersistSession)

  const currentGroupId = groupViewStack.length > 0 ? groupViewStack[groupViewStack.length - 1] : null
  const isInGroupView = currentGroupId !== null

  // Refs tracking live inner edits (flushed back once on exit, to avoid frequent store writes).
  const innerNodesRef = useRef<PipelineNode[]>([])
  const innerLayoutRef = useRef<Record<string, { x: number; y: number }>>({})
  const innerEdgesRef = useRef<PipelineEdge[]>([])
  const innerExposedInputsRef = useRef<NodeGroup['exposedInputs']>([])
  const innerExposedOutputsRef = useRef<NodeGroup['exposedOutputs']>([])
  const isDirtyRef = useRef(false)
  // Break the buildInnerNodes ↔ rebuildInnerView cycle: the shell nodes carry an
  // onRebuild callback that defers to the latest rebuild implementation.
  const rebuildInnerViewRef = useRef<() => void>(() => {})

  // Build the inner ReactFlow nodes (inner sub-nodes + external context nodes).
  const buildInnerNodes = useCallback((group: NodeGroup, onEntGrp: (gid: string) => void): Node[] => {
    const { batteries, currentPipeline } = usePipelineStore.getState()
    const innerLayout = group.innerLayout ?? {}
    const container = resolveGroupContainer(group.id)
    const externalInEdges = container.edges.filter((edge) => edge.target.nodeId === container.groupNodeId)
    const externalOutEdges = container.edges.filter((edge) => edge.source.nodeId === container.groupNodeId)

    const subNodes: Node[] = group.nodes.map((n) => {
      const battery = batteries.find((b) => b.id === n.batteryId)
      const pos = innerLayout[n.id] ?? n.position

      if (n.batteryId === RELAY_BATTERY_ID) {
        return {
          id: n.id,
          type: 'relay',
          position: pos,
          style: { width: RELAY_NODE_WIDTH, height: RELAY_NODE_HEIGHT },
          data: { portType: typeof n.params?.portType === 'string' ? n.params.portType : 'any' },
          selected: false,
        }
      }

      // A sub-node may itself be a GroupNode (nested).
      if (n.batteryId === '__group__') {
        const innerGroup = (currentPipeline?.groups ?? []).find((g) => g.id === n.params?.groupId)
        if (innerGroup) {
          return {
            id: n.id,
            type: 'group',
            position: pos,
            style: { width: estimateGroupNodeWidth(innerGroup, batteries) },
            data: buildGroupNodeData(innerGroup, onUngroup, onEntGrp),
            selected: false,
          }
        }
      }

      if (!battery) return null
      const { type: nodeType, style } = resolveNodeTypeAndStyleFromStore(n.batteryId)
      return {
        id: n.id,
        type: nodeType,
        position: pos,
        style,
        data: { battery, params: n.params || {} },
        selected: false,
      }
    }).filter(Boolean) as Node[]

    const bounds = computeNodeBounds(subNodes)
    const inputByPort = new Map(sortGroupPorts(group.exposedInputs).map((port) => [port.portName, port]))
    const outputByPort = new Map(sortGroupPorts(group.exposedOutputs).map((port) => [port.portName, port]))

    // Shell anchors: the input shell sits just left of the inner nodes, the
    // output shell just right; context nodes are pushed further out so the
    // external wire reaches the shell, and the shell bridges on to the inner port.
    const visibleInputs = getVisibleGroupPorts(group.exposedInputs)
    const visibleOutputs = getVisibleGroupPorts(group.exposedOutputs)
    const shellInHeight = estimateShellHeight(visibleInputs.length)
    const shellOutHeight = estimateShellHeight(visibleOutputs.length)
    const shellInX = bounds.minX - SHELL_GAP_X - SHELL_WIDTH
    const shellOutX = bounds.maxX + SHELL_GAP_X
    const boundsCenterY = (bounds.minY + bounds.maxY) / 2
    const shellInY = boundsCenterY - shellInHeight / 2
    const shellOutY = boundsCenterY - shellOutHeight / 2

    const getContextSize = (nodeId: string): { width: number; height: number } => {
      const sourceNode = container.nodes.find((n) => n.id === nodeId)
      if (sourceNode?.batteryId === RELAY_BATTERY_ID) return { width: RELAY_NODE_WIDTH, height: RELAY_NODE_HEIGHT }
      if (sourceNode?.batteryId === '__group__') {
        const childGroupId = typeof sourceNode.params?.groupId === 'string' ? sourceNode.params.groupId : ''
        const childGroup = (currentPipeline?.groups ?? []).find((g) => g.id === childGroupId)
        return {
          width: childGroup ? estimateGroupNodeWidth(childGroup, batteries) : DEFAULT_GROUP_WIDTH,
          height: childGroup ? estimateGroupNodeHeight(childGroup) : GROUP_NODE_MIN_HEIGHT,
        }
      }
      const battery = batteries.find((b) => b.id === sourceNode?.batteryId)
      if (!sourceNode || !battery) return { width: DEFAULT_BATTERY_WIDTH, height: GROUP_NODE_MIN_HEIGHT }
      const savedWidth = typeof sourceNode.params?._nodeWidth === 'number' ? sourceNode.params._nodeWidth : undefined
      return {
        width: savedWidth ?? estimateBatteryNodeWidth(battery, DEFAULT_BATTERY_WIDTH),
        height: estimateBatteryNodeHeight(sourceNode, battery),
      }
    }

    const buildContextNode = (
      contextId: string,
      nodeId: string,
      direction: 'in' | 'out',
      y: number,
    ): Node | null => {
      const sourceNode = container.nodes.find((n) => n.id === nodeId)
      if (!sourceNode) return null
      const { width: contextWidth } = getContextSize(nodeId)
      const className = `group-context-node group-context-node--${direction === 'in' ? 'input' : 'output'}`
      const pos = direction === 'in'
        ? { x: shellInX - contextWidth - CONTEXT_GAP_X, y }
        : { x: shellOutX + SHELL_WIDTH + CONTEXT_GAP_X, y }

      if (sourceNode.batteryId === RELAY_BATTERY_ID) {
        return {
          id: contextId,
          type: 'relay',
          position: pos,
          className,
          style: { width: RELAY_NODE_WIDTH, height: RELAY_NODE_HEIGHT },
          data: { portType: typeof sourceNode.params?.portType === 'string' ? sourceNode.params.portType : 'any' },
          selected: false,
          selectable: false,
          draggable: false,
          deletable: false,
          connectable: true,
        }
      }

      if (sourceNode.batteryId === '__group__') {
        const childGroupId = typeof sourceNode.params?.groupId === 'string' ? sourceNode.params.groupId : ''
        const childGroup = (currentPipeline?.groups ?? []).find((g) => g.id === childGroupId)
        if (!childGroup) return null
        return {
          id: contextId,
          type: 'group',
          position: pos,
          className,
          style: { width: estimateGroupNodeWidth(childGroup, batteries) },
          data: buildGroupNodeData(childGroup, onUngroup, onEntGrp),
          selected: false,
          selectable: false,
          draggable: false,
          deletable: false,
          connectable: true,
        }
      }

      const battery = batteries.find((b) => b.id === sourceNode.batteryId)
      if (!battery) return null
      const { type: nodeType, style } = resolveNodeTypeAndStyleFromStore(sourceNode.batteryId)
      const savedHeight = typeof sourceNode.params?._nodeHeight === 'number' ? sourceNode.params._nodeHeight : undefined
      return {
        id: contextId,
        type: nodeType,
        position: pos,
        className,
        style: {
          ...style,
          width: contextWidth,
          ...(savedHeight !== undefined ? { height: savedHeight } : {}),
        },
        data: { battery, params: sourceNode.params || {} },
        selected: false,
        selectable: false,
        draggable: false,
        deletable: false,
        connectable: true,
      }
    }

    const buildContextItems = (
      edgesForContext: PipelineEdge[],
      direction: 'in' | 'out',
    ): Array<{ contextId: string; nodeId: string }> => {
      const seen = new Set<string>()
      const items: Array<{ contextId: string; nodeId: string }> = []
      for (const edge of edgesForContext) {
        const nodeId = direction === 'in' ? edge.source.nodeId : edge.target.nodeId
        if (!container.nodes.some((node) => node.id === nodeId)) continue
        const exposed = direction === 'in'
          ? inputByPort.get(edge.target.port)
          : outputByPort.get(edge.source.port)
        if (!exposed) continue
        const contextId = direction === 'in'
          ? makeGroupContextNodeId('in', nodeId)
          : makeGroupContextNodeId('out', nodeId)
        // Reuse the same context node per external node; multiple external output
        // edges connect to different target handles of the same context battery to
        // avoid duplicating identical batteries in the group view.
        if (seen.has(contextId)) continue
        seen.add(contextId)
        items.push({ contextId, nodeId })
      }
      return items
    }

    const resolveAlignedRows = (
      inputItems: Array<{ contextId: string; nodeId: string }>,
      outputItems: Array<{ contextId: string; nodeId: string }>,
    ): { inputRows: Map<string, number>; outputRows: Map<string, number> } => {
      const rowCount = Math.max(inputItems.length, outputItems.length)
      const inputRows = new Map<string, number>()
      const outputRows = new Map<string, number>()
      if (rowCount === 0) return { inputRows, outputRows }

      const rowHeights = Array.from({ length: rowCount }, (_, index) => {
        const inputHeight = inputItems[index] ? getContextSize(inputItems[index].nodeId).height : 0
        const outputHeight = outputItems[index] ? getContextSize(outputItems[index].nodeId).height : 0
        return Math.max(inputHeight, outputHeight, 1) + CONTEXT_LABEL_OVERHANG_Y
      })
      const totalHeight = rowHeights.reduce((sum, height) => sum + height, 0)
        + CONTEXT_MIN_GAP_Y * Math.max(0, rowCount - 1)
      const minStartY = bounds.minY
      const maxStartY = Math.max(bounds.minY, bounds.maxY - totalHeight)
      let y = clamp((bounds.minY + bounds.maxY - totalHeight) / 2, minStartY, maxStartY)

      for (let index = 0; index < rowCount; index += 1) {
        const inputItem = inputItems[index]
        const outputItem = outputItems[index]
        const rowHeight = rowHeights[index]
        if (inputItem) {
          const height = getContextSize(inputItem.nodeId).height
          inputRows.set(inputItem.contextId, y + CONTEXT_LABEL_OVERHANG_Y + (rowHeight - CONTEXT_LABEL_OVERHANG_Y - height) / 2)
        }
        if (outputItem) {
          const height = getContextSize(outputItem.nodeId).height
          outputRows.set(outputItem.contextId, y + CONTEXT_LABEL_OVERHANG_Y + (rowHeight - CONTEXT_LABEL_OVERHANG_Y - height) / 2)
        }
        y += rowHeight + CONTEXT_MIN_GAP_Y
      }
      return { inputRows, outputRows }
    }

    const inputContextItems = buildContextItems(externalInEdges, 'in')
    const outputContextItems = buildContextItems(externalOutEdges, 'out')
    const { inputRows, outputRows } = resolveAlignedRows(inputContextItems, outputContextItems)

    const contextNodeIds = new Set<string>()
    const contextNodes: Node[] = []
    for (const { contextId, nodeId } of inputContextItems) {
      if (contextNodeIds.has(contextId)) continue
      const node = buildContextNode(contextId, nodeId, 'in', inputRows.get(contextId) ?? bounds.minY)
      if (node) {
        contextNodeIds.add(contextId)
        contextNodes.push(node)
      }
    }
    for (const { contextId, nodeId } of outputContextItems) {
      if (contextNodeIds.has(contextId)) continue
      const node = buildContextNode(contextId, nodeId, 'out', outputRows.get(contextId) ?? bounds.minY)
      if (node) {
        contextNodeIds.add(contextId)
        contextNodes.push(node)
      }
    }

    // Shell (boundary) nodes: rendered between the context nodes and the inner
    // nodes. They display the group's edited exposed ports and bridge each wire
    // on to the real inner port. Shown whenever the group has exposed ports in
    // that direction (even unconnected ones, mirroring the collapsed group face).
    const onRebuild = () => rebuildInnerViewRef.current()
    const shellNodes: Node[] = []
    if (group.exposedInputs.length > 0) {
      shellNodes.push({
        id: `${BOUNDARY_INPUT_PREFIX}${group.id}`,
        type: 'group_input',
        position: { x: shellInX, y: shellInY },
        data: { boundaryType: 'input', groupId: group.id, ports: visibleInputs, onRebuild },
        selectable: false,
        draggable: false,
        deletable: false,
        connectable: true,
      })
    }
    if (group.exposedOutputs.length > 0) {
      shellNodes.push({
        id: `${BOUNDARY_OUTPUT_PREFIX}${group.id}`,
        type: 'group_output',
        position: { x: shellOutX, y: shellOutY },
        data: { boundaryType: 'output', groupId: group.id, ports: visibleOutputs, onRebuild },
        selectable: false,
        draggable: false,
        deletable: false,
        connectable: true,
      })
    }

    return [...contextNodes, ...shellNodes, ...subNodes]
  }, [onUngroup])

  // Build the inner ReactFlow edges.
  const buildInnerEdges = useCallback((group: NodeGroup): Edge[] => {
    const container = resolveGroupContainer(group.id)
    // Externally-connected ports must show their edges in the group view. Do not
    // filter by `hidden` here, or "connected-but-hidden" ports in old data would
    // drop their lines and break the context.
    const inputByPort = new Map(sortGroupPorts(group.exposedInputs).map((port) => [port.portName, port]))
    const outputByPort = new Map(sortGroupPorts(group.exposedOutputs).map((port) => [port.portName, port]))
    const realEdges = group.edges.filter((edge) => !isBoundaryEdge(edge)).map((e) => {
      const color = resolveEdgeColorFromStore(e.source.nodeId, e.source.port, group.nodes, domainPortTypes)
      return {
        id: e.id,
        source: e.source.nodeId,
        sourceHandle: e.source.port,
        target: e.target.nodeId,
        targetHandle: e.target.port,
        animated: false,
        style: { stroke: color, strokeWidth: 2 },
      }
    })

    const shellInId = `${BOUNDARY_INPUT_PREFIX}${group.id}`
    const shellOutId = `${BOUNDARY_OUTPUT_PREFIX}${group.id}`
    const hasInnerNode = (nodeId: string): boolean => group.nodes.some((n) => n.id === nodeId)

    // Mapping segment: shell exposed port ↔ the real inner port it maps to.
    // Shown for every visible exposed port that carries a valid inner mapping
    // (independent of whether the port is externally connected).
    const mappingInEdges: Edge[] = getVisibleGroupPorts(group.exposedInputs)
      .filter((port) => port.sourceNodeId && port.sourcePortName && hasInnerNode(port.sourceNodeId))
      .map((port) => ({
        id: `${BOUNDARY_MAP_PREFIX}${group.id}__in__${port.portName}`,
        source: shellInId,
        sourceHandle: port.portName,
        target: port.sourceNodeId,
        targetHandle: port.sourcePortName,
        animated: false,
        deletable: true,
        style: { stroke: getPortTypeColor(port.portType ?? 'any', domainPortTypes), strokeWidth: 2 },
      }))

    const mappingOutEdges: Edge[] = getVisibleGroupPorts(group.exposedOutputs)
      .filter((port) => port.sourceNodeId && port.sourcePortName && hasInnerNode(port.sourceNodeId))
      .map((port) => ({
        id: `${BOUNDARY_MAP_PREFIX}${group.id}__out__${port.portName}`,
        source: port.sourceNodeId,
        sourceHandle: port.sourcePortName,
        target: shellOutId,
        targetHandle: port.portName,
        animated: false,
        deletable: true,
        style: { stroke: getPortTypeColor(port.portType ?? 'any', domainPortTypes), strokeWidth: 2 },
      }))

    // External segment: external context node ↔ shell exposed port.
    const externalInEdges: Edge[] = container.edges
      .filter((edge) => edge.target.nodeId === container.groupNodeId && inputByPort.has(edge.target.port))
      .map((edge) => {
        const exposed = inputByPort.get(edge.target.port)
        if (!exposed) return null
        const color = resolveEdgeColorFromStore(edge.source.nodeId, edge.source.port, container.nodes, domainPortTypes)
        return {
          id: `${BOUNDARY_EDGE_PREFIX}${group.id}__external_in__${edge.id}`,
          source: makeGroupContextNodeId('in', edge.source.nodeId),
          sourceHandle: edge.source.port,
          target: shellInId,
          targetHandle: exposed.portName,
          animated: false,
          deletable: false,
          style: { stroke: color, strokeWidth: 2 },
        } as Edge
      })
      .filter((edge): edge is Edge => edge !== null)

    const externalOutEdges: Edge[] = container.edges
      .filter((edge) => edge.source.nodeId === container.groupNodeId && outputByPort.has(edge.source.port))
      .map((edge) => {
        const exposed = outputByPort.get(edge.source.port)
        if (!exposed) return null
        const color = getPortTypeColor(exposed?.portType ?? 'any', domainPortTypes)
        return {
          id: `${BOUNDARY_EDGE_PREFIX}${group.id}__external_out__${edge.id}`,
          source: shellOutId,
          sourceHandle: exposed.portName,
          target: makeGroupContextNodeId('out', edge.target.nodeId),
          targetHandle: edge.target.port,
          animated: false,
          deletable: false,
          style: { stroke: color, strokeWidth: 2 },
        } as Edge
      })
      .filter((edge): edge is Edge => edge !== null)

    return [...realEdges, ...mappingInEdges, ...mappingOutEdges, ...externalInEdges, ...externalOutEdges]
  }, [domainPortTypes])

  // Rebuild the inner canvas after a structural exposed-port change (add / remove
  // / hide / reorder / bind / unbind). Exposed ports are authoritative in the
  // store (the port actions write there directly); inner nodes/edges/layout may
  // still hold unflushed live edits in the refs, so we merge the two so a rebuild
  // never clobbers a live inner wire or node move.
  const rebuildInnerView = useCallback(() => {
    if (!currentGroupId) return
    const { currentPipeline } = usePipelineStore.getState()
    const storeGroup = (currentPipeline?.groups ?? []).find((g) => g.id === currentGroupId)
    if (!storeGroup) return
    innerExposedInputsRef.current = [...storeGroup.exposedInputs]
    innerExposedOutputsRef.current = [...storeGroup.exposedOutputs]
    const merged: NodeGroup = {
      ...storeGroup,
      nodes: innerNodesRef.current,
      edges: innerEdgesRef.current,
      innerLayout: innerLayoutRef.current,
    }
    setNodes(buildInnerNodes(merged, onEnterGroup))
    setEdges(buildInnerEdges(merged))
  }, [currentGroupId, buildInnerNodes, buildInnerEdges, onEnterGroup, setNodes, setEdges])
  rebuildInnerViewRef.current = rebuildInnerView

  // Flush the current inner view's dirty state (layout + edges) back to the store;
  // returns whether anything changed.
  const flushInnerEdits = useCallback((): boolean => {
    if (!currentGroupId) return false
    if (!isDirtyRef.current) return false
    updateGroup(currentGroupId, {
      nodes: [...innerNodesRef.current],
      innerLayout: { ...innerLayoutRef.current },
      edges: innerEdgesRef.current.filter((edge) => !isBoundaryEdge(edge)),
      exposedInputs: [...innerExposedInputsRef.current],
      exposedOutputs: [...innerExposedOutputsRef.current],
    })
    return true
  }, [currentGroupId, updateGroup])

  // Durably persist a live inner edit. Inner edits are staged in refs and were
  // previously flushed to the kernel ONLY on exit (`exitGroupView`), so a page
  // refresh while still inside the group view lost every unflushed inner change
  // (deleted nodes/wires reappeared on reload — "没有持久化到 json"). Flush the
  // refs into the store group now and schedule a debounced durable persist, so an
  // inner structural edit survives a refresh just like a root-canvas edit does.
  const scheduleInnerPersist = useCallback(() => {
    flushInnerEdits()
    schedulePersistSession('group-inner-edit')
  }, [flushInnerEdits, schedulePersistSession])

  // Enter a group view. The useEffect on currentGroupId rebuilds the canvas after
  // pushing. When going deeper, flush the current level's dirty edits first.
  const enterGroupView = useCallback((groupId: string) => {
    const { currentPipeline } = usePipelineStore.getState()
    const group = (currentPipeline?.groups ?? []).find((g) => g.id === groupId)
    if (!group) {
      console.warn('[GroupView] enterGroupView: group not found', groupId)
      return
    }
    flushInnerEdits()
    enterGroupViewStore(groupId)
  }, [enterGroupViewStore, flushInnerEdits])

  // Exit the group view (pop one level): flush edits, rebuild, and recompute if dirty.
  const exitGroupView = useCallback(() => {
    if (!currentGroupId) return
    const { currentPipeline } = usePipelineStore.getState()
    const group = (currentPipeline?.groups ?? []).find((g) => g.id === currentGroupId)
    const dirty = flushInnerEdits()
    // The execution engine only runs TOP-LEVEL graph nodes. An inner node id is
    // not in graphFile.nodes, so executing it fails with "target node not found"
    // and the edited inner subgraph never recomputes (the "stuck at add_child"
    // symptom). Re-run the top-level group ANCESTOR instead — its shadow node id
    // equals groupViewStack[0] and IS a top-level node, so running it (fullExec=
    // false → it + downstream) re-executes the whole group subtree top-down,
    // including the just-edited inner nodes. This mirrors how every other inner
    // edit (updateGroupInnerNodeParam, bind/unbindGroupExposedPort) re-runs the
    // group node by its id rather than an inner node.
    const topLevelGroupNodeId = groupViewStack[0] ?? currentGroupId
    exitGroupViewStore()
    if (dirty && group && topLevelGroupNodeId) {
      setTimeout(() => {
        void usePipelineStore.getState().persistSession()
          .then(() => usePipelineStore.getState().incrementalExecute(topLevelGroupNodeId, false, { persist: false }))
      }, 80)
    }
  }, [currentGroupId, groupViewStack, exitGroupViewStore, flushInnerEdits])

  // Breadcrumb cross-level jump: flush the current inner dirty state, then trim the
  // stack to the given depth. depth=0 → root; depth=N → keep stack[0..N-1].
  const jumpToGroupViewDepth = useCallback((depth: number) => {
    flushInnerEdits()
    popGroupViewToStore(depth)
  }, [flushInnerEdits, popGroupViewToStore])

  // No setNodes on first mount (useSessionRestore owns that); later groupViewStack
  // changes (enter / exit / cross-level jump) rebuild the canvas.
  const [hasEnteredGroupView, setHasEnteredGroupView] = useState(false)

  useEffect(() => {
    if (currentGroupId) {
      const { currentPipeline } = usePipelineStore.getState()
      const group = (currentPipeline?.groups ?? []).find((g) => g.id === currentGroupId)
      if (!group) return
      innerNodesRef.current = [...group.nodes]
      innerLayoutRef.current = { ...group.innerLayout }
      innerEdgesRef.current = [...group.edges]
      innerExposedInputsRef.current = [...group.exposedInputs]
      innerExposedOutputsRef.current = [...group.exposedOutputs]
      isDirtyRef.current = false
      setHasEnteredGroupView(true)
      const innerNodes = buildInnerNodes(group, onEnterGroup)
      const innerEdges = buildInnerEdges(group)
      setNodes(innerNodes)
      setEdges(innerEdges)
      setTimeout(() => reactFlowInstance?.fitView({ padding: 0.15 }), 50)
      // A group runs as a black box (its inner intermediates are discarded), so
      // the inner wires would show empty "any / no result". Probe the inner
      // sub-graph now to hydrate nodeOutputs with each inner node's real output,
      // driving the internal data-probes. Best-effort + async — never blocks the
      // view switch.
      void usePipelineStore.getState().probeGroupInnerOutputs(currentGroupId)
    } else if (hasEnteredGroupView) {
      const outerNodes = buildOuterNodes()
      const outerEdges = buildOuterEdges()
      if (outerNodes.length > 0 || outerEdges.length > 0) {
        setNodes(outerNodes)
        setEdges(outerEdges)
        setTimeout(() => reactFlowInstance?.fitView({ padding: 0.1 }), 50)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentGroupId])

  const syncInnerNodePosition = useCallback((nodeId: string, position: { x: number; y: number }) => {
    innerLayoutRef.current[nodeId] = position
    isDirtyRef.current = true
    scheduleInnerPersist()
  }, [scheduleInnerPersist])

  const syncInnerNodesDelete = useCallback((deleted: Node[]) => {
    if (!currentGroupId) return

    const deletedIds = new Set(
      deleted
        .map((node) => node.id)
        .filter((nodeId) => !isBoundaryNodeId(nodeId)),
    )
    if (deletedIds.size === 0) return

    const { currentPipeline, groupViewStack: stack } = usePipelineStore.getState()
    const currentGroup = (currentPipeline?.groups ?? []).find((group) => group.id === currentGroupId)
    if (!currentGroup) return

    const removedInputPorts = new Set(
      innerExposedInputsRef.current
        .filter((port) => deletedIds.has(port.sourceNodeId))
        .map((port) => port.portName),
    )
    const removedOutputPorts = new Set(
      innerExposedOutputsRef.current
        .filter((port) => deletedIds.has(port.sourceNodeId))
        .map((port) => port.portName),
    )

    innerNodesRef.current = innerNodesRef.current.filter((node) => !deletedIds.has(node.id))
    for (const nodeId of deletedIds) delete innerLayoutRef.current[nodeId]
    innerEdgesRef.current = innerEdgesRef.current.filter(
      (edge) => !deletedIds.has(edge.source.nodeId) && !deletedIds.has(edge.target.nodeId) && !isBoundaryEdge(edge),
    )
    innerExposedInputsRef.current = innerExposedInputsRef.current.filter((port) => !deletedIds.has(port.sourceNodeId))
    innerExposedOutputsRef.current = innerExposedOutputsRef.current.filter((port) => !deletedIds.has(port.sourceNodeId))

    const removedEdgeIds = new Set<string>()
    const container = resolveGroupContainer(currentGroupId)
    const isRemovedGroupPortEdge = (edge: PipelineEdge): boolean =>
      (edge.target.nodeId === container.groupNodeId && removedInputPorts.has(edge.target.port)) ||
      (edge.source.nodeId === container.groupNodeId && removedOutputPorts.has(edge.source.port))

    const stackIndex = stack.lastIndexOf(currentGroupId)
    const parentGroupId = stackIndex > 0 ? stack[stackIndex - 1] : null
    if (parentGroupId) {
      const parentGroup = (currentPipeline?.groups ?? []).find((group) => group.id === parentGroupId)
      if (parentGroup) {
        updateGroup(parentGroupId, {
          edges: parentGroup.edges.filter((edge) => {
            if (!isRemovedGroupPortEdge(edge)) return true
            removedEdgeIds.add(edge.id)
            return false
          }),
        })
      }
    } else {
      for (const edge of currentPipeline?.edges ?? []) {
        if (isRemovedGroupPortEdge(edge)) {
          removedEdgeIds.add(edge.id)
          removeEdge(edge.id)
        }
      }
    }

    setNodes((nodes) => nodes.filter((node) => !deletedIds.has(node.id)))
    setEdges((edges) =>
      edges.filter((edge) =>
        !deletedIds.has(edge.source) &&
        !deletedIds.has(edge.target) &&
        !removedEdgeIds.has(edge.id),
      ),
    )
    isDirtyRef.current = true
    scheduleInnerPersist()
  }, [currentGroupId, removeEdge, setEdges, setNodes, updateGroup, scheduleInnerPersist])

  // A battery dropped / inserted while inside a group view belongs to the group,
  // not the root graph. Push it into the live inner refs (the canvas node was
  // already added by the drop hook's setNodes) and mark dirty so the exit flush
  // saves it into the group (turning the outer instance `unsaved*`).
  const syncInnerNodeAdd = useCallback((node: PipelineNode) => {
    innerNodesRef.current = [...innerNodesRef.current.filter((n) => n.id !== node.id), node]
    innerLayoutRef.current[node.id] = node.position
    isDirtyRef.current = true
    scheduleInnerPersist()
  }, [scheduleInnerPersist])

  // An inner node's param edit (text panel content, slider/toggle value, resize…)
  // updates the live ref + the on-canvas node data, and marks dirty. Returns false
  // for ids that are not inner nodes of the current group so the store can fall
  // back to its normal root-graph path.
  const syncInnerNodeParam = useCallback((nodeId: string, key: string, value: unknown): boolean => {
    if (!innerNodesRef.current.some((n) => n.id === nodeId)) return false
    innerNodesRef.current = innerNodesRef.current.map((n) =>
      n.id === nodeId ? { ...n, params: { ...n.params, [key]: value } } : n,
    )
    setNodes((nds) => nds.map((node) =>
      node.id === nodeId
        ? { ...node, data: { ...node.data, params: { ...(node.data?.params ?? {}), [key]: value } } }
        : node,
    ))
    isDirtyRef.current = true
    scheduleInnerPersist()
    const topLevelGroupId = usePipelineStore.getState().groupViewStack[0] ?? currentGroupId
    if (topLevelGroupId) {
      enqueueGroupParamExecute(() => usePipelineStore.getState(), topLevelGroupId)
    }
    return true
  }, [currentGroupId, setNodes, scheduleInnerPersist])

  // Register the inner param-edit sink while a group view is active so the store's
  // generic updateNodeParam routes an inner node's param edit here instead of the
  // root graph. (Node ADD is routed at the drop hook, not via the store.)
  useEffect(() => {
    if (!currentGroupId) return
    setGroupInnerSink(syncInnerNodeParam)
    return () => setGroupInnerSink(null)
  }, [currentGroupId, syncInnerNodeParam])

  const syncInnerEdgeAdd = useCallback((edge: PipelineEdge) => {
    innerEdgesRef.current = innerEdgesRef.current.filter((e) => e.id !== edge.id)
    innerEdgesRef.current.push(edge)
    isDirtyRef.current = true
    scheduleInnerPersist()
  }, [scheduleInnerPersist])

  const syncInnerEdgeRemove = useCallback((edgeId: string) => {
    if (edgeId.startsWith(BOUNDARY_EDGE_PREFIX) || edgeId.startsWith(BOUNDARY_MAP_PREFIX)) return
    innerEdgesRef.current = innerEdgesRef.current.filter((e) => e.id !== edgeId)
    isDirtyRef.current = true
    scheduleInnerPersist()
  }, [scheduleInnerPersist])

  // Breadcrumbs.
  const { currentPipeline } = usePipelineStore.getState()
  const breadcrumbs: BreadcrumbItem[] = [
    { id: null, name: 'Root Pipeline' },
    ...groupViewStack.map((gid) => {
      const group = (currentPipeline?.groups ?? []).find((g) => g.id === gid)
      return { id: gid, name: group?.name ?? gid }
    }),
  ]

  const currentGroup = currentGroupId
    ? ((currentPipeline?.groups ?? []).find((g) => g.id === currentGroupId) ?? null)
    : null

  return {
    isInGroupView,
    currentGroupId,
    currentGroup,
    breadcrumbs,
    syncInnerNodePosition,
    syncInnerNodeAdd,
    syncInnerNodeParam,
    syncInnerNodesDelete,
    syncInnerEdgeAdd,
    syncInnerEdgeRemove,
    enterGroupView,
    exitGroupView,
    jumpToGroupViewDepth,
    rebuildInnerView,
  }
}
