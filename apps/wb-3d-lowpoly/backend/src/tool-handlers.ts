import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import {
  buildEngineGlbPath,
  EDITOR_ASSET_IMPORT_CAPABILITY,
  EDITOR_ASSET_IMPORT_CAPABILITY_VERSION,
} from './editor-import.js'

type Caller = {
  kind: 'user' | 'ai' | 'skill' | 'workbench' | 'cli'
  sessionId?: string
  threadId?: string
  agentId?: string
}

type ToolCtx = {
  caller: Caller
  toolId: string
  env: Record<string, string | undefined>
  cwd: string
  capabilities?: {
    invoke: (capabilityId: string, version: number, input: unknown, options?: { requestId?: string }) => Promise<unknown>
  }
}

type ToolHandler = (args: unknown, ctx: ToolCtx) => Promise<unknown>

const PLUGIN_ID = '@forgeax-plugin/wb-3d-lowpoly'
const DEFAULT_BACKEND_URL = 'http://127.0.0.1:9567'

function objectArgs(args: unknown): Record<string, unknown> {
  return args && typeof args === 'object' && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`missing string arg: ${key}`)
  }
  return value
}

type EngineImportInput = {
  base64: string
  directory?: unknown
  name?: unknown
  requestId?: unknown
}

async function importGlbBytes(ctx: ToolCtx, input: EngineImportInput): Promise<{
  directory: string
  sourceName: string
  destPath: string
  requestId: string
  receipt: unknown
}> {
  if (!ctx.capabilities) {
    throw new Error('Editor import capability is unavailable; open this generator inside Studio and retry.')
  }
  if (!input.base64.trim()) throw new Error('GLB source bytes are empty')
  const target = buildEngineGlbPath(input.directory, input.name)
  const requestId = typeof input.requestId === 'string' && input.requestId.trim() ? input.requestId.trim() : randomUUID()
  const receipt = await ctx.capabilities.invoke(
    EDITOR_ASSET_IMPORT_CAPABILITY,
    EDITOR_ASSET_IMPORT_CAPABILITY_VERSION,
    {
      base64: input.base64,
      destPath: target.destPath,
      sourceName: target.sourceName,
      requestId,
    },
    { requestId },
  )
  if (isRecord(receipt) && receipt.ok === false) {
    const error = isRecord(receipt.error) ? receipt.error : {}
    const failure = new Error(typeof error.hint === 'string' ? error.hint : 'Editor asset import failed') as Error & { code?: string }
    failure.code = typeof error.code === 'string' ? error.code : 'editor-asset-import-failed'
    throw failure
  }
  return { ...target, requestId, receipt }
}

// Resolve the target project for a pipeline tool call. If the agent passes an
// explicit `projectId` we use it; otherwise we fall back to the workspace's
// active/viewing project. Agents drive the workflow as `projects.open` → many
// `pipeline.*` calls, and they routinely omit `projectId` on the follow-ups
// (each call is stateless), which previously hard-failed with
// "missing string arg: projectId" and burned turns / stalled the run. Defaulting
// to the open project mirrors that workflow without weakening the explicit path.
async function resolveProjectId(ctx: ToolCtx, args: Record<string, unknown>): Promise<string> {
  const explicit = args.projectId
  if (typeof explicit === 'string' && explicit.trim()) return explicit
  try {
    const ws = (await request(ctx, 'GET', '/api/v1/workspace')) as {
      agentProjectId?: unknown
      viewingProjectId?: unknown
      activeProjectId?: unknown
      recentProjectIds?: unknown
    } | null
    // Prefer the project THIS agent holds the exclusive lock on. The global
    // `viewingProjectId` is shared across all clients, so relying on it lets a
    // concurrent agent's `open` — or a human switching views — silently retarget
    // this agent's omitted-`projectId` mutation to the wrong project (which then
    // 403s "not open by any agent"). The per-agent lock, surfaced as
    // `agentProjectId` by the workspace route, matches the mutation gate exactly.
    if (typeof ws?.agentProjectId === 'string' && ws.agentProjectId.trim()) return ws.agentProjectId
    const recent = Array.isArray(ws?.recentProjectIds) ? ws?.recentProjectIds : []
    const candidate =
      (typeof ws?.viewingProjectId === 'string' && ws.viewingProjectId.trim() && ws.viewingProjectId) ||
      (typeof ws?.activeProjectId === 'string' && ws.activeProjectId.trim() && ws.activeProjectId) ||
      (typeof recent[0] === 'string' && (recent[0] as string).trim() ? (recent[0] as string) : '')
    if (candidate) return candidate
  } catch {
    /* workspace fetch failed — fall through to the explicit-arg error below */
  }
  throw new Error(
    'missing string arg: projectId (no active project — call lowpoly:projects.open first, or pass projectId explicitly)',
  )
}

