import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { NodeResizer, useReactFlow } from '@xyflow/react'
import type { NodeProps } from '@forgeax/node-runtime-react/editor'
import {
  BatteryNode,
  resolveInputPortValue,
  usePipelineStore,
  type Battery,
} from '@forgeax/node-runtime-react/editor'
import { childrenOf, type NodeId, type SceneGraph, type SceneNode } from '../../../vendor/shared/types/scene/graph.js'
import {
  collectNodeStats,
  extractScenePortFromWire,
  focusDisplayPath,
  formatSceneNodeLabel,
  idsExpandedToFocus,
  readTreeRoot,
  type SceneNodeStats,
} from './sceneStructureUtils.js'
import './SceneStructureNode.css'

const MIN_NODE_WIDTH = 200
const MIN_NODE_HEIGHT = 160
const DEFAULT_NODE_HEIGHT = 280

interface SceneStructureNodeData {
  battery: Battery
  params: Record<string, unknown>
}

function TreeCaret({ collapsed }: { collapsed: boolean }): JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="scene-structure-tree__caret-icon">
      <path
        d={collapsed ? 'M3 1L7 5L3 9' : 'M1 3L5 7L9 3'}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SceneTreeRow({
  graph,
  node,
  depth,
  isLast,
  guides,
  focusId,
  collapsed,
  onToggle,
}: {
  graph: SceneGraph
  node: SceneNode
  depth: number
  isLast: boolean
  guides: boolean[]
  focusId: NodeId
  collapsed: ReadonlySet<NodeId>
  onToggle: (id: NodeId) => void
}): JSX.Element {
  const stats = useMemo(() => collectNodeStats(graph, node), [graph, node])
  const kids = useMemo(() => childrenOf(graph, node.id), [graph, node])
  const hasChildren = kids.length > 0
  const isCollapsed = collapsed.has(node.id)
  const isFocus = node.id === focusId

  return (
    <>
      <li className={`scene-structure-tree__row${isFocus ? ' is-focus' : ''}`}>
        <div className="scene-structure-tree__guides" aria-hidden="true">
          {guides.map((continues, index) => (
            <span
              key={`${node.id}-guide-${index}`}
              className={`scene-structure-tree__guide${continues ? ' scene-structure-tree__guide--v' : ''}`}
            />
          ))}
          {depth > 0 ? (
            <span
              className={`scene-structure-tree__guide scene-structure-tree__guide--branch${isLast ? ' scene-structure-tree__guide--last' : ''}`}
            />
          ) : null}
        </div>
        {hasChildren ? (
          <button
            type="button"
            className="scene-structure-tree__caret nodrag"
            aria-expanded={!isCollapsed}
            onClick={() => onToggle(node.id)}
          >
            <TreeCaret collapsed={isCollapsed} />
          </button>
        ) : (
          <span className="scene-structure-tree__caret scene-structure-tree__caret--spacer" aria-hidden />
        )}
        <span className="scene-structure-tree__name" title={node.id}>
          {formatSceneNodeLabel(node)}
        </span>
        {node.schema ? <span className="scene-structure-tree__schema">{node.schema}</span> : null}
        <span className="scene-structure-tree__stats" title={`own=${stats.ownVoxels} · subtree=${stats.subtreeVoxels}`}>
          {stats.ownVoxels}/{stats.subtreeVoxels}
        </span>
      </li>
      {hasChildren &&
        !isCollapsed &&
        kids.map((child, index) => (
          <SceneTreeRow
            key={child.id}
            graph={graph}
            node={child}
            depth={depth + 1}
            isLast={index === kids.length - 1}
            guides={[...guides, !isLast]}
            focusId={focusId}
            collapsed={collapsed}
            onToggle={onToggle}
          />
        ))}
    </>
  )
}

