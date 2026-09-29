import { memo, useEffect, useMemo, useRef } from 'react'
import { NodeResizer, useReactFlow } from '@xyflow/react'
import type { NodeProps } from '@forgeax/node-runtime-react/editor'
import {
  BatteryNode,
  resolveInputPortValue,
  usePipelineStore,
  type Battery,
} from '@forgeax/node-runtime-react/editor'
import {
  countNonZeroCells,
  drawMaskDots,
  extractGridFromWire,
  gridDimensions,
} from './maskStructureUtils.js'
import './MaskStructureNode.css'

const MIN_NODE_WIDTH = 200
const MIN_NODE_HEIGHT = 180
const DEFAULT_NODE_HEIGHT = 280

interface MaskStructureNodeData {
  battery: Battery
  params: Record<string, unknown>
}

function resolveGridWireValue(nodeId: string): unknown {
  const state = usePipelineStore.getState()
  const fromOutput = state.nodeOutputs[nodeId]?.grid
  if (fromOutput !== undefined) return fromOutput
  return resolveInputPortValue(nodeId, 'grid')
}

function MaskStructurePanel({ grid }: { grid: number[][] }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const { rows, cols } = useMemo(() => gridDimensions(grid), [grid])
  const onCount = useMemo(() => countNonZeroCells(grid), [grid])

  useEffect(() => {
    const body = bodyRef.current
    const canvas = canvasRef.current
    if (!body || !canvas) return

    const redraw = (): void => {
      drawMaskDots(canvas, grid, body.clientWidth, body.clientHeight)
    }

    redraw()
    const observer = new ResizeObserver(redraw)
    observer.observe(body)
    return () => observer.disconnect()
  }, [grid])

  return (
    <div className="mask-structure-panel nodrag">
      <div className="mask-structure-panel__summary">
        <span className="mask-structure-panel__size">
          {rows}×{cols}
        </span>
        <span className="mask-structure-panel__meta">on {onCount}</span>
      </div>
      <div className="mask-structure-panel__body" ref={bodyRef}>
        <canvas ref={canvasRef} className="mask-structure-panel__canvas" aria-label="Grid mask preview" />
      </div>
    </div>
  )
}

function MaskStructureNode(props: NodeProps<MaskStructureNodeData>): JSX.Element {
  const { id, data, selected } = props
  const updateNodeParam = usePipelineStore((s) => s.updateNodeParam)
  const schedulePersistSession = usePipelineStore((s) => s.schedulePersistSession)
  const { setNodes } = useReactFlow()
  const nodeOutputs = usePipelineStore((s) => s.nodeOutputs[id])
  const edges = usePipelineStore((s) => s.currentPipeline?.edges)

  useEffect(() => {
    if (typeof data.params._nodeHeight === 'number') return
    setNodes((nds) =>
      nds.map((n) => (n.id === id ? { ...n, style: { ...n.style, height: DEFAULT_NODE_HEIGHT } } : n)),
    )
    updateNodeParam(id, '_nodeHeight', DEFAULT_NODE_HEIGHT, true)
  }, [data.params._nodeHeight, id, setNodes, updateNodeParam])

  const grid = useMemo(() => {
    void nodeOutputs
    void edges
    return extractGridFromWire(resolveGridWireValue(id))
  }, [id, nodeOutputs, edges])

  const placeholder = !grid ? '连接 grid 端口以查看 mask' : null

  return (
    <div className="mask-structure-node">
      <NodeResizer
        minWidth={MIN_NODE_WIDTH}
        minHeight={MIN_NODE_HEIGHT}
        isVisible={selected}
        lineClassName="mask-structure-resize-line"
        handleClassName="mask-structure-resize-handle"
        onResizeEnd={(_event, params) => {
          updateNodeParam(id, '_nodeWidth', params.width, true)
          updateNodeParam(id, '_nodeHeight', params.height, true)
          schedulePersistSession('mask-structure-resize')
        }}
      />
      <BatteryNode {...props} />
      {placeholder ? (
        <div className="mask-structure-panel mask-structure-panel--empty nodrag">
          <span className="mask-structure-panel__placeholder">{placeholder}</span>
        </div>
      ) : grid ? (
        <MaskStructurePanel grid={grid} />
      ) : null}
    </div>
  )
}

export default memo(MaskStructureNode)