function projectPath(projectId: string, suffix: string): string {
  return `/api/v1/projects/${encodeURIComponent(projectId)}${suffix}`
}

function backendUrlFromOverrides(file: string | undefined): string | null {
  if (!file) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as {
      plugins?: Record<string, { backendPort?: unknown }>
    }
    const port = parsed.plugins?.[PLUGIN_ID]?.backendPort
    if (Number.isInteger(port) && Number(port) > 0 && Number(port) <= 65535) {
      return `http://127.0.0.1:${Number(port)}`
    }
  } catch {
    return null
  }
  return null
}

function backendBaseUrl(ctx: ToolCtx): string {
  const explicit = ctx.env.FORGEAX_LOWPOLY_BACKEND_URL
  if (explicit?.trim()) return explicit.replace(/\/+$/u, '')
  return backendUrlFromOverrides(ctx.env.FORGEAX_PLUGIN_DEV_PORTS_FILE) ?? DEFAULT_BACKEND_URL
}

function lowpolyCallerHeaders(ctx: ToolCtx, hasBody: boolean): Record<string, string> {
  const headers: Record<string, string> = { 'x-forgeax-caller-kind': ctx.caller.kind }
  if (hasBody) headers['content-type'] = 'application/json'
  if (ctx.caller.agentId) headers['x-forgeax-caller-agent-id'] = ctx.caller.agentId
  if (ctx.caller.sessionId) headers['x-forgeax-caller-session-id'] = ctx.caller.sessionId
  return headers
}

async function lowpolyRawFetch(
  ctx: ToolCtx,
  method: string,
  path: string,
  body: unknown,
): Promise<{ res: Response; payload: unknown; text: string }> {
  const res = await fetch(`${backendBaseUrl(ctx)}${path}`, {
    method,
    headers: lowpolyCallerHeaders(ctx, body !== undefined),
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  // A non-2xx response (or a proxy in front of the backend) may return a non-JSON
  // body — an HTML error page, plain text, etc. Guard the parse so that surfaces
  // as a null payload (the raw `text` still feeds the error message below) instead
  // of throwing and masking the real status.
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text) as unknown
    } catch {
      payload = null
    }
  }
  return { res, payload, text }
}

async function request(ctx: ToolCtx, method: string, path: string, body?: unknown): Promise<unknown> {
  let { res, payload, text } = await lowpolyRawFetch(ctx, method, path, body)

  // Transparent recovery after a backend restart wipes the in-memory session +
  // lock tables: an AI mutation gets 403 `mutation-denied-not-open`
  // (recoverable). Soft re-`open` once and replay — the mutation route reclaims
  // the write lock itself. Genuine conflicts (`mutation-denied-locked-by-other`)
  // are NOT retried.
  if (res.status === 403 && ctx.caller.kind === 'ai' && ctx.caller.agentId) {
    const p = (payload ?? {}) as { code?: unknown; projectId?: unknown }
    if (p.code === 'mutation-denied-not-open' && typeof p.projectId === 'string' && p.projectId) {
      const reopen = await lowpolyRawFetch(
        ctx,
        'POST',
        `/api/v1/projects/${encodeURIComponent(p.projectId)}/open`,
        {},
      )
      if (reopen.res.ok) {
        ;({ res, payload, text } = await lowpolyRawFetch(ctx, method, path, body))
      }
    }
  }

  if (!res.ok) {
    const reason =
      payload && typeof payload === 'object' && 'reason' in payload
        ? String((payload as { reason?: unknown }).reason)
        : text || `${res.status} ${res.statusText}`
    throw new Error(`lowpoly backend ${method} ${path} failed: ${reason}`)
  }
  return payload
}

