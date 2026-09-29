import { readFileSync } from 'node:fs'
import { isAbsolute, resolve as resolvePath } from 'node:path'

import { parseGeneratorContractSource, toPublicSceneDiagnostics, type SceneDiagnostic } from '@forgeax/scene-authoring'

import { resolveNarrativeLocationNames } from './resolve-narrative-names.js'
import {
  dedupeRead,
  noteAuthoringMutation,
  READ_DEDUPE_NEXT_ACTION,
} from './scene-script/agent/readDedupe.js'
import { resolveCanonicalEntryFile } from './scene-script/persist/store.js'
import {
  EXECUTE_SUMMARY_CHANNEL_HOWTOFIX,
  SCENE_EXECUTE_SUMMARY_CHANNEL,
  parseSceneBackendPayload,
} from './execute-summary-channel.js'
import { ensureSceneBackend } from './ensure-host-backend.js'
import { formatExecuteVerificationFailure } from './execute-verification.js'

export { formatExecuteVerificationFailure, type ExecuteSummaryVerification } from './execute-verification.js'

const backendReady = ensureSceneBackend()

type Caller = {
  kind: 'user' | 'ai' | 'skill' | 'extension' | 'cli'
  sessionId?: string
  threadId?: string
  agentId?: string
  extensionId?: string
}

type ToolCtx = {
  caller: Caller
  toolId: string
  env: Record<string, string | undefined>
  cwd: string
}

type ToolHandler = (args: unknown, ctx: ToolCtx) => Promise<unknown>

const PLUGIN_ID = '@forgeax/scene-generator-composition'
const DEFAULT_BACKEND_URL = 'http://127.0.0.1:9557'

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

function devPortsFile(env: Record<string, string | undefined>): string | undefined {
  return env.FORGEAX_EXTENSION_DEV_PORTS_FILE || env.FORGEAX_PLUGIN_DEV_PORTS_FILE
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
  return backendUrlFromOverrides(devPortsFile(ctx.env), PLUGIN_ID) ?? DEFAULT_BACKEND_URL
}

function sceneCallerHeaders(ctx: ToolCtx, hasBody: boolean): Record<string, string> {
  const headers: Record<string, string> = { 'x-forgeax-caller-kind': ctx.caller.kind }
  if (hasBody) headers['content-type'] = 'application/json'
  if (ctx.caller.agentId) headers['x-forgeax-caller-agent-id'] = ctx.caller.agentId
  if (ctx.caller.sessionId) headers['x-forgeax-caller-session-id'] = ctx.caller.sessionId
  if (ctx.caller.extensionId) headers['x-forgeax-caller-extension-id'] = ctx.caller.extensionId
  return headers
}

