// Browser-safe Layer 2 contract.
//
// Mirrors @forgeax/node-runtime Layer 2 (applyBatch + queries + subscribe)
// without pulling Node-only deps (fs, chokidar, pino). Consumers (e.g.
// scene-generator's frontend) implement this over their transport of
// choice (HTTP, WebSocket, IPC, in-process).
//
// === Contract ===
//
// 1. Lifetime
//    Each ApiClient instance is bound to a single pipeline (pipelineId).
//    Multi-pipeline UIs hold multiple clients. dispose(), if present, is
//    idempotent and tears down the underlying transport (close socket,
//    abort pending requests).
//
// 2. Query semantics
//    - "Not found" returns null (getNode, getPipeline). List-shaped
//      queries return an empty readonly array on no match.
//    - Failures (network error, server reject, malformed response)
//      reject the Promise. Implementations MUST NOT throw
//      synchronously — wrap any sync errors in Promise.reject.
//
// 3. Read-after-write consistency
//    On the same client, the Promise returned by applyBatch is
//    guaranteed to resolve only after the server has committed (or
//    rejected) the batch. Subsequent queries observe the post-batch
//    state.
//
// 4. Subscription ordering
//    - Listeners are invoked synchronously in the order they were
//      registered.
//    - For events caused by an applyBatch on the SAME client, listeners
//      are invoked BEFORE the applyBatch Promise resolves. Do not
//      refetch from inside `await client.applyBatch(...)` — let the
//      listener handle it, otherwise you will double-fetch.
//    - Listeners SHOULD be exception-safe. A throwing listener may
//      break delivery to listeners registered after it on the same
//      channel; this is implementation-dependent.
//
// 5. Optimised reads
//    Prefer getPipeline() over (listNodes + listEdges) when you want a
//    consistent snapshot — it returns both with one round-trip and one
//    hash, eliminating skew.

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

/** Transport-level create-project request (template referenced by server-side path). */
export interface CreateProjectRequest {
  type?: string
  name: string
  description?: string
  /** Owning ForgeaX game slug — tags the project for per-game list filtering. */
  gameSlug?: string
  /** Server-side template path/id the backend resolves + seeds from. */
  fromTemplate?: string
}

/** Palette entry for a reusable group/template battery discovered by the app. */
export interface GroupTemplateBattery {
  id: string
  name: string
  nameEn?: string
  category: string
  description?: string
  descriptionEn?: string
  version?: string
  /** Authoring metadata persisted in the template json (read-only display). */
  author?: string
  /** Creation timestamp (ms epoch) persisted in the template json; falls back to the file mtime. */
  createdAt?: number
  iconSvg?: string
  /** Base64 data URL of icon.png beside the template json, when present. */
  iconPng?: string
  displayGroup?: string
  sourcePath?: string
  tags?: string[]
  tagLabels?: string[]
  /** True for preset templates shipped in the plugin (read-only); false for user templates under `.forgeax`. */
  builtin?: boolean
  /**
   * Public Scene Script surface for a published native Definition. The backend
   * deliberately omits the sealed `definition` body; palette consumers only
   * need the callable name and public ports.
   */
  nativeDefinition?: {
    functionName: string
    kind: 'group' | 'template'
    contractVersion: string
    definitionId?: string
    definitionVersion?: string
    description: string
    inputs: Array<{
      name: string
      type: string
      access?: 'item' | 'list' | 'tree'
      required?: boolean
      defaultValue?: unknown
      runtimePort?: string
      label?: string
      hidden?: boolean
      order?: number
    }>
    outputs: Array<{
      name: string
      type: string
      access?: 'item' | 'list' | 'tree'
      runtimePort?: string
      label?: string
      hidden?: boolean
      order?: number
    }>
  }
}

/**
 * Sibling docs for a template battery folder (`icon.png` / `usage.png` / `README.md`).
 * Returned by `GET /api/v1/group-templates/:id/docs`; missing files omit the field.
 */
