import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { NodeResizer, useReactFlow } from '@xyflow/react'
import type { NodeProps } from '@forgeax/node-runtime-react/editor'
import {
  BatteryNode,
  isDataTreeEntries,
  peelWireValue,
  resolveInputPortValue,
  usePipelineStore,
  type Battery,
} from '@forgeax/node-runtime-react/editor'
import { parseKeypoint, type KNode } from './keypointGraph/parse.js'
import { computeForceLayout, type ForceEdge } from './keypointGraph/forceLayout.js'
import { hasAllPositions, metricPositions, metricRadius } from './keypointGraph/metricLayout.js'
import { KeypointGraphCanvas } from './keypointGraph/KeypointGraphCanvas.js'
import { KeypointHierarchyList } from './keypointGraph/KeypointHierarchyList.js'
import './KeypointGraphNode.css'

const MIN_NODE_WIDTH = 260
const MIN_NODE_HEIGHT = 220
const DEFAULT_NODE_HEIGHT = 340

interface KeypointGraphNodeData {
  battery: Battery
  params: Record<string, unknown>
}

function resolveKeypointWireValue(nodeId: string): unknown {
  const state = usePipelineStore.getState()
  const fromOutput = state.nodeOutputs[nodeId]?.keypoint
  if (fromOutput !== undefined) return fromOutput
  return resolveInputPortValue(nodeId, 'keypoint')
}

/** Unwrap DataTree / wire wrappers down to the raw keypoint object or string. */
function extractKeypointFromWire(raw: unknown): unknown {
  if (raw === undefined || raw === null) return null
  if (isDataTreeEntries(raw)) {
    const first = raw[0]?.items?.[0]
    return first !== undefined ? extractKeypointFromWire(first) : null
  }
  const peeled = peelWireValue(raw)
  if (peeled !== raw) return extractKeypointFromWire(peeled)
  return raw
}

function KeypointGraphNode(props: NodeProps<KeypointGraphNodeData>): JSX.Element {
  const { id, data, selected } = props
  const updateNodeParam = usePipelineStore((s) => s.updateNodeParam)
  const schedulePersistSession = usePipelineStore((s) => s.schedulePersistSession)
  const { setNodes } = useReactFlow()
  const nodeOutputs = usePipelineStore((s) => s.nodeOutputs[id])
  const edges = usePipelineStore((s) => s.currentPipeline?.edges)

  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (typeof data.params._nodeHeight === 'number') return
    setNodes((nds) =>
      nds.map((n) => (n.id === id ? { ...n, style: { ...n.style, height: DEFAULT_NODE_HEIGHT } } : n)),
    )
    updateNodeParam(id, '_nodeHeight', DEFAULT_NODE_HEIGHT, true)
  }, [data.params._nodeHeight, id, setNodes, updateNodeParam])

  const raw = useMemo(() => {
    void nodeOutputs
    void edges
    return extractKeypointFromWire(resolveKeypointWireValue(id))
  }, [id, nodeOutputs, edges])

  const structureKey = useMemo(() => {
    if (raw === null || raw === undefined) return ''
    try {
      return JSON.stringify(raw)
    } catch {
      return String(raw)
    }
  }, [raw])

  // Keep the parsed model stable per structure (not per pipeline run), so the
  // force layout below does not re-run / jitter on every execute.
  const rawRef = useRef(raw)
  rawRef.current = raw
  const model = useMemo(() => parseKeypoint(rawRef.current), [structureKey])

  // Metric mode: if every node carries a solved position (from keypoint_layout),
  // draw at those real coordinates; otherwise fall back to the force layout.
  const metric = useMemo(() => hasAllPositions(model), [model])

  const positions = useMemo(() => {
    if (metric) return metricPositions(model)
    const nodeIds = model.nodes.map((n) => n.id)
    const layoutEdges: ForceEdge[] = [
      ...model.parentEdges.map((e) => ({ from: e.from, to: e.to })),
      ...model.relationEdges.map((e) => ({
        from: e.from,
        to: e.to,
        restLength: e.kind === 'clearance' && e.distance ? Math.max(60, Math.min(220, e.distance * 30)) : undefined,
      })),
    ]
    return computeForceLayout(nodeIds, layoutEdges)
  }, [model, metric])

  const radiusOf = useMemo(
    () => (metric ? (node: KNode) => metricRadius(node.area) : undefined),
    [metric],
  )

  // Clear selection when the underlying structure changes.
  useEffect(() => {
    setSelectedId(null)
  }, [structureKey])

  const isEmpty = structureKey === ''
  const hasNodes = model.nodes.length > 0

  return (
    <div className="kpg-node">
      <NodeResizer
        minWidth={MIN_NODE_WIDTH}
        minHeight={MIN_NODE_HEIGHT}
        isVisible={selected}
        lineClassName="kpg-resize-line"
        handleClassName="kpg-resize-handle"
        onResizeEnd={(_event, params) => {
          updateNodeParam(id, '_nodeWidth', params.width, true)
          updateNodeParam(id, '_nodeHeight', params.height, true)
          schedulePersistSession('keypoint-graph-resize')
        }}
      />
      <BatteryNode {...props} />
      {isEmpty ? (
        <div className="kpg-panel kpg-panel--empty nodrag">
          <span className="kpg-panel__placeholder">连接 keypoint 端口以查看关系图</span>
        </div>
      ) : (
        <div className="kpg-panel nodrag">
          <div className="kpg-panel__summary">
            <span className="kpg-panel__count">
              {model.nodes.length} 节点 · {model.relationEdges.length} 关系
            </span>
            {model.warnings.length > 0 ? (
              <span className="kpg-panel__warn" title={model.warnings.join('\n')}>
                ⚠ {model.warnings.length} 条提示
              </span>
            ) : null}
          </div>
          {hasNodes ? (
            <div className="kpg-panel__body">
              <div className="kpg-panel__graph">
                <KeypointGraphCanvas
                  model={model}
                  positions={positions}
                  structureKey={structureKey}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  radiusOf={radiusOf}
                  metric={metric}
                />
              </div>
              <div className="kpg-panel__list">
                <KeypointHierarchyList model={model} selectedId={selectedId} onSelect={setSelectedId} />
              </div>
            </div>
          ) : (
            <div className="kpg-panel__empty-body">
              <span className="kpg-panel__placeholder">keypoint 无可显示的层级数据</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default memo(KeypointGraphNode)