async function sceneRawFetch(
  ctx: ToolCtx,
  method: string,
  path: string,
  body: unknown,
): Promise<{ res: Response; payload: unknown; text: string }> {
  await backendReady
  const res = await fetch(`${backendBaseUrl(ctx)}${path}`, {
    method,
    headers: sceneCallerHeaders(ctx, body !== undefined),
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  const payload = parseSceneBackendPayload(text)
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
  const topDiagnostics = Array.isArray(input.diagnostics) ? input.diagnostics : []
  const execDiagnostics = Array.isArray(executionRecord?.diagnostics) ? executionRecord.diagnostics : []
  const mergedDiagnostics = toPublicSceneDiagnostics([
    ...(topDiagnostics as SceneDiagnostic[]),
    ...(execDiagnostics as SceneDiagnostic[]),
  ])
  return {
    ...bounded,
    ...(mergedDiagnostics.length > 0 ? { diagnostics: mergedDiagnostics } : {}),
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
            ...(!bounded.verification && executionRecord.verification ? { verification: executionRecord.verification } : {}),
            ...(executionRecord.spatialTelemetry ? { spatialTelemetry: executionRecord.spatialTelemetry } : {}),
            ...(Array.isArray(executionRecord.diagnostics) && executionRecord.diagnostics.length > 0
              ? { diagnostics: executionRecord.diagnostics }
              : {}),
            ...(!bounded.sync && executionRecord.sync ? { sync: executionRecord.sync } : {}),
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

export function generateGeneratorOutline(source: string, file: string): string {
  try {
    const parsed = parseGeneratorContractSource(source, file)
    const lines: string[] = [`// [Outline Mode: ${file}]`]
    if (parsed.exports.length === 0) {
      return `// [Outline Mode: ${file}]\n// No defineGenerator exports found.\n`
    }
    for (const exp of parsed.exports) {
      const inputs = Object.entries(exp.meta.inputs).map(([k, v]) => `${k}: '${v.type}'`).join(', ')
      const outputs = Object.entries(exp.meta.outputs).map(([k, v]) => `${k}: '${v.type}'`).join(', ')
      lines.push(`export const ${exp.exportName} = defineGenerator({`)
      if (exp.meta.id) lines.push(`  id: '${exp.meta.id}',`)
      if (exp.meta.description) lines.push(`  description: '${exp.meta.description}',`)
      lines.push(`  inputs: { ${inputs} },`)
      lines.push(`  outputs: { ${outputs} },`)
      lines.push(`  // run(ctx, args) { /* ... implementation omitted in outline mode ... */ }`)
      lines.push(`})`)
    }
    return lines.join('\n')
  } catch {
    return `// [Outline Mode: ${file}]\n` + source.slice(0, 300) + '\n// ...'
  }
}

export function summarizeSceneScriptSource(
  payload: unknown,
  ifRevision?: unknown,
  options?: { mode?: 'outline' | 'signatures' | 'full' },
): unknown {
  if (!payload || typeof payload !== 'object') return payload
  const module = payload as Record<string, unknown>
  const state = module.state && typeof module.state === 'object'
    ? module.state as Record<string, unknown>
    : null
  const projectRevision = typeof module.projectRevision === 'string'
    ? module.projectRevision
    : typeof state?.projectRevision === 'string'
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

  const isOutlineMode = options?.mode === 'outline' || options?.mode === 'signatures'
  let deliveredSource = module.source
  if (isOutlineMode && typeof file === 'string' && typeof module.source === 'string') {
    if (file.endsWith('.generator.ts')) {
      deliveredSource = generateGeneratorOutline(module.source, file)
    } else if (file.endsWith('.scene.ts')) {
      deliveredSource = `// [Outline Mode: ${file}]\n` + outline.map((o) => `// ${o.functionName} (${o.statementId})`).join('\n')
    }
  }

  const compact: Record<string, unknown> = {
    file,
    revision,
    projectRevision,
    exists: module.exists,
    unchanged: false,
    source: deliveredSource,
    ...(isOutlineMode ? { mode: 'outline' } : {}),
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
    payload: isOutlineMode ? 'compact-source-outline' : 'compact-source-no-runtime-graph',
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

export const SINO_STARTER_PRIMITIVE_GUIDANCE = {
  overview: 'Write Scene Script against operating geometry. First-batch library is point2d, point3d, basePlane, polyline2d, spline2d, polygon2d, network2d, polyline3d, spline3d, polygon3d, network3d, geometryMask, createGrid, gridFill, gridGradient, gridDiamondSquare, gridMidpoint, hashNoise, valueNoise, valueCubicNoise, perlinNoise, openSimplex2Noise, openSimplex2sNoise, cellularNoise, then Grid math gridAdd / gridBlur / gridDilate / gridErodeMorph / gridSlope / gridThreshold (also gridSub, gridMul, gridMin, gridMax, gridLerp, gridChoose, gridMaskDiff, gridMaskUnion, gridAbs, gridNeg, gridClamp, gridRemap, gridSmoothstep, gridQuantize, gridSharpen, gridMedian, gridNeighborhoodMin, gridNeighborhoodMax, gridOpen, gridClose, gridMajority, gridOutline, gridAspect, gridCurvature, gridRangeSelect, gridEdge, gridBBox, gridComponents, gridZonalMean, gridStats, gridDistance, gridResize), then heightfield, heightfieldExplode, heightfieldSetMask, heightfieldMesh, box / transform / placeOnGround / liftToSurface / surfaceBand, emptyScene / sceneNode / addChild / sceneOutput. Same-lattice Grid math; radius is cells (convert metres before the call); gridSlope is Δvalue/cell; gridDistance is cells (unreachable 1e9); gridStats + gridRemap is normalize; gridComponents writes integer ids; gridZonalMean leaves zone 0; gridResize aligns lattices; noise frequency is index-space; geometryMask width/feather are metres. gridErodeMorph is surface morph, not hydro. A street or building is a .scene.ts that consumes operating Geometry, not a platform road tool. geometryMask burns that Geometry onto plane + columns + rows as a 0–1 Grid. heightfieldSetMask replaces packet.mask only. heightfieldMesh weaves plane + height into Geometry kind mesh with UVs matching sampleHeight; hang it with sceneNode. box is a local mesh; placeOnGround sits it on the Heightfield. liftToSurface vertically lifts 2D operating Geometry. surfaceBand constructs a Minkowski corridor (own stadium/disk mesh sat on the surface). sampleHeight / sampleSurface are queries, not graph nodes. sceneNode hangs mesh or voxel. Grid is a script value. Heightfield is a packet, not scene content. Persist .scene.ts. Do not call composeHeightfield, subPlane, fieldComposite, meshNode, voxelNode, meshSceneNode, grid2node, or numberValue.',
  primitives: [
    { name: 'point2d', signature: 'point2d({ x, y })', role: 'Plan site in authoring metres. Defaults to (0, 0). Geometry kind point2d; Default draws an X. Not hangable.' },
    { name: 'point3d', signature: 'point3d({ x, y, z })', role: 'World site in authoring metres. Geometry kind point3d; Default draws a fuchsia X at authored Z and does not re-drape. Not hangable.' },
    { name: 'basePlane', signature: 'basePlane({ origin, width, height })', role: 'World-metre frame. origin is the top-left corner and defaults to [0, 0]. No grid, no cellSize, no parent.' },
    { name: 'geometryMask', signature: 'geometryMask({ plane, geometry, columns, rows, width?, feather? })', role: 'Burn operating Geometry onto plane + columns + rows as a 0–1 Grid. Width and feather are metres on this call, not on the Geometry. Combine with gridMul / gridLerp; bind with heightfield({ mask }). Not a Heightfield op.' },
    { name: 'createGrid', signature: 'createGrid({ columns, rows, fill })', role: 'Valued number[][]. No Geometry. Bind later with heightfield. Flatten to a named const; do not nest .grid in another call.' },
    { name: 'gridFill', signature: 'gridFill({ grid, fill })', role: 'Rewrite every cell of an existing Grid. Shape stays the same.' },
    { name: 'gridGradient', signature: 'gridGradient({ columns, rows, kind })', role: 'Row, column, or radial ramp in index space (0–1). Not world metres.' },
    { name: 'gridDiamondSquare', signature: 'gridDiamondSquare({ power, roughness, seed })', role: 'Fractal first table. Side length 2^power+1. Values 0–1.' },
    { name: 'gridMidpoint', signature: 'gridMidpoint({ power, roughness, seed })', role: 'Midpoint-displacement first table. Same lattice as diamond-square.' },
    { name: 'hashNoise', signature: 'hashNoise({ columns, rows, seed, scale })', role: 'Coordinate-hash first table. scale is index-space frequency. No fractal, no mask.' },
    { name: 'valueNoise', signature: 'valueNoise({ columns, rows, frequency, fractal, seed })', role: 'Value-noise first table. Frequency and offset are index-space. No mask.' },
    { name: 'valueCubicNoise', signature: 'valueCubicNoise({ columns, rows, frequency, fractal, seed })', role: 'Smoother value-cubic first table. Same sampled ports as Perlin.' },
    { name: 'perlinNoise', signature: 'perlinNoise({ columns, rows, frequency, fractal, seed })', role: 'Perlin first table. Call perlinNoise(...), not gridNoise.perlin. Mountain presets stay in .generator.ts.' },
    { name: 'openSimplex2Noise', signature: 'openSimplex2Noise({ columns, rows, frequency, fractal, seed })', role: 'OpenSimplex2 first table. Same sampled ports as Perlin.' },
    { name: 'openSimplex2sNoise', signature: 'openSimplex2sNoise({ columns, rows, frequency, fractal, seed })', role: 'Smoother OpenSimplex2S first table. Same sampled ports as Perlin.' },
    { name: 'cellularNoise', signature: 'cellularNoise({ columns, rows, frequency, distanceFunction, returnType, jitter, seed })', role: 'Cellular / Worley first table. Extra ports stay on this battery. Not a CA step.' },
    { name: 'gridAdd', signature: 'gridAdd({ a, b?, value?, mask? })', role: 'Same-lattice add. b is a Grid; value is a number. Script may still pass a number as b. Optional mask writeback is lerp. Also gridSub / gridMul / gridMin / gridMax / gridLerp / gridClamp / gridRemap.' },
    { name: 'gridBlur', signature: 'gridBlur({ grid, radius, kind })', role: 'Box or gaussian blur. Radius is cells, 1–16, not metres. Convert metres before the call. Also gridSharpen / gridMedian / gridNeighborhoodMin / gridNeighborhoodMax.' },
    { name: 'gridDilate', signature: 'gridDilate({ grid, radius, connectivity? })', role: 'Morphological max. Radius is cells, not metres. connectivity 4 or 8, default 8. Also gridOpen / gridClose / gridMajority / gridOutline.' },
    { name: 'gridErodeMorph', signature: 'gridErodeMorph({ grid, radius, connectivity? })', role: 'Surface morph min. Radius is cells. Never erodeGrid; hydro stays in .generator.ts.' },
    { name: 'gridSlope', signature: 'gridSlope({ grid })', role: 'Hypot of cell deltas (Δvalue/cell). Also gridAspect / gridCurvature / gridEdge. Not degrees-per-metre.' },
    { name: 'gridThreshold', signature: 'gridThreshold({ grid, value })', role: '0/1 mask at value. Also gridRangeSelect / gridChoose / gridBBox (bbox returns numbers).' },
    { name: 'gridComponents', signature: 'gridComponents({ grid, connectivity? })', role: 'Integer zone ids for connected nonzero cells. Background stays 0. One Grid, not a list. Default connectivity 8.' },
    { name: 'gridZonalMean', signature: 'gridZonalMean({ grid, zones })', role: 'Replace each cell with the mean of its zone. Zone 0 is left unchanged. Same lattice or { error }.' },
    { name: 'gridStats', signature: 'gridStats({ grid, mask? })', role: 'Returns { min, max, mean, sum, count, coverage }. Optional mask counts only mask>0. Multi-output numbers, not a Grid.' },
    { name: 'gridDistance', signature: 'gridDistance({ seeds, mask?, connectivity? })', role: 'Cell distance to nearest nonzero seed. Optional mask is a wall where mask<=0. Unreachable is 1e9. Distance is cells, not metres.' },
    { name: 'gridResize', signature: 'gridResize({ grid, columns, rows, mode? })', role: 'Change lattice size. Default bilinear; also nearest. Align tables before Arith.' },
    { name: 'heightfield', signature: 'heightfield({ geometry, height, mask?, attributes? })', role: 'Bind a plane to a height Grid. Packet is region + lattice + height + mask (default ones) + a dict of named attribute Grids. Stretch metrics lift as SCENE_GRID_STRETCH. Not a mesh.' },
    { name: 'heightfieldExplode', signature: 'heightfieldExplode({ heightfield })', role: 'Unpack the packet into geometry, columns, rows, height, mask, and a dict of named attribute Grids.' },
    { name: 'heightfieldSetMask', signature: 'heightfieldSetMask({ heightfield, mask })', role: 'Replace packet.mask only. Same lattice or { error }. Keeps geometry, height, and attributes. Default paints a red halo when mask is not all 1s.' },
    { name: 'heightfieldMesh', signature: 'heightfieldMesh({ heightfield })', role: 'Weave packet plane + height into Geometry kind mesh. Mask does not punch holes. Hang with sceneNode, then sceneOutput.' },
    { name: 'box', signature: 'box({ width, depth, height })', role: 'Local hangable mesh. Origin is the floor-centre contact. width +X, depth +Y, height +Z. Pose with transform or placeOnGround.' },
    { name: 'transform', signature: 'transform({ geometry, x, y, z, yaw?, scale? })', role: 'Move a local hangable mesh so its origin sits at (x, y, z). Yaw is radians about +Z. z is not terrain height unless you sampled it.' },
    { name: 'placeOnGround', signature: 'placeOnGround({ geometry, heightfield, x, y, yaw?, offset? })', role: 'Sit the mesh AABB floor on the same Heightfield sampleHeight reads. Keep upright. Scatter loops should call sampleHeight instead.' },
    { name: 'liftToSurface', signature: 'liftToSurface({ geometry, surface })', role: 'Vertical lift of 2D operating Geometry onto a Heightfield. Matching 3D kind. Network node indices stay. sampleSurface is the unrecorded query.' },
    { name: 'surfaceBand', signature: 'surfaceBand({ mesh, geometry, width, widths?, metric?, offset? })', role: 'Minkowski band of a 3D skeleton on a hangable mesh. Width is metres on this call. Constructs its own stadium/disk mesh, then sits vertices on the surface. geodesic or plan. Not a road kind.' },
    { name: 'emptyScene', signature: 'emptyScene()', role: 'Empty SceneTree root. Graft SceneTree children with addChild.' },
    { name: 'sceneNode', signature: 'sceneNode({ name, geometry, structure?, part? })', role: 'One-node SceneTree from Geometry. kind mesh or voxel. structure/part annotate consuming modules (road pavement) so authoring can find them. Plane is operating geometry, not scene content.' },
    { name: 'addChild', signature: 'addChild({ scene, nodes })', role: 'Graft any SceneTree under parent.focus. Named focus is one node; unnamed root grafts its children.' },
    { name: 'sceneOutput', signature: 'sceneOutput({ scene })', role: 'Assemble the complete SceneTree in main.scene.ts. Nested modules export trees; they do not each call this.' },
  ],
  generatorExample: `// generators/roll-hills.generator.ts
import { defineGenerator } from '@forgeax/scene'

export const rollHills = defineGenerator({
  id: 'roll-hills',
  inputs: { grid: { type: 'Grid', runtimeType: 'grid' }, peak: { type: 'NumberValue', defaultValue: 22 } },
  outputs: { grid: { type: 'Grid', runtimeType: 'grid' } },
  run(_ctx, args) {
    return { grid: args.grid }
  }
})`,
  sceneExample: `// main.scene.ts
import { addChild, basePlane, createGrid, emptyScene, heightfield, heightfieldMesh, sceneNode, sceneOutput } from '@forgeax/scene'
import { rollHills } from "./generators/roll-hills.generator.ts"

const world = basePlane({ origin: [0, 0], width: 120, height: 80 })
const seed = createGrid({ columns: 48, rows: 32, fill: 6 })
const hills = rollHills({ grid: seed, peak: 22 })
const field = heightfield({ geometry: world, height: hills.grid })
const mesh = heightfieldMesh({ heightfield: field })
const terrain = sceneNode({ name: 'hills', geometry: mesh })
sceneOutput({ scene: addChild({ scene: emptyScene(), nodes: [terrain.scene] }).scene })`,
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
    starterGuide: SINO_STARTER_PRIMITIVE_GUIDANCE,
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

function normalizeFileWrites(raw: unknown): Array<{ file: string; source: string }> {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => {
    if (!item || typeof item !== 'object') return item
    const rec = item as Record<string, unknown>
    const file = typeof rec.file === 'string' ? rec.file : typeof rec.path === 'string' ? rec.path : ''
    const source = typeof rec.source === 'string' ? rec.source : typeof rec.content === 'string' ? rec.content : ''
    return { file, source }
  }).filter((item): item is { file: string; source: string } => Boolean(item && item.file))
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
    const summary = summarizeProjectOpen(opened, {
      projectId: id,
      projectRevision: typeof infoRecord.projectRevision === 'string'
        ? infoRecord.projectRevision
        : undefined,
      canonicalModule: typeof infoRecord.canonicalModule === 'string' ? infoRecord.canonicalModule : undefined,
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
    if (ctx.caller.kind === 'ai') {
      return {
        status: 'rejected',
        code: 'contracts-not-an-ai-tool',
        reason: 'Do not start with the contract catalog. Commit the actual design: basePlane → createGrid / project-local Generator → heightfield → heightfieldExplode. Heightfield is a packet, not a mesh.',
      }
    }
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
    return request(
      ctx,
      'GET',
      `${projectPath(projectId, '/scene-script/contracts')}${query({
        audience: 'sino',
        mode,
        functionNames: functionNames.length ? functionNames.join(',') : undefined,
      })}`,
    )
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
    const mode = (body.mode === 'outline' || body.mode === 'signatures') ? 'outline' : 'full'
    const compact = summarizeSceneScriptSource(source, body.ifRevision, { mode })
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
      extra: `${file}:${mode}`,
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
  'scene:script.draft': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    const files = normalizeFileWrites(body.files)
    const draft = await request(ctx, 'POST', projectPath(projectId, '/scene-script/draft'), {
      draftId: body.draftId,
      generation: body.generation,
      files,
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
    const files = normalizeFileWrites(body.files)
    const patches = Array.isArray(body.patches) ? body.patches : undefined
    const commit = await request(ctx, 'POST', projectPath(projectId, '/scene-script/commit'), {
      files,
      patches,
      entryFile: body.entryFile,
      expectedProjectRevision: body.expectedProjectRevision,
      expectedRevision: body.expectedRevision,
      canonicalize: body.canonicalize,
      label: body.label,
      clean: body.clean,
      deleteFiles: body.deleteFiles,
    }, { returnErrorPayload: true })
    const committed = commit && typeof commit === 'object' ? commit as Record<string, unknown> : {}
    if (committed.status === 'rejected' || typeof committed.httpStatus === 'number') {
      return boundedSceneScriptMutationResult(committed)
    }
    if (ctx.caller.kind === 'ai') noteAuthoringMutation(ctx.caller, projectId)
    const revision = typeof committed.projectRevision === 'string'
      ? committed.projectRevision
      : typeof committed.revision === 'string' ? committed.revision : undefined
    let executed: Record<string, unknown> = {}
    try {
      const execution = await request(
        ctx,
        'POST',
        projectPath(projectId, '/execute/summary'),
        { quietErrors: true },
        { returnErrorPayload: true },
      )
      executed = execution && typeof execution === 'object' ? execution as Record<string, unknown> : {}
    } catch (error) {
      executed = {
        httpStatus: 500,
        code: SCENE_EXECUTE_SUMMARY_CHANNEL,
        status: 'channel-error',
        error: error instanceof Error ? error.message : String(error),
      }
    }
    const channelHttp = typeof executed.httpStatus === 'number' ? executed.httpStatus : 0
    const channelFailed = channelHttp >= 500 || executed.code === SCENE_EXECUTE_SUMMARY_CHANNEL
    return boundedSceneScriptMutationResult({
      ...committed,
      executedRevision: executed.executedRevision ?? revision,
      executionId: executed.executionId,
      executionStatus: channelFailed && executed.status !== 'completed' ? 'channel-error' : executed.status,
      verification: executed.verification,
      evidenceAligned: executed.evidenceAligned,
      sync: executed.sync,
      ...(executed.telemetry ? { telemetry: executed.telemetry } : executed.spatialTelemetry ? { telemetry: executed.spatialTelemetry } : {}),
      ...(channelFailed
        ? {
            executionChannel: {
              ok: false,
              httpStatus: channelHttp || 500,
              code: SCENE_EXECUTE_SUMMARY_CHANNEL,
              howToFix: [...EXECUTE_SUMMARY_CHANNEL_HOWTOFIX],
            },
          }
        : {}),
      execution: executed,
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
        symbol: body.symbol,
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
  // Strip inline-image fields so the catalog is always clean text (see
  // `stripBatteryIcon` / `stripInlineImages` above).
  // Full battery catalog — human/authoring only (exposedToAI:false).
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
        }
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
  'scene:export.glb': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    const forward: Record<string, unknown> = {}
    if (typeof body.name === 'string') forward.name = body.name
    if (typeof body.gameSlug === 'string') forward.gameSlug = body.gameSlug
    if (typeof body.destDir === 'string') forward.destDir = body.destDir
    if (typeof body.sceneName === 'string') forward.sceneName = body.sceneName
    return request(ctx, 'POST', projectPath(projectId, '/export/glb'), forward)
  },
  'scene:sceneExport.glb': async (args, ctx) => {
    return tools['scene:export.glb'](args, ctx)
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
  // asset2d:publishToGame) so the scene authoring reads it as an asset source —
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
    return request(ctx, 'POST', '/api/v1/library/publish-external', objectArgs(args))
  },
  // Capture returns a bounded file reference rather than base64, so visual
  // verification does not inflate the agent context.
  'scene:screenshot.capture': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    const timeout = typeof body.timeout === 'number' ? body.timeout : Number(body.timeout) || 12000
    let result = await request(ctx, 'POST', '/api/v1/agent/screenshot/capture', {
      projectId,
      timeout,
    }, { returnErrorPayload: true })
    if (result && typeof result === 'object') {
      const err = result as { error?: string; httpStatus?: number; code?: string; enabled?: boolean }
      // If screenshot capability is disabled by user, return immediately without retries
      if (err.code === 'screenshot-disabled' || err.enabled === false) {
        return result
      }
      // If capture timed out on cold-start (e.g. 504), perform internal auto-heal retry
      // so transient renderer frame delays do not surface as false-positive blockers to the agent.
      if (err.httpStatus === 504 || (typeof err.error === 'string' && err.error.includes('timeout'))) {
        await new Promise((r) => setTimeout(r, 600))
        result = await request(ctx, 'POST', '/api/v1/agent/screenshot/capture', {
          projectId,
          timeout: Math.max(timeout, 15000),
        }, { returnErrorPayload: true })
      }
    }
    return result
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

/* ------------------------------------------------------------------------- *
 * Extension Host adapter
 *
 * Two runtimes invoke these handlers with the arguments in opposite order:
 *
 *   orchestrator registry -> handler(args, registryToolCtx)
 *   Extension Host        -> handler(extensionContext, args)
 *
 * The Host context carries gameId / gameRoot / files / media, not the
 * registry's caller / toolId / env / cwd, so a raw Host call would put the
 * args object where `ctx` is expected and every `ctx.env` read would throw.
 * Keep the named `tools` export as the args-first registry API (also used by
 * the unit tests) and expose the Host convention through the default export,
 * detecting which runtime is calling at this single boundary. Mirrors the
 * same adapter in @forgeax-extension/character-3d.
 * ------------------------------------------------------------------------- */

const EXTENSION_ID = '@forgeax-extension/scene-generator'

type HostToolHandler = (context: unknown, args: unknown) => Promise<unknown>

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** The registry hands us a fully formed ToolCtx; the Host never does. */
function isRegistryToolCtx(value: unknown): value is ToolCtx {
  if (!isPlainRecord(value)) return false
  return typeof value.toolId === 'string'
    && typeof value.cwd === 'string'
    && isPlainRecord(value.caller)
    && typeof (value.caller as Record<string, unknown>).kind === 'string'
}

/** Synthesize the registry ToolCtx the handlers expect from a Host context. */
function toolCtxFromHostContext(toolId: string): ToolCtx {
  return {
    caller: { kind: 'extension', extensionId: EXTENSION_ID },
    toolId,
    env: process.env,
    cwd: process.cwd(),
  }
}

/**
 * The Host owns the authoritative game scope outside the tool arguments, while
 * these handlers read the project from `args.projectId`. Fill it in when the
 * caller omitted it; never override an explicit argument, so registry
 * semantics stay byte-identical.
 */
function hostScopedArgs(context: unknown, args: unknown): unknown {
  if (!isPlainRecord(context)) return args
  const gameId = typeof context.gameId === 'string' ? context.gameId.trim() : ''
  if (!gameId) return args
  const record = isPlainRecord(args) ? args : {}
  if (typeof record.projectId === 'string' && record.projectId.trim()) return args
  return { ...record, projectId: gameId }
}

function adaptToolHandler(toolId: string, handler: ToolHandler): HostToolHandler & ToolHandler {
  return function adapted(first?: unknown, second?: unknown) {
    // Registry convention: (args, ctx).
    if (isRegistryToolCtx(second)) return handler(first, second)
    // Single-argument direct call: args only, no context.
    if (arguments.length < 2) return handler(first, toolCtxFromHostContext(toolId))
    // Host convention: (context, args).
    return handler(hostScopedArgs(first, second), toolCtxFromHostContext(toolId))
  } as HostToolHandler & ToolHandler
}

const extensionHostTools = Object.fromEntries(
  Object.entries(tools).map(([id, handler]) => [id, adaptToolHandler(id, handler)]),
) as Record<string, HostToolHandler & ToolHandler>

export default { tools: extensionHostTools }
