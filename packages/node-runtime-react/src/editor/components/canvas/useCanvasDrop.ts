// Drop hook: drop a battery from the palette onto the canvas, build a ReactFlow
// node and sync it to the pipeline store. The placement logic is factored into
// placeBattery so the double-click search popover can reuse the same insertion
// path. Ported from the legacy editor (components/canvas/useCanvasDrop.ts),
// retargeted onto the editor stores.
//
import { useCallback, useEffect, useRef } from 'react'
import type { Node, ReactFlowInstance } from '../../xyflow.js'
import { usePipelineStore, useHistoryStore } from '../../stores/index.js'
import { createEmptyPipeline } from '../../stores/pipelineStore.helpers.js'
import type { Battery, PipelineNode } from '../../types.js'
import { resolveNodeType, DEFAULT_BATTERY_WIDTH, estimateBatteryNodeWidth, mintCanvasNodeId } from './canvasConstants.js'
import { formatIdAsLabel } from '../../utils/batteryLabels.js'
import { RELAY_BATTERY_ID, RELAY_NODE_HEIGHT, RELAY_NODE_WIDTH } from './RelayNode.js'
import { getEditorTransport } from '../../transport/index.js'
import { catalogBatteryKey } from '../sidebar/batteryGrouping.js'
import { readBatteryTextDragPayload } from '../sidebar/batteryDragPayload.js'
import { BATTERY_POINTER_DROP_EVENT, type BatteryPointerDropDetail } from '../sidebar/batteryPointerDrag.js'

/** Shared kernel op id backing every saved-prompt node (see PromptNode). */
const PROMPT_OP_ID = 'prompt_template'

/** Resolve a battery from a drop event: slim id payload (catalog lookup) or legacy full JSON. */
function resolveDroppedBattery(event: React.DragEvent): Battery | null {
  // Match on catalogBatteryKey (sourcePath) first: a group id can appear twice in
  // the catalog when the same battery exists under both `groups/` (develop copy)
  // and `templates/` (published copy). Resolving by bare id returns whichever row
  // sorts first, which silently loads the wrong copy AND drops the template
  // styling/lock. Fall back to the id for payloads without a key.
  const batteryKey = event.dataTransfer.getData('application/battery-key')
  if (batteryKey) {
    const byKey = usePipelineStore.getState().batteries.find((b) => catalogBatteryKey(b) === batteryKey)
    if (byKey) return byKey
  }
  const batteryId = event.dataTransfer.getData('application/battery-id')
  if (batteryId) {
    const fromCatalog = usePipelineStore.getState().batteries.find((b) => b.id === batteryId)
    if (fromCatalog) return fromCatalog
  }
  const batteryData = event.dataTransfer.getData('application/battery')
  if (batteryData) {
    try {
      return JSON.parse(batteryData) as Battery
    } catch {
      // Continue to the WebKit-safe text/plain fallback below.
    }
  }

  const fallback = readBatteryTextDragPayload(event.dataTransfer.getData('text/plain'))
  if (!fallback) return null

  if (fallback.key) {
    const byKey = usePipelineStore.getState().batteries.find((b) => catalogBatteryKey(b) === fallback.key)
    if (byKey) return byKey
  }
  if (fallback.id) {
    const fromCatalog = usePipelineStore.getState().batteries.find((b) => b.id === fallback.id)
    if (fromCatalog) return fromCatalog
  }
  return fallback.battery ?? null
}

interface UseCanvasDropParams {
  reactFlowInstance: ReactFlowInstance | null
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>
  onUngroup?: (groupId: string) => void
  onEnterGroup?: (groupId: string) => void
  /**
   * App/domain hook for a drop that carries NO `application/battery` payload —
   * e.g. an image dragged from an embedded asset panel (a different iframe, so
   * the native dataTransfer does not survive). Called with the drop position in
   * flow coordinates plus `placeBattery`, so the consumer can look up a battery
   * and insert a node with preset params. Generic: the kernel knows nothing
   * about the domain payload (it lives in an app-side channel, e.g. localStorage).
   */
  onExternalDrop?: ExternalDropHandler
  /**
   * Route a newly placed node into the active group's internal view instead of
   * the root graph. Supplied (via a ref bridge) by the group-view hook; when the
   * canvas is inside a group view, `placeBattery` calls this in lieu of the
   * store's root-level `addNode`, so the new battery is saved into the group.
   */
  onInnerNodeAdd?: (node: PipelineNode) => void
}

export type ExternalDropHandler = (
  flowPosition: { x: number; y: number },
  event: React.DragEvent,
  placeBattery: PlaceBatteryFn,
) => void

export type PlaceBatteryFn = (
  battery: Battery,
  position: { x: number; y: number },
  options?: { presetText?: string; presetParams?: Record<string, unknown> },
) => string | null