function query(params: Record<string, unknown>): string {
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) qs.set(key, String(value))
  }
  const out = qs.toString()
  return out ? `?${out}` : ''
}

// `/api/v1/ops` may attach inline-image fields (battery `iconSvg`, preview
// thumbnails, data: URIs). The host tool bridge mis-reads ANY such string as an
// image content part and drops the rest of the (text) payload, so an agent
// calling `batteries.list` gets a blank / garbled result. Defensively strip
// every value that looks like inline image markup — agents only ever need
// ports / params, never pixels — so the op catalog is always clean text.
const INLINE_IMAGE_KEYS = new Set(['iconSvg', 'icon', 'iconPng', 'preview', 'thumbnail', 'thumbnailSvg'])

function looksLikeInlineImage(value: string): boolean {
  const head = value.trimStart().slice(0, 24).toLowerCase()
  return head.startsWith('<svg') || head.startsWith('<?xml') || head.startsWith('data:image')
}

function stripInlineImages(value: unknown): unknown {
  if (typeof value === 'string') return looksLikeInlineImage(value) ? undefined : value
  if (Array.isArray(value)) return value.map(stripInlineImages).filter((v) => v !== undefined)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (INLINE_IMAGE_KEYS.has(key)) continue
      const cleaned = stripInlineImages(val)
      if (cleaned !== undefined) out[key] = cleaned
    }
    return out
  }
  return value
}

export function stripBatteryIcon(op: Record<string, unknown>): Record<string, unknown> {
  return stripInlineImages(op) as Record<string, unknown>
}

// `batteries.list` used to return the FULL op catalog (`/api/v1/ops`) — every
// registered op with its bilingual name/description AND fully-described input/
// output ports (each port carries type, default, `description`, `descriptionEn`,
// `label`). With 300+ ops that serializes to ~200k+ tokens — on its own already
// as large as (or larger than) the model's context window. Handing that back as
// a single tool result blew the NEXT model call past the window, so the turn
// ended immediately with `reason: 'error'` (a provider "prompt too long" 400) —
// i.e. calling `lowpoly:batteries.list` reliably killed the run one turn later.
// (`stripBatteryIcon` only removed the SVG icons — a few % — nowhere near enough.)
//
// The catalogue only needs to be browsable: an agent picks an op by id and sees
// its port names, then calls `batteries.get` for the full per-port spec (types,
// defaults, ranges, descriptions). So `list` returns a COMPACT projection and
// `get` stays full. This keeps the list ~1 order of magnitude smaller (well
// inside the window) and matches the documented workflow (SKILL.md: list to find
// ids/ports, get for detail).
const COMPACT_BATTERY_KEYS = [
  'id',
  'name',
  'nameEn',
  'category',
  'type',
  'description',
  'descriptionEn',
  'lacing',
  'manualTrigger',
] as const

function portNames(ports: unknown): string[] {
  if (!Array.isArray(ports)) return []
  return ports
    .map((p) => {
      if (typeof p === 'string') return p
      if (p && typeof p === 'object') {
        const rec = p as Record<string, unknown>
        const name = rec.name ?? rec.id
        return typeof name === 'string' ? name : undefined
      }
      return undefined
    })
    .filter((n): n is string => typeof n === 'string' && n.length > 0)
}