export interface GroupTemplateDocs {
  iconPng?: string
  usagePng?: string
  readme?: string
}

/** Server response of POST /projects/:id/view. */
export interface ViewProjectResult {
  project: ProjectRecord
  /** The viewed project's graph snapshot (null when empty/unwritten). */
  pipeline: PipelineSnapshot | null
}

/** @deprecated Use ViewProjectResult / viewProject(). */
export type ActivateProjectResult = ViewProjectResult

/** A saved text preset (built-in or user). `builtin` entries are read-only. */
export interface TextPresetDto {
  id: string
  title: string
  text: string
  createdAt: number
  builtin: boolean
}

/**
 * A saved prompt (built-in or user). `vars` is the ordered, de-duplicated list
 * of `[placeholder]` names parsed from `template`; each becomes a `str` input
 * port on the dropped prompt battery. `builtin` entries are read-only.
 */
export interface PromptDto {
  id: string
  name: string
  /** Sub-group (small label) under the "Prompts" big tag. Defaults to 'saved'. */
  tag: string
  template: string
  vars: string[]
  createdAt: number
  builtin: boolean
  /** Palette icon SVG — preset vs user variant, by `builtin`. */
  iconSvg?: string
}

export interface ApiClient {
  /** Pipeline id this client is bound to. */
  readonly pipelineId: string

  // Mutations -------------------------------------------------------------
  applyBatch(ops: readonly Op[], opts?: ApplyBatchOptions): Promise<ApplyBatchResult>

  // Execution ------------------------------------------------------------
  /** Run the pipeline (omit nodeId) or a node's upstream closure. Resolves
   *  when the run finishes; live progress arrives on the 'execution' channel. */
  execute(request?: { nodeId?: string; quietErrors?: boolean }): Promise<ExecutionResult>
  /** Remove every persisted outputs/<nodeId>/ cache directory for this project. */
  clearOutputCache(): Promise<{ ok: true }>

  // Queries ---------------------------------------------------------------
  getPipeline(): Promise<PipelineSnapshot | null>
  /** Lightweight hash poll for live-sync reconciler (optional on transports). */
  getPipelineHash?(): Promise<{ hash: string | null }>
  getNode(nodeId: string): Promise<GraphNode | null>
  listNodes(filter?: NodeFilter): Promise<readonly GraphNode[]>
  listEdges(): Promise<readonly GraphEdge[]>
  getNodeOutput(nodeId: string, portId: string): Promise<unknown>
  /** Metadata-only output read — cheap skip check before full GET (optional). */
  getNodeOutputMeta?(
    nodeId: string,
    portId: string,
  ): Promise<{ executedHash: string; valid: boolean; sharded: boolean; missing?: boolean }>
  /**
   * Batch value+meta read for many ports in ONE HTTP round trip — replaces N
   * sequential getNodeOutputMeta+getNodeOutput pairs with a single request
   * (optionally `metaOnly` to skip value serialization entirely). OPTIONAL:
   * transports that don't implement it force callers to fall back to the
   * per-port path.
   */
  getNodeOutputsBatch?(
    ports: ReadonlyArray<{ nodeId: string; portId: string }>,
    opts?: { metaOnly?: boolean },
  ): Promise<
    ReadonlyArray<{
      nodeId: string
      portId: string
      value?: unknown
      /**
       * Present when the backend shipped a Phase-2 deduped wire envelope
       * instead of a `tooLarge` sentinel — see
       * wb-scene-generator-scene-tree-storage.md §3. `value` still holds the
       * DataTreeEntry[]-shaped payload, but any item field that repeats
       * (e.g. a `scene_focus_path` decoration tree shared by many branches)
       * is replaced by `{ __outputCacheBlobRef: hash }`; `blobs[hash]` holds
       * the one real copy. Callers must hydrate `value` against `blobs`
       * before treating it as a normal port value.
       */
      blobs?: Record<string, unknown>
      meta: { executedHash: string; valid: boolean; sharded: boolean; dataChunks?: number; type?: string } | null
      tooLarge?: boolean
      estimatedBytes?: number
    }>
  >
  getHistory(opts?: HistoryQuery): Promise<readonly HistoryEntryV1[]>
  listOps(): Promise<readonly OpSpec[]>

