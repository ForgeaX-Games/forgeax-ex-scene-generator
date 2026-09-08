// Loader main implementation: walks every configured scanDir, parses each meta.json, dynamic-imports index.ts for the execute closure, builds an OpSpec, and registers it with the kernel registry. Optional chokidar hot-reload watches the same scanDirs and re-scans to emit per-folder add/remove/update events.

import { existsSync, readFileSync, readdirSync, statSync, copyFileSync, unlinkSync } from 'node:fs'
import { join, basename } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { OpRegistry } from '../op-registry.js'
import type { ExecutionContext, OpSpec } from '../types/op-spec.js'
import { metaToOpSpec } from './meta-parser.js'
import type { BatteryLoader, BatteryLoaderConfig, BatteryMeta, LoaderEvent, LoaderUnsubscribe, ScanError, ScanResult } from './types.js'

// Bookkeeping for one registered op: its source dir, the id it was registered under, and mtimes that drive update detection.
interface LoadedOp {
  dir: string
  id: string
  metaMtime: number
  /** Latest mtime of index.ts / index.js — hot-reload must pick up execute-logic edits without meta.json changes. */
  entryMtime: number
}

// Core factory: closes over the kernel registry and config, holding the loaded-op bookkeeping, event subscribers, and the optional watcher, and returns the BatteryLoader surface (see types.ts).
export function createBatteryLoader(
  registry: OpRegistry,
  config: BatteryLoaderConfig,
): BatteryLoader {
  const loaded = new Map<string, LoadedOp>() // key = dir
  const subscribers = new Set<(event: LoaderEvent) => void>()
  let watcher: { close: () => Promise<void> } | null = null

  // Fan a loader event out to every subscriber, isolating a bad listener so it can't poison the rest.
  function emit(event: LoaderEvent): void {
    for (const sub of subscribers) {
      try {
        sub(event)
      } catch {
        /* swallow subscriber errors so one bad listener does not poison the loader */
      }
    }
  }

  // List a directory's immediate subdirectories (skipping dotfiles / node_modules), sorted so the walk order — and thus which directory wins an id collision — is reproducible across machines and filesystems.
  function listSubdirectories(dir: string): string[] {
    if (!existsSync(dir)) return []
    try {
      return readdirSync(dir)
        .filter((name) => {
          if (name.startsWith('.') || name === 'node_modules') return false
          try {
            return statSync(join(dir, name)).isDirectory()
          } catch {
            return false
          }
        })
        .sort()
    } catch {
      return []
    }
  }

  // Recursively collect every directory containing a meta.json. The kernel imposes no fixed depth (2-level / 3-level / mixed layouts are all fine); a directory with meta.json is treated as a leaf and not descended into, and the walk is bounded by the node_modules / dotfile filtering in listSubdirectories.
  function findBatteryDirs(root: string, out: string[]): void {
    if (!existsSync(root)) return
    let isLeaf = false
    if (existsSync(join(root, 'meta.json'))) {
      out.push(root)
      isLeaf = true
    }
    if (isLeaf) return
    for (const child of listSubdirectories(root)) {
      findBatteryDirs(join(root, child), out)
    }
  }

  // Latest mtime of the battery entry module (index.ts or index.js).
  function entryMtime(dir: string): number {
    let latest = 0
    for (const name of ['index.ts', 'index.js'] as const) {
      const p = join(dir, name)
      if (!existsSync(p)) continue
      try {
        latest = Math.max(latest, statSync(p).mtimeMs)
      } catch {
        /* unreadable — treat as unchanged */
      }
    }
    return latest
  }

  // Load one battery directory into a complete OpSpec: parse meta.json, run the filter hook, dynamic-import index.ts for its execute function, and stitch the two together. Every failure is pushed to errors and returns null so a single bad folder never aborts the whole scan.
  async function loadOne(
    dir: string,
    errors: ScanError[],
    opts: { bustImport?: boolean } = {},
  ): Promise<OpSpec | null> {
    const metaPath = join(dir, 'meta.json')
    if (!existsSync(metaPath)) return null

    let meta: BatteryMeta
    try {
      meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as BatteryMeta
    } catch (e) {
      errors.push({ dir, reason: `meta.json parse failed: ${e instanceof Error ? e.message : String(e)}` })
      return null
    }

    const fallbackId = meta.id ?? `${config.pluginId}.${basename(dir)}`
    const baseSpec = metaToOpSpec(meta, fallbackId)
    const filteredId = config.filter ? config.filter(baseSpec.id, dir) : baseSpec.id
    if (filteredId === null) return null
    const finalId = filteredId

    // Dynamic-import index.ts (or its compiled index.js) for the execute closure.
    const indexPath = join(dir, 'index.ts')
    const indexJsPath = join(dir, 'index.js')
    const entryPath = existsSync(indexPath) ? indexPath : existsSync(indexJsPath) ? indexJsPath : null

    if (!entryPath) {
      errors.push({ dir, reason: 'index.ts / index.js not found' })
      return null
    }

    let entryModule: Record<string, unknown>
    try {
      let importPath = entryPath
      if (opts.bustImport) {
        // Unique staging path busts ESM module cache (query strings break vitest/.ts).
        const ext = entryPath.endsWith('.js') ? '.js' : '.ts'
        importPath = join(dir, `.forgeax-reload-${Date.now()}${ext}`)
        copyFileSync(entryPath, importPath)
      }
      try {
        let timer: NodeJS.Timeout | undefined
        try {
          entryModule = await Promise.race([
            import(/* @vite-ignore */ pathToFileURL(importPath).href) as Promise<Record<string, unknown>>,
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => {
                reject(new Error(`dynamic import timed out after 15s: ${entryPath}`))
              }, 15_000)
            }),
          ])
        } finally {
          if (timer) clearTimeout(timer)
        }
      } finally {
        if (importPath !== entryPath) {
          try {
            unlinkSync(importPath)
          } catch {
            /* staging cleanup best-effort */
          }
        }
      }
    } catch (e) {
      errors.push({
        dir,
        reason: `dynamic import failed: ${e instanceof Error ? e.message : String(e)}`,
      })
      return null
    }

    // Entry convention: the first exported lowercase-named function is the op's execute body.
    const entryFn = Object.values(entryModule).find(
      (v) =>
        typeof v === 'function' &&
        /^[a-z]/.test((v as { name: string }).name),
    ) as ((input: Record<string, unknown>, ctx?: ExecutionContext) => unknown) | undefined

    if (!entryFn) {
      errors.push({ dir, reason: 'no lowercase-named entry function exported' })
      return null
    }

    const op: OpSpec = {
      ...baseSpec,
      id: finalId,
      execute: (ctx, args) => entryFn(args, ctx),
    }
    return op
  }

  // Full scan: walk every scanDir, incrementally (re)register each battery by meta.json mtime, and reconcile the registry against what was loaded last time. Op ids must be unique across directories, so a duplicate-id guard makes the first directory to claim an id win (the walk is deterministic because listSubdirectories sorts) and reports + skips any later directory re-using it rather than silently overwriting in filesystem order. Distinct dirs with distinct ids coexist; only a true id clash is flagged.
  async function scan(): Promise<ScanResult> {
    const result: ScanResult = { added: 0, updated: 0, removed: 0, errors: [] }
    const visitedDirs = new Set<string>()
    const seenIds = new Map<string, string>() // op id -> winning source dir
    const noteWinner = (id: string, dir: string): void => {
      if (!seenIds.has(id)) seenIds.set(id, dir)
    }

    for (const root of config.scanDirs) {
      const dirs: string[] = []
      findBatteryDirs(root, dirs)
      for (const dir of dirs) {
        visitedDirs.add(dir)
        const metaMtime = (() => {
          try {
            return statSync(join(dir, 'meta.json')).mtimeMs
          } catch {
            return 0
          }
        })()

        const entryMt = entryMtime(dir)

        const prev = loaded.get(dir)
        if (prev && prev.metaMtime === metaMtime && prev.entryMtime === entryMt && registry.has(prev.id)) {
          // No change.
          noteWinner(prev.id, dir)
          continue
        }

        const op = await loadOne(dir, result.errors, {
          bustImport: prev !== undefined && prev.entryMtime !== entryMt,
        })
        if (!op) continue

        const winner = seenIds.get(op.id)
        if (winner !== undefined && winner !== dir) {
          result.errors.push({
            dir,
            reason: `duplicate op id "${op.id}" — already provided by "${winner}"; skipping this duplicate (op ids must be unique across battery directories)`,
          })
          continue
        }
        noteWinner(op.id, dir)

        if (prev) {
          // Update path: re-register under the same id.
          if (prev.id !== op.id) {
            // Id changed — drop the old, register the new.
            registry.unregister(prev.id)
            emit({ kind: 'op-removed', opId: prev.id, sourceDir: dir })
          }
          registry.replace(op)
          loaded.set(dir, { dir, id: op.id, metaMtime, entryMtime: entryMt })
          result.updated++
          emit({ kind: 'op-updated', opId: op.id, sourceDir: dir })
        } else {
          registry.replace(op)
          loaded.set(dir, { dir, id: op.id, metaMtime, entryMtime: entryMt })
          result.added++
          emit({ kind: 'op-added', opId: op.id, sourceDir: dir })
        }
      }
    }

    // Reconcile removals: any previously loaded dir not seen this pass had its source deleted, so unregister it.
    for (const [dir, info] of loaded.entries()) {
      if (visitedDirs.has(dir)) continue
      registry.unregister(info.id)
      loaded.delete(dir)
      result.removed++
      emit({ kind: 'op-removed', opId: info.id, sourceDir: dir })
    }

    for (const error of result.errors) emit({ kind: 'scan-error', error })
    return result
  }

  // Re-scan from scratch (same as scan; the diffing inside makes it idempotent).
  async function reload(): Promise<ScanResult> {
    return scan()
  }

  // Watch every scanDir via chokidar and debounce file changes into a re-scan; no-op when watch was false. Chokidar is dynamic-imported so consumers that never watch don't pay for the dep. Returns an unsubscribe that stops the watcher.
  function startWatching(): LoaderUnsubscribe {
    if (!config.watch) return () => undefined
    if (watcher) return () => undefined

    let unsubscribed = false
    let debounceTimer: NodeJS.Timeout | null = null

    void (async (): Promise<void> => {
      const chokidar = (await import('chokidar')) as typeof import('chokidar')
      if (unsubscribed) return
      const w = chokidar.watch(config.scanDirs as string[], {
        ignoreInitial: true,
        ignored: (p: string) => /node_modules|(^|\/)\../.test(p),
      })
      const triggerRescan = (): void => {
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          void scan()
        }, 200)
      }
      w.on('add', triggerRescan)
      w.on('change', triggerRescan)
      w.on('unlink', triggerRescan)
      w.on('addDir', triggerRescan)
      w.on('unlinkDir', triggerRescan)
      watcher = w as unknown as { close: () => Promise<void> }
    })()

    return (): void => {
      unsubscribed = true
      if (debounceTimer) clearTimeout(debounceTimer)
      void watcher?.close()
      watcher = null
    }
  }

  // Register an event handler; the returned function removes it.
  function subscribe(handler: (event: LoaderEvent) => void): LoaderUnsubscribe {
    subscribers.add(handler)
    return () => {
      subscribers.delete(handler)
    }
  }

  // Snapshot of every op id this loader currently has registered.
  function list(): readonly string[] {
    return [...loaded.values()].map((l) => l.id)
  }

  return { scan, reload, startWatching, subscribe, list }
}
