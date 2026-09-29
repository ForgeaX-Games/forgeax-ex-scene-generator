import {
  hydrateBlobRefs,
  type ActivateProjectResult,
  type ApiClient,
  type CreateProjectRequest,
  type GroupTemplateBattery,
} from '@forgeax/node-runtime-react'
import type {
  ApplyBatchOptions,
  ApplyBatchResult,
  AssetDeletePolicy,
  ExecutionResult,
  GraphEdge,
  GraphNode,
  HistoryEntryV1,
  HistoryQuery,
  ImportPipelineExecuteOptions,
  ImportPipelineResponse,
  ImportTemplate,
  NodeFilter,
  NodeGroup,
  Op,
  OpSpec,
  PipelineSnapshot,
  ProjectMeta,
  ProjectRecord,
  RuntimeChannel,
  RuntimeEvent,
  WorkspaceState,
} from '@forgeax/node-runtime'

import { readOutputBatch, readPagedOutput } from './outputPages'
import { syncTraceEnabled } from '../debug/syncTrace.js'
import { pluginBasePath, pluginWsUrl } from './pluginHttp'

type Listener = (e: RuntimeEvent) => void

export interface HttpApiClientOptions {
  baseUrl?: string
  pipelineId: string
  /** Pin an embedded surface to one project without mutating workspace.viewingProjectId. */
  projectId?: string
}

export interface HttpApiErrorPayload {
  code?: string
  message?: string
  reason?: string
  retryable?: boolean
  diagnostics?: SceneScriptDiagnostic[]
}

export class HttpApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly payload: HttpApiErrorPayload | null,
  ) {
    super(payload?.message ?? payload?.reason ?? `${path} → ${status}`)
    this.name = 'HttpApiRequestError'
  }

  get code(): string | undefined {
    return this.payload?.code
  }

  get retryable(): boolean {
    return this.payload?.retryable === true
  }
}

async function httpError(response: Response, path: string): Promise<HttpApiRequestError> {
  const payload = (await response.json().catch(() => null)) as HttpApiErrorPayload | null
  return new HttpApiRequestError(response.status, path, payload)
}

export interface SceneScriptPortContract {
  name: string
  type: string
  access?: 'item' | 'list'
  required?: boolean
  defaultValue?: unknown
  runtimePort?: string
  description?: string
  label?: string
  hidden?: boolean
  order?: number
  options?: string[]
  mode?: 'value' | 'parameter'
  control?: boolean
}

export interface SceneScriptFunctionContract {
  functionName: string
  kind: 'atomic' | 'native-group' | 'compound'
  contractVersion: string
  opId?: string
  description: string
  inputs: SceneScriptPortContract[]
  outputs: SceneScriptPortContract[]
}

export interface SceneScriptContractsResponse {
  version: string
  functions: SceneScriptFunctionContract[]
}

export interface SceneScriptSourceRange {
  file: string
  start: number
  end: number
  line: number
  column: number
  endLine?: number
  endColumn?: number
  statementId?: string
}

export interface SceneScriptDiagnosticFix {
  fixId: string
  title: string
  edits: Array<
    | {
        type: 'ReplaceReference'
        statementId: string
        argument: string
        sourceStatementId: string
        sourceOutput?: string
      }
    | {
        type: 'ReplaceSource'
        file: string
        start: number
        end: number
        text: string
      }
  >
}

export interface SceneScriptTransaction {
  applied: boolean
  rolledBack: boolean
  undoToken?: string
}

export interface SceneScriptDiagnostic {
  code: string
  phase: 'parse' | 'type' | 'resolve' | 'compile' | 'execute' | 'verify' | 'platform' | 'capability'
  severity: 'error' | 'warning' | 'info'
  title?: string
  message: string
  source?: SceneScriptSourceRange
  graph?: {
    authoringNodeId?: string
    runtimeNodeIds?: string[]
    runtimeEdgeIds?: string[]
    sceneNodeIds?: string[]
  }
  expected?: unknown
  actual?: unknown
  fixes?: SceneScriptDiagnosticFix[]
  transaction?: SceneScriptTransaction
  retryable?: boolean
  escalation?: 'none' | 'compiler' | 'battery' | 'platform'
  debugAttachment?: string
  statementId?: string
}

export function limitSceneScriptDiagnostics(
  diagnostics: readonly SceneScriptDiagnostic[] | undefined,
): SceneScriptDiagnostic[] {
  if (!diagnostics?.length) return []
  const primary = diagnostics.findIndex((item) => item.severity === 'error')
  const ordered = primary > 0
    ? [diagnostics[primary], ...diagnostics.slice(0, primary), ...diagnostics.slice(primary + 1)]
    : [...diagnostics]
  return ordered.slice(0, 3).map((item) => ({
    ...item,
    ...(item.fixes ? { fixes: item.fixes.slice(0, 3) } : {}),
  }))
}

export interface SceneScriptSourceMapEntry {
  moduleId?: string
  file?: string
  statementId: string
  source: SceneScriptSourceRange
  entityId: string
  runtimeNodeIds: string[]
  runtimeEdgeIds?: string[]
  runtimeOrigins?: Record<string, string>
  definitionId?: string
  definitionVersion?: string
  instancePath?: string
}

