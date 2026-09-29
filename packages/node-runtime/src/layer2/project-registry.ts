// Multi-project registry — kernel-level CRUD + open/activate cascade.
//
// A generic, plugin-agnostic registry for managing many pipelines ("projects")
// inside one workspace. Scene composition and any future task type consume the
// SAME registry: the per-project `type` is just a tag,
// and per-domain extras (assets, thumbnails, asset-detach policy) stay in the
// app via the optional hooks.
//
// Storage layout (under `workspaceRoot`):
//
//   <workspaceRoot>/
//     workspace.json                      ← { viewingProjectId, recentProjectIds, lastOpenedAt }
//     projects/
//       index.json                        ← { schemaVersion, projects: ProjectMeta[] }
//       <id>/
//         manifest.json                   ← ProjectManifest (incl. storage ref)
//         state/
//           graph.json                    ← runtime projection (per-project, isolated)
//           history.jsonl                 ← append-only log (per-project, isolated)
//           outputs/                       ← execution cache (per-project, isolated)
//
// Each project maps to its own Runtime (created lazily through an app-supplied
// factory that points the kernel storage classes at the project's `state/`
// dir). `viewProject(id)` sets the UI viewing target; agent `openProject`
// acquires an exclusive lock without changing viewing. Pipeline routes are
// project-scoped; per-project history
// isolation therefore falls out for free — each Runtime owns its own
// history.jsonl path.
//
// Default-project backfill: on first init (no projects/index.json) the registry
// adopts the legacy implicit pipeline — the existing
// `<workspaceRoot>/state/graph.json` — as a default project (no file moves, so
// current users keep their work). New projects get `projects/<id>/state/...`.

