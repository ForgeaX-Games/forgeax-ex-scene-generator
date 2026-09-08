// Main canvas component: the core ReactFlow visualisation surface. This file is
// the shell — local state, hook assembly, and JSX render; the interaction logic
// lives in the extracted canvas hooks:
//   useCanvasGraphSync — rebuild RF nodes/edges from the store + agent selection
//   useCanvasConnect   — connection creation, type validation, handle pulse
//   useCanvasDrop      — drop a battery from the palette
//   useCanvasDelete    — node / edge deletion + dynamic-port shrink
//   useCanvasGrid      — grid CSS-var updates on pan/zoom
//
// Split for clarity from the legacy 1664-LOC Canvas.tsx: the rendered DOM, CSS
// class names, ReactFlow wiring and node/edge type registration are identical.
// Group view, frames, snap guides, ctrl-drag ghost and copy/paste are all wired
// here via their extracted hooks. The only legacy couplings intentionally left
// out are APP-LEVEL chrome (the embedded renderer iframe) — a consumer injects
// those through Editor props, not the generic canvas.
import { useCallback, useState, useRef, useMemo, useEffect, startTransition } from 'react'
import {
  ReactFlow,
  MiniMap,
  Panel,
  applyEdgeChanges,
  applyNodeChanges,
  useEdgesState,
  useViewport,
  SelectionMode,
  type EdgeChange,
  type NodeChange,
  type NodeTypes,
  type OnSelectionChangeParams,
  type Connection,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Node, Edge, ReactFlowInstance } from '../../xyflow.js'
import { usePipelineStore, useUIStore } from '../../stores/index.js'
import type { Battery, BatteryPort, PipelineNode } from '../../types.js'
import { createCanvasNodeTypes, createCanvasEdgeTypes } from './canvasConstants.js'
import { ContextMenuPortal, type ContextMenuState } from './BatteryNode.js'
import { CanvasSearchPopover } from './CanvasSearchPopover.js'
import { useCanvasGraphSync, buildCanvasNodes, buildCanvasEdges } from './useCanvasGraphSync.js'
import { useCanvasConnect, resolveConnectionPortType } from './useCanvasConnect.js'
import { useCanvasDrop } from './useCanvasDrop.js'
import type { ExternalDropHandler } from './useCanvasDrop.js'
import { useCanvasDelete } from './useCanvasDelete.js'
import { useCanvasGrid } from './useCanvasGrid.js'
import { useCanvasGroup } from './useCanvasGroup.js'
import { useCanvasCopyPaste } from './useCanvasCopyPaste.js'
import { useCanvasSnap } from './useCanvasSnap.js'
import { useCanvasFrames } from './useCanvasFrames.js'
import { useCanvasUndoRedo } from './useCanvasUndoRedo.js'
import { useCtrlDragGhost } from './useCtrlDragGhost.js'
import { useCanvasRelayInteractions } from './useCanvasRelayInteractions.js'
import {
  useCanvasGroupView,
  BOUNDARY_EDGE_PREFIX,
  BOUNDARY_MAP_PREFIX,
  isGroupContextInputNodeId,
  isGroupContextOutputNodeId,
  isBoundaryInputNodeId,
  isBoundaryOutputNodeId,
  getGroupIdFromBoundaryNodeId,
} from './useCanvasGroupView.js'
import GroupBreadcrumb from './GroupBreadcrumb.js'
import { getPortTypeColor } from '../../utils/portTypes.js'
import { useHistoryStore } from '../../stores/index.js'
import './Canvas.css'
import type { DomainPortTypes } from '../../utils/portTypes.js'
import { ViewportMovingProvider, useViewportMoveHandlers } from './ViewportMovingContext.js'
import { reportCanvasViewport } from '../../utils/canvasPerfReport.js'

interface CanvasProps {
  domainNodeTypes?: Record<string, NodeTypes[string]>
  domainPortTypes?: DomainPortTypes
  onExternalDrop?: ExternalDropHandler
}

