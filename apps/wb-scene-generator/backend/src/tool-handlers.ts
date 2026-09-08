import { readFileSync } from 'node:fs'
import { isAbsolute, resolve as resolvePath } from 'node:path'

import { parseGeneratorContractSource } from '@forgeax/scene-authoring'

import { resolveNarrativeLocationNames } from './resolve-narrative-names.js'
import {
  dedupeRead,
  noteAuthoringMutation,
  READ_DEDUPE_NEXT_ACTION,
} from './scene-script/agent/readDedupe.js'
import { resolveCanonicalEntryFile } from './scene-script/persist/store.js'

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
}

type ToolHandler = (args: unknown, ctx: ToolCtx) => Promise<unknown>

const PLUGIN_ID = '@forgeax-plugin/wb-scene-generator'
const DEFAULT_BACKEND_URL = 'http://127.0.0.1:9557'
const ASSET2D_PLUGIN_ID = '@forgeax-plugin/wb-2d-scene-asset-generator'
const DEFAULT_ASSET2D_BACKEND_URL = 'http://127.0.0.1:9567'

function objectArgs(args: unknown): Record<string, unknown> {
  return args && typeof args === 'object' && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {}
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`missing string arg: ${key}`)
  }
  return value
}

function backendUrlFromOverrides(file: string | undefined, pluginId: string): string | null {
  if (!file) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as {
      plugins?: Record<string, { backendPort?: unknown }>
    }
    const port = parsed.plugins?.[pluginId]?.backendPort
    if (Number.isInteger(port) && Number(port) > 0 && Number(port) <= 65535) {
      return `http://127.0.0.1:${Number(port)}`
    }
  } catch {
    return null
  }
  return null
}

function backendBaseUrl(ctx: ToolCtx): string {
  const explicit = ctx.env.FORGEAX_SCENE_BACKEND_URL
  if (explicit?.trim()) return explicit.replace(/\/+$/u, '')
  return backendUrlFromOverrides(ctx.env.FORGEAX_PLUGIN_DEV_PORTS_FILE, PLUGIN_ID) ?? DEFAULT_BACKEND_URL
}

// The 2D asset generator runs as a separate Fastify backend on its own port.
// Resolve it from the same dev-ports file the host uses, so the publish bridge
// can pull bytes server-to-server (the agent must NEVER shuttle base64 — large
// base64 gets dropped by context auto-compaction, causing publish retry loops).
function asset2dBackendBaseUrl(ctx: ToolCtx): string {
  const explicit = ctx.env.FORGEAX_ASSET2D_BACKEND_URL
  if (explicit?.trim()) return explicit.replace(/\/+$/u, '')
  return backendUrlFromOverrides(ctx.env.FORGEAX_PLUGIN_DEV_PORTS_FILE, ASSET2D_PLUGIN_ID) ?? DEFAULT_ASSET2D_BACKEND_URL
}