import { mkdirSync, rmSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

import { importPipelineGraph } from './import-graph.js'
import { collectCachedNodeIds } from './apply-batch.js'
import type { Runtime } from './runtime.js'
import { readJsonSafe, writeJsonAtomic } from './project-registry-storage.js'


export type {
  AssetDeletePolicy,
  CallerIdentity,
  ProjectLockInfo,
  ProjectQueueEntry,
  ProjectQueueStatus,
  LockDeniedCode,
  LockResult,
  OpenOrQueueResult,
  ProjectStorageRef,
  ProjectManifest,
  ProjectMeta,
  ProjectIndex,
  WorkspaceState,
  ProjectRecord,
  CreateProjectInput,
  UpdateProjectPatch,
  ListProjectsOptions,
  DeleteProjectOptions,
  ProjectRuntimeRequest,
  ProjectRuntimeFactory,
  ProjectRegistryOptions,
} from './project-registry.types.js'
import type {
  CallerIdentity,
  ProjectLockInfo,
  ProjectQueueEntry,
  ProjectQueueStatus,
  LockResult,
  OpenOrQueueResult,
  ProjectManifest,
  ProjectMeta,
  ProjectIndex,
  WorkspaceState,
  ProjectRecord,
  CreateProjectInput,
  UpdateProjectPatch,
  ListProjectsOptions,
  DeleteProjectOptions,
  ProjectRuntimeFactory,
  ProjectRegistryOptions,
  ProjectSessionEntry,
} from './project-registry.types.js'

const RECENT_LIMIT = 10
const DEFAULT_LOCK_LEASE_MS = 10 * 60_000
const DEFAULT_QUEUE_ENTRY_IDLE_MS = 15 * 60_000
const DEFAULT_SESSION_IDLE_MS = 30 * 60_000

function nowIso(): string {
  return new Date().toISOString()
}

function genProjectId(prefix = 'p'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

// Identity of an exclusive-lock/queue *holder*, distinct from `agentId` alone.
// Two concurrent callers can legitimately share the same ForgeaX agent
// *role* name (e.g. every construction-queue item dispatches to the fixed
// role `sino-constructor`) while being completely independent actors — the
// only thing that actually distinguishes them is `sessionId`. Keying the
// lock/queue tables on `agentId` alone would let two such concurrent
// sessions silently alias each other: the second one's `acquireProjectLock`
// would see "I already hold this project" (true only in the sense that
// *some* sino-constructor session does) and be allowed to mutate right
// alongside the first, defeating the whole point of the lock. Falling back
// to `agentId` alone when `sessionId` is absent keeps every existing
// (session-less) caller's behavior byte-for-byte unchanged — this is a
// strict refinement, not a behavior change, for anyone who never passes a
// sessionId. The NUL separator can't appear in either field, so this is
// injective for any real agentId/sessionId pair.
function holderKey(agentId: string | undefined, sessionId: string | undefined): string {
  return `${agentId ?? ''}\u0000${sessionId ?? ''}`
}

function metaFromManifest(m: ProjectManifest): ProjectMeta {
  const meta: ProjectMeta = {
    id: m.id,
    type: m.type,
    name: m.name,
    description: m.description,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  }
  if (m.thumbnail !== undefined) meta.thumbnail = m.thumbnail
  if (m.gameSlug !== undefined) meta.gameSlug = m.gameSlug
  return meta
}

// Generic multi-project registry. One instance owns one workspace: call init() once at startup,
// thereafter getViewingRuntime() returns the UI viewing project's Runtime.
export class ProjectRegistry {
  private readonly root: string
  private readonly factory: ProjectRuntimeFactory
  private readonly defaultType: string
  private readonly defaultName: string
  private readonly defaultId: string
  private readonly legacyStateDir: string
  private readonly onDeleteAssets?: ProjectRegistryOptions['onDeleteProjectAssets']

  private index: ProjectIndex = { schemaVersion: 1, projects: [] }
  private workspace: WorkspaceState = {
    viewingProjectId: null,
    recentProjectIds: [],
    lastOpenedAt: '',
  }
  private readonly pool = new Map<string, Runtime>()
  private viewing: Runtime | null = null
  private initialized = false

  // ── exclusive lock table ─────────────────────────────────────────────────
  // In-memory only: this single backend process owns the authoritative active
  // project, so the lock lives here too. A backend restart clears all locks —
  // an agent whose backend restarted must re-`open` its project. Invariant:
  // at most one entry per projectId AND at most one per agentId (kept in sync
  // via the reverse index). Humans never appear in either map.
  private readonly locks = new Map<string, ProjectLockInfo>()
  private readonly agentLock = new Map<string, string>()

  // Shared session attach (soft open): many agents may open the same project
  // for analysis. Distinct from exclusive write locks above.
  private readonly agentSessions = new Map<string, ProjectSessionEntry>()

  // ── FIFO write wait queue, one per project (AI callers only) ─────────────
  private readonly queues = new Map<string, ProjectQueueEntry[]>()
  private readonly lockLeaseMs: number
  private readonly queueEntryIdleMs: number
  private readonly sessionIdleMs: number

  constructor(opts: ProjectRegistryOptions) {
    this.root = opts.workspaceRoot
    this.factory = opts.createRuntime
    this.defaultType = opts.defaultType ?? 'default'
    this.defaultName = opts.defaultProjectName ?? 'Default'
    this.defaultId = opts.defaultProjectId ?? 'main'
    this.legacyStateDir = opts.legacyStateDir ?? 'state'
    this.onDeleteAssets = opts.onDeleteProjectAssets
    this.lockLeaseMs = opts.lockLeaseMs ?? DEFAULT_LOCK_LEASE_MS
    this.queueEntryIdleMs = opts.queueEntryIdleMs ?? DEFAULT_QUEUE_ENTRY_IDLE_MS
    this.sessionIdleMs = opts.sessionIdleMs ?? DEFAULT_SESSION_IDLE_MS
  }

  /** Release every runtime owned by this workspace registry. */
  dispose(): void {
    for (const runtime of this.pool.values()) runtime.dispose()
    this.pool.clear()
    this.viewing = null
    this.locks.clear()
    this.agentLock.clear()
    this.agentSessions.clear()
    this.queues.clear()
  }

  // ── paths ────────────────────────────────────────────────────────────────

  private get projectsDir(): string {
    return join(this.root, 'projects')
  }
  private get indexPath(): string {
    return join(this.projectsDir, 'index.json')
  }
  private get workspacePath(): string {
    return join(this.root, 'workspace.json')
  }
  private manifestPath(id: string): string {
    return join(this.projectsDir, id, 'manifest.json')
  }
  private abs(relOrAbs: string): string {
    return isAbsolute(relOrAbs) ? relOrAbs : join(this.root, relOrAbs)
  }

  // ── lifecycle ──────────────────────────────────────────────────────────

  // Load index + workspace; backfill a default project on first run.
  init(): void {
    if (this.initialized) return
    const loadedIndex = readJsonSafe<ProjectIndex>(this.indexPath)
    if (loadedIndex && Array.isArray(loadedIndex.projects)) {
      this.index = { schemaVersion: 1, projects: loadedIndex.projects }
    }
    const loadedWs = readJsonSafe<WorkspaceState & { activeProjectId?: string | null }>(this.workspacePath)
    if (loadedWs) {
      this.workspace = {
        viewingProjectId: loadedWs.viewingProjectId ?? loadedWs.activeProjectId ?? null,
        recentProjectIds: Array.isArray(loadedWs.recentProjectIds) ? loadedWs.recentProjectIds : [],
        lastOpenedAt: loadedWs.lastOpenedAt ?? nowIso(),
      }
    }

    if (this.index.projects.length === 0) {
      this.backfillDefault()
    }

    // Drop a stale viewing id that no longer resolves to a project.
    if (
      this.workspace.viewingProjectId &&
      !this.index.projects.some((p) => p.id === this.workspace.viewingProjectId)
    ) {
      this.workspace.viewingProjectId = null
    }
    if (!this.workspace.viewingProjectId && this.index.projects.length > 0) {
      this.workspace.viewingProjectId = this.index.projects[0]!.id
    }
    this.saveWorkspace()

    if (this.workspace.viewingProjectId) {
      this.viewing = this.getRuntimeFor(this.workspace.viewingProjectId)
    }
    this.initialized = true
  }

  // Adopt the legacy implicit pipeline (`<workspaceRoot>/state/graph.json`) as a default project, in place — no file moves, so existing work survives.
  private backfillDefault(): void {
    const ts = nowIso()
    const manifest: ProjectManifest = {
      schemaVersion: 1,
      id: this.defaultId,
      type: this.defaultType,
      name: this.defaultName,
      description: '',
      createdAt: ts,
      updatedAt: ts,
      storage: {
        graphFile: join(this.legacyStateDir, 'graph.json'),
        historyFile: join(this.legacyStateDir, 'history.jsonl'),
        outputsDir: join(this.legacyStateDir, 'outputs'),
      },
    }
    writeJsonAtomic(this.manifestPath(this.defaultId), manifest)
    this.index = { schemaVersion: 1, projects: [metaFromManifest(manifest)] }
    writeJsonAtomic(this.indexPath, this.index)
    this.workspace.viewingProjectId = this.defaultId
    this.workspace.recentProjectIds = [this.defaultId]
  }

  // ── queries ──────────────────────────────────────────────────────────────

  // Without `opts.gameSlug`, returns every project ("show all"). With it, returns
  // only projects tagged with that exact gameSlug — projects with no gameSlug
  // (created before the field existed, or outside a game context) are excluded
  // from a scoped list, matching "this game's projects only" intent.
  listProjects(opts?: ListProjectsOptions): ProjectMeta[] {
    const all = this.index.projects.map((p) => ({ ...p }))
    if (!opts?.gameSlug) return all
    return all.filter((p) => p.gameSlug === opts.gameSlug)
  }

  getProject(id: string): ProjectRecord | null {
    const manifest = readJsonSafe<ProjectManifest>(this.manifestPath(id))
    if (!manifest) return null
    return { manifest }
  }

  getWorkspace(): WorkspaceState {
    return {
      ...this.workspace,
      recentProjectIds: [...this.workspace.recentProjectIds],
      executingProjectIds: this.listLockedProjectIds(),
      queuedProjectIds: [...this.queues.keys()].filter((id) => (this.queues.get(id)?.length ?? 0) > 0),
    }
  }

  getViewingProjectId(): string | null {
    return this.workspace.viewingProjectId
  }

  /** All project ids currently held by an AI agent lock. */
  listLockedProjectIds(): string[] {
    for (const projectId of [...this.locks.keys()]) this.sweepExpiredLock(projectId)
    return [...this.locks.keys()]
  }

  // ── exclusive lock (open-then-operate, one agent ↔ one project) ──────────

  // Acquire an AI agent's exclusive lock on a project (humans always pass). For kind:'ai' the project must exist, must not be held by a different agent, and the agent must not already hold another project; re-opening the project the agent already holds is idempotent.
  acquireProjectLock(projectId: string, caller: CallerIdentity): LockResult {
    if (caller.kind !== 'ai') return { ok: true }
    if (!caller.agentId) {
      return { ok: false, code: 'lock-requires-agent-id', reason: 'lock-requires-agent-id: caller.kind is ai but agentId is missing' }
    }
    if (!this.index.projects.some((p) => p.id === projectId)) {
      return { ok: false, code: 'project-not-found', reason: `project-not-found: ${projectId}` }
    }
    this.sweepExpiredLock(projectId)
    const key = holderKey(caller.agentId, caller.sessionId)
    const existing = this.locks.get(projectId)
    if (existing && holderKey(existing.agentId, existing.sessionId) !== key) {
      return {
        ok: false,
        code: 'project-locked-by-other',
        reason: `project-locked-by-other: project ${projectId} is held by agent ${existing.agentId}`,
      }
    }
    const held = this.agentLock.get(key)
    if (held && held !== projectId) {
      return {
        ok: false,
        code: 'agent-holds-another',
        reason: `agent-holds-another: agent ${caller.agentId} already holds project ${held}; close it first`,
      }
    }
    this.locks.set(projectId, {
      agentId: caller.agentId,
      kind: caller.kind,
      acquiredAt: nowIso(),
      leaseExpiresAt: Date.now() + this.lockLeaseMs,
      ...(caller.sessionId ? { sessionId: caller.sessionId } : {}),
    })
    this.agentLock.set(key, projectId)
    return { ok: true }
  }

  // Release an AI agent's lock. Idempotent; rejects a wrong-agent release.
  // Immediately hands the freed project to the next queued agent, if any.
  releaseProjectLock(projectId: string, caller: CallerIdentity): LockResult {
    if (caller.kind !== 'ai') return { ok: true }
    const lock = this.locks.get(projectId)
    if (!lock) return { ok: true }
    if (holderKey(lock.agentId, lock.sessionId) !== holderKey(caller.agentId, caller.sessionId)) {
      return {
        ok: false,
        code: 'lock-not-owned',
        reason: `lock-not-owned: project ${projectId} is held by agent ${lock.agentId}, not ${caller.agentId ?? '(none)'}`,
      }
    }
    this.locks.delete(projectId)
    this.agentLock.delete(holderKey(lock.agentId, lock.sessionId))
    this.promoteQueueHead(projectId)
    return { ok: true }
  }

  // Renew an AI agent's lock lease without touching the graph — call this on
  // every successful mutation (see `checkMutationAccess`) and expose it as an
  // explicit heartbeat tool for agents mid-way through a long non-mutating
  // stretch (e.g. reasoning between tool calls). Silently a no-op if the
  // caller does not currently hold `projectId` (nothing to renew).
  private touchLock(projectId: string, caller: CallerIdentity): void {
    const key = holderKey(caller.agentId, caller.sessionId)
    const lock = this.locks.get(projectId)
    if (lock && holderKey(lock.agentId, lock.sessionId) === key) {
      lock.leaseExpiresAt = Date.now() + this.lockLeaseMs
    }
    // An actively-mutating agent's soft session is alive by definition.
    const session = this.agentSessions.get(key)
    if (session?.projectId === projectId) session.lastSeenAtMs = Date.now()
  }

  // Public heartbeat: explicit lease renewal an agent can call between
  // mutations to hold onto a project during a long thinking/reading stretch,
  // without that idle time eventually expiring its lock out from under it.
  renewLock(projectId: string, caller: CallerIdentity): LockResult {
    if (caller.kind !== 'ai') return { ok: true }
    if (!caller.agentId) {
      return { ok: false, code: 'lock-requires-agent-id', reason: 'lock-requires-agent-id: caller.kind is ai but agentId is missing' }
    }
    this.sweepExpiredLock(projectId)
    const lock = this.locks.get(projectId)
    if (!lock || holderKey(lock.agentId, lock.sessionId) !== holderKey(caller.agentId, caller.sessionId)) {
      return {
        ok: false,
        code: 'mutation-denied-not-open',
        reason: `mutation-denied: project ${projectId} is not open by agent ${caller.agentId} (nothing to renew)`,
      }
    }
    lock.leaseExpiresAt = Date.now() + this.lockLeaseMs
    return { ok: true }
  }

  // Drop an AI lock whose lease has lapsed — the normal signature of a
  // crashed/abandoned agent that never called `close`. Immediately hands the
  // now-free project to the queue head, if any, so "unlocked with a
  // non-empty queue" is never an observable state between calls (this
  // process is single-threaded/synchronous, so the check-then-promote pair
  // below can't race with another request).
  private sweepExpiredLock(projectId: string): void {
    const lock = this.locks.get(projectId)
    if (!lock || lock.leaseExpiresAt > Date.now()) return
    this.locks.delete(projectId)
    this.agentLock.delete(holderKey(lock.agentId, lock.sessionId))
    this.promoteQueueHead(projectId)
  }

  // Drop queue entries nobody has polled `openProject` for in a while — an
  // abandoned wait-queue slot must not block every agent behind it forever.
  private sweepStaleQueue(projectId: string): void {
    const queue = this.queues.get(projectId)
    if (!queue || queue.length === 0) return
    const cutoff = Date.now() - this.queueEntryIdleMs
    const fresh = queue.filter((e) => e.lastSeenAtMs >= cutoff)
    if (fresh.length === queue.length) return
    if (fresh.length > 0) this.queues.set(projectId, fresh)
    else this.queues.delete(projectId)
  }

  // Idempotently add/refresh `caller` at the back of `projectId`'s wait
  // queue (re-polling does not move an already-queued agent further back)
  // and return its 1-based position + the agentIds ahead of it.
  private joinQueue(projectId: string, caller: CallerIdentity): ProjectQueueStatus {
    const agentId = caller.agentId!
    const key = holderKey(agentId, caller.sessionId)
    let queue = this.queues.get(projectId)
    if (!queue) {
      queue = []
      this.queues.set(projectId, queue)
    }
    const idx = queue.findIndex((e) => holderKey(e.agentId, e.sessionId) === key)
    if (idx >= 0) {
      queue[idx]!.lastSeenAtMs = Date.now()
    } else {
      queue.push({
        agentId,
        kind: caller.kind,
        enqueuedAt: nowIso(),
        lastSeenAtMs: Date.now(),
        ...(caller.sessionId ? { sessionId: caller.sessionId } : {}),
      })
    }
    const finalIdx = queue.findIndex((e) => holderKey(e.agentId, e.sessionId) === key)
    return { agentId, position: finalIdx + 1, aheadOf: queue.slice(0, finalIdx).map((e) => e.agentId) }
  }

  // Voluntarily leave a project's wait queue (e.g. the agent decided to work
  // on something else). Idempotent; a no-op if not queued.
  leaveQueue(projectId: string, caller: CallerIdentity): LockResult {
    if (caller.kind !== 'ai' || !caller.agentId) return { ok: true }
    const key = holderKey(caller.agentId, caller.sessionId)
    const queue = this.queues.get(projectId)
    if (queue) {
      const next = queue.filter((e) => holderKey(e.agentId, e.sessionId) !== key)
      if (next.length > 0) this.queues.set(projectId, next)
      else this.queues.delete(projectId)
    }
    return { ok: true }
  }

  // Current wait-queue snapshot for a project, in FIFO order (position 1 is
  // next in line). Sweeps expired lock/stale entries first for accuracy.
  getProjectQueue(projectId: string): ProjectQueueStatus[] {
    this.sweepExpiredLock(projectId)
    this.sweepStaleQueue(projectId)
    const queue = this.queues.get(projectId) ?? []
    return queue.map((e, i) => ({ agentId: e.agentId, position: i + 1, aheadOf: queue.slice(0, i).map((x) => x.agentId) }))
  }

  // Grant a just-freed project straight to its queue head, skipping (and
  // dropping) any head entry whose agent already holds a *different*
  // project — an agent may only hold one project's lock at a time, so a
  // stale double-booked queue slot must not wedge the line. Called right
  // after a lock is released or its lease expires.
  private promoteQueueHead(projectId: string): void {
    if (this.locks.has(projectId)) return
    const queue = this.queues.get(projectId)
    if (!queue || queue.length === 0) return
    while (queue.length > 0) {
      const head = queue.shift()!
      const headKey = holderKey(head.agentId, head.sessionId)
      const heldElsewhere = this.agentLock.get(headKey)
      if (heldElsewhere && heldElsewhere !== projectId) continue // stale slot — drop and try next
      this.locks.set(projectId, {
        agentId: head.agentId,
        kind: head.kind,
        acquiredAt: nowIso(),
        leaseExpiresAt: Date.now() + this.lockLeaseMs,
        ...(head.sessionId ? { sessionId: head.sessionId } : {}),
      })
      this.agentLock.set(headKey, projectId)
      break
    }
    if (queue.length === 0) this.queues.delete(projectId)
  }

  // Emergency escape hatch: fully resets a project's lock + wait queue.
  // Human/authoring callers ONLY — never callable by an AI caller — because
  // it is the last-resort manual override for the (expected-never) case
  // where the automatic lease-expiry self-healing somehow fails to recover a
  // stuck project. Not part of the normal AI open/queue/close flow.
  forceUnlockProject(projectId: string, caller: CallerIdentity): LockResult {
    if (caller.kind === 'ai') {
      return { ok: false, code: 'force-unlock-denied', reason: 'force-unlock-denied: not available to AI callers' }
    }
    const lock = this.locks.get(projectId)
    if (lock) {
      this.locks.delete(projectId)
      this.agentLock.delete(holderKey(lock.agentId, lock.sessionId))
    }
    this.queues.delete(projectId)
    // Soft sessions too — otherwise the "last-resort manual override" leaves
    // every attached agent still answering `agent-holds-another` on its next
    // attempt to open a different project, and the project stays half-stuck.
    this.dropSessionsFor(projectId)
    return { ok: true }
  }

  // Detach every agent's soft session pointing at `projectId`.
  private dropSessionsFor(projectId: string): void {
    for (const [key, session] of [...this.agentSessions.entries()]) {
      if (session.projectId === projectId) this.agentSessions.delete(key)
    }
  }

  // Gate a mutation against the lock. Humans may mutate any existing project
  // when addressed by id (project-scoped routes). An AI caller may mutate ONLY
  // a project it holds an exclusive lock on — independent of the UI viewing
  // project, so multiple agents can execute different projects concurrently.
  checkMutationAccess(projectId: string | null, caller: CallerIdentity): LockResult {
    if (caller.kind !== 'ai') {
      if (!projectId) {
        return {
          ok: false,
          code: 'mutation-denied-no-project',
          reason: 'mutation-denied: project id is required',
        }
      }
      if (!this.index.projects.some((p) => p.id === projectId)) {
        return { ok: false, code: 'project-not-found', reason: `project-not-found: ${projectId}` }
      }
      return { ok: true }
    }
    if (!projectId) {
      return { ok: false, code: 'mutation-denied-no-project', reason: 'mutation-denied: project id is required' }
    }
    this.sweepExpiredLock(projectId)
    const lock = this.locks.get(projectId)
    if (!lock) {
      // RECOVERABLE: no agent holds this (existing, active) project. The normal
      // state after a backend restart wiped the in-memory lock table — the AI
      // tool seam re-`open`s and retries on this exact code. Distinct from
      // `locked-by-other` so a genuine conflict is never auto-retried.
      return {
        ok: false,
        code: 'mutation-denied-not-open',
        reason: `mutation-denied: project ${projectId} is not open by any agent`,
      }
    }
    if (!caller.agentId || holderKey(lock.agentId, lock.sessionId) !== holderKey(caller.agentId, caller.sessionId)) {
      return {
        ok: false,
        code: 'mutation-denied-locked-by-other',
        reason: `mutation-denied: project ${projectId} is locked by agent ${lock.agentId}`,
      }
    }
    // Successful mutation under the lock: renew the lease so a genuinely
    // active agent (still calling applyBatch/execute regularly) never gets
    // timed out mid-task by the idle-lease sweep.
    this.touchLock(projectId, caller)
    return { ok: true }
  }

  // Current lock holder for a project (or null). For UI badges / diagnostics.
  // Sweeps an expired lease first so a stale/crashed agent never shows as
  // "still holding" the project.
  getProjectLock(projectId: string): ProjectLockInfo | null {
    this.sweepExpiredLock(projectId)
    const lock = this.locks.get(projectId)
    return lock ? { ...lock } : null
  }

  /** All active agent locks — for workspace diagnostics / project panel. */
  listAllProjectLocks(): Array<{ projectId: string } & ProjectLockInfo> {
    for (const projectId of [...this.locks.keys()]) this.sweepExpiredLock(projectId)
    return [...this.locks.entries()].map(([projectId, lock]) => ({ projectId, ...lock }))
  }

  // The UI viewing project's Runtime. Throws if init() has not run / no project.
  getViewingRuntime(): Runtime {
    if (!this.viewing) {
      throw new Error('[project-registry] no viewing runtime — call init() first')
    }
    return this.viewing
  }

  /** @deprecated Use getViewingRuntime(). */
  getActiveRuntime(): Runtime {
    return this.getViewingRuntime()
  }

  /** @deprecated Use getViewingProjectId(). */
  getActiveProjectId(): string | null {
    return this.getViewingProjectId()
  }

  // Get (or lazily build) the Runtime for a project by id.
  getRuntimeFor(id: string): Runtime {
    const cached = this.pool.get(id)
    if (cached) return cached
    const manifest = readJsonSafe<ProjectManifest>(this.manifestPath(id))
    if (!manifest) throw new Error(`[project-registry] project not found: ${id}`)
    const rt = this.factory({
      projectId: id,
      pipelineId: id,
      graphFile: this.abs(manifest.storage.graphFile),
      historyFile: this.abs(manifest.storage.historyFile),
      outputsDir: this.abs(manifest.storage.outputsDir),
    })
    this.pool.set(id, rt)
    return rt
  }

  /** Release an unused in-memory runtime; canonical files and outputs stay on disk. */
  releaseIdleRuntime(id: string): boolean {
    if (
      this.workspace.viewingProjectId === id || this.locks.has(id)
      || [...this.agentSessions.values()].some(session => session.projectId === id)
      || (this.queues.get(id)?.length ?? 0) > 0
    ) return false
    const runtime = this.pool.get(id)
    if (!runtime) return false
    runtime.dispose()
    this.pool.delete(id)
    return true
  }

  // ── mutations ──────────────────────────────────────────────────────────

  // Create a project. With `fromTemplate`, the new project's graph is seeded by the kernel importPipelineGraph (single atomic batch → graph:applied), the same path the editor Open / CLI import use; without it, an empty graph is bootstrapped so getPipeline returns a (nodes:{}) snapshot.
  async createProject(input: CreateProjectInput): Promise<ProjectMeta> {
    const name = (input.name ?? '').trim()
    if (!name) throw new Error('[project-registry] project name is required')

    const id = input.id ?? genProjectId('p')
    if (this.index.projects.some((p) => p.id === id)) {
      throw new Error(`[project-registry] project id already exists: ${id}`)
    }
    const ts = nowIso()
    const type = input.type ?? this.defaultType
    const stateRel = join('projects', id, 'state')
    const manifest: ProjectManifest = {
      schemaVersion: 1,
      id,
      type,
      name,
      description: input.description ?? '',
      createdAt: ts,
      updatedAt: ts,
      ...(input.gameSlug !== undefined ? { gameSlug: input.gameSlug } : {}),
      storage: {
        graphFile: join(stateRel, 'graph.json'),
        historyFile: join(stateRel, 'history.jsonl'),
        outputsDir: join(stateRel, 'outputs'),
      },
    }
    mkdirSync(join(this.projectsDir, id), { recursive: true })
    writeJsonAtomic(this.manifestPath(id), manifest)
    this.index.projects.push(metaFromManifest(manifest))
    writeJsonAtomic(this.indexPath, this.index)

    try {
      const rt = this.getRuntimeFor(id)
      if (input.fromTemplate) {
        const res = await importPipelineGraph(rt, input.fromTemplate, {
          mode: 'replace',
          actor: 'project:template',
          label: `New project from template`,
          ...(input.templateOptions ?? {}),
        })
        if (res.status !== 'ok') {
          throw new Error(`template seed rejected: ${res.reason ?? 'unknown'}`)
        }
      } else {
        // Bootstrap an empty, hash-valid graph so reads succeed immediately.
        rt.graph.save({
          schemaVersion: 1,
          id,
          createdAt: ts,
          updatedAt: ts,
          nodes: {},
          edges: {},
        })
      }
    } catch (e) {
      // Roll back the half-created project so the index stays consistent.
      this.pool.delete(id)
      this.index.projects = this.index.projects.filter((p) => p.id !== id)
      writeJsonAtomic(this.indexPath, this.index)
      rmSync(join(this.projectsDir, id), { recursive: true, force: true })
      throw e
    }

    return metaFromManifest(manifest)
  }

  updateProject(id: string, patch: UpdateProjectPatch): ProjectMeta {
    const manifest = readJsonSafe<ProjectManifest>(this.manifestPath(id))
    if (!manifest) throw new Error(`[project-registry] project not found: ${id}`)
    if (patch.name !== undefined) manifest.name = patch.name.trim() || manifest.name
    if (patch.description !== undefined) manifest.description = patch.description
    if (patch.thumbnail !== undefined) manifest.thumbnail = patch.thumbnail
    if (patch.type !== undefined) manifest.type = patch.type
    if (patch.gameSlug !== undefined) manifest.gameSlug = patch.gameSlug
    manifest.updatedAt = nowIso()
    writeJsonAtomic(this.manifestPath(id), manifest)
    const meta = metaFromManifest(manifest)
    this.index.projects = this.index.projects.map((p) => (p.id === id ? meta : p))
    writeJsonAtomic(this.indexPath, this.index)
    return meta
  }

  // Set the UI viewing project: bumps recents and persists workspace. Does NOT
  // acquire or release agent locks.
  viewProject(id: string): Runtime {
    const __t0 = Date.now()
    if (!readJsonSafe<ProjectManifest>(this.manifestPath(id))) {
      throw new Error(`[project-registry] project not found: ${id}`)
    }
    this.workspace.viewingProjectId = id
    this.workspace.recentProjectIds = [
      id,
      ...this.workspace.recentProjectIds.filter((rid) => rid !== id),
    ].slice(0, RECENT_LIMIT)
    this.saveWorkspace()
    const __t1 = Date.now()
    const rt = this.getRuntimeFor(id)
    const __t2 = Date.now()
    const graph = rt.graph.load()
    const __t3 = Date.now()
    const pruned = rt.outputs.pruneByRetention(
      graph ? { protectedNodeIds: collectCachedNodeIds(graph) } : undefined,
    )
    const __t4 = Date.now()
    const mem = process.memoryUsage()
    process.stderr.write(
      `[switch-trace] viewProject id=${id} saveWorkspace=${__t1 - __t0}ms getRuntimeFor=${__t2 - __t1}ms ` +
        `graph.load=${__t3 - __t2}ms pruneByRetention=${__t4 - __t3}ms(removed=${pruned.removed},freedMB=${Math.round(pruned.freedBytes / (1024 * 1024))}) ` +
        `TOTAL=${__t4 - __t0}ms rss=${(mem.rss / 1024 / 1024).toFixed(1)}MB heapUsed=${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB\n`,
    )
    this.viewing = rt
    return rt
  }

  /** @deprecated Use viewProject(). */
  activateProject(id: string): Runtime {
    return this.viewProject(id)
  }

  // Drop a soft session nobody has touched in `sessionIdleMs` — the signature
  // of an agent that crashed (or whose host restarted) without ever calling
  // `detachProject`. Must run before every read/write of `agentSessions`, or a
  // dead session permanently answers `agent-holds-another` to that agent's
  // attempts to open any other project.
  private sweepStaleSession(key: string): void {
    const session = this.agentSessions.get(key)
    if (!session) return
    if (session.lastSeenAtMs >= Date.now() - this.sessionIdleMs) return
    // A session backing a still-live write lock is by definition not idle.
    if (this.agentLock.get(key)) {
      session.lastSeenAtMs = Date.now()
      return
    }
    this.agentSessions.delete(key)
  }

  /** Soft-open project id for this AI caller, if any. */
  getAgentOpenProjectId(caller: CallerIdentity): string | null {
    if (caller.kind !== 'ai' || !caller.agentId) return null
    const key = holderKey(caller.agentId, caller.sessionId)
    this.sweepStaleSession(key)
    return this.agentSessions.get(key)?.projectId ?? null
  }

  /**
   * Agent open = **shared session attach** for analysis. Ensures the Runtime
   * exists; does **not** take the exclusive write lock and does **not** join
   * the write wait queue. Multiple AI agents may open the same project at
   * once and call read tools (`pipeline.get`, …). Write exclusivity is
   * enforced later by {@link claimWriteAccess} / mutation routes.
   *
   * Does **not** change the UI viewing project.
   */
  openProject(projectId: string, caller: CallerIdentity): OpenOrQueueResult {
    if (!this.index.projects.some((p) => p.id === projectId)) {
      return { ok: false, code: 'project-not-found', reason: `project-not-found: ${projectId}` }
    }
    if (caller.kind !== 'ai') {
      this.getRuntimeFor(projectId)
      return { ok: true, queued: false }
    }
    if (!caller.agentId) {
      return { ok: false, code: 'lock-requires-agent-id', reason: 'lock-requires-agent-id: caller.kind is ai but agentId is missing' }
    }
    const key = holderKey(caller.agentId, caller.sessionId)
    this.sweepStaleSession(key)
    const existingSession = this.agentSessions.get(key)
    if (existingSession && existingSession.projectId !== projectId) {
      return {
        ok: false,
        code: 'agent-holds-another',
        reason:
          `agent-holds-another: agent ${caller.agentId} already has project ${existingSession.projectId} open; ` +
          'close it first before opening another',
      }
    }
    // Soft attach only — never exclusive-lock here.
    this.agentSessions.set(key, { projectId, lastSeenAtMs: Date.now() })
    this.getRuntimeFor(projectId)
    return { ok: true, queued: false }
  }

  /**
   * Claim exclusive **write** access (single-writer). If another agent holds
   * the write lock, join the FIFO wait queue (`queued: true`) instead of
   * hard-failing. Soft-opens the project first when needed. Used by mutation
   * routes (applyBatch/execute/…) — not by `openProject`.
   */
  claimWriteAccess(projectId: string, caller: CallerIdentity): OpenOrQueueResult {
    if (caller.kind !== 'ai') {
      const lock = this.acquireProjectLock(projectId, caller)
      if (!lock.ok) return lock
      this.getRuntimeFor(projectId)
      return { ok: true, queued: false }
    }

    // Ensure shared session before taking the write lock.
    const opened = this.openProject(projectId, caller)
    if (!opened.ok) return opened

    this.sweepExpiredLock(projectId)
    this.sweepStaleQueue(projectId)

    const lock = this.acquireProjectLock(projectId, caller)
    if (lock.ok) {
      this.leaveQueue(projectId, caller)
      this.getRuntimeFor(projectId)
      return { ok: true, queued: false }
    }
    if (lock.code !== 'project-locked-by-other') return lock

    const { position, aheadOf } = this.joinQueue(projectId, caller)
    return {
      ok: false,
      queued: true,
      code: 'project-queued',
      position,
      aheadOf,
      reason:
        `project-queued: project ${projectId} write lock is held by another agent; you are #${position} in line` +
        (aheadOf.length > 0 ? ` behind [${aheadOf.join(', ')}]` : '') +
        '. Analysis/read tools are fine while waiting; mutation tools block/wait for the write lock. ' +
        'Do NOT spam scene:projects.open — open is shared and already succeeded.',
    }
  }

  /**
   * Detach soft session + release write lock if this caller holds it.
   * Safe when another agent holds the write lock (only clears this caller's
   * session / queue slot).
   */
  detachProject(projectId: string, caller: CallerIdentity): LockResult {
    this.leaveQueue(projectId, caller)
    if (caller.kind === 'ai' && caller.agentId) {
      const key = holderKey(caller.agentId, caller.sessionId)
      const lock = this.locks.get(projectId)
      if (lock && holderKey(lock.agentId, lock.sessionId) === key) {
        this.releaseProjectLock(projectId, caller)
      }
      if (this.agentSessions.get(key)?.projectId === projectId) this.agentSessions.delete(key)
    }
    return { ok: true }
  }

  async deleteProject(id: string, opts: DeleteProjectOptions = {}): Promise<void> {
    const manifest = readJsonSafe<ProjectManifest>(this.manifestPath(id))
    if (!manifest) throw new Error(`[project-registry] project not found: ${id}`)

    if (this.onDeleteAssets) {
      await this.onDeleteAssets(id, opts.assetPolicy ?? 'detach')
    }

    // Drop any exclusive lock, wait queue and soft session on the project
    // being removed — a session pointing at a deleted project would otherwise
    // block its agent from opening anything else.
    const lock = this.locks.get(id)
    if (lock) {
      this.locks.delete(id)
      this.agentLock.delete(holderKey(lock.agentId, lock.sessionId))
    }
    this.queues.delete(id)
    this.dropSessionsFor(id)

    // Drop the runtime and remove every storage artefact this project owns.
    this.pool.get(id)?.dispose()
    this.pool.delete(id)
    rmSync(this.abs(manifest.storage.outputsDir), { recursive: true, force: true })
    rmSync(this.abs(manifest.storage.historyFile), { force: true })
    rmSync(this.abs(manifest.storage.graphFile), { force: true })
    rmSync(join(this.projectsDir, id), { recursive: true, force: true })

    this.index.projects = this.index.projects.filter((p) => p.id !== id)
    writeJsonAtomic(this.indexPath, this.index)
    this.workspace.recentProjectIds = this.workspace.recentProjectIds.filter((rid) => rid !== id)

    if (this.workspace.viewingProjectId === id) {
      const next = this.index.projects[0]
      if (next) {
        this.workspace.viewingProjectId = next.id
        this.viewing = this.getRuntimeFor(next.id)
      } else {
        // Never leave the workspace empty — mint a fresh default.
        const meta = await this.createProject({ type: this.defaultType, name: this.defaultName })
        this.workspace.viewingProjectId = meta.id
        this.viewing = this.getRuntimeFor(meta.id)
      }
    }
    this.saveWorkspace()
  }

  setWorkspace(patch: Partial<Pick<WorkspaceState, 'viewingProjectId' | 'recentProjectIds'>> & { activeProjectId?: string | null }): WorkspaceState {
    const viewingId = patch.viewingProjectId ?? patch.activeProjectId
    if (viewingId) {
      this.viewProject(viewingId)
    }
    if (patch.recentProjectIds !== undefined) {
      this.workspace.recentProjectIds = patch.recentProjectIds.slice(0, RECENT_LIMIT)
      this.saveWorkspace()
    }
    return this.getWorkspace()
  }

  // ── internals ──────────────────────────────────────────────────────────

  private saveWorkspace(): void {
    this.workspace.lastOpenedAt = nowIso()
    writeJsonAtomic(this.workspacePath, this.workspace)
  }
}
