// Multi-project registry types — kept out of project-registry.ts so the
// ProjectRegistry class file is the runtime implementation only.
// Public surface is re-exported from project-registry.ts (layer2 barrel unchanged).

import type { Runtime } from './runtime.js'
import type { ImportGraphInput, ImportGraphOptions } from './import-graph.js'

export type AssetDeletePolicy = 'detach' | 'delete'

// Identity of whoever drives a project op, forwarded by the app's route layer from the tool-call
// `caller`. The exclusive-lock rules apply ONLY to kind:'ai' callers — humans
// and product extensions are never locked (final authority).
export interface CallerIdentity {
  kind: 'ai' | 'user' | 'extension' | 'cli' | 'skill'
  agentId?: string
  sessionId?: string
  extensionId?: string
}

// Current holder of a project's exclusive lock (process-lifetime only).
// `leaseExpiresAt` (epoch ms) makes the lock self-healing: renewed on every
// successful mutation (and explicit heartbeat) via `touchLock`, and swept by
// `sweepExpiredLock` before any lock read/write. A crashed or abandoned agent
// therefore never wedges a project shut for longer than one lease window —
// see the queue design in `openProject`.
export interface ProjectLockInfo {
  agentId: string
  kind: CallerIdentity['kind']
  acquiredAt: string
  leaseExpiresAt: number
  sessionId?: string
}

// One agent's shared (non-exclusive) attach to a project. `lastSeenAtMs` is
// bumped by every open/claim/mutation touch; an entry nobody has touched in
// `sessionIdleMs` is swept. Without that sweep a crashed agent's soft session
// wedges it out of EVERY other project for the process' lifetime, because
// `openProject` rejects a second project with `agent-holds-another` and only
// an explicit `detachProject` clears the entry.
export interface ProjectSessionEntry {
  projectId: string
  lastSeenAtMs: number
}

// A waiting-in-line AI agent (not yet holding the lock). `lastSeenAtMs` is
// bumped every time the agent polls `openProject` again — an entry nobody
// has touched in `queueEntryIdleMs` is dropped so an abandoned queue slot can
// never block everyone behind it.
export interface ProjectQueueEntry {
  agentId: string
  kind: CallerIdentity['kind']
  enqueuedAt: string
  lastSeenAtMs: number
  sessionId?: string
}

// Public view of one agent's position in a project's wait queue.
export interface ProjectQueueStatus {
  agentId: string
  position: number
  aheadOf: string[]
}

// Machine-readable lock-denial codes. `mutation-denied-not-open` is the ONLY
// recoverable one: it means no agent currently holds the (existing, active)
// project — the normal state after a backend restart wiped the in-memory lock
// table. The AI tool seam can transparently re-`open` and retry on this code.
// Every other code is a genuine conflict (held by a different agent, no active
// project, etc.) and must surface to the caller.
export type LockDeniedCode =
  | 'lock-requires-agent-id'
  | 'project-not-found'
  | 'project-locked-by-other'
  | 'agent-holds-another'
  | 'lock-not-owned'
  | 'mutation-denied-no-project'
  | 'mutation-denied-not-open'
  | 'mutation-denied-locked-by-other'
  | 'force-unlock-denied'

// Result of a lock op — discriminated so callers can surface `reason` verbatim.
// The failure variant carries a machine-readable `code` for programmatic
// recovery (the human-readable `reason` stays for logs / direct surfacing).
export type LockResult = { ok: true } | { ok: false; reason: string; code: LockDeniedCode }

// Result of `claimWriteAccess` (exclusive write lock). `openProject` is a
// shared attach and always returns `{ ok:true, queued:false }` for an
// existing project — multiple agents may open the same project for analysis.
// Write exclusivity is enforced only when mutating via `claimWriteAccess` /
// `ensureMutationAccess`. `queued: true` means the caller joined the FIFO
// write wait line (not an error).
export type OpenOrQueueResult =
  | { ok: true; queued: false }
  | { ok: false; queued: true; code: 'project-queued'; position: number; aheadOf: string[]; reason: string }
  | { ok: false; queued?: false; code: LockDeniedCode; reason: string }

// Per-project storage paths, stored relative to the workspace root for portability.
export interface ProjectStorageRef {
  // graph.json path, relative to workspaceRoot.
  graphFile: string
  // history.jsonl path, relative to workspaceRoot.
  historyFile: string
  // outputs/ root, relative to workspaceRoot.
  outputsDir: string
}