// Fetch a generated 2D asset's raw bytes (by alias or blobId) from the asset2d
// backend and return base64. Runs in the host tool process (server-to-server),
// keeping pixels out of the agent context entirely.
async function fetch2dAssetBase64(
  ctx: ToolCtx,
  ref: { alias?: string; blobId?: string },
): Promise<string> {
  const base = asset2dBackendBaseUrl(ctx)
  const path = ref.alias
    ? `/api/v1/generated-assets/blob/${encodeURIComponent(ref.alias)}`
    : `/api/v1/library/blob/${encodeURIComponent(ref.blobId ?? '')}`
  const res = await fetch(`${base}${path}`)
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`asset2d byte fetch ${path} failed: ${res.status} ${detail || res.statusText}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length === 0) throw new Error(`asset2d byte fetch ${path} returned empty bytes`)
  return buf.toString('base64')
}

function sceneCallerHeaders(ctx: ToolCtx, hasBody: boolean): Record<string, string> {
  const headers: Record<string, string> = { 'x-forgeax-caller-kind': ctx.caller.kind }
  if (hasBody) headers['content-type'] = 'application/json'
  if (ctx.caller.agentId) headers['x-forgeax-caller-agent-id'] = ctx.caller.agentId
  if (ctx.caller.sessionId) headers['x-forgeax-caller-session-id'] = ctx.caller.sessionId
  return headers
}

async function sceneRawFetch(
  ctx: ToolCtx,
  method: string,
  path: string,
  body: unknown,
): Promise<{ res: Response; payload: unknown; text: string }> {
  const res = await fetch(`${backendBaseUrl(ctx)}${path}`, {
    method,
    headers: sceneCallerHeaders(ctx, body !== undefined),
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  const payload = text ? (JSON.parse(text) as unknown) : null
  return { res, payload, text }
}

async function request(
  ctx: ToolCtx,
  method: string,
  path: string,
  body?: unknown,
  options: { returnErrorPayload?: boolean } = {},
): Promise<unknown> {
  let { res, payload, text } = await sceneRawFetch(ctx, method, path, body)

  // Transparent lock recovery after a backend restart wipes the in-memory lock
  // table: an AI mutation gets 403 `mutation-denied-not-open` (recoverable). Re-
  // `open` the active project once and replay. Genuine conflicts
  // (`mutation-denied-locked-by-other`) are NOT retried.
  if (res.status === 403 && ctx.caller.kind === 'ai' && ctx.caller.agentId) {
    const p = (payload ?? {}) as { code?: unknown; projectId?: unknown }
    if (p.code === 'mutation-denied-not-open' && typeof p.projectId === 'string' && p.projectId) {
      // Soft re-attach; write lock is reclaimed by the mutation route itself.
      const reopen = await sceneRawFetch(
        ctx,
        'POST',
        `/api/v1/projects/${encodeURIComponent(p.projectId)}/open`,
        {},
      )
      if (reopen.res.ok) {
        ;({ res, payload, text } = await sceneRawFetch(ctx, method, path, body))
      }
    }
  }

  if (!res.ok) {
    if (options.returnErrorPayload && payload && typeof payload === 'object') {
      return { ...(payload as Record<string, unknown>), httpStatus: res.status }
    }
    const reason =
      payload && typeof payload === 'object' && 'reason' in payload
        ? String((payload as { reason?: unknown }).reason)
        : payload && typeof payload === 'object' && 'error' in payload
          ? String((payload as { error?: unknown }).error)
          : text || `${res.status} ${res.statusText}`
    throw new Error(`scene backend ${method} ${path} failed: ${reason}`)
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

// `/api/v1/ops` attaches each battery's inline `icon.svg` as `iconSvg`, and a
// battery could expose other inline-image fields too (preview thumbnails, data:
// URIs, …). The host tool bridge mis-reads ANY such string as an image content
// part and drops the rest of the (text) payload, so an agent calling
// `batteries.list` gets a blank / garbled result. Defensively strip every value
// that looks like inline image markup — agents only ever need ports / params,
// never pixels — so the op catalog is always clean, parseable text.
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

function stripBatteryIcon(op: Record<string, unknown>): Record<string, unknown> {
  return stripInlineImages(op) as Record<string, unknown>
}

/** The REST authoring surface serves Studio as well as AI and therefore keeps
 * canonical source and Source Map details. Tool calls already supplied the
 * source and only need transaction/revision/diagnostic evidence back. */
export function boundedSceneScriptMutationResult(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
  const input = payload as Record<string, unknown>
  const {
    canonicalSource: _canonicalSource,
    sourceMap,
    sources: _sources,
    runtimeGraph: _runtimeGraph,
    execution,
    incremental,
    ...bounded
  } = input
  const executionRecord = execution && typeof execution === 'object'
    ? execution as Record<string, unknown>
    : null
  const incrementalRecord = incremental && typeof incremental === 'object'
    ? incremental as Record<string, unknown>
    : null
  const moduleIds = incrementalRecord?.modules && typeof incrementalRecord.modules === 'object'
    ? Object.keys(incrementalRecord.modules as Record<string, unknown>)
    : []
  const invalidatedModuleIds = Array.isArray(incrementalRecord?.invalidatedModuleIds)
    ? incrementalRecord.invalidatedModuleIds.filter((item): item is string => typeof item === 'string')
    : []
  return {
    ...bounded,
    ...(Array.isArray(sourceMap) ? { sourceMapEntries: sourceMap.length } : {}),
    ...(executionRecord
      ? {
          execution: {
            status: executionRecord.status,
            durationMs: executionRecord.durationMs,
            executionId: executionRecord.executionId,
            projectRevision: executionRecord.projectRevision,
            executedRevision: executionRecord.executedRevision,
            evidenceAligned: executionRecord.evidenceAligned,
            verification: executionRecord.verification,
            diagnostics: executionRecord.diagnostics,
            sync: executionRecord.sync,
          },
        }
      : {}),
    ...(incrementalRecord
      ? {
          incremental: {
            directlyChanged: incrementalRecord.reparsedModuleIds,
            recompiled: invalidatedModuleIds,
            reexecuted: invalidatedModuleIds,
            reused: moduleIds.filter((moduleId) => !invalidatedModuleIds.includes(moduleId)),
          },
        }
      : {}),
  }
}

type WorkspaceSnapshot = {
  viewingProjectId?: string | null
  executingProjectIds?: string[]
}

type MineSnapshot = {
  openProjectId?: string | null
}

/** Explicit `projectId` in args, else soft-open session / write lock, else UI viewing (non-AI). */
async function resolveProjectId(ctx: ToolCtx, args: Record<string, unknown>): Promise<string> {
  const explicit = args.projectId
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim()

  if (ctx.caller.kind === 'ai') {
    const mine = (await request(ctx, 'GET', '/api/v1/workspace/mine')) as MineSnapshot
    if (typeof mine.openProjectId === 'string' && mine.openProjectId.trim()) {
      return mine.openProjectId.trim()
    }
    const ws = (await request(ctx, 'GET', '/api/v1/workspace')) as WorkspaceSnapshot
    const executing = ws.executingProjectIds ?? []
    if (executing.length === 1) return executing[0]!
    throw new Error(
      'missing projectId: AI must pass projectId on every pipeline tool call, ' +
      'or scene:projects.open first (shared attach — does not wait for write lock). ' +
      (executing.length > 0
        ? `Write locks currently held: [${executing.join(', ')}].`
        : 'No soft-open session found.'),
    )
  }

  const ws = (await request(ctx, 'GET', '/api/v1/workspace')) as WorkspaceSnapshot
  const viewing = ws.viewingProjectId
  if (typeof viewing === 'string' && viewing.trim()) return viewing.trim()

  throw new Error(
    'missing projectId: pass projectId in args, or scene:projects.open a project first (AI agents must open before mutating)',
  )
}

function projectPath(projectId: string, suffix: string): string {
  return `/api/v1/projects/${encodeURIComponent(projectId)}${suffix}`
}

export type ExecuteSummaryVerification = {
  ok?: boolean
  hints?: string[]
  primaryFailure?: 'execution' | 'structural' | 'location-names'
  finalOutput?: {
    ok?: boolean
    resultEntityIds?: string[]
    totalSceneCells?: number
    missingResultEntityIds?: string[]
    emptyResultEntityIds?: string[]
  }
  executionFailures?: {
    ok?: boolean
    count?: number
    failures?: Array<{ index: number; message: string }>
    truncated?: boolean
  }
  locationNameAlignment?: {
    ok?: boolean
    missing?: Array<{ name: string }>
    fix?: string
    actualNodeNames?: string[]
    actualNodeNamesTruncated?: boolean
  }
  topologyIssues?: Array<{
    kind: 'rest-fan-out' | 'illegal-local-merge' | 'manual-points-zero-default'
    reason: string
    fix: string
    suggestedOps?: unknown[]
  }>
}

/** Build the Error message for AI execute when verification failed. Structural issues take priority over naming. */
export function formatExecuteVerificationFailure(summary: {
  status?: string
  verification?: ExecuteSummaryVerification
  diagnostics?: Array<{ repairSlip?: string }>
}): string | null {
  if (summary.status !== 'completed' || summary.verification?.ok !== false) return null

  const hints = summary.verification.hints ?? []
  const loc = summary.verification.locationNameAlignment
  const structuralHints = hints.filter((h) => !h.startsWith('[stage3.location_names]'))
  const hasStructural = structuralHints.length > 0 || summary.verification.primaryFailure === 'structural'
  const hasLocation = loc?.ok === false
  const execution = summary.verification.executionFailures

  if (summary.verification.primaryFailure === 'execution' || execution?.ok === false) {
    const failures = (execution?.failures ?? []).map((item) => `[${item.index + 1}] ${item.message}`).join('\n')
    const repairSlip = summary.diagnostics?.find((item) => item.repairSlip)?.repairSlip
    return (
      `[primaryFailure: execution] pipeline.execute recorded ${execution?.count ?? 'one or more'} node execution failure(s); ` +
      `status=completed is not acceptance. Fix the first failing Scene Script operation and re-execute.` +
      (failures ? `\n${failures}` : '') +
      (repairSlip ? `\n\n${repairSlip}` : '')
    )
  }

  if (hasStructural) {
    const locationSection = hasLocation
      ? `\n\n[secondary: locationNameAlignment] missing narrative names: ${(loc!.missing ?? []).map((m) => m.name).join('、')}. ` +
        `${loc!.fix ?? 'Wire Name/BuildingName ports from checklist namePort, then re-execute.'}` +
        (loc!.actualNodeNames?.length
          ? ` 当前场景实际节点名（共 ${loc!.actualNodeNames.length}${loc!.actualNodeNamesTruncated ? '+' : ''} 个）：${loc!.actualNodeNames.join('、')}`
          : '')
      : ''
    return (
      `[primaryFailure: structural] pipeline.execute verification failed — empty/disconnected group outputs (fix wiring before checking names). ` +
      `Correct the responsible Scene Script call using its structured diagnostic, then re-execute. ` +
      (structuralHints[0] ?? 'See verification.hints') +
      locationSection
    )
  }

  if (hasLocation) {
    const missing = (loc!.missing ?? []).map((m) => m.name).join('、')
    const actualList = loc!.actualNodeNames ?? []
    const actualNote = actualList.length > 0
      ? ` 当前场景实际节点名（共 ${actualList.length}${loc!.actualNodeNamesTruncated ? '+' : ''} 个，无需再跑 raw execute 翻找）：${actualList.join('、')}`
      : ''
    return (
      `[primaryFailure: location-names] pipeline.execute locationNameAlignment failed — missing narrative names: ${missing}. ` +
      `${loc!.fix ?? 'Wire Name/BuildingName ports from checklist namePort, then re-execute.'}${actualNote}`
    )
  }

  return (
    `[primaryFailure: structural] pipeline.execute verification failed (empty/disconnected group outputs). ` +
    `Correct the responsible Scene Script call using its structured diagnostic, then re-execute. ` +
    (hints[0] ?? 'See verification.hints')
  )
}

export const DEFAULT_PROJECT_LIST_LIMIT = 8
export const COMPACT_SOURCE_MAX_BYTES = 16 * 1024
const COMPACT_OUTLINE_LIMIT = 64
const COMPACT_MODULE_LIMIT = 48
const COMPACT_CONTROL_LIMIT = 16
const COMPACT_DEPENDENCY_LIMIT = 24

export interface BoundProjectList {
  projects: Array<{ id: unknown; name?: unknown; type?: unknown; updatedAt?: unknown }>
  total: number
  truncated: boolean
  currentProjectId?: string
  nextAction?: string
}

function compactProjectRow(item: unknown): BoundProjectList['projects'][number] | null {
  if (!item || typeof item !== 'object') return null
  const project = item as Record<string, unknown>
  return {
    id: project.id,
    ...(project.name !== undefined ? { name: project.name } : {}),
    ...(project.type !== undefined ? { type: project.type } : {}),
    ...(project.updatedAt !== undefined ? { updatedAt: project.updatedAt } : {}),
  }
}

export function summarizeProjectList(
  payload: unknown,
  options: { limit?: unknown; scope?: unknown; currentProjectId?: string } = {},
): BoundProjectList {
  const rows = Array.isArray(payload)
    ? payload.map(compactProjectRow).filter((item): item is BoundProjectList['projects'][number] => Boolean(item))
    : []
  const currentProjectId = typeof options.currentProjectId === 'string' && options.currentProjectId.trim()
    ? options.currentProjectId.trim()
    : undefined
  const scope = options.scope === 'current' ? 'current' : 'recent'
  const parsedLimit = typeof options.limit === 'number' ? options.limit : Number(options.limit)
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.min(Math.floor(parsedLimit), 32)
    : DEFAULT_PROJECT_LIST_LIMIT
  const sorted = [...rows].sort((left, right) => String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')))
  let selected = scope === 'current' && currentProjectId
    ? sorted.filter((item) => item.id === currentProjectId)
    : sorted
  if (scope === 'current' && currentProjectId && selected.length === 0) {
    selected = [{ id: currentProjectId, type: 'scene' }]
  }
  const truncated = selected.length > limit
  const projects = selected.slice(0, limit)
  if (currentProjectId && !projects.some((item) => item.id === currentProjectId)) {
    const current = sorted.find((item) => item.id === currentProjectId)
    if (current) projects.unshift(current)
    while (projects.length > limit) projects.pop()
  }
  return {
    projects,
    total: rows.length,
    truncated: truncated || projects.length < selected.length,
    ...(currentProjectId ? { currentProjectId } : {}),
    nextAction: 'Open a known projectId. Do not re-list to recover an id you already have.',
  }
}

function generatorControlSummary(source: string, file: string): unknown[] {
  try {
    return parseGeneratorContractSource(source, file).exports.flatMap((item) =>
      Object.entries(item.meta.inputs).flatMap(([name, descriptor]) =>
        descriptor.control === true
          ? [{
              generatorId: item.meta.id,
              name,
              type: descriptor.type,
              defaultValue: descriptor.defaultValue,
              label: descriptor.label,
            }]
          : []))
  } catch {
    return []
  }
}

export function summarizeSceneScriptSource(payload: unknown, ifRevision?: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload
  const module = payload as Record<string, unknown>
  const state = module.state && typeof module.state === 'object'
    ? module.state as Record<string, unknown>
    : null
  const projectRevision = typeof state?.projectRevision === 'string'
    ? state.projectRevision
    : state?.sourceRevision
  const revision = module.revision
  const unchanged = typeof ifRevision === 'string'
    && (ifRevision === revision || ifRevision === projectRevision)
  if (unchanged) {
    return {
      file: module.file,
      revision,
      projectRevision,
      exists: module.exists,
      unchanged: true,
      nextAction: READ_DEDUPE_NEXT_ACTION,
      payload: 'compact-source-unchanged',
    }
  }
  const sourceMap = Array.isArray(state?.sourceMap) ? state.sourceMap : []
  const file = module.file
  const outline = sourceMap.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const entry = item as Record<string, unknown>
    if (typeof file === 'string' && entry.file !== file) return []
    const source = entry.source && typeof entry.source === 'object'
      ? entry.source as Record<string, unknown>
      : {}
    const start = typeof source.start === 'number' ? source.start : 0
    const end = typeof source.end === 'number' ? source.end : start
    const snippet = typeof module.source === 'string' ? module.source.slice(start, end) : ''
    const functionName = typeof entry.functionName === 'string' && entry.functionName
      ? entry.functionName
      : snippet.match(/=\s*([A-Za-z_][\w]*)\s*\(/)?.[1]
    return [{
      statementId: entry.statementId,
      entityId: entry.entityId,
      functionName,
      span: { start, end },
    }]
  }).slice(0, COMPACT_OUTLINE_LIMIT)
  const moduleRevisions = state?.moduleRevisions && typeof state.moduleRevisions === 'object'
    ? Object.entries(state.moduleRevisions as Record<string, unknown>).slice(0, COMPACT_MODULE_LIMIT).map(([path, value]) => {
        const detail = value && typeof value === 'object' ? value as Record<string, unknown> : {}
        return { file: path, moduleId: detail.moduleId, revision: detail.revision }
      })
    : []
  const files = Array.isArray(state?.modules)
    ? (state.modules as unknown[]).filter((item): item is string => typeof item === 'string').slice(0, COMPACT_MODULE_LIMIT)
    : typeof file === 'string' ? [file] : []
  const dependencyGraph = state?.dependencyGraph && typeof state.dependencyGraph === 'object'
    ? Object.fromEntries(Object.entries(state.dependencyGraph as Record<string, unknown>).slice(0, COMPACT_DEPENDENCY_LIMIT).map(([path, value]) => {
        const detail = value && typeof value === 'object' ? value as Record<string, unknown> : {}
        const deps = Array.isArray(detail.dependencies)
          ? detail.dependencies.filter((item): item is string => typeof item === 'string').slice(0, 16)
          : []
        const dependents = Array.isArray(detail.dependents)
          ? detail.dependents.filter((item): item is string => typeof item === 'string').slice(0, 16)
          : []
        return [path, { dependencies: deps, dependents }]
      }))
    : {}
  const controls = typeof file === 'string'
    && file.endsWith('.generator.ts')
    && typeof module.source === 'string'
    ? generatorControlSummary(module.source, file).slice(0, COMPACT_CONTROL_LIMIT)
    : []
  const compact: Record<string, unknown> = {
    file,
    revision,
    projectRevision,
    exists: module.exists,
    unchanged: false,
    source: module.source,
    manifest: {
      entryFile: resolveCanonicalEntryFile(
        files,
        typeof state?.entryFile === 'string' ? state.entryFile : null,
        file,
      ),
      files,
      moduleRevisions,
      dependencyGraph,
    },
    outline,
    controls,
    payload: 'compact-source-no-runtime-graph',
  }
  if (Buffer.byteLength(JSON.stringify(compact)) <= COMPACT_SOURCE_MAX_BYTES) return compact
  const manifest = compact.manifest as Record<string, unknown>
  return {
    ...compact,
    manifest: { ...manifest, dependencyGraph: {} },
    outline: outline.slice(0, 16),
    controls: Array.isArray(controls) ? controls.slice(0, 8) : controls,
    truncated: true,
  }
}

export function summarizeProjectOpen(
  payload: unknown,
  extras: {
    projectId?: string
    projectRevision?: string
    canonicalModule?: string
    revisionState?: Record<string, unknown>
    renderer?: Record<string, unknown>
  } = {},
): unknown {
  if (!payload || typeof payload !== 'object') return payload
  const source = payload as Record<string, unknown>
  const project = source.project && typeof source.project === 'object' ? source.project as Record<string, unknown> : {}
  const pipeline = source.pipeline && typeof source.pipeline === 'object' ? source.pipeline as Record<string, unknown> : {}
  const count = (value: unknown): number => Array.isArray(value)
    ? value.length
    : value && typeof value === 'object'
      ? Object.keys(value).length
      : 0
  const id = typeof project.id === 'string' && project.id.trim()
    ? project.id
    : extras.projectId
  return {
    project: {
      id: id ?? 'unknown',
      name: typeof project.name === 'string' && project.name.trim() ? project.name : 'Scene Project',
      type: typeof project.type === 'string' && project.type.trim() ? project.type : 'scene',
    },
    pipeline: {
      id: pipeline.id,
      hash: pipeline.hash,
      nodeCount: count(pipeline.nodes),
      edgeCount: count(pipeline.edges),
    },
    ...(typeof extras.projectRevision === 'string' ? { projectRevision: extras.projectRevision } : {}),
    ...(typeof extras.canonicalModule === 'string' ? { canonicalModule: extras.canonicalModule } : {}),
    ...(extras.revisionState ? { revisionState: extras.revisionState } : {}),
    ...(extras.renderer ? { renderer: extras.renderer } : {}),
    ...(source.openMode !== undefined ? { openMode: source.openMode } : {}),
    ...(source.writeLockedBy !== undefined ? { writeLockedBy: source.writeLockedBy } : {}),
  }
}

function callerForce(args: Record<string, unknown>): boolean {
  return args.force === true
}

function compactRendererSync(payload: unknown): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const body = payload as Record<string, unknown>
  const sync = body.sync && typeof body.sync === 'object' ? body.sync as Record<string, unknown> : body
  const representation = sync.representation && typeof sync.representation === 'object'
    ? sync.representation as Record<string, unknown>
    : undefined
  return {
    aligned: sync.aligned,
    meshLayers: sync.meshLayers,
    voxelLayers: sync.voxelLayers,
    gridLayers: sync.gridLayers,
    viewingProjectId: sync.viewingProjectId,
    openProjectId: sync.openProjectId,
    staleReasons: sync.staleReasons,
    ...(representation ? { representation } : {}),
  }
}

function executionVerificationResponse(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload
  const summary = payload as Record<string, unknown>
  return {
    executionId: summary.executionId,
    status: summary.status,
    durationMs: summary.durationMs,
    ...(summary.error !== undefined ? { error: summary.error } : {}),
    ...(summary.execFailures !== undefined ? { execFailures: summary.execFailures } : {}),
    ...(summary.failures !== undefined ? { failures: summary.failures } : {}),
    ...(summary.diagnostics !== undefined ? { diagnostics: summary.diagnostics } : {}),
    summarized: true,
    verificationOnly: true,
    ...(summary.verification !== undefined ? { verification: summary.verification } : {}),
  }
}

export const tools: Record<string, ToolHandler> = {
  'scene:projects.list': async (args, ctx) => {
    const body = objectArgs(args)
    const listed = await request(ctx, 'GET', '/api/v1/projects')
    if (ctx.caller.kind !== 'ai') return listed
    const mine = await request(ctx, 'GET', '/api/v1/workspace/mine').catch(() => ({ openProjectId: null })) as MineSnapshot
    const currentProjectId = typeof mine.openProjectId === 'string' ? mine.openProjectId : undefined
    const bounded = summarizeProjectList(listed, {
      limit: body.limit,
      scope: body.scope,
      currentProjectId,
    })
    const revision = bounded.projects.map((item) => `${item.id}:${item.updatedAt ?? ''}`).join('|')
    return dedupeRead({
      caller: ctx.caller,
      tool: 'list',
      projectId: currentProjectId,
      revision,
      payload: bounded,
      force: callerForce(body),
    }).delivered
  },
  'scene:projects.create': async (args, ctx) => {
    const body = objectArgs(args)
    if ('gameSlug' in body) {
      throw new Error('gameSlug is selected by Studio active game; switch games before creating a Scene Project')
    }
    const created = await request(ctx, 'POST', '/api/v1/projects', body)
    const projectId = created && typeof created === 'object' && typeof (created as { id?: unknown }).id === 'string'
      ? String((created as { id: string }).id)
      : ''
    if (ctx.caller.kind === 'ai' && created && typeof created === 'object') {
      noteAuthoringMutation(ctx.caller, projectId)
      return {
        ...(created as Record<string, unknown>),
        nextAction: projectId
          ? `scene:projects.open with id ${projectId}; do not list history to recover this id.`
          : 'Retry create; the project id was missing.',
      }
    }
    return created
  },
  // Shared session attach. Canonical source transactions claim the exclusive
  // write lease only when a mutation is committed.
  'scene:projects.open': async (args, ctx) => {
    const body = objectArgs(args)
    const id = stringArg(body, 'id')
    const opened = await request(ctx, 'POST', `/api/v1/projects/${encodeURIComponent(id)}/open`, {})
    if (ctx.caller.kind !== 'ai') return opened
    const [info, renderer] = await Promise.all([
      request(ctx, 'GET', projectPath(id, '/scene-script/project-info')).catch(() => null),
      request(ctx, 'GET', '/api/v1/agent/renderer/info').catch(() => null),
    ])
    const infoRecord = info && typeof info === 'object' ? info as Record<string, unknown> : {}
    const resume = await request(ctx, 'GET', projectPath(id, '/scene-agent/resume')).catch(() => null)
    const resumeRecord = resume && typeof resume === 'object' ? resume as Record<string, unknown> : {}
    const summary = summarizeProjectOpen(opened, {
      projectId: id,
      projectRevision: typeof infoRecord.projectRevision === 'string'
        ? infoRecord.projectRevision
        : typeof resumeRecord.projectSummary === 'object' && resumeRecord.projectSummary
          ? String((resumeRecord.projectSummary as { projectRevision?: unknown }).projectRevision ?? '')
          : undefined,
      canonicalModule: typeof infoRecord.canonicalModule === 'string' ? infoRecord.canonicalModule : undefined,
      revisionState: resumeRecord.revisionState && typeof resumeRecord.revisionState === 'object'
        ? resumeRecord.revisionState as Record<string, unknown>
        : undefined,
      renderer: compactRendererSync(renderer),
    })
    const revision = typeof (summary as { projectRevision?: unknown }).projectRevision === 'string'
      ? (summary as { projectRevision: string }).projectRevision
      : null
    return dedupeRead({
      caller: ctx.caller,
      tool: 'open',
      projectId: id,
      revision,
      payload: summary,
      force: callerForce(body),
    }).delivered
  },
  'scene:projects.close': async (args, ctx) => {
    const id = stringArg(objectArgs(args), 'id')
    return request(ctx, 'POST', `/api/v1/projects/${encodeURIComponent(id)}/close`, {})
  },
  // Explicit lease renewal for a project you already hold — call this if
  // you expect a long non-mutating stretch (reading/reasoning) between
  // pipeline mutation calls so idle time alone never expires your lock.
  // Every successful canonical transaction or execute renews it automatically;
  // this is only needed for long gaps with no mutation in between.
  'scene:projects.heartbeat': async (args, ctx) => {
    const id = stringArg(objectArgs(args), 'id')
    return request(ctx, 'POST', `/api/v1/projects/${encodeURIComponent(id)}/heartbeat`, {})
  },
  // Check your (or anyone's) position in a project's wait queue without
  // side effects — unlike `projects.open`, this never joins the queue.
  'scene:projects.queue.status': async (args, ctx) => {
    const id = stringArg(objectArgs(args), 'id')
    return request(ctx, 'GET', `/api/v1/projects/${encodeURIComponent(id)}/queue`)
  },
  // Voluntarily give up your place in a project's wait queue (e.g. you
  // decided to work on a different project instead). Idempotent.
  'scene:projects.queue.leave': async (args, ctx) => {
    const id = stringArg(objectArgs(args), 'id')
    return request(ctx, 'POST', `/api/v1/projects/${encodeURIComponent(id)}/queue/leave`, {})
  },
  'scene:projects.remove': async (args, ctx) => {
    const body = objectArgs(args)
    const id = stringArg(body, 'id')
    return request(ctx, 'DELETE', `/api/v1/projects/${encodeURIComponent(id)}${query({ assetPolicy: body.assetPolicy })}`)
  },
  'scene:script.contracts': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    const mode = body.mode === 'detail' ? 'detail' : 'summary'
    const functionNames = Array.isArray(body.functionNames)
      ? body.functionNames.filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
      : []
    if (mode === 'detail' && functionNames.length === 0) {
      throw new Error('scene:script.contracts detail mode requires exact functionNames from the summary')
    }
    if (functionNames.length > 6) {
      throw new Error('scene:script.contracts detail mode accepts at most 6 functionNames')
    }
    const result = await request(
      ctx,
      'GET',
      `${projectPath(projectId, '/scene-script/contracts')}${query({
        audience: 'sino',
        mode,
        functionNames: functionNames.length ? functionNames.join(',') : undefined,
      })}`,
    )
    if (ctx.caller.kind !== 'ai') return result
    const version = result && typeof result === 'object' && typeof (result as { version?: unknown }).version === 'string'
      ? (result as { version: string }).version
      : 'contracts'
    return dedupeRead({
      caller: ctx.caller,
      tool: 'contracts',
      projectId,
      revision: `${mode}:${functionNames.join(',')}:${version}`,
      extra: mode,
      payload: result,
      force: callerForce(body),
    }).delivered
  },
  'scene:script.get': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    const source = await request(
      ctx,
      'GET',
      `${projectPath(projectId, '/scene-script')}${query({ file: body.file })}`,
    )
    if (ctx.caller.kind !== 'ai') return source
    const compact = summarizeSceneScriptSource(source, body.ifRevision)
    const compactRecord = compact && typeof compact === 'object' ? compact as Record<string, unknown> : {}
    const revision = typeof compactRecord.projectRevision === 'string'
      ? compactRecord.projectRevision
      : typeof compactRecord.revision === 'string' ? compactRecord.revision : null
    const file = typeof body.file === 'string' && body.file.trim() ? body.file : 'main.scene.ts'
    if (compactRecord.unchanged === true) {
      return compact
    }
    return dedupeRead({
      caller: ctx.caller,
      tool: 'get',
      projectId,
      revision,
      extra: file,
      payload: compact,
      force: callerForce(body),
    }).delivered
  },
  'scene:script.validate': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    const { projectId: _projectId, ...requestBody } = body
    return boundedSceneScriptMutationResult(
      await request(ctx, 'POST', projectPath(projectId, '/scene-script/validate'), requestBody),
    )
  },
  'scene:script.put': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    const { projectId: _projectId, ...requestBody } = body
    return boundedSceneScriptMutationResult(
      await request(ctx, 'PUT', projectPath(projectId, '/scene-script'), requestBody),
    )
  },
  'scene:script.references': async (args, ctx) => {
    const body = objectArgs(args)
    const topic = stringArg(body, 'topic')
    const projectId = typeof body.projectId === 'string' && body.projectId.trim()
      ? body.projectId.trim()
      : null
    const path = projectId
      ? `${projectPath(projectId, '/scene-script/references')}${query({ topic })}`
      : `/api/v1/scene-script/references${query({ topic })}`
    return request(ctx, 'GET', path)
  },
  'scene:script.scaffold': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    const scaffolded = await request(ctx, 'POST', projectPath(projectId, '/scene-script/scaffold'), {
        template: body.template,
        expectedProjectRevision: body.expectedProjectRevision,
        overwrite: body.overwrite,
      }, { returnErrorPayload: true })
    if (ctx.caller.kind === 'ai' && scaffolded && typeof scaffolded === 'object' && (scaffolded as { status?: unknown }).status !== 'rejected') {
      noteAuthoringMutation(ctx.caller, projectId)
    }
    return boundedSceneScriptMutationResult(scaffolded)
  },
  'scene:script.draft': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    const draft = await request(ctx, 'POST', projectPath(projectId, '/scene-script/draft'), {
      draftId: body.draftId,
      generation: body.generation,
      files: Array.isArray(body.files) ? body.files : [],
      entryFile: body.entryFile,
      expectedProjectRevision: body.expectedProjectRevision,
      execute: body.execute,
    }, { returnErrorPayload: true })
    if (ctx.caller.kind === 'ai' && draft && typeof draft === 'object' && (draft as { status?: unknown }).status !== 'rejected') {
      noteAuthoringMutation(ctx.caller, projectId)
    }
    return boundedSceneScriptMutationResult(draft)
  },
  'scene:script.commitProject': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    const files = Array.isArray(body.files) ? body.files : []
    const commit = await request(ctx, 'POST', projectPath(projectId, '/scene-script/commit'), {
      files,
      entryFile: body.entryFile,
      expectedProjectRevision: body.expectedProjectRevision,
      expectedRevision: body.expectedRevision,
      canonicalize: body.canonicalize,
      label: body.label,
    }, { returnErrorPayload: true })
    const committed = commit && typeof commit === 'object' ? commit as Record<string, unknown> : {}
    if (committed.status === 'rejected' || typeof committed.httpStatus === 'number') {
      return boundedSceneScriptMutationResult(committed)
    }
    if (ctx.caller.kind === 'ai') noteAuthoringMutation(ctx.caller, projectId)
    const revision = typeof committed.projectRevision === 'string'
      ? committed.projectRevision
      : typeof committed.revision === 'string' ? committed.revision : undefined
    const execution = await request(ctx, 'POST', projectPath(projectId, '/execute/summary'), { quietErrors: true })
    const executed = execution && typeof execution === 'object' ? execution as Record<string, unknown> : {}
    return boundedSceneScriptMutationResult({
      ...committed,
      executedRevision: executed.executedRevision ?? revision,
      executionId: executed.executionId,
      executionStatus: executed.status,
      verification: executed.verification,
      evidenceAligned: executed.evidenceAligned,
      sync: executed.sync,
      execution,
    })
  },
  'scene:script.verify': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    return request(
      ctx,
      'GET',
      projectPath(projectId, '/scene-script/completion'),
      undefined,
      { returnErrorPayload: true },
    )
  },
  'scene:authoring.lens': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    return request(
      ctx,
      'GET',
      `${projectPath(projectId, '/scene-script/lens')}${query({
        file: body.file,
        statementId: body.statementId,
        entityId: body.entityId,
      })}`,
    )
  },
  'scene:authoring.applyCommands': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    const { projectId: _projectId, ...requestBody } = body
    const applied = await request(
      ctx,
      'POST',
      projectPath(projectId, '/scene-script/commands'),
      requestBody,
      { returnErrorPayload: true },
    )
    const result = applied && typeof applied === 'object' ? applied as Record<string, unknown> : {}
    if (result.status !== 'ok') return boundedSceneScriptMutationResult(applied)
    if (ctx.caller.kind === 'ai') noteAuthoringMutation(ctx.caller, projectId)
    const execution = await request(
      ctx,
      'POST',
      projectPath(projectId, '/execute/summary'),
      { quietErrors: true },
      { returnErrorPayload: true },
    )
    return boundedSceneScriptMutationResult({ ...result, execution })
  },
  'scene:agent.resumeSceneWork': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    return request(ctx, 'GET', projectPath(projectId, '/scene-agent/resume'))
  },
  'scene:agent.locateSceneTarget': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    const { projectId: _projectId, ...requestBody } = body
    return request(ctx, 'POST', projectPath(projectId, '/scene-agent/locate'), requestBody)
  },
  'scene:agent.openEditLens': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    const { projectId: _projectId, ...requestBody } = body
    return request(ctx, 'POST', projectPath(projectId, '/scene-agent/lens'), requestBody)
  },
  'scene:agent.proposeSceneEdit': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    const { projectId: _projectId, ...requestBody } = body
    return request(ctx, 'POST', projectPath(projectId, '/scene-agent/propose'), requestBody)
  },
  'scene:agent.applySceneEdit': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    const id = stringArg(body, 'transactionId')
    const forward: Record<string, unknown> = {
      humanApproved: body.humanApproved === true,
    }
    if ('layout' in body) forward.layout = body.layout
    return request(ctx, 'POST', projectPath(projectId, `/scene-agent/transactions/${encodeURIComponent(id)}/apply`), forward)
  },
  'scene:agent.previewSemanticDiff': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    const id = stringArg(body, 'transactionId')
    return request(ctx, 'GET', projectPath(projectId, `/scene-agent/transactions/${encodeURIComponent(id)}/diff`))
  },
  'scene:agent.verifySceneEdit': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    const id = stringArg(body, 'transactionId')
    const forward: Record<string, unknown> = {
      profile: body.profile,
    }
    if ('layout' in body) forward.layout = body.layout
    return request(ctx, 'POST', projectPath(projectId, `/scene-agent/transactions/${encodeURIComponent(id)}/verify`), forward)
  },
  'scene:agent.acceptOrRevertSceneEdit': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    const id = stringArg(body, 'transactionId')
    const forward: Record<string, unknown> = {
      decision: body.decision,
    }
    if ('layout' in body) forward.layout = body.layout
    return request(ctx, 'POST', projectPath(projectId, `/scene-agent/transactions/${encodeURIComponent(id)}/decision`), forward)
  },
  // Strip inline-image fields so the catalog is always clean text (see
  // `stripBatteryIcon` / `stripInlineImages` above).
  // Full battery catalog — human/workbench only (exposedToAI:false).
  'scene:batteries.list': async (_args, ctx) => {
    const ops = await request(ctx, 'GET', '/api/v1/ops') as Array<Record<string, unknown>>
    return Array.isArray(ops) ? ops.map(stripBatteryIcon) : ops
  },
  'scene:batteries.get': async (args, ctx) => {
    const id = stringArg(objectArgs(args), 'id')
    const ops = await request(ctx, 'GET', '/api/v1/ops') as Array<Record<string, unknown>>
    const op = ops.find((candidate) => candidate.id === id)
    if (!op) throw new Error(`scene battery not found: ${id}`)
    return stripBatteryIcon(op)
  },
  'scene:pipeline.get': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    if (body.raw === true) {
      return request(ctx, 'GET', projectPath(projectId, '/pipeline'))
    }
    const q = new URLSearchParams()
    const hasSelector = Boolean(
      (typeof body.groupId === 'string' && body.groupId.trim())
      || (Array.isArray(body.nodeIds) && body.nodeIds.length > 0)
      || (typeof body.nameContains === 'string' && body.nameContains.trim())
      || (Array.isArray(body.opIdIn) && body.opIdIn.length > 0),
    )
    if (body.mode === 'hash' || (ctx.caller.kind === 'ai' && !hasSelector)) q.set('mode', 'hash')
    if (typeof body.groupId === 'string' && body.groupId.trim()) q.set('groupId', body.groupId.trim())
    if (Array.isArray(body.nodeIds)) {
      const ids = body.nodeIds.filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
      if (ids.length > 0) q.set('nodeIds', ids.join(','))
    }
    // grep 式模糊过滤 —— nameContains 按节点 name 子串（大小写不敏感）匹配，
    // opIdIn 按 opId 精确匹配任意一个。命中的节点 + 其一跳邻居一起返回（跟
    // groupId/nodeIds 的行为一致），不用先 pipeline.get() 全图肉眼翻找再回填
    // 具体 nodeId。两者可以和 groupId/nodeIds 同时传，取并集。
    if (typeof body.nameContains === 'string' && body.nameContains.trim()) {
      q.set('nameContains', body.nameContains.trim())
    }
    if (Array.isArray(body.opIdIn)) {
      const ids = body.opIdIn.filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
      if (ids.length > 0) q.set('opIdIn', ids.join(','))
    }
    const suffix = q.size > 0 ? `/pipeline/summary?${q}` : '/pipeline/summary'
    return request(ctx, 'GET', projectPath(projectId, suffix))
  },
  // The agent must never pour a full ExecutionResult into its context (a real
  // graph is ~28MB and a huge scene can exceed V8's single-string limit, which
  // would throw `Invalid string length` while serializing the HTTP body). So by
  // default we call the backend's summary route, which projects the result to a
  // KB-scale summary (status + per-port child names / cell counts) BEFORE it is
  // ever serialized into an HTTP body — keeping the payload tiny regardless of
  // scene size. Escape hatch: `raw: true` hits the full route (UI parity; the
  // caller then owns the size and accepts that a massive scene may be heavy).
  'scene:pipeline.execute': async (args, ctx) => {
    const body = objectArgs(args)
    const raw = body.raw === true
    const projectIdHint =
      typeof body.projectId === 'string' && body.projectId.trim() ? body.projectId.trim() : undefined
    let narrativeLocationNames = Array.isArray(body.narrativeLocationNames)
      ? body.narrativeLocationNames.filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
      : []
    if (!raw && ctx.caller.kind === 'ai' && narrativeLocationNames.length === 0) {
      narrativeLocationNames = resolveNarrativeLocationNames(ctx.env, [], projectIdHint)
    }
    const projectId = await resolveProjectId(ctx, body)
    if (!raw && ctx.caller.kind === 'ai' && narrativeLocationNames.length === 0) {
      narrativeLocationNames = resolveNarrativeLocationNames(ctx.env, [], projectId)
    }
    const forward: Record<string, unknown> = {}
    if (typeof body.nodeId === 'string') forward.nodeId = body.nodeId
    if (!raw) forward.quietErrors = true
    // Independent scene-design agents may originate the brief themselves, so
    // there is no mandatory Director dispatch carrying location names. Keep
    // name-alignment verification when names are available, but never block
    // execution solely because that optional evidence is absent.
    if (!raw && narrativeLocationNames.length > 0) {
      forward.narrativeLocationNames = narrativeLocationNames
    }
    const path = raw ? projectPath(projectId, '/execute') : projectPath(projectId, '/execute/summary')
    const payload = await request(ctx, 'POST', path, forward)
    if (!raw && ctx.caller.kind === 'ai' && payload && typeof payload === 'object') {
      const summary = payload as {
        status?: string
        verification?: {
          ok?: boolean
          hints?: string[]
          locationNameAlignment?: {
            ok?: boolean
            missing?: Array<{ name: string }>
            fix?: string
            actualNodeNames?: string[]
            actualNodeNamesTruncated?: boolean
          }
          topologyIssues?: Array<{
            kind: 'rest-fan-out' | 'illegal-local-merge' | 'manual-points-zero-default'
            reason: string
            fix: string
            suggestedOps?: unknown[]
          }>
        }
      }
      // 2026-07-15：topologyIssues 里 rest-fan-out / illegal-local-merge 这两类
      // 在拓扑上从来没有"暂时这样、后面再改"的合法中间态——一旦出现就是真的接错了
      // （不像"还没接完全部装饰"那种正常施工中的状态）。即便 status=completed 且
      // verification.ok=true（这两类目前不参与 ok 判定，见 execution-summary.ts），
      // 也在这里强制抛出，不能让 agent 只看 ok=true 就以为万事大吉——这正是
      // 旧 raw-graph 工作流记录的真实翻车案例（fan-out/局部 merge 卡住
      // 几十 turn）本该被当场拦下的地方。manual-points-zero-default 允许有"确实
      // 就想放原点"的合法情况，不在这里强制抛出，只随 hints 一起返回。
      const blockingTopologyIssues = (summary.verification?.topologyIssues ?? []).filter(
        (i) => i.kind === 'rest-fan-out' || i.kind === 'illegal-local-merge',
      )
      if (blockingTopologyIssues.length > 0) {
        const detail = blockingTopologyIssues
          .map((i, idx) => `[${idx + 1}] ${i.reason}\n${i.fix}${i.suggestedOps ? `\nsuggestedOps: ${JSON.stringify(i.suggestedOps)}` : ''}`)
          .join('\n\n')
        throw new Error(
          `[primaryFailure: topology] pipeline.execute detected ${blockingTopologyIssues.length} topology violation(s) that are NEVER a legitimate mid-construction state ` +
          '(Rest fan-out / illegal local tree_merge) — fix these before doing anything else, do not adjust tree_merge params first:\n\n' +
          detail,
        )
      }
      const verificationError = formatExecuteVerificationFailure(summary)
      if (verificationError) {
        throw new Error(verificationError)
      }
    }
    return !raw && ctx.caller.kind === 'ai' && body.mode !== 'summary'
      ? executionVerificationResponse(payload)
      : payload
  },
  'scene:pipeline.export': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    const { projectId: _omit, ...exportBody } = body
    return request(ctx, 'POST', projectPath(projectId, '/pipeline/export'), exportBody)
  },
  // 复盘(2026-07-01 sino bake/export 工具缺口):bake/export 一直只有 HTTP 路由 +
  // UI 按钮,agent 完全没有工具能触达——sino 走到"图搭完了"就没有下一步了。这两个
  // 工具补上 M7（收尾)：先 bakeFromExecute 把当前图的执行结果快照成可编辑的 baked
  // 图层（原地在服务端投影出体素,agent 不搬 cells),再 export.cook 把 baked 图层
  // 烘焙打包成 scene.zip。都不需要参数拼 cells——分别对应 SKILL.md 的 M7 步骤。
  'scene:baked.bakeFromExecute': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    const forward: Record<string, unknown> = {}
    if (typeof body.nodeId === 'string') forward.nodeId = body.nodeId
    return request(ctx, 'POST', projectPath(projectId, '/baked/bake-from-execute'), forward)
  },
  'scene:sceneExport.cook': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    const forward: Record<string, unknown> = {}
    if (typeof body.sceneName === 'string') forward.sceneName = body.sceneName
    if (body.allowMissingAssets === true) forward.allowMissingAssets = true
    return request(ctx, 'POST', projectPath(projectId, '/scene-export/cook'), forward)
  },
  'scene:mesh3dExport.cook': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    const forward: Record<string, unknown> = {}
    if (typeof body.sceneName === 'string') forward.sceneName = body.sceneName
    if (typeof body.sceneId === 'string') forward.sceneId = body.sceneId
    if (typeof body.gameSlug === 'string') forward.gameSlug = body.gameSlug
    if (body.allowMissingAssets === true) forward.allowMissingAssets = true
    return request(ctx, 'POST', projectPath(projectId, '/mesh3d-export/cook'), forward)
  },
  'scene:assets.list': async (args, ctx) => request(ctx, 'GET', `/api/v1/assets${query(objectArgs(args))}`),
  // Library listing (base ∪ project-private, paginated) — the ONLY way for an
  // agent to SEE/verify what it published via `scene:library.publishExternal`.
  // (`scene:assets.list` above lists the shared filesystem `assets/` dir, NOT
  // the private library DB, so it can't confirm a publish.) Defaults to the
  // `raw` zone (the publish bridge's landing zone).
  'scene:library.list': async (args, ctx) => {
    const a = objectArgs(args)
    return request(ctx, 'GET', `/api/v1/library/list${query({ zone: 'raw', ...a })}`)
  },
  // Texture-pipeline publish bridge. Lands a 2D-generated PNG (base64) into this
  // scene project's private `raw` zone so the billboard renderer can match it —
  // composing a renderer-shaped alias (field4=assetName, field8=type), binding a
  // tile's autotile rule (autotileKind), and recording provenance (sourceBlobId,
  // idempotent). Args: { assetName, assetType:'tile'|'object', dataBase64,
  // autotileKind?, sourceBlobId?, anchorX?, anchorY?, geometryJson?, extraFields? }.
  // Bind the shared-game-sandbox textures dir (where the 2D app publishes via
  // asset2d:publishToGame) so the scene workbench reads it as an asset source —
  // surfaced in the AssetStore view AND merged into the renderer matching pool.
  // The host tool process resolves the absolute dir from its cwd (= project root).
  'scene:library.useGameTextures': async (args, ctx) => {
    const a = objectArgs(args)
    const gameSlug = stringArg(a, 'gameSlug')
    const root = typeof a.projectRoot === 'string' && a.projectRoot.trim() ? a.projectRoot.trim() : ctx.cwd
    const base = isAbsolute(root) ? root : resolvePath(ctx.cwd, root)
    const dir = resolvePath(base, '.forgeax', 'games', gameSlug, 'textures')
    return request(ctx, 'POST', '/api/v1/library/use-game-textures', { dir })
  },
  'scene:library.publishExternal': async (args, ctx) => {
    const a = { ...objectArgs(args) }
    // Preferred path: agent passes a 2D asset reference (from2dAlias / from2dBlobId)
    // and we fetch the bytes server-to-server here. The agent NEVER carries the
    // base64 — large base64 in the conversation gets dropped by auto-compaction,
    // which previously caused publishExternal to loop (lost dataBase64 → re-fetch
    // → compact → repeat). Raw `dataBase64` is still accepted for back-compat.
    const from2dAlias = typeof a.from2dAlias === 'string' ? a.from2dAlias.trim() : ''
    const from2dBlobId = typeof a.from2dBlobId === 'string' ? a.from2dBlobId.trim() : ''
    if (!a.dataBase64 && (from2dAlias || from2dBlobId)) {
      a.dataBase64 = await fetch2dAssetBase64(ctx, { alias: from2dAlias || undefined, blobId: from2dBlobId || undefined })
      if (!a.sourceBlobId && from2dBlobId) a.sourceBlobId = from2dBlobId
    }
    // These are tool-layer-only hints; the backend route doesn't know them.
    delete a.from2dAlias
    delete a.from2dBlobId
    return request(ctx, 'POST', '/api/v1/library/publish-external', a)
  },
  // Capture returns a bounded file reference rather than base64, so visual
  // verification does not inflate the agent context.
  'scene:screenshot.capture': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    return request(ctx, 'POST', '/api/v1/agent/screenshot/capture', {
      projectId,
      timeout: body.timeout,
    }, { returnErrorPayload: true })
  },
  'scene:screenshot.latest': async (_args, ctx) =>
    request(ctx, 'GET', '/api/v1/agent/screenshot/latest'),
  // Renderer-internal callback used to satisfy a pending capture request.
  'scene:screenshot.store': async (args, ctx) => request(ctx, 'POST', '/api/v1/agent/screenshot/store', objectArgs(args)),
  'scene:renderer.info': async (_args, ctx) => request(ctx, 'GET', '/api/v1/agent/renderer/info'),
  'scene:renderer.setViewMode': async (args, ctx) => request(ctx, 'PATCH', '/api/v1/agent/renderer/view-mode', objectArgs(args)),
  'scene:renderer.selectLayer': async (args, ctx) => request(ctx, 'POST', '/api/v1/agent/renderer/select-layer', objectArgs(args)),
  'scene:renderer.openAllSubLayers': async (args, ctx) => request(ctx, 'POST', '/api/v1/agent/renderer/open-all-sublayers', objectArgs(args)),
}

export default tools
