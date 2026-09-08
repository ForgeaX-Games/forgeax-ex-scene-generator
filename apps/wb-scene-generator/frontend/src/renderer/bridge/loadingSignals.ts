// Cross-document progress reporting for the renderer iframe.
//
// The renderer pane runs its own data hooks (useNodePreviews / useBakedLayers
// / useAliasMetas), each doing async fetches that the host page (the
// workbench shell on the other side of the iframe boundary) has no visibility
// into. On a project switch the host remounts this iframe and the user is
// left staring at a blank/stale canvas with zero feedback about what is still
// loading or which step is stuck.
//
// This module lets those hooks report coarse-grained "task" state
// (active / done, plus an optional counter) which gets posted to the parent
// window as a single `workbench:loading-status` message. WorkbenchHost merges
// it with its own (editor-side) phases into one aggregated progress panel.
// Pure telemetry — nothing here gates behavior, so it is safe to add/remove
// call sites without risk of regressing the actual data flow.

export type LoadingTaskId = 'previews' | 'baked' | 'aliases'

export interface LoadingTaskState {
  id: LoadingTaskId
  label: string
  active: boolean
  /** Optional "42/78"-style progress; omit when indeterminate. */
  done?: number
  total?: number
}

import { sceneLoadingTaskLabel } from '../../sceneI18n.js'

// Finished tasks are dropped a couple seconds after `endLoadingTask` so a
// stale "done" entry doesn't linger forever in the payload across repeated
// switches — the host itself also fades finished steps out, this just keeps
// the wire payload (and the host's merge logic) tidy.
const FINISHED_TTL_MS = 2000

const tasks = new Map<LoadingTaskId, LoadingTaskState>()
let postTimer: ReturnType<typeof setTimeout> | null = null

function post(): void {
  if (typeof window === 'undefined' || window.parent === window) return
  window.parent.postMessage(
    { type: 'workbench:loading-status', tasks: Array.from(tasks.values()) },
    '*',
  )
}

function schedulePost(): void {
  if (postTimer) return
  postTimer = setTimeout(() => {
    postTimer = null
    post()
  }, 16)
}

export function beginLoadingTask(id: LoadingTaskId, progress?: { done?: number; total?: number }): void {
  tasks.set(id, { id, label: sceneLoadingTaskLabel(id), active: true, done: progress?.done, total: progress?.total })
  schedulePost()
}

export function updateLoadingTask(id: LoadingTaskId, progress: { done?: number; total?: number }): void {
  const cur = tasks.get(id)
  if (!cur || !cur.active) return
  tasks.set(id, { ...cur, ...progress })
  schedulePost()
}

export function endLoadingTask(id: LoadingTaskId): void {
  const cur = tasks.get(id)
  if (!cur) return
  tasks.set(id, { ...cur, active: false })
  schedulePost()
  setTimeout(() => {
    const latest = tasks.get(id)
    if (latest && !latest.active) tasks.delete(id)
    schedulePost()
  }, FINISHED_TTL_MS)
}
