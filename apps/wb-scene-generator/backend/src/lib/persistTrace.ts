/**
 * Persist / applyBatch tracing for canvas perf diagnosis.
 * Enabled when FORGEAX_CANVAS_PERF_DEBUG is on (opt-in).
 *
 * Helpers are local (not imported from @forgeax/node-runtime) so tracing
 * survives a stale kernel dist during HMR — the route still loads.
 */

import type { ApplyBatchResult } from '@forgeax/node-runtime'
import { isCanvasPerfVerbose } from './canvasPerfDebug.js'

type OpLike = { type: string; [key: string]: unknown }

function summarizeOps(ops: readonly OpLike[]): string {
  return ops
    .map((op) => {
      switch (op.type) {
        case 'updateNode': {
          const parts: string[] = []
          if (op.position !== undefined) parts.push('pos')
          if (op.params !== undefined) parts.push('params')
          if (op.name !== undefined) parts.push('name')
          return `updateNode:${String(op.nodeId)}{${parts.join('+') || '?'}}`
        }
        case 'setMetadata':
          return `setMetadata:${String(op.key)}`
        case 'connect':
          return `connect:${String(op.edgeId)}`
        case 'disconnect':
          return `disconnect:${String(op.edgeId)}`
        case 'createNode':
          return `createNode:${String(op.nodeId)}`
        case 'deleteNode':
          return `deleteNode:${String(op.nodeId)}`
        case 'createGroup':
          return `createGroup:${String(op.groupId)}`
        case 'updateGroup':
          return `updateGroup:${String(op.groupId)}`
        case 'deleteGroup':
          return `deleteGroup:${String(op.groupId)}`
        case 'ungroup':
          return `ungroup:${String(op.groupId)}`
        default:
          return op.type
      }
    })
    .join(',')
}

function isLayoutOnlyOps(ops: readonly OpLike[]): boolean {
  if (ops.length === 0) return false
  return ops.every((op) => {
    switch (op.type) {
      case 'updateNode':
        return op.position !== undefined && op.params === undefined && op.name === undefined
      case 'updateGroup':
        return (
          (op.position !== undefined || op.innerLayout !== undefined) &&
          op.name === undefined &&
          op.nameEn === undefined &&
          op.exposedPorts === undefined &&
          op.exposedWiring === undefined &&
          op.nodes === undefined &&
          op.edges === undefined
        )
      case 'setMetadata':
        return op.key === 'viewport' || op.key === 'frames' || op.key === 'annotations'
      default:
        return false
    }
  })
}

export function logPersistBatch(
  ops: readonly OpLike[],
  result: ApplyBatchResult,
  opts: { actor?: string; label?: string; batchId?: string; durationMs: number },
): void {
  if (!isCanvasPerfVerbose()) return
  const layoutOnly = result.layoutOnly ?? isLayoutOnlyOps(ops)
  const emitGraphApplied = result.status === 'ok' && !layoutOnly
  const inv = result.invalidatedNodeCount ?? 0
  console.log(
    `[persist-trace] batchId=${result.batchId ?? opts.batchId ?? '?'} actor=${opts.actor ?? '?'} ` +
      `status=${result.status} durationMs=${opts.durationMs.toFixed(1)} ` +
      `isLayoutOnly=${layoutOnly} emitGraphApplied=${emitGraphApplied} invalidatedNodes=${inv} ` +
      `newHash=${result.newHash ?? '-'} ops=[${summarizeOps(ops)}]` +
      (opts.label ? ` label=${opts.label}` : ''),
  )
}

export function logOutputFetch(
  nodeId: string,
  portId: string,
  durationMs: number,
  bytesOut: number,
  meta?: { sharded?: boolean; dataChunks?: number; assembleMs?: number; skipped?: boolean },
): void {
  if (!isCanvasPerfVerbose()) return
  if (bytesOut < 1024 * 1024 && durationMs < 200) return
  const kb = (bytesOut / 1024).toFixed(1)
  const shard =
    meta?.sharded === true
      ? ` sharded=true chunks=${meta.dataChunks ?? '?'} assembleMs=${meta.assembleMs?.toFixed(1) ?? '?'}`
      : ''
  console.log(
    `[output-trace] node=${nodeId} port=${portId} bytes=${kb}KB durationMs=${durationMs.toFixed(1)}${shard}`,
  )
}
