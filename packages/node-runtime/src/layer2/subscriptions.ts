// Subscription channels: graph events, execution events, asset events.
// Consumed by UI for live updates and by AI for change notifications.

export type GraphEvent =
  | { kind: 'graph:applied'; pipelineId: string; batchId: string; newHash: string }
  | { kind: 'graph:rejected'; pipelineId: string; reason: string }

export type ExecutionEvent =
  | { kind: 'exec:started'; pipelineId: string; executionId: string }
  | { kind: 'exec:node:output'; pipelineId: string; nodeId: string; portId: string; outputType: string }
  // A node the walker chose NOT to execute. Currently only manual-trigger ops (e.g. AI generators behind the Run button): the walker treats them as data boundaries and hydrates downstream from their cached output instead of re-firing the op. `reason` is a short machine tag ('manualTrigger').
  | { kind: 'exec:node:skipped'; pipelineId: string; executionId: string; nodeId: string; reason: string }
  | { kind: 'exec:completed'; pipelineId: string; executionId: string }
  | { kind: 'exec:error'; pipelineId: string; executionId: string; nodeId?: string; message: string }
  // Non-fatal execution diagnostic (the run continues). Emitted e.g. when a partial run reads a boundary upstream input that has no cached output yet (never executed), so the input silently resolves to empty.
  | { kind: 'exec:warn'; pipelineId: string; executionId: string; nodeId: string; message: string }

export type AssetEvent =
  | { kind: 'asset:added'; path: string; type: string; producer: string }
  | { kind: 'asset:changed'; path: string; type: string }
  | { kind: 'asset:removed'; path: string }

// Workspace-lifecycle events. `project:viewing` is broadcast when the UI
// viewing project changes. `project:executing` when an agent acquires a lock.
// `project:idle` when an agent releases a lock. Legacy `project:activated` is
// retained as an alias for `project:viewing`.
// `project:created` / `project:deleted` announce that the project *list* itself
// changed (e.g. an agent created a project via the tool bridge) so other clients
// can refetch — creation/deletion previously broadcast nothing, leaving sibling
// panes (the workbench navigation) stale until a manual reload.
export type WorkspaceEvent =
  | { kind: 'project:viewing'; projectId: string; pipelineId: string; newHash: string }
  | { kind: 'project:executing'; projectId: string; pipelineId: string; agentId: string; sessionId?: string }
  | { kind: 'project:idle'; projectId: string; agentId?: string }
  | { kind: 'project:list-changed'; reason: 'created' | 'deleted' }
  | { kind: 'project:activated'; projectId: string; pipelineId: string; newHash: string }
  | { kind: 'project:created'; projectId: string }
  | { kind: 'project:deleted'; projectId: string }

export type RuntimeEvent = GraphEvent | ExecutionEvent | AssetEvent | WorkspaceEvent

export type RuntimeChannel = 'graph' | 'execution' | 'asset'

export interface SubscriptionAPI {
  subscribe(
    pipelineId: string,
    channels: ReadonlyArray<RuntimeChannel>,
    handler: (event: RuntimeEvent) => void,
  ): () => void
}
