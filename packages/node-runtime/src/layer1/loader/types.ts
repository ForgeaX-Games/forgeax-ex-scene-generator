// Public types for the battery (op) loader: the loader contract plus the
// parseSpec hook that turns a `scene.contract.ts` source buffer into an OpSpec.

import type { OpSpec } from '../types/op-spec.js'

// Directory layouts the kernel knows how to walk under each scanDir.
export type ScanLayout = 'three-level' | 'flexible'

// Loader construction config: which plugin owns the ops, which dirs to scan, the layout strategy, whether to hot-reload, and an optional hook to drop or rename ops after parsing.
export interface BatteryLoaderConfig {
  // Plugin id used to namespace registered op ids when the contract omits an explicit opId (e.g. directory humanoid-skeleton/ under plugin 3d-lowpoly yields op id 3d-lowpoly.humanoid-skeleton).
  pluginId: string

  // Absolute paths to scan, typically built by plugins from path slots (kernel.batteries.user, plugin.batteries.builtin, etc.).
  scanDirs: readonly string[]

  // Layout strategy under each scanDir: three-level is {bigTag}/{smallTag}/{batteryId}, flexible is {bigTag}/{batteryDir|smallTag/batteryDir}. Mixed per-directory layouts still work because the loader detects scene.contract.ts at every depth.
  layout?: ScanLayout

  // Hot-reload via chokidar. Default false.
  watch?: boolean

  // Plugin hook to drop (return null) or rename (return a different id) an op after the kernel parsed it.
  filter?: (id: string, dir: string) => string | null

  // Required. Hosts pass parseAtomicContractSource + contractToOpSpec. The kernel does not import scene-authoring.
  parseSpec: (dir: string, source: string) => Omit<OpSpec, 'execute'>
}

// One per-directory scan failure, collected rather than thrown so a single bad folder never aborts the scan.
export interface ScanError {
  dir: string
  reason: string
}

// Outcome of a scan: newly registered, updated (contract / index / icon changed), and removed (source dir gone) counts, plus the collected per-directory failures.
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
