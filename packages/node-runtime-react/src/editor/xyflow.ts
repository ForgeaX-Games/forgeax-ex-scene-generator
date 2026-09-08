// React Flow v12 (@xyflow/react) type shims for this editor.
//
// v12 changed NodeProps' generic from the *data payload* to the full Node type,
// and tightened Node.data to Record<string, unknown>. The canvas still uses the
// v11 pattern (NodeProps<MyData>, node.data.battery.id). These aliases keep that
// ergonomics without a full AppNode-union rewrite.
import type {
  Edge as XYEdge,
  Node as XYNode,
  NodeProps as XYNodeProps,
  ReactFlowInstance as XYReactFlowInstance,
} from '@xyflow/react'

/** Canvas node with loose data access (v11-style `node.data.foo`). */
export type Node = XYNode<Record<string, any>>

export type Edge = XYEdge

/**
 * v11-compatible NodeProps: the generic is the data payload shape.
 * Prefer this over importing NodeProps from `@xyflow/react` directly.
 */
export type NodeProps<T = any> = Omit<XYNodeProps<XYNode>, 'data'> & {
  data: T
}

/**
 * `reactFlowInstance.getNodes()/getEdges()` return this file's loose
 * `Node`/`Edge` (not @xyflow/react's default `Record<string, unknown>` data),
 * so every canvas hook can keep reading `node.data.foo` without narrowing.
 */
export type ReactFlowInstance = XYReactFlowInstance<Node, Edge>