export function useCanvasDrop({ reactFlowInstance, setNodes, onExternalDrop, onInnerNodeAdd }: UseCanvasDropParams) {
  // Canvas wrapper + ReactFlow both register onDrop; the same native drop can
  // invoke both handlers. Dedupe by timeStamp+position so placeBattery runs once.
  const lastDropSigRef = useRef<string | null>(null)

  const addNode = usePipelineStore((s) => s.addNode)
  const addAnnotation = usePipelineStore((s) => s.addAnnotation)
  const incrementalExecute = usePipelineStore((s) => s.incrementalExecute)

  // dragenter 与 dragover 都必须 preventDefault 才算合法 drop target。
  // 单独 cancel dragover 在 Chrome 够用，但 WebKit（Studio/.app 的 WKWebView）
  // 在进入时若 dragenter 未 cancel 会先显示「禁止」光标、直到下一次 dragover 才纠正，
  // 期间松手 drop 不触发 → 电池创建失败。补 onDragEnter 消除这个进入瞬态。
  const onDragEnter = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const placeBattery = useCallback<PlaceBatteryFn>(
    (battery, position, options) => {
      const presetText = options?.presetText
      const presetExtraParams = options?.presetParams ?? {}
      // Inside a group's internal view the new node is routed to the group (via
      // the store's addNode → group-view sink). Skip the root-graph history record
      // and execute here: the node isn't in the root kernel graph, so a root
      // execute would no-op/error and an undo snapshot would desync from the
      // group's live refs. The exit flush re-executes the edited inner subgraph.
      const inGroupView = usePipelineStore.getState().groupViewStack.length > 0
      // Inside a group view the node belongs to the group's inner graph, so route
      // it to the group-view sink (live refs, flushed on exit) instead of the root
      // store; otherwise insert at root as usual.
      const insertNode = (node: PipelineNode) => {
        if (inGroupView && onInnerNodeAdd) onInnerNodeAdd(node)
        else addNode(node)
      }

      if (battery.type === 'group') {
        // Published native Definitions are authoring entities, not JSON graph
        // bundles. Add the public function call to canonical Scene Script and
        // let the resulting graph:applied/loadPipeline rebuild the canvas. Never
        // fall back to loadGroup → client remap → createGroup for this marker:
        // that path diverges from canonical source and is rejected by the
        // Scene-Script batch adapter.
        if (battery.nativeDefinition) {
          if (inGroupView) {
            console.error('[placeBattery] native Scene Definitions can only be added at the project root')
            return null
          }
          void getEditorTransport().api
            .instantiateNativeDefinition(battery.nativeDefinition.functionName, position)
            .then(() => usePipelineStore.getState().loadPipeline())
            .catch((error) => {
              console.error(
                `[placeBattery] failed to instantiate native Definition '${battery.nativeDefinition?.functionName}':`,
                error,
              )
            })
          return null
        }

        console.error(`[placeBattery] unpublished legacy Group/Template '${battery.id}' is unavailable`)
        return null
      }

      // Saved-prompt battery: every prompt instance is backed by the shared
      // `prompt_template` op (executes the [xxx] substitution). The per-instance
      // template + var ports + name are baked into the node params (carried on
      // the palette battery as dropParams), so the node is self-contained and
      // survives reload — PromptNode renders its ports from these params, not
      // from the catalog battery (which on reload is the bare shared op).
      if (battery.nodeType === 'prompt') {
        const nodeId = mintCanvasNodeId('node')
        const promptVars = battery.inputs.map((i) => i.name)
        const params: Record<string, unknown> = {
          ...(battery.dropParams ?? {}),
          ...presetExtraParams,
          _promptVars: promptVars,
          _promptName: battery.name,
        }
        const autoWidth = estimateBatteryNodeWidth(battery)
        const newNode: Node = {
          id: nodeId,
          type: 'prompt',
          position,
          style: { width: autoWidth },
          data: { battery, params },
        }
        setNodes((nds) => [...nds, newNode])

        if (!inGroupView) {
          const { currentPipeline } = usePipelineStore.getState()
          useHistoryStore.getState().record('add_node', currentPipeline ?? createEmptyPipeline(), {
            nodeIds: [nodeId],
            label: `添加提示词：${battery.name}`,
            labelEn: `Add prompt: ${battery.name}`,
          })
        }

        insertNode({ id: nodeId, batteryId: PROMPT_OP_ID, name: battery.name, position, params })
        if (!inGroupView) incrementalExecute(nodeId, false)
        return nodeId
      }

      if (battery.id === RELAY_BATTERY_ID) {
        const nodeId = mintCanvasNodeId('relay')
        const params = { portType: 'any' }
        const newNode: Node = {
          id: nodeId,
          type: 'relay',
          position,
          style: { width: RELAY_NODE_WIDTH, height: RELAY_NODE_HEIGHT },
          data: params,
        }

        setNodes((nds) => [...nds, newNode])

        if (!inGroupView) {
          const { currentPipeline } = usePipelineStore.getState()
          useHistoryStore.getState().record('add_node', currentPipeline ?? createEmptyPipeline(), {
            nodeIds: [nodeId],
            label: '添加 Relay',
            labelEn: 'Add Relay',
          })
        }

        insertNode({
          id: nodeId,
          batteryId: RELAY_BATTERY_ID,
          name: 'Relay',
          position,
          params,
        })
        return nodeId
      }

      const nodeType = resolveNodeType(battery)

      // annotation battery: create a canvas annotation, not an execution node.
      if (nodeType === 'annotation') {
        const { currentPipeline } = usePipelineStore.getState()
        const annotationId = addAnnotation(position)
        useHistoryStore.getState().record('add_node', currentPipeline ?? createEmptyPipeline(), {
          nodeIds: [annotationId],
          label: '添加注释',
          labelEn: 'Add annotation',
        })
        setNodes((nds) => [
          ...nds,
          {
            id: annotationId,
            type: 'annotation',
            position,
            style: { width: 400, height: 60 },
            data: { text: '', initialEdit: true },
            deletable: true,
            selectable: true,
            draggable: true,
          },
        ])
        return annotationId
      }

      const nodeId = mintCanvasNodeId('node')

      const specialInit: Record<string, { style?: Record<string, number>; params?: Record<string, unknown> }> = {
        text_panel: { style: { width: DEFAULT_BATTERY_WIDTH, height: 150 } },
        ai_battery: { style: { width: DEFAULT_BATTERY_WIDTH } },
        json_battery: { style: { width: DEFAULT_BATTERY_WIDTH, height: 200 } },
        image_reader: { style: { width: DEFAULT_BATTERY_WIDTH } },
        image_preview: { style: { width: DEFAULT_BATTERY_WIDTH } },
      }
      const initConfig = specialInit[nodeType] ?? {}
      const autoWidth = estimateBatteryNodeWidth(
        battery,
        (initConfig.style?.width as number | undefined) ?? DEFAULT_BATTERY_WIDTH,
      )

      const dynInitParams: Record<string, unknown> = battery.dynamicInputs
        ? { portCount: battery.dynamicInputs.minCount }
        : {}

      const presetParams: Record<string, unknown> = {
        ...(presetText ? { text: presetText } : {}),
        ...presetExtraParams,
      }

      const newNode: Node = {
        id: nodeId,
        type: nodeType,
        position,
        style: { ...(initConfig.style ?? { width: DEFAULT_BATTERY_WIDTH }), width: autoWidth },
        data: {
          battery,
          params: { ...dynInitParams, ...(initConfig.params ?? {}), ...presetParams },
        },
      }

      setNodes((nds) => [...nds, newNode])

      if (!inGroupView) {
        const { currentPipeline } = usePipelineStore.getState()
        useHistoryStore.getState().record('add_node', currentPipeline ?? createEmptyPipeline(), {
          nodeIds: [nodeId],
          label: `添加节点：${battery.name}`,
          labelEn: `Add node: ${formatIdAsLabel(battery.id)}`,
        })
      }

      insertNode({
        id: nodeId,
        batteryId: battery.id,
        name: battery.name,
        position,
        params: { ...presetParams },
      })

      // AI batteries must be run manually; everything else triggers a partial
      // recompute on insert. In a group view the exit flush handles re-execution.
      if (battery.type !== 'ai' && !inGroupView) {
        incrementalExecute(nodeId, false)
      }
      return nodeId
    },
    [setNodes, addNode, addAnnotation, incrementalExecute, onInnerNodeAdd],
  )

  // WebKit can keep pointer events alive while never starting native HTML5
  // drag-and-drop for a trackpad gesture. The sidebar fallback dispatches a
  // same-document event once the pointer is released over this canvas.
  useEffect(() => {
    const onPointerDrop = (event: Event) => {
      const detail = (event as CustomEvent<BatteryPointerDropDetail>).detail
      if (!detail || !reactFlowInstance) return
      const position = reactFlowInstance.screenToFlowPosition({ x: detail.clientX, y: detail.clientY })
      placeBattery(detail.battery, position, detail.presetText ? { presetText: detail.presetText } : undefined)
    }

    window.addEventListener(BATTERY_POINTER_DROP_EVENT, onPointerDrop)
    return () => window.removeEventListener(BATTERY_POINTER_DROP_EVENT, onPointerDrop)
  }, [reactFlowInstance, placeBattery])

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      event.stopPropagation()

      const sig = `${event.timeStamp}:${event.clientX}:${event.clientY}`
      if (lastDropSigRef.current === sig) return
      lastDropSigRef.current = sig

      if (!reactFlowInstance) return

      const position = reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      const battery = resolveDroppedBattery(event)

      // No battery payload: this may be an app/domain external drop (e.g. an
      // image dragged from an embedded asset panel in another iframe, whose
      // native dataTransfer does not cross the boundary). Defer to the consumer.
      if (!battery) {
        onExternalDrop?.(position, event, placeBattery)
        return
      }

      const presetText = event.dataTransfer.getData('application/preset-text')
        || readBatteryTextDragPayload(event.dataTransfer.getData('text/plain'))?.presetText

      placeBattery(battery, position, presetText ? { presetText } : undefined)
    },
    [reactFlowInstance, placeBattery, onExternalDrop],
  )

  return { onDragEnter, onDragOver, onDrop, placeBattery }
}