  // Group queries (Phase G — kernel v0.2.0+). Single-level groups only.
  getGroup(groupId: string): Promise<NodeGroup | null>
  listGroups(): Promise<readonly NodeGroup[]>
  /**
   * READ-ONLY probe of a group's INNER sub-graph: re-runs the inner nodes (with
   * the group's external inputs hydrated from the persisted output cache) and
   * returns each inner node's output bag, keyed innerNodeId -> { port -> value }.
   * Powers the internal view's wire data-probes (a group otherwise executes as a
   * black box and discards inner intermediates). OPTIONAL: transports that don't
   * support it leave the internal view empty (degrades to prior behaviour).
   */
  probeGroupInner?(groupId: string): Promise<Record<string, Record<string, unknown>> | null>

  // Subscriptions ---------------------------------------------------------
  /**
   * Register a listener for events on `channel`. Returns an unsubscribe
   * function that is safe to call multiple times. See contract §4 for
   * ordering and exception-safety rules.
   */
  subscribe(channel: RuntimeChannel, listener: (e: RuntimeEvent) => void): () => void

  // Asset path resolution -------------------------------------------------
  // Resolver lives server-side; the browser asks via apiClient.
  // Sync UI bindings (e.g. <img src=...>) should layer a caching hook
  // (see useAssetPath) on top of this Promise-shaped primitive.
  resolveAssetPath(template: string, vars?: Record<string, string>): Promise<string>

  // Graph import / export (optional) -------------------------------------
  // The faithful "load a node-connection graph from a file" feature. These
  // are OPTIONAL and additive: a transport that fronts an app exposing the
  // import routes implements them (see scene-generator's HttpApiClient); the
  // in-memory mock and minimal transports may omit them. The editor's Open /
  // Save toolbar actions degrade gracefully when they are absent.

  /** List graph templates the server discovered under its templates directory. */
  listImportTemplates?(): Promise<readonly ImportTemplate[]>
  /** Import a template FILE the server reads + applies (replace/merge + optional execute). */
  importPipelineFile?(req: {
    path: string
    source?: string
    options?: ImportPipelineExecuteOptions
  }): Promise<ImportPipelineResponse>
  /** Export the current graph to a server-side template file. */
  exportPipelineFile?(req: { name?: string; source?: string }): Promise<{ path: string; name: string }>