// On-disk per-project manifest (`projects/<id>/manifest.json`).
export interface ProjectManifest {
  schemaVersion: 1
  id: string
  // Free-form domain tag, e.g. 'scene' | 'lowpoly'. Drives battery filtering.
  type: string
  name: string
  description: string
  createdAt: string
  updatedAt: string
  // Relative path to a thumbnail image, if any (app-managed).
  thumbnail?: string
  // Owning ForgeaX game slug (multi-game workspace tagging). Optional —
  // projects created before this field existed, or created outside a game
  // context (e.g. CLI), have no gameSlug and surface under "show all".
  gameSlug?: string
  storage: ProjectStorageRef
}

// Lightweight project descriptor surfaced in the index + list responses.
export interface ProjectMeta {
  id: string
  type: string
  name: string
  description: string
  thumbnail?: string
  createdAt: string
  updatedAt: string
  gameSlug?: string
}

// On-disk index (`projects/index.json`).
export interface ProjectIndex {
  schemaVersion: 1
  projects: ProjectMeta[]
}

// Workspace-level state (`workspace.json`). Invariant: viewingProjectId ∈ index.
export interface WorkspaceState {
  viewingProjectId: string | null
  recentProjectIds: string[]
  lastOpenedAt: string
  /** Populated at read time from the in-memory lock table (not persisted). */
  executingProjectIds?: string[]
  /** Populated at read time from the in-memory wait queues (not persisted). */
  queuedProjectIds?: string[]
}

// A full project record (manifest only; the graph is fetched via the Runtime).
export interface ProjectRecord {
  manifest: ProjectManifest
}

// Create-project input. `fromTemplate` seeds the graph via importPipelineGraph.
export interface CreateProjectInput {
  // Domain type tag. Defaults to the registry's `defaultType`.
  type?: string
  name: string
  description?: string
  // Explicit id (tests / migration). Defaults to a generated id.
  id?: string
  // Owning ForgeaX game slug — tags the project for per-game list filtering.
  gameSlug?: string
  // Seed the new project's graph from a template graph (kernel reuses importPipelineGraph).
  fromTemplate?: ImportGraphInput
  // Extra import options when `fromTemplate` is given.
  templateOptions?: ImportGraphOptions
}

export interface UpdateProjectPatch {
  name?: string
  description?: string
  thumbnail?: string
  type?: string
  gameSlug?: string
}

// Optional filter for listProjects(). Omitting `gameSlug` (or passing undefined)
// returns every project — the "show all" behaviour list callers default to
// unless they explicitly scope by game.
export interface ListProjectsOptions {
  gameSlug?: string
}

export interface DeleteProjectOptions {
  assetPolicy?: AssetDeletePolicy
}

// App-supplied per-project Runtime factory (lets the app share one OpRegistry).
export interface ProjectRuntimeRequest {
  projectId: string
  // pipelineId === projectId (faithful Project.id === Pipeline.id invariant).
  pipelineId: string
  // Absolute graph.json path for this project.
  graphFile: string
  // Absolute history.jsonl path for this project.
  historyFile: string
  // Absolute outputs/ dir for this project.
  outputsDir: string
}

export type ProjectRuntimeFactory = (req: ProjectRuntimeRequest) => Runtime

export interface ProjectRegistryOptions {
  // Absolute workspace root that holds projects/ + workspace.json.
  workspaceRoot: string
  // Builds a Runtime targeting one project's isolated storage.
  createRuntime: ProjectRuntimeFactory
  // Default domain tag for new + backfilled projects. Default 'default'.
  defaultType?: string
  // Default name for the backfilled default project. Default 'Default'.
  defaultProjectName?: string
  // Id assigned to the backfilled default project. Default 'main'.
  defaultProjectId?: string
  // Relative dir (under workspaceRoot) of the legacy implicit pipeline's state to adopt as the default project on backfill. Default 'state'.
  legacyStateDir?: string
  // Optional asset cleanup hook on delete (app owns its asset library).
  onDeleteProjectAssets?: (projectId: string, policy: AssetDeletePolicy) => void | Promise<void>
  // How long an AI lock survives without renewal before it auto-expires and
  // is handed to the next queued agent (ms). Renewed on every successful
  // mutation and by the explicit heartbeat call. Default 10 minutes.
  lockLeaseMs?: number
  // How long a queued (not-yet-holding) write waiter may go without polling
  // `claimWriteAccess` again before its wait-queue slot is dropped (ms).
  // Default 15 minutes.
  queueEntryIdleMs?: number
  // How long an AI agent's shared (soft) open session survives untouched
  // before it auto-detaches (ms). Generous relative to the write lease: a
  // soft session blocks nothing except that agent's own ability to open a
  // different project. Default 30 minutes.
  sessionIdleMs?: number
}
