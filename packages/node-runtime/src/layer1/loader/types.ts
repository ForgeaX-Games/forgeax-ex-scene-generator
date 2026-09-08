// Public types for the battery (op) loader: the loader contract plus the on-disk meta.json shape every battery folder conforms to.

// Directory layouts the kernel knows how to walk under each scanDir.
export type ScanLayout = 'three-level' | 'flexible'

// Loader construction config: which plugin owns the ops, which dirs to scan, the layout strategy, whether to hot-reload, and an optional hook to drop or rename ops after parsing.
export interface BatteryLoaderConfig {
  // Plugin id used to namespace registered op ids when meta.json omits an explicit id (e.g. directory humanoid-skeleton/ under plugin wb-3d-lowpoly yields op id wb-3d-lowpoly.humanoid-skeleton).
  pluginId: string

  // Absolute paths to scan, typically built by plugins from path slots (kernel.batteries.user, plugin.batteries.builtin, etc.).
  scanDirs: readonly string[]

  // Layout strategy under each scanDir: three-level is {bigTag}/{smallTag}/{batteryId}, flexible is {bigTag}/{batteryDir|smallTag/batteryDir}. Mixed per-directory layouts still work because the loader detects meta.json at every depth.
  layout?: ScanLayout

  // Hot-reload via chokidar. Default false.
  watch?: boolean

  // Plugin hook to drop (return null) or rename (return a different id) an op after the kernel parsed it.
  filter?: (id: string, dir: string) => string | null
}

// One per-directory scan failure, collected rather than thrown so a single bad folder never aborts the scan.
export interface ScanError {
  dir: string
  reason: string
}

// Outcome of a scan: newly registered, updated (meta.json changed), and removed (source dir gone) counts, plus the collected per-directory failures.
export interface ScanResult {
  added: number
  updated: number
  removed: number
  errors: ScanError[]
}

// Event a loader emits as the registry diff unfolds, so plugins can mirror it into their UI metadata store.
export type LoaderEvent =
  | { kind: 'op-added'; opId: string; sourceDir: string }
  | { kind: 'op-updated'; opId: string; sourceDir: string }
  | { kind: 'op-removed'; opId: string; sourceDir: string }
  | { kind: 'scan-error'; error: ScanError }

// Handle returned from subscribe / startWatching that tears the subscription down.
export type LoaderUnsubscribe = () => void

// The loader contract: initial scan, full re-scan, chokidar watch, event subscription, and a snapshot of known op ids.
export interface BatteryLoader {
  scan(): Promise<ScanResult>
  reload(): Promise<ScanResult>
  startWatching(): LoaderUnsubscribe
  subscribe(handler: (event: LoaderEvent) => void): LoaderUnsubscribe
  list(): readonly string[]
}

// The on-disk meta.json shape every battery folder must conform to. Fields are loose (mostly optional with sane defaults; the parser fills the gaps). UI-only fields (color, tags, displayGroup, etc.) are read here but the kernel ignores them — plugins consume them via the loader's metaJson snapshot, not via OpSpec.

// A single input/output port declaration.
export interface BatteryMetaPort {
  name?: string
  type?: string
  required?: boolean
  default?: unknown
  description?: string
  'description-en'?: string
  label?: string
  options?: string[]
  // 'item' | 'list' | 'tree' — the dispatcher's per-port mode.
  access?: 'item' | 'list' | 'tree'
}

// A single static parameter declaration.
export interface BatteryMetaParam {
  name?: string
  type?: string
  default?: unknown
  description?: string
  options?: string[]
  min?: number
  max?: number
  label?: string
}

// Config for a variable-arity port group (e.g. a merge node growing item_0, item_1, ...).
export interface BatteryMetaDynamicConfig {
  prefix?: string
  labelTemplate?: string
  minCount?: number
  type?: string
  access?: 'item' | 'list' | 'tree'
}

// The full battery meta.json document: identity/labels, port and param declarations, dispatcher hints (lacing, dynamic ports, engineBehavior, manualTrigger), and UI-only fields the kernel passes through untouched.
export interface BatteryMeta {
  id?: string
  type?: string
  label?: string
  name?: string
  'name-zh'?: string
  'name-en'?: string
  category?: string
  description?: string
  'description-en'?: string
  version?: string
  author?: string
  inputs?: BatteryMetaPort[]
  outputs?: BatteryMetaPort[]
  params?: BatteryMetaParam[]
  icon?: string
  color?: string
  tags?: string[]
  tag_labels?: string[]
  dynamicInputs?: BatteryMetaDynamicConfig
  dynamicOutputs?: BatteryMetaDynamicConfig
  lacing?: 'longest' | 'shortest' | 'cross' | 'pairwise'
  principal?: string
  engineBehavior?: 'loopUnpack'
  // Manual-trigger gate: when true the op never auto-runs in the pipeline walk; only an explicit user action (the editor's AI-node Run button) produces its output. The parser also infers this for batteries the editor renders with a Run button (frontend.nodeType === 'ai_battery'), so a battery only opts in explicitly to override the inference.
  manualTrigger?: boolean
  // Plugin-specific multi-project visibility hint. Kernel passes through.
  projectTypes?: string[]
  frontend?: {
    nodeType?: string
    displayGroup?: string
    hideOutputs?: boolean
  }
}
