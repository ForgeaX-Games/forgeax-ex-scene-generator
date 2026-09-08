// Group-view boundary / context node id scheme. Kept DEPENDENCY-FREE (pure
// string helpers, no store/React imports) so both the canvas group-view code and
// the pipeline store can share the SAME id scheme without an import cycle. The
// inner view renders a group's external upstream/downstream nodes ("context"
// nodes) and the editable exposed-port "shell" nodes under these synthetic ids,
// distinct from the real node ids they mirror.

export const BOUNDARY_INPUT_PREFIX = '__boundary_input__'
export const BOUNDARY_OUTPUT_PREFIX = '__boundary_output__'
export const CONTEXT_INPUT_PREFIX = '__group_context_in__'
export const CONTEXT_OUTPUT_PREFIX = '__group_context_out__'

/** Synthetic id of an external up/downstream "context" node in the inner view. */
export function makeGroupContextNodeId(direction: 'in' | 'out', nodeId: string, edgeId?: string): string {
  const prefix = direction === 'in' ? CONTEXT_INPUT_PREFIX : CONTEXT_OUTPUT_PREFIX
  return `${prefix}${nodeId}${edgeId ? `__${edgeId}` : ''}`
}

/** Synthetic id of the input/output "shell" (boundary) node for a group. */
export function makeGroupBoundaryNodeId(direction: 'in' | 'out', groupId: string): string {
  return `${direction === 'in' ? BOUNDARY_INPUT_PREFIX : BOUNDARY_OUTPUT_PREFIX}${groupId}`
}

/**
 * Map an inner-view node id back to the REAL node id it mirrors. External
 * up/downstream "context" nodes render under a synthetic prefixed id, but the
 * real node (carrying the cached value + the real wiring in the container graph)
 * keeps its original id. Returns the id unchanged for non-context nodes.
 */
export function getRealNodeIdFromContext(nodeId: string): string {
  if (nodeId.startsWith(CONTEXT_INPUT_PREFIX)) return nodeId.slice(CONTEXT_INPUT_PREFIX.length)
  if (nodeId.startsWith(CONTEXT_OUTPUT_PREFIX)) return nodeId.slice(CONTEXT_OUTPUT_PREFIX.length)
  return nodeId
}
