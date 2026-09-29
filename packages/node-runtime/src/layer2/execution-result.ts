// Result shape for a Scene Script run (or any host that hydrates OutputCache
// after executing TypeScript). This is not a graph-walk request/handle.

export interface ExecutionResult {
  executionId: string
  status: 'completed' | 'error' | 'aborted'
  // nodeId -> portId -> wire value (DataTreeEntry[] form).
  outputs: Record<string, Record<string, unknown>>
  /**
   * Small, serializable origin records for every public output, including ports
   * whose large value was omitted from `outputs`. Hosts may enrich these with
   * authoring/SceneGraph lineage without touching the business value.
   */
  resultMetadata?: Record<string, Record<string, {
    producerNodeId: string
    producerPort: string
    outputType: string
    value: { inline: boolean; ref?: string }
  }>>
  error?: { nodeId?: string; message: string }
  /** Bounded structured node failures; hosts should prefer this over parsing execFailures strings. */
  failures?: Array<{ nodeId?: string; message: string }>
  /** Present when `quietErrors: true`; mirrors Studio execute failure summary. */
  execFailures?: string[]
  durationMs: number
}
