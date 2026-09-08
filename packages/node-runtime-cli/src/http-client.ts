// HTTP thin client — route mutations and execution through a running backend so
// the in-process event bus fans out graph:applied / exec:* to live WS clients.

import type { ApplyBatchResult, ExecutionResult, Op } from '@forgeax/node-runtime'
import { CliError } from './errors.js'

export function resolveServerUrl(opts: Record<string, unknown>): string | null {
  if (opts.offline === true) return null
  const fromOpt = typeof opts.serverUrl === 'string' && opts.serverUrl ? opts.serverUrl : ''
  const fromEnv = process.env.FORGEAX_SERVER_URL ?? ''
  const url = (fromOpt || fromEnv).replace(/\/$/, '')
  return url || null
}

async function readResponseBody(r: Response): Promise<string> {
  try {
    return await r.text()
  } catch {
    return '<no body>'
  }
}

export async function postBatch(
  serverUrl: string,
  ops: readonly Op[],
  opts?: {
    actor?: string
    label?: string
    batchId?: string
    ephemeral?: boolean
    expectedPrevHash?: string
    projectId?: string
  },
): Promise<ApplyBatchResult> {
  const batchPath = opts?.projectId
    ? `/api/v1/projects/${encodeURIComponent(opts.projectId)}/batch`
    : '/api/v1/batch'
  const r = await fetch(`${serverUrl}${batchPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forgeax-caller-kind': 'cli',
    },
    body: JSON.stringify({
      ops,
      opts: { actor: opts?.actor ?? 'cli', ...opts },
    }),
  })
  if (!r.ok) {
    const body = await readResponseBody(r)
    throw new CliError(`POST ${batchPath} → ${r.status}: ${body}`, 1)
  }
  return (await r.json()) as ApplyBatchResult
}

export async function postExecute(serverUrl: string, nodeId?: string): Promise<ExecutionResult> {
  const r = await fetch(`${serverUrl}/api/v1/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forgeax-caller-kind': 'cli',
    },
    body: JSON.stringify(nodeId ? { nodeId } : {}),
  })
  if (!r.ok) {
    const body = await readResponseBody(r)
    throw new CliError(`POST /api/v1/execute → ${r.status}: ${body}`, 1)
  }
  return (await r.json()) as ExecutionResult
}