function SceneStructurePanel({
  graph,
  focusId,
  focusPath,
  root,
  rootStats,
}: {
  graph: SceneGraph
  focusId: NodeId
  focusPath: string
  root: SceneNode
  rootStats: SceneNodeStats
}): JSX.Element {
  const [collapsed, setCollapsed] = useState<Set<NodeId>>(() => new Set())

  useEffect(() => {
    const expanded = idsExpandedToFocus(graph, focusId)
    setCollapsed(() => {
      const next = new Set<NodeId>()
      const walk = (node: SceneNode): void => {
        const kids = childrenOf(graph, node.id)
        if (kids.length > 0 && !expanded.has(node.id)) {
          next.add(node.id)
        }
        for (const child of kids) walk(child)
      }
      walk(root)
      return next
    })
  }, [graph, focusId, root])

  const onToggle = useCallback((id: NodeId) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  return (
    <div className="scene-structure-panel nodrag">
      <div className="scene-structure-panel__summary">
        <span className="scene-structure-panel__focus" title={focusPath}>
          focus {focusPath || '/'}
        </span>
        <span className="scene-structure-panel__meta">
          nodes {rootStats.nodeCount} · voxels {rootStats.subtreeVoxels}
        </span>
      </div>
      <ul className="scene-structure-tree" role="tree">
        <SceneTreeRow
          graph={graph}
          node={root}
          depth={0}
          isLast
          guides={[]}
          focusId={focusId}
          collapsed={collapsed}
          onToggle={onToggle}
        />
      </ul>
    </div>
  )
}

function resolveSceneWireValue(nodeId: string): unknown {
  const state = usePipelineStore.getState()
  const fromOutput = state.nodeOutputs[nodeId]?.scene
  if (fromOutput !== undefined) return fromOutput
  return resolveInputPortValue(nodeId, 'scene')
}

function SceneStructureNode(props: NodeProps<SceneStructureNodeData>): JSX.Element {
  const { id, data, selected } = props
  const updateNodeParam = usePipelineStore((s) => s.updateNodeParam)
  const schedulePersistSession = usePipelineStore((s) => s.schedulePersistSession)
  const { setNodes } = useReactFlow()
  // Subscribe to the whole outputs map (not just this node's own output): in a
  // group's inner view a leaf visualize node has no persisted output, so the
  // scene arrives only when the async group-probe hydrates the UPSTREAM
  // producer. Watching the full map re-renders the panel once that lands.
  const nodeOutputs = usePipelineStore((s) => s.nodeOutputs)
  const edges = usePipelineStore((s) => s.currentPipeline?.edges)

  useEffect(() => {
    if (typeof data.params._nodeHeight === 'number') return
    setNodes((nds) =>
      nds.map((n) => (n.id === id ? { ...n, style: { ...n.style, height: DEFAULT_NODE_HEIGHT } } : n)),
    )
    updateNodeParam(id, '_nodeHeight', DEFAULT_NODE_HEIGHT, true)
  }, [data.params._nodeHeight, id, setNodes, updateNodeParam])

  const scenePort = useMemo(() => {
    void nodeOutputs
    void edges
    return extractScenePortFromWire(resolveSceneWireValue(id))
  }, [id, nodeOutputs, edges])

  const root = scenePort ? readTreeRoot(scenePort) : null
  const rootStats = root && scenePort ? collectNodeStats(scenePort.graph, root) : null
  const placeholder = !scenePort ? '连接 scene 端口以查看结构' : null

  return (
    <div className="scene-structure-node">
      <NodeResizer
        minWidth={MIN_NODE_WIDTH}
        minHeight={MIN_NODE_HEIGHT}
        isVisible={selected}
        lineClassName="scene-structure-resize-line"
        handleClassName="scene-structure-resize-handle"
        onResizeEnd={(_event, params) => {
          updateNodeParam(id, '_nodeWidth', params.width, true)
          updateNodeParam(id, '_nodeHeight', params.height, true)
          schedulePersistSession('scene-structure-resize')
        }}
      />
      <BatteryNode {...props} />
      {placeholder ? (
        <div className="scene-structure-panel scene-structure-panel--empty nodrag">
          <span className="scene-structure-panel__placeholder">{placeholder}</span>
        </div>
      ) : root && rootStats && scenePort ? (
        <SceneStructurePanel
          graph={scenePort.graph}
          focusId={scenePort.focus}
          focusPath={focusDisplayPath(scenePort)}
          root={root}
          rootStats={rootStats}
        />
      ) : null}
    </div>
  )
}

export default memo(SceneStructureNode)