export function compactBattery(op: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of COMPACT_BATTERY_KEYS) {
    if (op[key] !== undefined) out[key] = op[key]
  }
  const inputs = portNames(op.inputs)
  const outputs = portNames(op.outputs)
  const params = portNames(op.params)
  if (inputs.length) out.inputs = inputs
  if (outputs.length) out.outputs = outputs
  if (params.length) out.params = params
  return out
}

// `pipeline.get` used to hand the AI the raw `getPipeline` snapshot verbatim.
// The documented loop (SKILL.md rule #2) calls `pipeline.get` after EVERY
// `applyBatch` to confirm the nodes actually changed, so this snapshot is
// re-serialized into the model context on essentially every turn — and it grows
// with the graph, so a scene/assembly re-sends an ever-larger blob each turn
// (the O(N²) context creep the run logs show). Each node carries two fields the
// agent never needs to READ: `position` (pure canvas x/y layout) and an inner
// `id` that just duplicates the nodes-map key. Project those away for the AI
// tool result only; `opId` / `name` / `params` / `status` (everything the agent
// reasons about and edits) pass through verbatim. The REST `/pipeline` route is
// untouched — the frontend reconciler still gets the full snapshot (it needs
// positions to lay out the canvas).
const PIPELINE_NODE_DROP_KEYS = new Set(['position', 'id'])

export function compactPipeline(snapshot: unknown): unknown {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return snapshot
  const s = snapshot as Record<string, unknown>
  if (!s.nodes || typeof s.nodes !== 'object' || Array.isArray(s.nodes)) return snapshot
  const nodes = s.nodes as Record<string, unknown>
  const projectedNodes: Record<string, unknown> = {}
  for (const [nodeId, node] of Object.entries(nodes)) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      projectedNodes[nodeId] = node
      continue
    }
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (PIPELINE_NODE_DROP_KEYS.has(key)) continue
      out[key] = value
    }
    projectedNodes[nodeId] = out
  }
  return { ...s, nodes: projectedNodes, projected: true }
}

// Max serialized size of a `raw:true` execute result we will inline back to the
// model. ~200k chars ≈ ~60k tokens — generous for the raw escape hatch yet still
// a fraction of the context window. Over this we omit the buffers (see below).
const RAW_EXECUTE_MAX_CHARS = 200_000

// Guard the `raw:true` execute payload against context-window overflow. Small
// results pass through verbatim (the escape hatch keeps working). Oversized ones
// are replaced by a bounded notice that preserves the useful signal (status,
// duration, error, which nodes produced output) and tells the agent how to get a
// safe view — never the multi-MB mesh dump that would end the run with an error.
function guardRawExecuteResult(result: unknown): unknown {
  let serialized: string
  try {
    serialized = JSON.stringify(result) ?? ''
  } catch {
    // Circular / non-serializable — can't inline it safely; collapse to a notice.
    serialized = ''
    return {
      rawOmitted: true,
      note: 'raw execution result is not serializable; re-run without raw:true for a bounded summary.',
    }
  }
  if (serialized.length <= RAW_EXECUTE_MAX_CHARS) return result
  const r = (result ?? {}) as Record<string, unknown>
  const outputs = r.outputs && typeof r.outputs === 'object' ? (r.outputs as Record<string, unknown>) : {}
  return {
    status: r.status,
    durationMs: r.durationMs,
    ...(r.error !== undefined ? { error: r.error } : {}),
    rawOmitted: true,
    rawChars: serialized.length,
    nodesWithOutput: Object.keys(outputs),
    note:
      `raw execution result is ${serialized.length} chars (> ${RAW_EXECUTE_MAX_CHARS}); ` +
      'the mesh buffers were omitted to protect the context window. Re-run WITHOUT ' +
      'raw:true for the bounded summary (per-port shape notes), or pass nodeId to ' +
      'inspect a single node.',
  }
}