  // Group/template batteries (optional) ----------------------------------
  /** List reusable group/template batteries. `scope`: all (editor default), groups (develop), templates (Sino). */
  listGroupTemplates?(scope?: 'all' | 'groups' | 'templates'): Promise<readonly GroupTemplateBattery[]>
  /** Load a reusable group/template battery; scope selects groups/ vs templates/ when ids collide. */
  loadGroupTemplate?(
    groupId: string,
    opts?: { scope?: 'groups' | 'templates' },
  ): Promise<NodeGroup | null>
  /**
   * Load template sibling docs (icon.png / usage.png / README.md) for the
   * "View details" panel. Apps without the route omit this method.
   */
  loadGroupTemplateDocs?(groupId: string): Promise<GroupTemplateDocs | null>
  /**
   * Add one published native Definition call to the canonical Scene Script and
   * persist its authoring layout. This is intentionally distinct from loading
   * JSON and applying raw createGroup ops.
   */
  instantiateNativeDefinition?(
    functionName: string,
    position: { x: number; y: number },
  ): Promise<{ status: 'ok'; entityId: string; statementId: string; revision: string; graphHash?: string }>
  /** Read the optimistic project revision used by canonical authoring commands. */
  getSceneAuthoringProjectInfo?(): Promise<{
    canonical: boolean
    canonicalModule: string
    projectRevision: string
    moduleRevisions: Record<string, { moduleId: string; revision: string }>
  }>
  /** Apply graph intent through the canonical Scene Project command route. */
  applySceneAuthoringCommands?(req: {
    expectedProjectRevision: string
    expectedModuleRevisions?: Record<string, string>
    commands: unknown[]
    label?: string
  }): Promise<{
    status: 'ok'
    projectRevision: string
    graphHash?: string
    transaction?: { applied: boolean; rolledBack: boolean; undoToken?: string }
  }>
  /** Restore the previous canonical authoring source transaction and rebuild projections. */
  undoSceneAuthoring?(req: { expectedProjectRevision: string }): Promise<{
    status: 'ok'
    direction: 'undo'
    projectRevision: string
    graphHash?: string
    history: { cursor: number; length: number; canUndo: boolean; canRedo: boolean }
  }>
  /** Reapply the next canonical authoring source transaction and rebuild projections. */
  redoSceneAuthoring?(req: { expectedProjectRevision: string }): Promise<{
    status: 'ok'
    direction: 'redo'
    projectRevision: string
    graphHash?: string
    history: { cursor: number; length: number; canUndo: boolean; canRedo: boolean }
  }>
  /** Persist a group as a reusable template battery. */
  saveGroupTemplate?(req: {
    group: NodeGroup
    categoryName: string
    batteryName: string
  }): Promise<{ filePath: string; groupId: string; categoryName: string; batteryName: string }>
  /**
   * Persist a group as a USER template (user content). Stored under the app's
   * workspace `.forgeax` area beneath the fixed "My templates" big-label, with
   * `smallTag` as the sub-folder. Surfaces in the Templates palette alongside
   * the built-in templates (the catalog merges both sources).
   */
  saveUserTemplate?(req: {
    group: NodeGroup
    smallTag: string
    templateName: string
  }): Promise<{ filePath: string; groupId: string; smallTag: string; templateName: string }>
  /**
   * Delete a USER template by group id. Only user content (under the workspace
   * `.forgeax` area) is deletable; preset templates shipped in the plugin are
   * read-only and the server rejects the request.
   */
  deleteUserTemplate?(groupId: string): Promise<{ ok: boolean }>
  /**
   * Delete a develop GROUPS-tab group battery (groups/<cat>/<name>) from the
   * app's local battery directory. Mirrors `saveGroupTemplate` (which writes the
   * same files); transports fronting an app without the delete route omit this,
   * and the palette hides the per-row delete button accordingly.
   */
  deleteGroupTemplate?(groupId: string): Promise<{ ok: boolean }>
  /** List template category folders, including empty folders when the app can scan them. */
  listTemplateCategories?(): Promise<readonly string[]>
  /**
   * List the `templates/` subfolders (incl. empty placeholder dirs) for the
   * Templates palette rail. Distinct from `listTemplateCategories` which lists
   * the `groups/` save-target categories used by the save dialog.
   */
  listTemplateOnlyCategories?(): Promise<readonly string[]>

  // Multi-project management (optional, app-level) -----------------------
  // Faithful port of the legacy project registry. OPTIONAL + additive: a
  // transport fronting an app that exposes the project routes implements them
  // (see scene-generator's HttpApiClient); minimal transports omit them and the
  // projectStore degrades to a single implicit pipeline. `viewProject` is
  // the open cascade's server step — it sets the UI viewing target so subsequent
  // getPipeline()/applyBatch() observe the viewed project's isolated graph.

