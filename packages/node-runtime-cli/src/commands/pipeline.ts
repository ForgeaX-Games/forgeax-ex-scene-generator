// `forgeax pipeline get|apply` handlers — read the current graph (no battery scan) or push a caller-supplied JSON batch of ops through the same atomic apply path the node verbs use.

import { getPipeline, listGroups } from '@forgeax/node-runtime'
import type { Op } from '@forgeax/node-runtime'
import { resolveConfig } from '../config.js'
import { loadRuntime } from '../runtime.js'
import { makeEmitter } from '../output.js'
import { CliError } from '../errors.js'
import { applyMany, mode, parseJson, requireStr } from './shared.js'

// pipeline get: load a runtime and emit the active pipeline graph (or a null sentinel when none exists).
export async function pipelineGet(opts: Record<string, unknown>): Promise<void> {
  const config = resolveConfig(opts)
  const runtime = await loadRuntime({ ...config, batteriesDir: '' })
  const snapshot = getPipeline(runtime)
  if (!snapshot) {
    makeEmitter(mode(opts)).record({ pipeline: null })
    return
  }
  // Surface group sub-graphs alongside the top-level snapshot so AI / CLI
  // consumers see the full structure (getPipeline omits `groups`).
  makeEmitter(mode(opts)).record({ ...snapshot, groups: listGroups(runtime) })
}

// pipeline apply: parse --ops into an Op array (rejecting non-arrays) and commit it atomically.
export async function pipelineApply(opts: Record<string, unknown>): Promise<void> {
  const ops = parseJson(requireStr(opts, 'ops', '--ops'), '[]')
  if (!Array.isArray(ops)) throw new CliError('--ops must be a JSON array', 2)
  await applyMany(opts, ops as Op[])
}