export interface SceneResultLineage {
  lineageId: string
  runtime: { nodeId: string; port: string; edgeIds?: string[] }
  authoring: {
    moduleId: string
    file: string
    statementId: string
    entityId: string
    source: SceneScriptSourceRange
    definitionId?: string
    definitionVersion?: string
    instancePath?: string
    runtimeOrigin?: string
  }
  sceneNodes: Array<{ id: string; path: string; graphIndex?: number }>
  bakedLayers: Array<{
    id: string
    path: string
    sourceSceneNodeId?: string
    sourceScenePath?: string
    cellSource?: { kind: 'scene-node-content'; ref: string }
  }>
  summary: { sceneNodeCount: number; bakedLayerCount: number; payload: 'reference-only' }
}

export interface SceneLineageResponse {
  revision: string
  count: number
  lineage: SceneResultLineage[]
  summary: { sceneNodeCount: number; bakedLayerCount: number; payload: 'reference-only' }
}

export interface SceneScriptModule {
  file: string
  source: string
  revision: string
  state: {
    schemaVersion: 1 | 2
    sourceRevision: string
    compiledGraphHash?: string
    updatedAt: string
    modules: string[]
    sourceMap: SceneScriptSourceMapEntry[]
    resultLineage?: SceneResultLineage[]
  } | null
}

export interface SceneScriptValidation {
  valid: boolean
  diagnostics: SceneScriptDiagnostic[]
  canonicalSource: string
  sourceMap?: SceneScriptSourceMapEntry[]
  entityCount?: number
  operationCount?: number
  transaction?: SceneScriptTransaction
}

export interface SceneScriptSaveResult {
  status: 'ok'
  revision: string
  projectRevision?: string
  graphHash: string
  diagnostics: SceneScriptDiagnostic[]
  sourceMap: SceneScriptSourceMapEntry[]
  canonicalSource: string
  entityCount: number
  operationCount: number
  transaction?: SceneScriptTransaction
}

export type SceneScriptDraftStatus = 'compiling' | 'visible' | 'failed'

export interface SceneScriptDraftSync {
  projectRevision?: string | null
  previewRevision?: string | null
  aligned?: boolean
  executionId?: string | null
  executionStatus?: string
  staleReasons?: string[]
}

export interface SceneScriptDraftLastGood {
  draftId?: string
  generation?: number
  previewRevision?: string | null
  projectRevision?: string | null
}

export interface SceneScriptDraftRequest {
  files: Array<{ file: string; source: string }>
  entryFile: string
  expectedProjectRevision: string
  execute: boolean
  draftId: string
  generation: number
}

export interface SceneScriptDraftResult {
  valid: boolean
  diagnostics: SceneScriptDiagnostic[]
  previewRevision?: string | null
  projectRevision?: string | null
  status: SceneScriptDraftStatus
  sync?: SceneScriptDraftSync | null
  lastGood?: SceneScriptDraftLastGood | null
}

export interface SceneScriptDraftEvent extends SceneScriptDraftResult {
  projectId?: string
  draftId: string
  generation: number
  render?: {
    graph: { nodes: GraphNode[] }
    outputs: Record<string, Record<string, unknown>>
    ops: OpSpec[]
  }
}

export interface SceneScriptCommandResult {
  status: 'ok'
  revision: string
  graphHash: string
  canonicalSource: string
  sourceMap: SceneScriptSourceMapEntry[]
  diagnostics: SceneScriptDiagnostic[]
  applied: number
  transaction?: SceneScriptTransaction
}

export interface SceneGraphSample {
  pipeline: PipelineSnapshot | null
  groups: readonly NodeGroup[]
}

export class SceneScriptRequestError extends Error {
  readonly status: number
  readonly code?: string
  readonly diagnostics: SceneScriptDiagnostic[]
  readonly expectedRevision?: string
  readonly actualRevision?: string
  readonly transaction?: SceneScriptTransaction

  constructor(
    status: number,
    payload: {
      reason?: string
      code?: string
      diagnostics?: SceneScriptDiagnostic[]
      expectedRevision?: string
      actualRevision?: string
      transaction?: SceneScriptTransaction
    } | null,
  ) {
    super(payload?.reason ?? `Scene Script request failed (HTTP ${status})`)
    this.name = 'SceneScriptRequestError'
    this.status = status
    this.code = payload?.code
    this.diagnostics = limitSceneScriptDiagnostics(payload?.diagnostics)
    this.expectedRevision = payload?.expectedRevision
    this.actualRevision = payload?.actualRevision
    this.transaction = payload?.transaction
  }
}

/**
 * Concrete ApiClient that talks to the backend bridge over fetch + WebSocket.
 *
 * Graph reactivity has a SINGLE source: the kernel bus emits `graph:applied` on
 * a committed `applyBatch` (and suppresses it for layout-only batches), the
 * backend `/ws` binding fans it out, and our socket forwards it to the 'graph'
 * listeners. This client deliberately does NOT synthesize a local `graph:applied`
 * after a batch POST — that was a redundant second source that double-fired
 * `loadPipeline` (and reset previews) on every mutation.
 */
export class HttpApiClient implements ApiClient {
  readonly pipelineId: string
  private base: string
  private viewingProjectId: string | null = null
  private ws: WebSocket | null = null
  private listeners = new Map<RuntimeChannel, Set<Listener>>()
  // Raw `/ws` broadcasts keyed by their top-level `event` name — for app-level
  // events (e.g. `baked:changed`) that ride this same socket but aren't part
  // of the kernel's typed RuntimeEvent/RuntimeChannel taxonomy. Lets callers
  // (useBakedLayers, useAliasMetas) share THIS socket via `subscribeRaw()`
  // instead of each opening its own `new WebSocket(...)` — a project switch
  // was opening 3 independent `/ws` connections from the SAME iframe.
  private rawListeners = new Map<string, Set<(payload: unknown) => void>>()
  private disposed = false
  private wsReconnectAttempts = 0
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null