// Guard `pipeline.applyBatch` against the "inline mesh" antipattern: an agent
// pasting raw vertex / index / point buffers (thousands of numbers) straight into
// a node's `params`. This is the failure documented in the run logs — one such
// call emitted ~10k output tokens, and because the arrays are then PERSISTED into
// the pipeline they get re-serialized on every subsequent `pipeline.get` /
// `execute`, repeatedly re-inflating the context window until a later turn bails
// with `reason:'error'`. Baked geometry must be content-addressed: bake the part
// (`g_bake_part`) → reference the resulting `<sha>.obj` via `g_mesh(filename)`,
// never inline the buffers. We reject oversized inline arrays here — BEFORE the
// payload is stored — with an actionable message, instead of letting it through.

// Per-array numeric-element cap. A hand-authored 2D profile (e.g.
// `g_profile_polygon`) is a short flat point list — tens of points, ~<200
// numbers. 1024 numbers = 512 2D points: an order of magnitude past any sane
// hand-authored profile, i.e. unmistakably a mesh/curve buffer that belongs in a
// baked OBJ, not in params.
const APPLY_BATCH_MAX_ARRAY_ELEMS = 1024

// Total serialized-batch backstop (~16k tokens). Legit multi-node batches (a
// handful of profiles + primitives + parts) serialize to a few KB; this only
// trips on bulk inlined data the per-array cap missed (many arrays each just
// under the element cap, or a giant inlined string / base64 blob).
const APPLY_BATCH_MAX_CHARS = 64_000

// A non-trivial array that is (nearly) all numbers reads as a geometry buffer —
// flat [x,y,z,...] vertex / point / index lists. The 0.9 ratio tolerates the odd
// non-number sentinel without letting a mostly-object array trip the guard.
function isNumericBuffer(value: unknown[]): boolean {
  if (value.length === 0) return false
  let numbers = 0
  for (const v of value) if (typeof v === 'number') numbers++
  return numbers / value.length >= 0.9
}

// Deepest-first scan for the first oversized numeric array; returns its length
// (for the error message) or null when the payload is clean.
function findOversizedArray(value: unknown): number | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findOversizedArray(item)
      if (hit !== null) return hit
    }
    if (value.length > APPLY_BATCH_MAX_ARRAY_ELEMS && isNumericBuffer(value)) return value.length
    return null
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      const hit = findOversizedArray(v)
      if (hit !== null) return hit
    }
  }
  return null
}

export function guardApplyBatchSize(batchBody: Record<string, unknown>): void {
  const oversized = findOversizedArray(batchBody.ops ?? batchBody)
  if (oversized !== null) {
    throw new Error(
      `pipeline.applyBatch rejected: an op param contains an inline numeric array of ${oversized} ` +
        `elements (> ${APPLY_BATCH_MAX_ARRAY_ELEMS}). Do NOT inline mesh / vertex / point buffers into ` +
        `node params — it blows the model context window and gets re-sent on every pipeline.get / ` +
        `execute. Bake the geometry to a content-addressed OBJ with g_bake_part and reference it via ` +
        `g_mesh(filename), or build the shape from primitives / CSG ops. (Hand-authored 2D profiles ` +
        `such as g_profile_polygon should use a short point list, not a digitized curve.)`,
    )
  }
  let serialized: string
  try {
    serialized = JSON.stringify(batchBody) ?? ''
  } catch {
    // Non-serializable batch is the backend's problem to reject, not a size concern.
    return
  }
  if (serialized.length > APPLY_BATCH_MAX_CHARS) {
    throw new Error(
      `pipeline.applyBatch rejected: the batch serializes to ${serialized.length} chars ` +
        `(> ${APPLY_BATCH_MAX_CHARS}). This usually means bulk geometry was inlined into params. Bake ` +
        `to an OBJ with g_bake_part and reference via g_mesh(filename) instead of inlining buffers, and ` +
        `split unrelated edits into smaller batches if genuinely needed.`,
    )
  }
}