function CanvasInner({ domainNodeTypes, domainPortTypes, onExternalDrop }: CanvasProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const { onMoveStart, onMoveEnd } = useViewportMoveHandlers()

  // Precise selectors: action refs are stable; state fields only re-render on
  // their own change, so 60fps updateNodeParam doesn't re-render the shell.
  const setSelectedNode = usePipelineStore((s) => s.setSelectedNode)
  const setSelectedNodeIds = usePipelineStore((s) => s.setSelectedNodeIds)
  const setNodePreview = usePipelineStore((s) => s.setNodePreview)
  const moveAnnotation = usePipelineStore((s) => s.moveAnnotation)
  const searchBatteries = usePipelineStore((s) => s.batteries)
  const searchLangMode = useUIStore((s) => s.langMode)

  // Local ReactFlow node / edge state.
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useEdgesState<Edge>([])
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null)
  const activeNodeTypes = useMemo(() => createCanvasNodeTypes(domainNodeTypes, domainPortTypes), [domainNodeTypes, domainPortTypes])
  // Inject domainPortTypes into the probe edge too, so the data-probe type badge
  // colours domain types (e.g. scene → orange) the same as their port handles —
  // the static `edgeTypes` map has no domain colours and falls back to grey.
  const activeEdgeTypes = useMemo(() => createCanvasEdgeTypes(domainPortTypes), [domainPortTypes])

  // Snap-align state: targets written by onNodeDrag, applied in onNodesChange.
  const snapTargetsRef = useRef<{ id: string; x: number; y: number }[]>([])
  const snapEnabled = useUIStore((s) => s.snapEnabled)

  // Selection-direction awareness: left-to-right (ltr) -> solid box + Full mode;
  // right-to-left (rtl) -> dashed box + Partial mode.
  const [selectionMode, setSelectionMode] = useState<SelectionMode>(SelectionMode.Full)
  const [selectionDir, setSelectionDir] = useState<'ltr' | 'rtl'>('ltr')
  const selectionStartX = useRef<number | null>(null)
  const prevSelectionDir = useRef<'ltr' | 'rtl'>('ltr')

  // ── Selection-overlay context menu ────────────────────────────────────────
  const [selectionContextMenu, setSelectionContextMenu] = useState<ContextMenuState | null>(null)
  const closeSelectionContextMenu = useCallback(() => setSelectionContextMenu(null), [])

  const handleSelectionPreviewAction = useCallback(
    (nodeIds: string[], enabled: boolean) => {
      const label = `${enabled ? '开启' : '关闭'}预览（${nodeIds.length} 个节点）`
      const labelEn = `${enabled ? 'Enable' : 'Disable'} preview (${nodeIds.length} node(s))`
      const { currentPipeline } = usePipelineStore.getState()
      if (currentPipeline) {
        useHistoryStore.getState().record('toggle_preview', currentPipeline, { nodeIds, label, labelEn })
      }
      setNodePreview(nodeIds, enabled)
    },
    [setNodePreview],
  )

  // ── Functional hooks ──────────────────────────────────────────────────────
  const { connectLineColor, isValidConnection, onConnect: outerOnConnect, onConnectStart, onConnectEnd } =
    useCanvasConnect({ nodes, setEdges, setNodes, domainPortTypes })

  const { onNodesDelete: outerOnNodesDelete, onEdgesChange: outerOnEdgesChange, onEdgesDelete: outerOnEdgesDelete } = useCanvasDelete({
    nodes,
    edges,
    setEdges,
    setNodes,
  })

  const { updateGridVars } = useCanvasGrid(reactFlowWrapper)

  const handleViewportMoveStart = useCallback(
    (_e: unknown, viewport: { x: number; y: number; zoom: number }) => {
      onMoveStart()
      reportCanvasViewport('start', viewport)
    },
    [onMoveStart],
  )

  const handleViewportMove = useCallback(
    (_e: unknown, viewport: { x: number; y: number; zoom: number }) => {
      updateGridVars(viewport)
      reportCanvasViewport('move', viewport)
    },
    [updateGridVars],
  )

  const handleViewportMoveEnd = useCallback(
    (_e: unknown, viewport: { x: number; y: number; zoom: number }) => {
      onMoveEnd()
      reportCanvasViewport('end', viewport)
    },
    [onMoveEnd],
  )

  // ── Group system (create / ungroup / group-view navigation) ───────────────
  const { groupSelectedNodes, ungroupNode } = useCanvasGroup({ nodes, edges, setNodes, setEdges, domainPortTypes })

  // handleEnterGroup must call enterGroupView, which is produced by the group-view
  // hook below — break the cycle with a ref (legacy pattern).
  const handleEnterGroupRef = useRef<(groupId: string) => void>(() => {})
  const handleUngroup = useCallback((groupId: string) => {
    ungroupNode(groupId, handleUngroup)
  }, [ungroupNode])
  const handleEnterGroup = useCallback((groupId: string) => {
    handleEnterGroupRef.current(groupId)
  }, [])

  // Bridge a drop placed inside a group view to the group-view sync (produced by
  // the group-view hook below). Ref-deferred to break the hook ordering cycle.
  const syncInnerNodeAddRef = useRef<(node: PipelineNode) => void>(() => {})
  const { onDragEnter, onDragOver, onDrop, placeBattery } = useCanvasDrop({
    reactFlowInstance,
    setNodes,
    onUngroup: handleUngroup,
    onEnterGroup: handleEnterGroup,
    onExternalDrop,
    onInnerNodeAdd: (node) => syncInnerNodeAddRef.current(node),
  })

  const groupCallbacks = useMemo(
    () => ({ onUngroup: handleUngroup, onEnterGroup: handleEnterGroup }),
    [handleUngroup, handleEnterGroup],
  )
  const buildOuterNodes = useCallback(() => buildCanvasNodes(groupCallbacks), [groupCallbacks])
  const buildOuterEdges = useCallback(() => buildCanvasEdges(domainPortTypes), [domainPortTypes])

  const {
    isInGroupView,
    breadcrumbs,
    syncInnerNodePosition,
    syncInnerNodeAdd,
    syncInnerNodesDelete,
    syncInnerEdgeAdd,
    syncInnerEdgeRemove,
    enterGroupView,
    exitGroupView,
    jumpToGroupViewDepth,
    rebuildInnerView,
  } = useCanvasGroupView({
    setNodes,
    setEdges,
    reactFlowInstance,
    buildOuterNodes,
    buildOuterEdges,
    onUngroup: handleUngroup,
    onEnterGroup: handleEnterGroup,
    domainPortTypes,
  })
  // Wire the deferred enter-group ref to the real implementation.
  handleEnterGroupRef.current = enterGroupView
  // Wire the deferred inner-node-add ref for drops inside a group view.
  syncInnerNodeAddRef.current = syncInnerNodeAdd

  // Clipboard (Ctrl+C / Ctrl+V) — pasted GroupNodes get the same callbacks.
  useCanvasCopyPaste({ nodes, edges, setNodes, setEdges, onUngroup: handleUngroup, onEnterGroup: handleEnterGroup, domainPortTypes })

  // Global Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z — restore the history snapshot through
  // the kernel (no local-state desync); see useCanvasUndoRedo.
  useCanvasUndoRedo()

  // Ctrl+drag to duplicate a node (DOM ghost layer).
  useCtrlDragGhost({ reactFlowInstance, reactFlowWrapper, setNodes, setEdges, onUngroup: handleUngroup, onEnterGroup: handleEnterGroup })

  // Snap-align: guides while dragging + node-move persistence/history on stop.
  const {
    snapGuides,
    onNodeDrag: snapOnNodeDrag,
    onNodeDragStart: snapOnNodeDragStart,
    onNodeDragStop: snapOnNodeDragStop,
    onSelectionDragStop: snapOnSelectionDragStop,
  } = useCanvasSnap({ reactFlowInstance, reactFlowWrapper, snapTargetsRef, snapEnabled })

  // Canvas frames: create from selection + drag-containment + frame context menu.
  const {
    onFrameDragStart,
    onFrameDragMove,
    onFrameDragStop,
    syncFramesToStore,
    createFrameFromSelection,
    frameContextMenu,
    closeFrameContextMenu,
    onNodeContextMenu,
  } = useCanvasFrames({
    nodes,
    setNodes,
    edges,
    reactFlowInstance,
    groupSelectedNodes,
    onUngroup: handleUngroup,
    onEnterGroup: handleEnterGroup,
    domainPortTypes,
  })

  // Graph-sync owns the RF layer only at the root level; in a group view the
  // group-view hook drives it. Registered after the group hooks so isInGroupView
  // is known.
  useCanvasGraphSync({ reactFlowInstance, setNodes, setEdges, isInGroupView, groupCallbacks, domainPortTypes })

  const { onEdgeDoubleClick, onNodeDoubleClick } = useCanvasRelayInteractions({
    reactFlowInstance,
    setNodes,
    setEdges,
    isInGroupView,
    domainPortTypes,
  })

  const handleFlowInit = useCallback(
    (instance: ReactFlowInstance) => {
      setReactFlowInstance(instance)
      updateGridVars(instance.getViewport())
    },
    [updateGridVars],
  )

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((nds) => {
      const next = applyNodeChanges(changes, nds)
      // Apply any active snap target (X-axis override) during the drag frame.
      if (snapTargetsRef.current.length === 0) return next
      return next.map((n) => {
        const snap = snapTargetsRef.current.find((s) => s.id === n.id)
        return snap ? { ...n, position: { x: snap.x, y: n.position.y } } : n
      })
    })
  }, [])

  // ── Selection sync ──────────────────────────────────────────────────────
  // onSelectionChange is the single source of truth, avoiding races between
  // onNodeClick and onPaneClick.
  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }: OnSelectionChangeParams<Node>) => {
      // Deprioritize sidebar/renderer bridge updates so xyflow can paint the
      // selection ring and accept the next drag gesture on the same frame.
      startTransition(() => {
        setSelectedNodeIds(selectedNodes.map((n) => n.id))

        if (
          selectedNodes.length === 1 &&
          selectedNodes[0].type !== 'annotation' &&
          selectedNodes[0].type !== 'frame'
        ) {
          const node = selectedNodes[0]
          if (node.type === 'group') {
            const groupId = (node.data as { groupId?: string }).groupId
            const groupName = (node.data as { groupName?: string }).groupName
            const runtimeParams = (node.data as { runtimeParams?: Record<string, unknown> }).runtimeParams
            setSelectedNode({
              id: node.id,
              batteryId: '__group__',
              name: groupName || node.id,
              position: node.position,
              params: { ...runtimeParams, groupId: groupId ?? node.id },
            })
          } else {
            setSelectedNode({
              id: node.id,
              batteryId: node.data.battery?.id || '',
              name: node.data.battery?.name || node.id,
              position: node.position,
              params: node.data.params || {},
            })
          }
        } else {
          setSelectedNode(null)
        }
      })
    },
    [setSelectedNode, setSelectedNodeIds],
  )

  // ReactFlow onSelectionContextMenu: right-click the marquee rectangle. With ≥2
  // real pipeline nodes selected, offer Create Frame / Group (annotation + frame
  // nodes don't count toward the threshold).
  const onSelectionContextMenu = useCallback((e: React.MouseEvent, selectedNodes: Node[]) => {
    e.preventDefault()
    if (selectedNodes.length === 0) return
    const { currentPipeline } = usePipelineStore.getState()
    const anyEnabled = selectedNodes.some(
      (n) => currentPipeline?.nodes.find((pn) => pn.id === n.id)?.previewEnabled !== false,
    )
    const selectedIds = selectedNodes.map((n) => n.id)
    const frameableCount = selectedNodes.filter((n) =>
      currentPipeline?.nodes.some((pn) => pn.id === n.id),
    ).length
    setSelectionContextMenu({
      x: e.clientX,
      y: e.clientY,
      nodeIds: selectedIds,
      previewEnabled: anyEnabled,
      // A single real node can be framed; grouping still needs ≥2.
      extraItems: [
        ...(frameableCount >= 1
          ? [
              {
                label: `Create Frame (${frameableCount} node(s))`,
                onClick: () => createFrameFromSelection(selectedNodes),
              },
            ]
          : []),
        ...(frameableCount >= 2
          ? [
              {
                label: `Group (${frameableCount} node(s))`,
                onClick: () => groupSelectedNodes(selectedIds, handleUngroup, handleEnterGroup),
              },
            ]
          : []),
      ],
    })
  }, [createFrameFromSelection, groupSelectedNodes, handleUngroup, handleEnterGroup])

  // ── Marquee-direction detection ───────────────────────────────────────────
  const handleWrapperMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (
      target.closest('.react-flow__node') ||
      target.closest('.react-flow__handle') ||
      target.closest('.react-flow__minimap') ||
      target.closest('.react-flow__edge')
    )
      return
    selectionStartX.current = e.clientX
  }, [])

  const handleWrapperMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (selectionStartX.current === null) return
    const diff = e.clientX - selectionStartX.current
    if (Math.abs(diff) < 5) return
    const newDir = diff > 0 ? 'ltr' : 'rtl'
    if (newDir !== prevSelectionDir.current) {
      prevSelectionDir.current = newDir
      setSelectionDir(newDir)
      setSelectionMode(newDir === 'ltr' ? SelectionMode.Full : SelectionMode.Partial)
    }
  }, [])

  const handleWrapperMouseUp = useCallback(() => {
    selectionStartX.current = null
  }, [])

  // ── Group-aware connection / deletion / drag ──────────────────────────────
  // At root level these delegate to the store-backed hooks. Inside a group view,
  // edges/positions belong to the group, so they route to the group-view sync
  // refs (flushed back to the store on exit) instead of touching the outer graph.
  const onConnect = useCallback((params: Connection) => {
    if (!isInGroupView) {
      outerOnConnect(params)
      return
    }
    if (!params.source || !params.target || !params.sourceHandle || !params.targetHandle) return
    // Edges touching the read-only external context nodes are intentionally not
    // creatable from inside a group view (they mirror the parent level only).
    if (
      isGroupContextInputNodeId(params.source) || isGroupContextInputNodeId(params.target) ||
      isGroupContextOutputNodeId(params.source) || isGroupContextOutputNodeId(params.target)
    ) return

    // Shell ↔ inner port: bind / re-wire an exposed port. This writes the mapping
    // into the group's exposedInputs/Outputs (not the inner edge list); the outer
    // group instance then auto-derives `unsaved*`.
    const inputShellSource = isBoundaryInputNodeId(params.source)
    const outputShellTarget = isBoundaryOutputNodeId(params.target)
    if (inputShellSource || outputShellTarget) {
      // Reject shell↔shell or reversed combinations.
      if (isBoundaryInputNodeId(params.target) || isBoundaryOutputNodeId(params.source)) return
      const store = usePipelineStore.getState()
      if (inputShellSource) {
        const innerNode = nodes.find((n) => n.id === params.target)
        const portType = resolveConnectionPortType(innerNode, params.targetHandle, 'target')
        const access = innerNode?.data?.battery?.inputs?.find((i: BatteryPort) => i.name === params.targetHandle)?.access
        store.bindGroupExposedPort(getGroupIdFromBoundaryNodeId(params.source), 'input', params.sourceHandle, {
          sourceNodeId: params.target, sourcePortName: params.targetHandle, portType, access,
        })
      } else {
        const innerNode = nodes.find((n) => n.id === params.source)
        const portType = resolveConnectionPortType(innerNode, params.sourceHandle, 'source')
        const access = innerNode?.data?.battery?.outputs?.find((o: BatteryPort) => o.name === params.sourceHandle)?.access
        store.bindGroupExposedPort(getGroupIdFromBoundaryNodeId(params.target), 'output', params.targetHandle, {
          sourceNodeId: params.source, sourcePortName: params.sourceHandle, portType, access,
        })
      }
      rebuildInnerView()
      return
    }

    const srcNode = nodes.find((n) => n.id === params.source)
    const srcPort = srcNode?.data?.battery?.outputs?.find((o: BatteryPort) => o.name === params.sourceHandle)
    const relayPortType = srcNode?.type === 'relay' && typeof srcNode.data?.portType === 'string' ? srcNode.data.portType : undefined
    const color = relayPortType
      ? getPortTypeColor(relayPortType, domainPortTypes)
      : srcPort
        ? getPortTypeColor(srcPort.type, domainPortTypes)
        : 'var(--color-accent)'
    const edgeId = `e-${params.source}-${params.sourceHandle}-${params.target}-${params.targetHandle}`
    setEdges((eds) => {
      const filtered = eds.filter((e) => !(e.target === params.target && e.targetHandle === params.targetHandle))
      return [...filtered, {
        id: edgeId,
        source: params.source!,
        sourceHandle: params.sourceHandle!,
        target: params.target!,
        targetHandle: params.targetHandle!,
        animated: false,
        style: { stroke: color, strokeWidth: 2 },
      }]
    })
    syncInnerEdgeAdd({
      id: edgeId,
      source: { nodeId: params.source, port: params.sourceHandle },
      target: { nodeId: params.target, port: params.targetHandle },
    })
  }, [isInGroupView, outerOnConnect, nodes, setEdges, syncInnerEdgeAdd, rebuildInnerView, domainPortTypes])

  // Remove one inner-view edge: a shell↔inner mapping edge unbinds the exposed
  // port; a real inner edge routes to the group-view sync; boundary/context
  // (external) edges are read-only mirrors and are ignored.
  const removeGroupViewEdge = useCallback((edge: Edge) => {
    if (edge.id.startsWith(BOUNDARY_MAP_PREFIX)) {
      const store = usePipelineStore.getState()
      if (isBoundaryInputNodeId(edge.source) && edge.sourceHandle) {
        store.unbindGroupExposedPort(getGroupIdFromBoundaryNodeId(edge.source), 'input', edge.sourceHandle)
      } else if (isBoundaryOutputNodeId(edge.target) && edge.targetHandle) {
        store.unbindGroupExposedPort(getGroupIdFromBoundaryNodeId(edge.target), 'output', edge.targetHandle)
      }
      rebuildInnerView()
      return
    }
    if (!edge.id.startsWith(BOUNDARY_EDGE_PREFIX)) syncInnerEdgeRemove(edge.id)
  }, [syncInnerEdgeRemove, rebuildInnerView])

  const onEdgesDelete = useCallback((deleted: Edge[]) => {
    if (!isInGroupView) {
      outerOnEdgesDelete(deleted)
      return
    }
    for (const e of deleted) removeGroupViewEdge(e)
  }, [isInGroupView, outerOnEdgesDelete, removeGroupViewEdge])

  const onNodesDelete = useCallback((deleted: Node[]) => {
    if (isInGroupView) {
      syncInnerNodesDelete(deleted)
      return
    }
    outerOnNodesDelete(deleted)
  }, [isInGroupView, outerOnNodesDelete, syncInnerNodesDelete])

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (!isInGroupView) {
      outerOnEdgesChange(changes)
      return
    }

    const removedEdges = changes
      .filter((change) => change.type === 'remove')
      .map((change) => edges.find((edge) => edge.id === change.id))
      .filter((edge): edge is Edge => edge !== undefined)

    setEdges((currentEdges) => applyEdgeChanges(changes, currentEdges))

    for (const edge of removedEdges) removeGroupViewEdge(edge)
  }, [edges, isInGroupView, outerOnEdgesChange, setEdges, removeGroupViewEdge])

  // Capture the member start-positions when a frame drag begins (root level only;
  // frames don't exist inside a group view).
  const onNodeDragStart = useCallback((_event: MouseEvent | TouchEvent, node: Node) => {
    if (isInGroupView) return
    snapOnNodeDragStart()
    onFrameDragStart(node)
  }, [isInGroupView, snapOnNodeDragStart, onFrameDragStart])

  const onNodeDragStop = useCallback((event: MouseEvent | TouchEvent, node: Node, draggedNodes: Node[]) => {
    if (isInGroupView) {
      // Persist inner node positions to the group (skip transient context nodes).
      for (const n of draggedNodes) {
        if (isGroupContextInputNodeId(n.id) || isGroupContextOutputNodeId(n.id)) continue
        syncInnerNodePosition(n.id, n.position)
      }
      return
    }
    // Annotation drag: persist position to the store (annotations aren't graph
    // nodes, so they bypass the snap/frame pipeline).
    if (node.type === 'annotation') {
      moveAnnotation(node.id, node.position)
      return
    }
    // Dragging a frame persists its geometry + member positions itself.
    if (onFrameDragStop(node)) return
    // Root level: snap + persist + history, then re-grow any frame a member left.
    snapOnNodeDragStop(event, node, draggedNodes)
    syncFramesToStore(reactFlowInstance?.getNodes() ?? nodes)
  }, [isInGroupView, syncInnerNodePosition, onFrameDragStop, snapOnNodeDragStop, syncFramesToStore, reactFlowInstance, nodes, moveAnnotation])

  const onNodeDrag = useCallback((event: MouseEvent | TouchEvent, node: Node, draggedNodes: Node[]) => {
    if (isInGroupView) return
    // Dragging a frame translates its members instead of snap-aligning.
    if (onFrameDragMove(node)) return
    snapOnNodeDrag(event, node, draggedNodes)
  }, [isInGroupView, onFrameDragMove, snapOnNodeDrag])

  const onSelectionDragStop = useCallback((event: React.MouseEvent, draggedNodes: Node[]) => {
    if (isInGroupView) {
      for (const n of draggedNodes) {
        if (isGroupContextInputNodeId(n.id) || isGroupContextOutputNodeId(n.id)) continue
        syncInnerNodePosition(n.id, n.position)
      }
      return
    }
    // Persist any annotation positions moved as part of a multi-selection drag.
    for (const n of draggedNodes) {
      if (n.type === 'annotation') moveAnnotation(n.id, n.position)
    }
    snapOnSelectionDragStop(event, draggedNodes)
    syncFramesToStore(reactFlowInstance?.getNodes() ?? nodes)
  }, [isInGroupView, syncInnerNodePosition, snapOnSelectionDragStop, syncFramesToStore, reactFlowInstance, nodes, moveAnnotation])

  // Ctrl/Cmd+G groups the current multi-selection into a GroupNode (root only).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.key !== 'g' && e.key !== 'G')) return
      if (isInGroupView) return
      const { selectedNodeIds } = usePipelineStore.getState()
      if (selectedNodeIds.length >= 2) {
        e.preventDefault()
        groupSelectedNodes(selectedNodeIds, handleUngroup, handleEnterGroup)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isInGroupView, groupSelectedNodes, handleUngroup, handleEnterGroup])

  // ── Double-click search popover ───────────────────────────────────────────
  // Native dblclick on the pane (zoomOnDoubleClick disabled). Screen coords
  // position the popover; flow coords place the inserted battery.
  const [searchPopover, setSearchPopover] = useState<{
    screenX: number
    screenY: number
    flowX: number
    flowY: number
  } | null>(null)

  useEffect(() => {
    if (isInGroupView || !reactFlowInstance) return
    const pane = reactFlowWrapper.current?.querySelector('.react-flow__pane')
    if (!(pane instanceof HTMLElement)) return

    const onPaneDoubleClick = (e: MouseEvent) => {
      // Only the empty background opens the search popover. Nodes are descendants
      // of the pane, so a dblclick on e.g. a TextPanel body bubbles here too; we
      // must NOT stopPropagation in that case, or React's delegated onDoubleClick
      // on the node never fires (panel can't enter edit mode).
      const target = e.target as HTMLElement | null
      if (target?.closest('.react-flow__node')) return
      e.preventDefault()
      e.stopPropagation()
      const flow = reactFlowInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY })
      setSearchPopover({ screenX: e.clientX, screenY: e.clientY, flowX: flow.x, flowY: flow.y })
    }

    pane.addEventListener('dblclick', onPaneDoubleClick)
    return () => pane.removeEventListener('dblclick', onPaneDoubleClick)
  }, [isInGroupView, reactFlowInstance])

  const closeSearchPopover = useCallback(() => setSearchPopover(null), [])

  const handlePickBattery = useCallback((b: Battery) => {
    if (!searchPopover) return
    placeBattery(b, { x: searchPopover.flowX, y: searchPopover.flowY })
  }, [searchPopover, placeBattery])

  // ── JSX ─────────────────────────────────────────────────────────────────
  return (
    <div
      className={`canvas${isInGroupView ? ' canvas--group-view' : ''}`}
      ref={reactFlowWrapper}
      data-selection-dir={selectionDir}
      onMouseDown={handleWrapperMouseDown}
      onMouseMove={handleWrapperMouseMove}
      onMouseUp={handleWrapperMouseUp}
      onDrop={onDrop}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        connectionLineStyle={{ stroke: connectLineColor, strokeWidth: 2 }}
        onInit={handleFlowInit}
        onMoveStart={handleViewportMoveStart}
        onMove={handleViewportMove}
        onMoveEnd={handleViewportMoveEnd}
        zoomOnDoubleClick={false}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onSelectionDragStop={onSelectionDragStop}
        onDrop={onDrop}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onSelectionChange={onSelectionChange}
        onSelectionContextMenu={onSelectionContextMenu}
        onNodeContextMenu={onNodeContextMenu}
        onNodeDoubleClick={onNodeDoubleClick}
        onEdgeDoubleClick={onEdgeDoubleClick}
        onNodeDragStart={onNodeDragStart}
        nodeTypes={activeNodeTypes}
        edgeTypes={activeEdgeTypes}
        isValidConnection={isValidConnection}
        deleteKeyCode={['Delete', 'Backspace']}
        multiSelectionKeyCode="Shift"
        selectionOnDrag={true}
        panOnDrag={[1, 2]}
        autoPanOnNodeDrag={false}
        zoomOnScroll={true}
        zoomOnPinch={true}
        minZoom={0.01}
        maxZoom={200}
        selectionMode={selectionMode}
        elevateNodesOnSelect={false}
        defaultEdgeOptions={{
          animated: false,
          style: { stroke: 'var(--color-accent)', strokeWidth: 2 },
        }}
        proOptions={{ hideAttribution: true }}
      >
        <MiniMap
          nodeColor="var(--color-accent)"
          maskColor="rgba(0, 0, 0, 0.5)"
          style={{ backgroundColor: 'var(--color-bg-secondary)', width: 100, height: 75 }}
        />
        <Panel position="bottom-right" className="zoom-slider-panel">
          <ZoomSlider reactFlowInstance={reactFlowInstance} />
        </Panel>
      </ReactFlow>

      {isInGroupView && (
        <GroupBreadcrumb breadcrumbs={breadcrumbs} onExit={exitGroupView} onJumpToDepth={jumpToGroupViewDepth} />
      )}

      {selectionContextMenu && (
        <ContextMenuPortal
          menu={selectionContextMenu}
          onClose={closeSelectionContextMenu}
          onAction={handleSelectionPreviewAction}
        />
      )}

      {frameContextMenu && (
        <ContextMenuPortal menu={frameContextMenu} onClose={closeFrameContextMenu} onAction={() => {}} />
      )}

      {searchPopover && (
        <CanvasSearchPopover
          batteries={searchBatteries}
          langMode={searchLangMode}
          screenX={searchPopover.screenX}
          screenY={searchPopover.screenY}
          onClose={closeSearchPopover}
          onPickBattery={handlePickBattery}
        />
      )}

      {snapGuides.length > 0 && (
        <svg className="snap-guide-overlay" aria-hidden="true">
          {snapGuides.map((guide, i) =>
            guide.type === 'vertical' ? (
              <line key={i} x1={guide.position} y1={0} x2={guide.position} y2="100%" className="snap-guide-line" />
            ) : (
              <line key={i} x1={0} y1={guide.position} x2="100%" y2={guide.position} className="snap-guide-line" />
            ),
          )}
        </svg>
      )}
    </div>
  )
}

