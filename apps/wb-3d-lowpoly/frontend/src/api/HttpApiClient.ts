import type { ActivateProjectResult, ApiClient, CreateProjectRequest } from '@forgeax/node-runtime-react'
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
import { pluginBasePath } from './pluginHttp'

type Listener = (e: RuntimeEvent) => void

interface GroupTemplateBattery {
  id: string
  name: string
  nameEn?: string
  category: string
  description?: string
  version?: string
  iconSvg?: string
  displayGroup?: string
  sourcePath?: string
}

export interface HttpApiClientOptions {
  baseUrl?: string
  pipelineId: string
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
  private disposed = false
  private wsReconnectAttempts = 0
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null

  constructor(opts: HttpApiClientOptions) {
    this.pipelineId = opts.pipelineId
    this.base = opts.baseUrl || pluginBasePath()
  }

  syncViewingProjectId(id: string): void {
    this.viewingProjectId = id
  }

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
    const r = await fetch(`${this.base}${path}`, { method: 'GET' })
    if (!r.ok) throw new Error(`${path} → ${r.status}`)
    return (await r.json()) as T
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const r = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!r.ok) throw new Error(`${path} → ${r.status}`)
    return (await r.json()) as T
  }

  private async put<T>(path: string, body: unknown): Promise<T> {
    const r = await fetch(`${this.base}${path}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!r.ok) throw new Error(`${path} → ${r.status}`)
    return (await r.json()) as T
  }

  private async del<T>(path: string): Promise<T> {
    const r = await fetch(`${this.base}${path}`, { method: 'DELETE' })
    if (!r.ok) throw new Error(`${path} → ${r.status}`)
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

  /**
   * Lightweight hash of the current pipeline, used by the live-sync reconciler
   * to cheaply detect missed `graph:applied` frames. Without it the kernel's
   * adapter (`getPipelineHash`) returns null every tick and the reconciler
   * degrades to a full `getPipeline()` snapshot pull every ~1.5s.
   */
  getPipelineHash(): Promise<{ hash: string | null }> {
    return this.get<{ hash: string | null }>(`${this.projectPrefix()}/pipeline/hash`)
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
    // Sharded/large outputs (big geometry, dense URDF probes) are cached in
    // chunks and the full GET responds 413 Payload Too Large. Callers that need
    // those should consult `getNodeOutputMeta` first; here we degrade gracefully
    // (return undefined) instead of throwing, so a single oversized output can't
    // break URDF live-sync / cable probes that iterate connected outputs.
    const r = await fetch(
      `${this.base}${this.projectPrefix()}/nodes/${encodeURIComponent(nodeId)}/outputs/${encodeURIComponent(portId)}`,
      { method: 'GET' },
    )
    if (r.status === 413) return undefined
    if (!r.ok) throw new Error(`getNodeOutput → ${r.status}`)
    const body = (await r.json()) as { value: unknown }
    return body.value
  }

  /**
   * Metadata-only output read — a cheap "is this output present / sharded / how
   * big" check the kernel's `refreshConnectedOutputs` does before a full GET, so
   * it can skip pulling oversized (413) payloads. Backed by the backend
   * `/nodes/:nid/outputs/:pid/meta` route registered by registerProjectPipelineRoutes.
   */
  getNodeOutputMeta(
    nodeId: string,
    portId: string,
  ): Promise<{ executedHash: string; valid: boolean; sharded: boolean; dataChunks?: number; missing?: boolean }> {
    return this.get(
      `${this.projectPrefix()}/nodes/${encodeURIComponent(nodeId)}/outputs/${encodeURIComponent(portId)}/meta`,
    )
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

  async resolveAssetPath(template: string, _vars?: Record<string, string>): Promise<string> {
    return template
  }

  listImportTemplates(): Promise<readonly ImportTemplate[]> {
    return this.get<readonly ImportTemplate[]>(`${this.projectPrefix()}/pipeline/templates`)
  }

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

  saveGroupTemplate(req: {
    group: NodeGroup
    categoryName: string
    batteryName: string
  }): Promise<{ filePath: string; groupId: string; categoryName: string; batteryName: string }> {
    return this.post('/api/v1/group-templates/save', req)
  }

  listTemplateCategories(): Promise<readonly string[]> {
    return this.get<readonly string[]>('/api/v1/group-templates/categories')
  }

  /** Execute the pipeline (or a single node) via the backend bridge. */
  execute(request?: { nodeId?: string; quietErrors?: boolean }): Promise<ExecutionResult> {
    return this.post(`${this.projectPrefix()}/execute`, request ?? {}) as Promise<ExecutionResult>
  }

  clearOutputCache(): Promise<{ ok: true }> {
    return this.post(`${this.projectPrefix()}/outputs/clear`, {}) as Promise<{ ok: true }>
  }

  listProjects(): Promise<readonly ProjectMeta[]> {
    return this.get<readonly ProjectMeta[]>('/api/v1/projects')
  }

  getProject(id: string): Promise<ProjectRecord | null> {
    return this.get<ProjectRecord | null>(`/api/v1/projects/${encodeURIComponent(id)}`)
  }

  createProject(req: CreateProjectRequest): Promise<ProjectMeta> {
    return this.post<ProjectMeta>('/api/v1/projects', req)
  }

  updateProject(
    id: string,
    patch: { name?: string; description?: string; thumbnail?: string; type?: string },
  ): Promise<ProjectMeta> {
    return this.put<ProjectMeta>(`/api/v1/projects/${encodeURIComponent(id)}`, patch)
  }

  deleteProject(id: string, opts?: { assetPolicy?: AssetDeletePolicy }): Promise<{ ok: true; workspace: WorkspaceState }> {
    const q = opts?.assetPolicy ? `?assetPolicy=${encodeURIComponent(opts.assetPolicy)}` : ''
    return this.del<{ ok: true; workspace: WorkspaceState }>(`/api/v1/projects/${encodeURIComponent(id)}${q}`)
  }

  async viewProject(id: string): Promise<ActivateProjectResult> {
    const res = await this.post<ActivateProjectResult>(`/api/v1/projects/${encodeURIComponent(id)}/view`, {})
    this.viewingProjectId = id
    return res
  }

  activateProject(id: string): Promise<ActivateProjectResult> {
    return this.viewProject(id)
  }

  getProjectLock(id: string): Promise<{ lock: { agentId: string; kind: string; acquiredAt: string } | null }> {
    return this.get(`/api/v1/projects/${encodeURIComponent(id)}/lock`)
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

  /** Total listener count across all channels — `this.listeners.size` alone is
   * wrong (it's the number of channel *keys*, which never shrinks back to 0
   * once a channel has ever been subscribed to, since `subscribe`'s unsubscribe
   * only empties the Set, it doesn't delete the channel key). */
  private listenerCount(): number {
    let total = 0
    for (const set of this.listeners.values()) total += set.size
    return total
  }

  subscribe(channel: RuntimeChannel, listener: (e: RuntimeEvent) => void): () => void {
    if (!this.listeners.has(channel)) this.listeners.set(channel, new Set())
    this.listeners.get(channel)!.add(listener)
    this.ensureSocket()
    return () => {
      const set = this.listeners.get(channel)
      set?.delete(listener)
      if (set && set.size === 0) this.listeners.delete(channel)
    }
  }

  private ensureSocket(): void {
    // Defensive: in test/non-browser envs there may be no WebSocket global or
    // no `location`; skip socket creation there. Graph reactivity then requires
    // the host to deliver runtime events through this socket once available.
    if (this.ws || typeof WebSocket === 'undefined') return
    if (!this.base.startsWith('http') && typeof location === 'undefined') return
    const wsBase = this.base.startsWith('http')
      ? this.base.replace(/^http/, 'ws')
      : `${location.origin.replace(/^http/, 'ws')}${this.base.replace(/\/$/, '')}`
    const sock = new WebSocket(`${wsBase}/ws`)
    this.ws = sock
    sock.onopen = () => {
      this.wsReconnectAttempts = 0
      sock.send(JSON.stringify({ action: 'subscribe', channels: ['graph', 'execution', 'asset'] }))
    }
    sock.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as { event: string; payload: RuntimeEvent }
        // Battery hot-reload: the backend broadcasts a top-level `ops:changed`
        // frame (not wrapped as a `runtime` event). Surface it on the 'graph'
        // channel as a synthetic runtime event so the editor can reload the
        // palette — otherwise a dev meta/index edit never reaches the catalog.
        if (msg.event === 'ops:changed') {
          const opsEvent = { ...(msg.payload ?? {}), kind: 'ops:changed' } as unknown as RuntimeEvent
          this.listeners.get('graph')?.forEach((l) => l(opsEvent))
          return
        }
        if (msg.event !== 'runtime') return
        const kind = (msg.payload as { kind?: string }).kind ?? ''
        // Cross-client project switch: the backend broadcasts `project:viewing`
        // (+ legacy `project:activated`) when the viewing project changes. The
        // kernel's projectStore reacts by calling loadPipeline() synchronously,
        // so our internal viewingProjectId MUST already point at the new project
        // BEFORE we dispatch — otherwise getPipeline()/applyBatch()/execute()
        // would still hit the OLD project's prefix and the canvas would load /
        // mutate the wrong project. Update it here, ahead of listener dispatch.
        if (kind === 'project:viewing' || kind === 'project:activated') {
          const pid = (msg.payload as { projectId?: string }).projectId
          if (pid) this.viewingProjectId = pid
        }
        const channel: RuntimeChannel = kind.startsWith('exec')
          ? 'execution'
          : kind.startsWith('asset')
            ? 'asset'
            : 'graph'
        this.listeners.get(channel)?.forEach((l) => l(msg.payload))
      } catch {
        /* ignore malformed frames */
      }
    }
    sock.onerror = () => { try { sock.close() } catch { /* noop */ } }
    sock.onclose = () => {
      this.ws = null
      // Reconnect on drop so graph/exec reactivity (URDF live-sync in the
      // headless renderer + the human panel) survives a stack restart or WS
      // blip. Without this, a single drop permanently stops exec:completed →
      // the viewer never loads the model → screenshot/glb export see an empty
      // scene. Backoff capped at 5s; only while there are listeners.
      if (this.disposed || this.listenerCount() === 0 || this.wsReconnectTimer) return
      const delay = Math.min(5000, 500 * 2 ** this.wsReconnectAttempts)
      this.wsReconnectAttempts += 1
      this.wsReconnectTimer = setTimeout(() => {
        this.wsReconnectTimer = null
        if (!this.disposed && !this.ws && this.listenerCount() > 0) this.ensureSocket()
      }, delay)
    }
  }

  dispose(): void {
    this.disposed = true
    if (this.wsReconnectTimer) { clearTimeout(this.wsReconnectTimer); this.wsReconnectTimer = null }
    this.ws?.close()
    this.ws = null
    this.listeners.clear()
  }
}