  constructor(opts: HttpApiClientOptions) {
    this.pipelineId = opts.pipelineId
    this.base = opts.baseUrl || pluginBasePath()
    this.viewingProjectId = opts.projectId ?? null
  }

  /** Align client-side project routing with the server workspace (read-only). */
  syncViewingProjectId(id: string): void {
    this.viewingProjectId = id
  }

  /** Resolve the UI viewing project before project-scoped pipeline calls. */
  async ensureViewingProject(): Promise<string> {
    if (this.viewingProjectId) return this.viewingProjectId
    const ws = await this.getWorkspace()
    const id =
      ws.viewingProjectId ?? (ws as { activeProjectId?: string | null }).activeProjectId ?? null
    if (!id) {
      throw new Error('[HttpApiClient] no viewing project — call viewProject or getWorkspace first')
    }
    this.viewingProjectId = id
    return id
  }

  private effectiveProjectId(): string | null {
    return this.viewingProjectId
  }

  private projectPrefix(): string {
    const id = this.effectiveProjectId()
    if (!id) {
      throw new Error('[HttpApiClient] no viewing project — call viewProject or getWorkspace first')
    }
    return `/api/v1/projects/${encodeURIComponent(id)}`
  }

  private async get<T>(path: string): Promise<T> {
    // GETs are idempotent, so retry TRANSIENT network failures. The common
    // culprit is the HTTP keep-alive reuse race: the server closes an idle
    // pooled socket and the browser sends on it before noticing, surfacing as
    // ERR_CONNECTION_RESET / ERR_EMPTY_RESPONSE / ERR_SOCKET_NOT_CONNECTED
    // (fetch rejects with a TypeError — distinct from an HTTP !r.ok response).
    // A short backoff almost always lands on a fresh connection. We deliberately
    // do NOT retry HTTP status errors (those are real responses) and never retry
    // POST/PUT/DELETE (non-idempotent).
    const maxAttempts = 3
    let lastErr: unknown
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const r = await fetch(`${this.base}${path}`, { method: 'GET' })
        if (!r.ok) throw await httpError(r, path)
        return (await r.json()) as T
      } catch (e) {
        // Only a network-level failure (TypeError from fetch) is retryable; an
        // HTTP status Error is a genuine response and must propagate as-is.
        if (this.disposed || !(e instanceof TypeError) || attempt === maxAttempts - 1) throw e
        lastErr = e
        await new Promise((res) => setTimeout(res, 120 * (attempt + 1) + Math.random() * 80))
      }
    }
    throw lastErr
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    if (syncTraceEnabled() && (path.includes('/execute') || path.includes('/outputs/clear') || path.includes('/baked/'))) {
      console.log(`[sync-trace] api:POST ${path}`, body)
    }
    const r = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!r.ok) throw await httpError(r, path)
    return (await r.json()) as T
  }

  private async put<T>(path: string, body: unknown): Promise<T> {
    const r = await fetch(`${this.base}${path}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!r.ok) throw await httpError(r, path)
    return (await r.json()) as T
  }

  private async del<T>(path: string): Promise<T> {
    const r = await fetch(`${this.base}${path}`, { method: 'DELETE' })
    if (!r.ok) throw await httpError(r, path)
    return (await r.json()) as T
  }

  async applyBatch(ops: readonly Op[], opts?: ApplyBatchOptions): Promise<ApplyBatchResult> {
    // No local graph:applied synthesis — the backend WS forwards the kernel's
    // single graph:applied (layout-only batches emit none). See the class doc.
    return this.post<ApplyBatchResult>(`${this.projectPrefix()}/batch`, { ops, opts })
  }

  getPipeline(): Promise<PipelineSnapshot | null> {
    return this.get<PipelineSnapshot | null>(`${this.projectPrefix()}/pipeline`)
  }

  getPipelineHash(): Promise<{ hash: string | null }> {
    return this.get<{ hash: string | null }>(`${this.projectPrefix()}/pipeline/hash`)
  }

  async getSceneGraphSample(projectId?: string | null): Promise<SceneGraphSample> {
    const id = projectId ?? this.effectiveProjectId()
    if (!id) throw new Error('[HttpApiClient] no viewing project — call viewProject or getWorkspace first')
    const prefix = `/api/v1/projects/${encodeURIComponent(id)}`
    const [pipeline, groups] = await Promise.all([
      this.get<PipelineSnapshot | null>(`${prefix}/pipeline`),
      this.get<readonly NodeGroup[]>(`${prefix}/groups`),
    ])
    return { pipeline, groups }
  }

  getSceneScriptContracts(projectId?: string | null): Promise<SceneScriptContractsResponse> {
    const id = projectId ?? this.effectiveProjectId()
    if (!id) throw new Error('[HttpApiClient] no viewing project — call viewProject or getWorkspace first')
    return this.get(`/api/v1/projects/${encodeURIComponent(id)}/scene-script/contracts`)
  }

  getSceneScriptProjectInfo(projectId?: string | null): Promise<{
    projectId: string
    canonicalModule: string
    revision: string
    projectRevision?: string
    moduleCount: number
    sourceMapEntries: number
    updatedAt: string | null
    files: Array<{ path: string; kind: 'module' | 'generator' | 'helper' | 'material' | 'state' | 'layout'; bytes: number; updatedAt: string }>
  }> {
    const id = projectId ?? this.effectiveProjectId()
    if (!id) throw new Error('[HttpApiClient] no viewing project — call viewProject or getWorkspace first')
    return this.get(`/api/v1/projects/${encodeURIComponent(id)}/scene-script/project-info`)
  }

  getSceneScriptModule(file?: string, projectId?: string | null): Promise<SceneScriptModule> {
    const id = projectId ?? this.effectiveProjectId()
    if (!id) throw new Error('[HttpApiClient] no viewing project — call viewProject or getWorkspace first')
    const query = file ? `?file=${encodeURIComponent(file)}` : ''
    return this.get(`/api/v1/projects/${encodeURIComponent(id)}/scene-script${query}`)
  }

  getSceneLineage(
    query: { sceneNodeId?: string; path?: string; bakedLayerId?: string; runtimeNodeId?: string },
    projectId?: string | null,
  ): Promise<SceneLineageResponse> {
    const id = projectId ?? this.effectiveProjectId()
    if (!id) throw new Error('[HttpApiClient] no viewing project — call viewProject or getWorkspace first')
    const params = new URLSearchParams()
    if (query.sceneNodeId) params.set('sceneNodeId', query.sceneNodeId)
    if (query.path) params.set('path', query.path)
    if (query.bakedLayerId) params.set('bakedLayerId', query.bakedLayerId)
    if (query.runtimeNodeId) params.set('runtimeNodeId', query.runtimeNodeId)
    return this.get(`/api/v1/projects/${encodeURIComponent(id)}/scene-script/lens?${params}`)
  }

  async validateSceneScript(
    input: { file: string; source: string },
    projectId?: string | null,
  ): Promise<SceneScriptValidation> {
    const id = projectId ?? this.effectiveProjectId()
    if (!id) throw new Error('[HttpApiClient] no viewing project — call viewProject or getWorkspace first')
    const result = await this.sceneScriptRequest<SceneScriptValidation>(
      `/api/v1/projects/${encodeURIComponent(id)}/scene-script/validate`,
      'POST',
      input,
    )
    return result
  }

  async saveSceneScript(
    input: { file: string; source: string; expectedRevision: string; canonicalize?: boolean; label?: string },
    projectId?: string | null,
  ): Promise<SceneScriptSaveResult> {
    const id = projectId ?? this.effectiveProjectId()
    if (!id) throw new Error('[HttpApiClient] no viewing project — call viewProject or getWorkspace first')
    const result = await this.sceneScriptRequest<SceneScriptSaveResult>(
      `/api/v1/projects/${encodeURIComponent(id)}/scene-script`,
      'PUT',
      input,
    )
    return result
  }

  async executeSceneScriptDraft(
    input: SceneScriptDraftRequest,
    projectId?: string | null,
  ): Promise<SceneScriptDraftResult> {
    const id = projectId ?? this.effectiveProjectId()
    if (!id) throw new Error('[HttpApiClient] no viewing project — call viewProject or getWorkspace first')
    const result = await this.sceneScriptRequest<SceneScriptDraftResult>(
      `/api/v1/projects/${encodeURIComponent(id)}/scene-script/draft`,
      'POST',
      input,
    )
    return result
  }

  async applySceneScriptFix(
    input: { file: string; expectedRevision: string; fix: SceneScriptDiagnosticFix; label?: string },
    projectId?: string | null,
  ): Promise<SceneScriptCommandResult> {
    const id = projectId ?? this.effectiveProjectId()
    if (!id) throw new Error('[HttpApiClient] no viewing project — call viewProject or getWorkspace first')
    if (!input.fix.edits.length || input.fix.edits.some((edit) => edit.type !== 'ReplaceReference')) {
      throw new TypeError(`Scene Script fix '${input.fix.fixId}' is not safe for automatic application.`)
    }
    const commands = input.fix.edits.map((edit) => {
      if (edit.type !== 'ReplaceReference') throw new TypeError('Unsupported Scene Script fix edit.')
      return {
        type: 'connectValue' as const,
        statementId: edit.statementId,
        input: edit.argument,
        sourceStatementId: edit.sourceStatementId,
        ...(edit.sourceOutput ? { output: edit.sourceOutput } : {}),
      }
    })
    const result = await this.sceneScriptRequest<SceneScriptCommandResult>(
      `/api/v1/projects/${encodeURIComponent(id)}/scene-script/commands`,
      'POST',
      {
        file: input.file,
        expectedRevision: input.expectedRevision,
        commands,
        label: input.label ?? `Apply diagnostic fix ${input.fix.fixId}`,
      },
    )
    return result
  }

  private async sceneScriptRequest<T>(
    path: string,
    method: 'POST' | 'PUT',
    body: unknown,
  ): Promise<T> {
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const payload = (await response.json().catch(() => null)) as T | null
    if (!response.ok) {
      throw new SceneScriptRequestError(
        response.status,
        payload as {
          reason?: string
          code?: string
          diagnostics?: SceneScriptDiagnostic[]
          expectedRevision?: string
          actualRevision?: string
          transaction?: SceneScriptTransaction
        } | null,
      )
    }
    return payload as T
  }

  getNode(nodeId: string): Promise<GraphNode | null> {
    return this.get<GraphNode | null>(`${this.projectPrefix()}/nodes/${encodeURIComponent(nodeId)}`)
  }

  listNodes(_filter?: NodeFilter): Promise<readonly GraphNode[]> {
    return this.get<readonly GraphNode[]>(`${this.projectPrefix()}/nodes`)
  }

  listEdges(): Promise<readonly GraphEdge[]> {
    return this.get<readonly GraphEdge[]>(`${this.projectPrefix()}/edges`)
  }

  async getNodeOutput(nodeId: string, portId: string): Promise<unknown> {
    const path = `${this.projectPrefix()}/nodes/${encodeURIComponent(nodeId)}/outputs/${encodeURIComponent(portId)}`
    try {
      const r = await this.get<{ value: unknown; blobs?: Record<string, unknown> }>(path)
      return hydrateBlobRefs(r.value, r.blobs)
    } catch (error) {
      if (!(error instanceof HttpApiRequestError) || error.status !== 413) throw error
      return readPagedOutput(path, this.get.bind(this))
    }
  }


  getNodeOutputMeta(
    nodeId: string,
    portId: string,
  ): Promise<{ executedHash: string; valid: boolean; sharded: boolean; dataChunks?: number; missing?: boolean }> {
    return this.get(`${this.projectPrefix()}/nodes/${encodeURIComponent(nodeId)}/outputs/${encodeURIComponent(portId)}/meta`)
  }

  /** Batch read; deferred large values use bounded output pages. */
  async getNodeOutputsBatch(
    ports: ReadonlyArray<{ nodeId: string; portId: string }>,
    opts?: { metaOnly?: boolean },
  ): Promise<
    ReadonlyArray<{
      nodeId: string
      portId: string
      value?: unknown
      blobs?: Record<string, unknown>
      meta: { executedHash: string; valid: boolean; sharded: boolean; dataChunks?: number } | null
      tooLarge?: boolean
    }>
  > {
    if (ports.length === 0) return []
    const prefix = this.projectPrefix()
    const r = await this.post<{
      results: ReadonlyArray<{
        nodeId: string
        portId: string
        value?: unknown
        blobs?: Record<string, unknown>
        meta: { executedHash: string; valid: boolean; sharded: boolean; dataChunks?: number } | null
        tooLarge?: boolean
      }>
    }>(`${prefix}/nodes/outputs/batch`, {
      ports: ports.map((p) => ({ nodeId: p.nodeId, portId: p.portId })),
      metaOnly: opts?.metaOnly === true,
    })
    return readOutputBatch(r.results, prefix, this.get.bind(this), opts?.metaOnly === true)
  }

  /** Persist a deferred Grid port from the last in-memory run so Default can load it. */
  async materializeNodeOutputs(
    ports: ReadonlyArray<{ nodeId: string; portId: string }>,
  ): Promise<{ ok: true; hydrated: number }> {
    if (ports.length === 0) return { ok: true, hydrated: 0 }
    return this.post(`${this.projectPrefix()}/outputs/materialize`, { ports })
  }

  getHistory(_opts?: HistoryQuery): Promise<readonly HistoryEntryV1[]> {
    return this.get<readonly HistoryEntryV1[]>(`${this.projectPrefix()}/history`)
  }

  listOps(): Promise<readonly OpSpec[]> {
    return this.get<readonly OpSpec[]>('/api/v1/ops')
  }

  getGroup(groupId: string): Promise<NodeGroup | null> {
    return this.get<NodeGroup | null>(`${this.projectPrefix()}/groups/${encodeURIComponent(groupId)}`)
  }

  listGroups(): Promise<readonly NodeGroup[]> {
    return this.get<readonly NodeGroup[]>(`${this.projectPrefix()}/groups`)
  }

  async probeGroupInner(groupId: string): Promise<Record<string, Record<string, unknown>> | null> {
    return this.get<Record<string, Record<string, unknown>> | null>(
      `${this.projectPrefix()}/groups/${encodeURIComponent(groupId)}/probe`,
    )
  }

  async resolveAssetPath(template: string, _vars?: Record<string, string>): Promise<string> {
    return template
  }

  // ── Graph import / export (faithful "load a graph from a file") ──────────

  /** List graph templates the backend discovered under its templates dir. */
  listImportTemplates(): Promise<readonly ImportTemplate[]> {
    return this.get<readonly ImportTemplate[]>(`${this.projectPrefix()}/pipeline/templates`)
  }

  /**
   * Import a template FILE — the backend reads + applies it via the kernel
   * importPipelineGraph (single applyBatch → graph:applied → live-sync). We do
   * NOT synthesize a graph event here: the backend broadcasts graph:applied
   * over /ws, which our socket listener forwards to subscribers (the same path
   * an AI/CLI import takes), so the canvas + preview refresh live.
   */
  importPipelineFile(req: {
    path: string
    source?: string
    options?: ImportPipelineExecuteOptions
  }): Promise<ImportPipelineResponse> {
    return this.post<ImportPipelineResponse>(`${this.projectPrefix()}/pipeline/import`, {
      file: { path: req.path, source: req.source },
      options: req.options,
    })
  }

  /**
   * Import an INLINE graph (e.g. a browser-uploaded JSON file) rather than a
   * server-side template file. The backend `/pipeline/import` route accepts a
   * `{ format, graph }` body directly and runs it through the same kernel
   * importPipelineGraph → single applyBatch → graph:applied (WS) → live-sync, so
   * the canvas + preview refresh without a manual reload. `format` may be omitted
   * to let the backend `detectFormat` infer it from the graph shape.
   */
  async importPipelineInline(req: {
    format?: string
    graph: unknown
    options?: ImportPipelineExecuteOptions
  }): Promise<ImportPipelineResponse> {
    // Unlike the generic `post`, read the body even on a non-2xx so a rejected
    // import (HTTP 422 → `{ status:'rejected', reason, diagnostics }`) surfaces the
    // kernel's actual reason (e.g. "unknown opId 'foo'") instead of a bare status.
    const r = await fetch(`${this.base}${this.projectPrefix()}/pipeline/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ format: req.format, graph: req.graph, options: req.options }),
    })
    const data = (await r.json().catch(() => null)) as ImportPipelineResponse | null
    if (!r.ok || data?.status === 'rejected') {
      const detail = (data?.diagnostics ?? [])
        .map((d) => (d as { message?: string }).message)
        .filter(Boolean)
        .join('; ')
      const reason = data?.reason ?? `import failed (HTTP ${r.status})`
      throw new Error(detail ? `${reason} — ${detail}` : reason)
    }
    return data as ImportPipelineResponse
  }

  /** Export the current graph to a backend template file. */
  exportPipelineFile(req: { name?: string; source?: string }): Promise<{ path: string; name: string }> {
    return this.post<{ path: string; name: string }>(`${this.projectPrefix()}/pipeline/export`, req)
  }

  listGroupTemplates(scope: 'all' | 'groups' | 'templates' = 'all'): Promise<readonly GroupTemplateBattery[]> {
    return this.get<readonly GroupTemplateBattery[]>(`/api/v1/group-templates?scope=${scope}`)
  }

  loadGroupTemplate(
    groupId: string,
    opts?: { scope?: 'groups' | 'templates' },
  ): Promise<NodeGroup | null> {
    const scope = opts?.scope
    const suffix = scope ? `?scope=${scope}` : ''
    return this.get<NodeGroup | null>(`/api/v1/group-templates/${encodeURIComponent(groupId)}${suffix}`)
  }

  loadGroupTemplateDocs(groupId: string): Promise<{
    iconPng?: string
    usagePng?: string
    readme?: string
  } | null> {
    return this.get(`/api/v1/group-templates/${encodeURIComponent(groupId)}/docs`)
  }

  instantiateNativeDefinition(
    functionName: string,
    position: { x: number; y: number },
  ): Promise<{ status: 'ok'; entityId: string; statementId: string; revision: string; graphHash?: string }> {
    return this.post(
      `${this.projectPrefix()}/scene-script/definitions/${encodeURIComponent(functionName)}/instantiate`,
      { position },
    )
  }

  getSceneAuthoringProjectInfo(): Promise<{
    canonical: boolean
    authoringSource: 'scene-project' | 'legacy-runtime-graph'
    runtimeGraphRole: 'cache-debug-export'
    migrationRequired: boolean
    canonicalModule: string
    projectRevision: string
    moduleRevisions: Record<string, { moduleId: string; revision: string }>
  }> {
    return this.get(`${this.projectPrefix()}/scene-script/project-info`)
  }

  liftLegacySceneProject(): Promise<{
    status: 'canonical' | 'confirmation-required' | 'read-only'
    canonical: boolean
    readOnly: boolean
    confidence: 'high' | 'medium' | 'low'
    diagnostics: Array<{ entityId: string; confidence: 'high' | 'medium' | 'low'; message: string }>
    source?: string
  }> {
    return this.post(`${this.projectPrefix()}/scene-script/lift`, {})
  }

  getLegacyRawGraph(): Promise<{ readOnly: true; newProjectsAllowed: false; rawGraph: unknown }> {
    return this.get(`${this.projectPrefix()}/scene-script/raw-graph`)
  }

  generateSceneArtifact(): Promise<unknown> {
    return this.post(`${this.projectPrefix()}/scene-script/artifact`, {})
  }

  getSceneArtifact(): Promise<unknown> {
    return this.get(`${this.projectPrefix()}/scene-script/artifact`)
  }

  applySceneAuthoringCommands(req: {
    expectedProjectRevision: string
    expectedModuleRevisions?: Record<string, string>
    commands: unknown[]
    label?: string
  }): Promise<{
    status: 'ok'
    projectRevision: string
    graphHash?: string
    transaction?: { applied: boolean; rolledBack: boolean; undoToken?: string }
  }> {
    return this.post(`${this.projectPrefix()}/scene-script/commands`, req)
  }

  undoSceneAuthoring(req: { expectedProjectRevision: string }): Promise<{
    status: 'ok'
    direction: 'undo'
    projectRevision: string
    graphHash?: string
    history: { cursor: number; length: number; canUndo: boolean; canRedo: boolean }
  }> {
    return this.post(`${this.projectPrefix()}/scene-script/undo`, req)
  }

  redoSceneAuthoring(req: { expectedProjectRevision: string }): Promise<{
    status: 'ok'
    direction: 'redo'
    projectRevision: string
    graphHash?: string
    history: { cursor: number; length: number; canUndo: boolean; canRedo: boolean }
  }> {
    return this.post(`${this.projectPrefix()}/scene-script/redo`, req)
  }

  deleteUserTemplate(groupId: string): Promise<{ ok: boolean }> {
    return this.del<{ ok: boolean }>(`/api/v1/group-templates/user/${encodeURIComponent(groupId)}`)
  }

  deleteGroupTemplate(groupId: string): Promise<{ ok: boolean }> {
    return this.del<{ ok: boolean }>(`/api/v1/group-templates/groups/${encodeURIComponent(groupId)}`)
  }

  listTemplateCategories(): Promise<readonly string[]> {
    return this.get<readonly string[]>('/api/v1/group-templates/categories')
  }

  listTemplateOnlyCategories(): Promise<readonly string[]> {
    return this.get<readonly string[]>('/api/v1/group-templates/template-categories')
  }

  /** Execute the pipeline (or a single node) via the backend bridge. */
  execute(request?: { nodeId?: string; quietErrors?: boolean }): Promise<ExecutionResult> {
    return this.post(`${this.projectPrefix()}/execute`, request ?? {}) as Promise<ExecutionResult>
  }

  getRendererInfo(): Promise<{
    pane?: string
    sync?: {
      aligned?: boolean
      staleReasons?: string[]
      executionId?: string | null
      projectRevision?: string | null
      executionStatus?: string
      voxelLayers?: number
      meshLayers?: number
      gridLayers?: number
      guideLayers?: number
      viewingProjectId?: string | null
      frameDigest?: string | null
    }
  }> {
    return this.get('/api/v1/agent/renderer/info')
  }

  reportRendererStatus(report: Record<string, unknown>): Promise<unknown> {
    return this.post('/api/v1/renderer/status', report)
  }

  clearOutputCache(): Promise<{ ok: true }> {
    return this.post(`${this.projectPrefix()}/outputs/clear`, {}) as Promise<{ ok: true }>
  }

  // ── Multi-project management (thin REST over the kernel ProjectRegistry) ──

  /**
   * List projects. `opts.gameSlug` scopes to that game's projects only; omit
   * to list every project ("show all"). Mirrors the backend's `?gameSlug=`
   * query filter.
   */
  listProjects(opts?: { gameSlug?: string }): Promise<readonly ProjectMeta[]> {
    const q = opts?.gameSlug ? `?gameSlug=${encodeURIComponent(opts.gameSlug)}` : ''
    return this.get<readonly ProjectMeta[]>(`/api/v1/projects${q}`)
  }

  getProject(id: string): Promise<ProjectRecord | null> {
    return this.get<ProjectRecord | null>(`/api/v1/projects/${encodeURIComponent(id)}`)
  }

  getProjectAssetsSummary(id: string): Promise<{ producedCount: number }> {
    return this.get<{ producedCount: number }>(`/api/v1/projects/${encodeURIComponent(id)}/assets/summary`)
  }

  createProject(req: CreateProjectRequest): Promise<ProjectMeta> {
    return this.post<ProjectMeta>('/api/v1/projects', req)
  }

  updateProject(
    id: string,
    patch: { name?: string; description?: string; thumbnail?: string; type?: string; gameSlug?: string },
  ): Promise<ProjectMeta> {
    return this.put<ProjectMeta>(`/api/v1/projects/${encodeURIComponent(id)}`, patch)
  }

  deleteProject(id: string, opts?: { assetPolicy?: AssetDeletePolicy }): Promise<{ ok: true; workspace: WorkspaceState }> {
    const q = opts?.assetPolicy ? `?assetPolicy=${encodeURIComponent(opts.assetPolicy)}` : ''
    return this.del<{ ok: true; workspace: WorkspaceState }>(`/api/v1/projects/${encodeURIComponent(id)}${q}`)
  }

  /**
   * Switch the UI viewing project. Sets the client-side viewingProjectId used
   * to prefix all project-scoped pipeline routes.
   */
  async viewProject(id: string): Promise<ActivateProjectResult> {
    const res = await this.post<ActivateProjectResult>(`/api/v1/projects/${encodeURIComponent(id)}/view`, {})
    this.viewingProjectId = id
    return res
  }

  /** @deprecated Use viewProject(). */
  activateProject(id: string): Promise<ActivateProjectResult> {
    return this.viewProject(id)
  }

  getProjectLock(id: string): Promise<{ lock: { agentId: string; kind: string; acquiredAt: string; sessionId?: string } | null }> {
    return this.get(`/api/v1/projects/${encodeURIComponent(id)}/lock`)
  }

  listWorkspaceLocks(): Promise<{ locks: readonly { projectId: string; agentId: string; kind: string; acquiredAt: string; sessionId?: string }[] }> {
    return this.get('/api/v1/workspace/locks')
  }

  async getWorkspace(): Promise<WorkspaceState> {
    const ws = await this.get<WorkspaceState>('/api/v1/workspace')
    // Cold start only: adopt the workspace's viewing project when this client
    // has no routing id yet. It must NEVER *re-point* an established one —
    // any poll/refresh would otherwise silently redirect every subsequent
    // write to whatever project the workspace currently views while THIS
    // document's canvas still holds another project's graph, landing edits in
    // the wrong project (observed: a brand-new project receiving the previous
    // project's nodes). Re-pointing goes through viewProject() /
    // syncViewingProjectId(), which the open cascade calls explicitly.
    if (!this.viewingProjectId) {
      const id = ws.viewingProjectId ?? (ws as { activeProjectId?: string | null }).activeProjectId
      if (id) this.viewingProjectId = id
    }
    return ws
  }

  setWorkspace(patch: Partial<WorkspaceState>): Promise<WorkspaceState> {
    return this.put<WorkspaceState>('/api/v1/workspace', patch)
  }

  subscribe(channel: RuntimeChannel, listener: (e: RuntimeEvent) => void): () => void {
    if (!this.listeners.has(channel)) this.listeners.set(channel, new Set())
    this.listeners.get(channel)!.add(listener)
    this.ensureSocket()
    return () => {
      const set = this.listeners.get(channel)
      set?.delete(listener)
      if (set && set.size === 0) this.listeners.delete(channel)
      this.releaseSocketIfIdle()
    }
  }

  /**
   * Subscribe to a raw `/ws` broadcast by its top-level `event` name (e.g.
   * `baked:changed`) — for app-level events that ride this socket but have no
   * `{ event: 'runtime', payload: { kind } }` envelope, so they don't fit the
   * kernel's typed `subscribe(channel, …)`. Shares THIS socket (see
   * `ensureSocket`) rather than the caller opening its own connection.
   */
  subscribeRaw(event: string, listener: (payload: unknown) => void): () => void {
    if (!this.rawListeners.has(event)) this.rawListeners.set(event, new Set())
    this.rawListeners.get(event)!.add(listener)
    this.ensureSocket()
    return () => {
      const set = this.rawListeners.get(event)
      set?.delete(listener)
      if (set && set.size === 0) this.rawListeners.delete(event)
      this.releaseSocketIfIdle()
    }
  }

  private ensureSocket(): void {
    // Defensive: in test/non-browser envs there may be no WebSocket global or
    // no `location`; skip socket creation there. Graph reactivity then requires
    // the host to deliver runtime events through this socket once available.
    if (this.ws || typeof WebSocket === 'undefined') return
    if (!this.base.startsWith('http') && typeof location === 'undefined') return
    const sock = new WebSocket(pluginWsUrl('/ws', this.base))
    this.ws = sock
    sock.onopen = () => {
      this.wsReconnectAttempts = 0
      sock.send(JSON.stringify({ action: 'subscribe', channels: ['graph', 'execution', 'asset'] }))
    }
    sock.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as { event: string; payload?: RuntimeEvent }
        // Raw app-level broadcasts (baked:changed, …) — dispatch first; these
        // have no runtime envelope so they never match the branches below.
        this.rawListeners.get(msg.event)?.forEach((l) => l(msg.payload))
        // Library mutations (import / publish / sandbox bind) broadcast this
        // directly — not on the runtime bus. AssetStore + preview hooks subscribe
        // to the `asset` channel, so forward here (mirrors useAliasMetas' raw WS).
        if (msg.event === 'library:changed') {
          const synthetic = { kind: 'asset:library-changed' } as unknown as RuntimeEvent
          this.listeners.get('asset')?.forEach((l) => l(synthetic))
          return
        }
        if (msg.event !== 'runtime') return
        const kind = (msg.payload as { kind?: string }).kind ?? ''
        // Cross-client project switch: the backend broadcasts `project:viewing`
        // (+ legacy `project:activated`) when the viewing project changes. The
        // projectStore reacts by calling loadPipeline(), so this client's
        // routing id MUST already point at the new project BEFORE dispatch —
        // otherwise getPipeline()/applyBatch()/execute() still hit the OLD
        // prefix and the canvas loads / mutates the wrong project. (This used
        // to happen by accident via a getWorkspace() side effect, i.e. only if
        // some unrelated poll happened to land in the right window.)
        if (kind === 'project:viewing' || kind === 'project:activated') {
          const pid = (msg.payload as { projectId?: string }).projectId
          if (pid) this.viewingProjectId = pid
        }
        const channel: RuntimeChannel = kind.startsWith('exec')
          ? 'execution'
          : kind.startsWith('asset')
            ? 'asset'
            : 'graph'
        this.listeners.get(channel)?.forEach((l) => l(msg.payload!))
      } catch {
        /* ignore malformed frames */
      }
    }
    sock.onerror = () => { try { sock.close() } catch { /* noop */ } }
    sock.onclose = () => {
      this.ws = null
      // Reconnect on drop so renderer/assetstore live-sync survives a backend
      // restart or WS blip.
      if (this.disposed || this.hasNoListeners() || this.wsReconnectTimer) return
      const delay = Math.min(5000, 500 * 2 ** this.wsReconnectAttempts)
      this.wsReconnectAttempts += 1
      this.wsReconnectTimer = setTimeout(() => {
        this.wsReconnectTimer = null
        if (!this.disposed && !this.ws && !this.hasNoListeners()) this.ensureSocket()
      }, delay)
    }
  }

  private hasNoListeners(): boolean {
    return this.listeners.size === 0 && this.rawListeners.size === 0
  }

  private releaseSocketIfIdle(): void {
    if (!this.hasNoListeners()) return
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer)
      this.wsReconnectTimer = null
    }
    const sock = this.ws
    this.ws = null
    sock?.close()
  }

  dispose(): void {
    this.disposed = true
    if (this.wsReconnectTimer) { clearTimeout(this.wsReconnectTimer); this.wsReconnectTimer = null }
    this.ws?.close()
    this.ws = null
    this.listeners.clear()
    this.rawListeners.clear()
  }
}