  /**
   * List projects in the workspace. `opts.gameSlug` scopes to that game's
   * projects only; omit (or pass `{ gameSlug: undefined }`) to list every
   * project ("show all"). Transports that don't support scoping ignore opts
   * and always return everything.
   */
  listProjects?(opts?: { gameSlug?: string }): Promise<readonly ProjectMeta[]>
  /** Fetch one project's manifest. Null when not found. */
  getProject?(id: string): Promise<ProjectRecord | null>
  /**
   * Read-only produced-asset summary for one project — `producedCount` is the
   * project's live private-asset tally. Drives the delete dialog's asset-policy
   * gating. Optional: transports without project routes omit it.
   */
  getProjectAssetsSummary?(id: string): Promise<{ producedCount: number }>
  /** Create a project (optionally seeded from a server-side template). */
  createProject?(req: CreateProjectRequest): Promise<ProjectMeta>
  /** Patch a project's metadata (name / description / thumbnail / type / gameSlug). */
  updateProject?(id: string, patch: { name?: string; description?: string; thumbnail?: string; type?: string; gameSlug?: string }): Promise<ProjectMeta>
  /** Delete a project; the server enforces "never empty" and returns the new workspace. */
  deleteProject?(id: string, opts?: { assetPolicy?: AssetDeletePolicy }): Promise<{ ok: true; workspace: WorkspaceState }>
  /** Switch the UI viewing project (the server step of the open cascade). */
  viewProject?(id: string): Promise<ViewProjectResult>
  /** @deprecated Use viewProject(). */
  activateProject?(id: string): Promise<ViewProjectResult>
  /** Read-only lock holder for a project (agent execution badge). */
  getProjectLock?(id: string): Promise<{ lock: { agentId: string; kind: string; acquiredAt: string; sessionId?: string } | null }>
  /** All active agent locks — batch fetch for the project panel. */
  listWorkspaceLocks?(): Promise<{ locks: readonly { projectId: string; agentId: string; kind: string; acquiredAt: string; sessionId?: string }[] }>
  /** Read the workspace doc (viewingProjectId / recentProjectIds / executingProjectIds). */
  getWorkspace?(): Promise<WorkspaceState>
  /** Patch the workspace doc. */
  setWorkspace?(patch: Partial<WorkspaceState>): Promise<WorkspaceState>

  // Text presets (optional, app-level) -----------------------------------
  // Saved Panel texts surfaced in the BatteryBar's "presets" rail. OPTIONAL +
  // additive: a transport fronting an app that exposes the preset routes
  // implements them (see the 2d-scene-asset-generator HttpApiClient); minimal
  // transports omit them and the editor falls back to localStorage-backed
  // presets. A preset = { id, title, text, createdAt, builtin } where `builtin`
  // entries are read-only (ship with the plugin) and cannot be deleted.

  /** List all text presets (built-in + user), merged + newest-first. */
  listTextPresets?(): Promise<readonly TextPresetDto[]>
  /** Create a user text preset (title + text). Returns the created entry. */
  createTextPreset?(req: { title?: string; text: string }): Promise<TextPresetDto>
  /** Delete a user text preset by id. Built-in presets reject. */
  deleteTextPreset?(id: string): Promise<{ ok: boolean }>

  // Prompts (optional, app-level) ----------------------------------------
  // Saved Panel prompts surfaced as draggable batteries under the BatteryBar
  // "Prompts" big tag. OPTIONAL + additive: a transport fronting an app that
  // exposes the prompt routes implements them (see the 2d-scene-asset-generator
  // HttpApiClient); transports without them simply show no Prompts tag and the
  // panel's "Save as Prompt" action is hidden. The server parses the
  // `[placeholder]` names out of the template into `vars` on create.

  /** List all prompts (built-in + user), merged + newest-first. */
  listPrompts?(): Promise<readonly PromptDto[]>
  /** Create a user prompt (name + optional sub-tag + template). Returns the created entry. */
  createPrompt?(req: { name?: string; tag?: string; template: string }): Promise<PromptDto>
  /** Delete a user prompt by id. Built-in prompts reject. */
  deletePrompt?(id: string): Promise<{ ok: boolean }>


  // Lifecycle -------------------------------------------------------------
  /**
   * Tear down the underlying transport. Optional — implementations that
   * have nothing to release (e.g. in-process / mock) may omit this. Must
   * be idempotent: multiple calls are no-ops after the first.
   */
  dispose?(): void
}
