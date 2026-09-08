// Commands — the per-verb action handlers that back the `forgeax` CLI's subcommands, one async function per leaf verb (node create/update/…, pipeline get/apply/execute/import/abort, project list/create/open/delete). Each handler is the thin adapter between commander.js (which parses flags in ../index.ts) and the kernel's stable layer2 API: it pulls flags off the opts bag, builds the kernel call, and emits the result as JSON/NDJSON so agents and scripts get a uniform machine-readable surface. This barrel-less file is the cluster's shared foundation every sibling handler imports — the flag-bag readers, JSON/endpoint parsers, and the apply-batch convenience wrappers — so the verb files stay one-liner translations.

import { applyBatch } from '@forgeax/node-runtime'
import type { Op } from '@forgeax/node-runtime'
import { resolveConfig } from '../config.js'
import { loadRuntime } from '../runtime.js'
import { makeEmitter, type OutputMode } from '../output.js'
import { CliError } from '../errors.js'
import { postBatch, resolveServerUrl } from '../http-client.js'

// Flag-bag readers: pick the output mode, require a non-empty string flag, coerce a number, parse a JSON flag, or split a node:port endpoint — all raising CliError(2) on bad input.
export function mode(opts: Record<string, unknown>): OutputMode {
  return opts.ndjson ? 'ndjson' : 'json'
}

export function requireStr(opts: Record<string, unknown>, key: string, flag: string): string {
  const v = opts[key]
  if (typeof v !== 'string' || v === '') throw new CliError(`missing required ${flag}`, 2)
  return v
}

export function numOpt(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function parseJson(v: unknown, fallback: string): unknown {
  try {
    return JSON.parse(typeof v === 'string' ? v : fallback)
  } catch (e) {
    throw new CliError(`invalid JSON: ${e instanceof Error ? e.message : String(e)}`, 2)
  }
}

export function parseEndpoint(s: string): { nodeId: string; port: string } {
  const i = s.indexOf(':')
  if (i < 0) throw new CliError(`expected node:port, got '${s}'`, 2)
  return { nodeId: s.slice(0, i), port: s.slice(i + 1) }
}

// Mutation entry the node/pipeline verbs share: load a runtime (no battery scan — pure graph edits), atomically applyBatch the ops, emit the result, and surface a rejected batch as CliError(1). applyOne is the single-op convenience over applyMany.
// When --server-url / FORGEAX_SERVER_URL is set, routes through
// POST /api/v1/projects/:projectId/batch (or the legacy unscoped /api/v1/batch
// when projectId is omitted) so live WS clients refresh.
export async function applyMany(opts: Record<string, unknown>, ops: readonly Op[]): Promise<void> {
  const serverUrl = resolveServerUrl(opts)
  if (serverUrl) {
    const projectId = typeof opts.projectId === 'string' && opts.projectId ? opts.projectId : undefined
    const result = await postBatch(serverUrl, ops, { actor: 'cli', ...(projectId ? { projectId } : {}) })
    makeEmitter(mode(opts)).record(result)
    if (result.status === 'rejected') {
      throw new CliError(`apply rejected: ${result.diagnostics?.[0]?.message ?? result.reason ?? 'unknown'}`, 1)
    }
    return
  }

  const config = resolveConfig(opts)
  const runtime = await loadRuntime({ ...config, batteriesDir: '' })
  const result = await applyBatch(runtime, ops)
  makeEmitter(mode(opts)).record(result)
  if (result.status === 'rejected') {
    throw new CliError(`apply rejected: ${result.diagnostics?.[0]?.message ?? result.reason ?? 'unknown'}`, 1)
  }
}

export async function applyOne(opts: Record<string, unknown>, op: Op): Promise<void> {
  await applyMany(opts, [op])
}