export const tools: Record<string, ToolHandler> = {
  'lowpoly:projects.list': async (_args, ctx) => request(ctx, 'GET', '/api/v1/projects'),
  'lowpoly:projects.create': async (args, ctx) => request(ctx, 'POST', '/api/v1/projects', objectArgs(args)),
  // Shared session attach for analysis — several agents may open the same
  // project concurrently and call read tools. The exclusive write lock is
  // claimed later by applyBatch/execute/import (those block and wait).
  'lowpoly:projects.open': async (args, ctx) => {
    const body = objectArgs(args)
    const id = stringArg(body, 'id')
    const opened = await request(ctx, 'POST', `/api/v1/projects/${encodeURIComponent(id)}/open`, {})
    // Same reasoning as `pipeline.get` (see compactPipeline): `open` hands back
    // the FULL pipeline snapshot, including per-node editor layout (`position`)
    // and the redundant inner `id`. For a project someone already worked on this
    // is the single biggest tool result in the whole open→resume path — exactly
    // the moment an interrupted/continued conversation re-opens the project to
    // recover state, so an oversized result here is the worst possible place for
    // a context blowup: it can push the very NEXT turn past the window and end
    // the run right as the agent is trying to re-orient itself.
    if (opened && typeof opened === 'object' && !Array.isArray(opened) && 'pipeline' in opened) {
      const o = opened as Record<string, unknown>
      return { ...o, pipeline: compactPipeline(o.pipeline) }
    }
    return opened
  },
  // Persist a small durable note on the project (build spec JSON / current phase
  // / baked-item ledger) so it survives a compacted or cut-off conversation.
  // Backed by the same project manifest as `name`/`description` on
  // `projects.create` (see backend/src/routes/projects.ts `PUT /projects/:id`) —
  // written atomically to disk, not just held in this agent's chat history, and
  // read back verbatim in `project` from `projects.list` / `projects.open`.
  // See compose-lowpoly's "断点续接" protocol (quickstart.md) for when to call
  // this and what to put in it.
  'lowpoly:projects.update': async (args, ctx) => {
    const body = objectArgs(args)
    const id = stringArg(body, 'id')
    const { id: _omit, ...patch } = body
    return request(ctx, 'PUT', `/api/v1/projects/${encodeURIComponent(id)}`, patch)
  },
  'lowpoly:projects.remove': async (args, ctx) => {
    const body = objectArgs(args)
    const id = stringArg(body, 'id')
    return request(ctx, 'DELETE', `/api/v1/projects/${encodeURIComponent(id)}${query({ assetPolicy: body.assetPolicy })}`)
  },
  // Detaches this agent's session AND releases its write lock. Required before
  // opening a different project.
  'lowpoly:projects.close': async (args, ctx) => {
    const id = stringArg(objectArgs(args), 'id')
    return request(ctx, 'POST', `/api/v1/projects/${encodeURIComponent(id)}/close`, {})
  },
  // Explicit lease renewal for a project you already hold. Every successful
  // mutation renews it automatically; this is only for long non-mutating gaps.
  'lowpoly:projects.heartbeat': async (args, ctx) => {
    const id = stringArg(objectArgs(args), 'id')
    return request(ctx, 'POST', `/api/v1/projects/${encodeURIComponent(id)}/heartbeat`, {})
  },
  // Inspect your position in a project's write wait queue without side effects.
  'lowpoly:projects.queue.status': async (args, ctx) => {
    const id = stringArg(objectArgs(args), 'id')
    return request(ctx, 'GET', `/api/v1/projects/${encodeURIComponent(id)}/queue`)
  },
  // Give up your place in a project's write wait queue. Idempotent.
  'lowpoly:projects.queue.leave': async (args, ctx) => {
    const id = stringArg(objectArgs(args), 'id')
    return request(ctx, 'POST', `/api/v1/projects/${encodeURIComponent(id)}/queue/leave`, {})
  },
  'lowpoly:batteries.list': async (_args, ctx) => {
    // Compact projection only (see compactBattery): the full catalog is ~200k+
    // tokens and overflows the model context on the next turn. Agents call
    // `batteries.get` for the full per-port spec of a chosen op.
    const ops = await request(ctx, 'GET', '/api/v1/ops') as Array<Record<string, unknown>>
    return Array.isArray(ops) ? ops.map(compactBattery) : ops
  },
  'lowpoly:batteries.get': async (args, ctx) => {
    const id = stringArg(objectArgs(args), 'id')
    const ops = await request(ctx, 'GET', '/api/v1/ops') as Array<Record<string, unknown>>
    const op = ops.find((candidate) => candidate.id === id)
    if (!op) throw new Error(`lowpoly battery not found: ${id}`)
    return stripBatteryIcon(op)
  },
  'lowpoly:pipeline.get': async (args, ctx) => {
    // Compact projection only (see compactPipeline): drop per-node editor layout
    // (`position`) + the redundant inner `id`, which the agent never reads but
    // which re-inflate the context on every post-applyBatch pipeline.get.
    const projectId = await resolveProjectId(ctx, objectArgs(args))
    const snapshot = await request(ctx, 'GET', projectPath(projectId, '/pipeline'))
    return compactPipeline(snapshot)
  },
  'lowpoly:pipeline.applyBatch': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    const { projectId: _omit, ...batchBody } = body
    // Reject inlined mesh/point buffers before they are persisted (see
    // guardApplyBatchSize): they balloon the tool call and re-inflate context on
    // every later pipeline.get/execute. Bake → g_mesh(filename) is the contract.
    guardApplyBatchSize(batchBody)
    return request(ctx, 'POST', projectPath(projectId, '/batch'), batchBody)
  },
  // Defaults to the backend summary route (status + per-port shape notes), never
  // raw mesh buffers. Pass `nodeId` to run only that node's downstream closure
  // (incremental — the editor's hot-update path; upstream hydrated from cache).
  // Escape hatch `raw: true` returns the FULL result — every port's DataTree wire
  // value, including mesh vertex/index/UV buffers, which is unbounded. Host-bridged
  // plugin tools run with maxResultSizeChars=Infinity (forgeax-core-kernel
  // wrapTools), so the loop's global result-budget gate never trims this; a heavy
  // raw result would blow the model context on the NEXT turn — the exact failure
  // mode that killed `batteries.list`. So we cap the raw payload here: over the
  // limit we drop the buffers and hand back a bounded notice pointing the agent at
  // the (safe) default summary instead of crashing the run.
  'lowpoly:pipeline.execute': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    const forward: Record<string, unknown> = {}
    if (typeof body.nodeId === 'string') forward.nodeId = body.nodeId
    if (body.raw !== true) {
      return request(ctx, 'POST', projectPath(projectId, '/execute/summary'), forward)
    }
    const result = await request(ctx, 'POST', projectPath(projectId, '/execute'), forward)
    return guardRawExecuteResult(result)
  },
  // DSL-first 建模主入口：一次调用完成 校验+编译成图+执行+QC，返回紧凑回执
  // （错误/QC 信号定位到 DSL 行号、mesh-aware 穿模硬信号、URDF 指纹）。agent 永不手写
  // createNode/connect —— 只写 DSL，后端 dsl-to-graph 自动建图连线。
  'lowpoly:model.apply': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    const { projectId: _omit, ...applyBody } = body
    return request(ctx, 'POST', projectPath(projectId, '/model/apply'), applyBody)
  },
  // 读态：从当前图反解出等价 DSL 源（round-trip；人在编辑器改过图也能读回）。
  'lowpoly:model.get': async (args, ctx) => {
    const projectId = await resolveProjectId(ctx, objectArgs(args))
    return request(ctx, 'GET', projectPath(projectId, '/model/get'))
  },
  'lowpoly:model.bakeBatch': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    const { projectId: _omit, ...batchBody } = body
    return request(ctx, 'POST', projectPath(projectId, '/model/bake-batch'), batchBody)
  },
  'lowpoly:model.patch': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    const { projectId: _omit, ...patchBody } = body
    return request(ctx, 'POST', projectPath(projectId, '/model/patch'), patchBody)
  },
  // 烘焙清单：廉价查询本项目已 bake 的 mesh（name → sha + bbox + dims），
  // 直接解决"找不到已 bake 的 mesh"。
  'lowpoly:parts.list': async (args, ctx) => {
    const projectId = await resolveProjectId(ctx, objectArgs(args))
    return request(ctx, 'GET', projectPath(projectId, '/parts'))
  },
  'lowpoly:pipeline.import': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    const { projectId: _omit, ...importBody } = body
    return request(ctx, 'POST', projectPath(projectId, '/pipeline/import'), importBody)
  },
  'lowpoly:pipeline.export': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    const { projectId: _omit, ...exportBody } = body
    return request(ctx, 'POST', projectPath(projectId, '/pipeline/export'), exportBody)
  },
  'lowpoly:assets.list': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    const { projectId: _omit, ...assetQuery } = body
    return request(ctx, 'GET', projectPath(projectId, `/assets${query(assetQuery)}`))
  },
  'lowpoly:screenshot.capture': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    return request(ctx, 'POST', '/api/v1/agent/screenshot/capture', { ...body, projectId })
  },
  'lowpoly:screenshot.latest': async (_args, ctx) => request(ctx, 'GET', '/api/v1/agent/screenshot/latest'),
  'lowpoly:screenshot.store': async (args, ctx) => request(ctx, 'POST', '/api/v1/agent/screenshot/store', objectArgs(args)),
  'lowpoly:export-glb': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    return request(ctx, 'POST', '/api/v1/agent/glb/export', { ...body, projectId })
  },
  // AI-facing one-shot workflow: bake the current lowpoly graph, then import
  // the resulting GLB through the same Editor capability as the human UI.
  'lowpoly:export-to-engine': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    const exported = await request(ctx, 'POST', '/api/v1/agent/glb/export', { ...body, projectId })
    if (!isRecord(exported) || typeof exported.path !== 'string') {
      throw new Error('GLB export completed without a readable artifact path')
    }

    const exportSummary = {
      requestId: typeof exported.requestId === 'string' ? exported.requestId : undefined,
      relPath: typeof exported.relPath === 'string' ? exported.relPath : undefined,
      bytes: typeof exported.bytes === 'number' ? exported.bytes : undefined,
    }
    const exportedName = typeof body.name === 'string' && body.name.trim()
      ? body.name
      : (typeof exported.relPath === 'string' ? exported.relPath.split('/').at(-1) : 'lowpoly-model')
    const base64 = (await readFile(exported.path)).toString('base64')

    try {
      const imported = await importGlbBytes(ctx, {
        base64,
        directory: body.directory,
        name: exportedName,
        requestId: randomUUID(),
      })
      return {
        status: 'succeeded',
        format: 'glb',
        projectId,
        export: exportSummary,
        import: {
          requestId: imported.requestId,
          directory: imported.directory,
          sourceName: imported.sourceName,
          destPath: imported.destPath,
          receipt: imported.receipt,
        },
        recoveryActions: [],
      }
    } catch (error) {
      const typed = error as Error & { code?: string }
      return {
        status: 'partial',
        format: 'glb',
        projectId,
        export: exportSummary,
        import: {
          status: 'failed',
          error: {
            code: typed.code ?? 'editor-asset-import-failed',
            hint: typed.message,
            retryable: true,
          },
        },
        recoveryActions: ['lowpoly:export-to-engine'],
      }
    }
  },
}

export default tools
