import type { ExecutionResult } from '@forgeax/node-runtime'
import { isFailedParamEdit, paramEditErrorMessage } from './paramEditRollback.js'

export interface ControlParamEdit {
  nodeId: string
  key: string
  value: unknown
}

export interface ControlParamNode {
  id: string
  params: Record<string, unknown>
}

export interface ControlParamStore {
  currentPipeline: { nodes: Array<{ id: string; params: Record<string, unknown> }> } | null
  updateNodeParam: (nodeId: string, key: string, value: unknown, silent?: boolean) => void
  incrementalExecute: (
    nodeId: string,
    fullExec?: boolean,
    options?: { persist?: boolean; localParamEdit?: boolean },
  ) => Promise<ExecutionResult | undefined>
}

export interface ControlParamBatchHooks {
  persistNodes: (nodes: ControlParamNode[]) => Promise<void>
}

export interface ControlParamBatchResult {
  ok: boolean
  nodeId?: string
  key?: string
  error?: string
}

function snapshotNodes(
  store: ControlParamStore,
  nodeIds: readonly string[],
): ControlParamNode[] {
  const pipeline = store.currentPipeline
  if (!pipeline) return []
  return nodeIds.flatMap((id) => {
    const node = pipeline.nodes.find((n) => n.id === id)
    return node ? [{ id, params: { ...node.params } }] : []
  })
}

/**
 * Apply many Control edits, persist every touched node, then run the full
 * pipeline once. Incremental start-at-heightfield is wrong here: writing
 * river/plaza/peaks invalidates those outputs, and a start at
 * `valley_heightfield` then sees `riverPoints` as empty.
 */
export async function applyControlParamBatch(
  store: ControlParamStore,
  edits: readonly ControlParamEdit[],
  hooks: ControlParamBatchHooks,
): Promise<ControlParamBatchResult> {
  if (edits.length === 0) return { ok: true }
  const pipeline = store.currentPipeline
  if (!pipeline) {
    return { ok: false, error: paramEditErrorMessage(undefined) }
  }

  const snapshots: Array<{ nodeId: string; key: string; previous: unknown }> = []
  for (const edit of edits) {
    if (typeof edit.nodeId !== 'string' || typeof edit.key !== 'string') continue
    const node = pipeline.nodes.find((n) => n.id === edit.nodeId)
    if (!node) continue
    snapshots.push({ nodeId: edit.nodeId, key: edit.key, previous: node.params[edit.key] })
    store.updateNodeParam(edit.nodeId, edit.key, edit.value, true)
  }
  if (snapshots.length === 0) {
    return { ok: false, error: paramEditErrorMessage(undefined) }
  }

  const nodeIds = [...new Set(snapshots.map((s) => s.nodeId))]
  const startId = nodeIds[0]!

  const runFull = async (): Promise<ExecutionResult | undefined> => {
    await hooks.persistNodes(snapshotNodes(store, nodeIds))
    return store.incrementalExecute(startId, true, { persist: false, localParamEdit: true })
  }

  const result = await runFull()
  if (!isFailedParamEdit(result)) {
    return { ok: true, nodeId: startId, key: snapshots[0]!.key }
  }

  for (const snap of snapshots) {
    store.updateNodeParam(snap.nodeId, snap.key, snap.previous, true)
  }
  await runFull()
  return {
    ok: false,
    nodeId: startId,
    key: snapshots[0]!.key,
    error: paramEditErrorMessage(result),
  }
}