// ── Zoom control sub-component ──────────────────────────────────────────────
//
// useViewport() subscribes to ReactFlow's internal store, so only this
// component re-renders on viewport change — the parent Canvas is never
// disturbed during scroll-zoom.

const SLIDER_MIN = Math.log10(0.05)
const SLIDER_MAX = Math.log10(5)

function ZoomSlider({ reactFlowInstance }: { reactFlowInstance: ReactFlowInstance | null }) {
  const { zoom } = useViewport()

  const handleZoomSlider = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!reactFlowInstance) return
      const newZoom = Math.pow(10, parseFloat(e.target.value))
      const { x, y } = reactFlowInstance.getViewport()
      reactFlowInstance.setViewport({ x, y, zoom: newZoom }, { duration: 0 })
    },
    [reactFlowInstance],
  )

  return (
    <div className="zoom-slider-control">
      <button
        className="zoom-btn"
        onClick={() => reactFlowInstance?.zoomOut({ duration: 150 })}
        title="缩小"
      >
        −
      </button>
      <input
        type="range"
        className="zoom-slider-input"
        min={SLIDER_MIN}
        max={SLIDER_MAX}
        step={0.005}
        value={Math.log10(Math.max(0.05, Math.min(5, zoom)))}
        onChange={handleZoomSlider}
        title={`${Math.round(zoom * 100)}%`}
      />
      <button
        className="zoom-btn"
        onClick={() => reactFlowInstance?.zoomIn({ duration: 150 })}
        title="放大"
      >
        +
      </button>
      <span className="zoom-label">{Math.round(zoom * 100)}%</span>
    </div>
  )
}

function Canvas(props: CanvasProps) {
  return (
    <ViewportMovingProvider>
      <CanvasInner {...props} />
    </ViewportMovingProvider>
  )
}

export default Canvas
