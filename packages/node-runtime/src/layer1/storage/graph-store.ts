// In-memory last-run display projection for the canvas.
// Composition Scene Projects own semantics in `.scene.ts`; this store holds
// the display graph projected from a Scene Script call trace. Scene execute
// is runSceneModule, not executeNode walking this graph.
// Disk `graph.json` is an optional cache (persist: true). It is not a project
// SSOT and is not required to open or execute.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type { GraphFileV1 } from './types.js'

export interface GraphStoreOptions {
  /** When false, never read or write graph.json. Default true for kernel tests. */
  persist?: boolean
}

/** Stable, deterministic JSON canonicalisation: sorted keys at every level. */
export function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(canonicalize)
  const obj = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(obj).sort()) out[k] = canonicalize(obj[k])
  return out
}

/** Compute the hash that goes into GraphFileV1.hash. Excludes the hash field itself. */
export function computeGraphHash(graph: Omit<GraphFileV1, 'hash'> & { hash?: string }): string {
  const { hash: _drop, ...rest } = graph
  void _drop
  const canon = JSON.stringify(canonicalize(rest))
  return createHash('sha256').update(canon).digest('hex')
}

function fileSignature(path: string): string | null {
  try {
    const st = statSync(path)
    return `${st.mtimeMs}:${st.size}`
  } catch {
    return null
  }
}

export class GraphStore {
  private snapshot: GraphFileV1 | null = null
  private fileSig: string | null = null

  constructor(
    private readonly path: string,
    private readonly options: GraphStoreOptions = {},
  ) {}

  get persist(): boolean {
    return this.options.persist !== false
  }

  /** True when a compiled projection is in memory, or a persisted file exists. */
  exists(): boolean {
    if (this.snapshot) return true
    return this.persist && existsSync(this.path)
  }

  /**
   * Install a compiled projection without requiring a disk file.
   * Hash is recomputed unless the caller already stamped a 64-char sha256.
   */
  hydrate(graph: Omit<GraphFileV1, 'hash'> & { hash?: string }): GraphFileV1 {
    const hash = typeof graph.hash === 'string' && /^[0-9a-f]{64}$/u.test(graph.hash)
      ? graph.hash
      : computeGraphHash(graph)
    const next: GraphFileV1 = { ...(graph as GraphFileV1), hash, schemaVersion: 1 }
    this.snapshot = next
    return next
  }

  /**
   * Load the compiled projection. Memory snapshot wins.
   * When persist is on and the file changed under us, re-read and validate.
   * Returns null when nothing has been compiled yet.
   */
  load(): GraphFileV1 | null {
    if (!this.persist) return this.snapshot

    if (!existsSync(this.path)) {
      return this.snapshot
    }

    const sig = fileSignature(this.path)
    if (this.snapshot && sig !== null && sig === this.fileSig) return this.snapshot

    let parsed: GraphFileV1
    try {
      parsed = JSON.parse(readFileSync(this.path, 'utf-8')) as GraphFileV1
    } catch (e) {
      throw new Error(`graph.json parse failed: ${e instanceof Error ? e.message : String(e)}`)
    }
    if (parsed.schemaVersion !== 1) {
      throw new Error(`graph.json schemaVersion=${parsed.schemaVersion} is not supported`)
    }
    const recomputed = computeGraphHash(parsed)
    if (recomputed !== parsed.hash) {
      throw new Error(
        `graph.json hash mismatch — file may have been edited externally (stored=${parsed.hash}, recomputed=${recomputed})`,
      )
    }
    this.snapshot = parsed
    this.fileSig = sig
    return parsed
  }

  /**
   * Atomic update of the in-memory projection. Writes graph.json only when persist is on.
   *
   * When `expectedPrevHash` is given, the current snapshot/file hash must match.
   */
  save(graph: Omit<GraphFileV1, 'hash'> & { hash?: string }, opts: { expectedPrevHash?: string; compact?: boolean } = {}): GraphFileV1 {
    if (opts.expectedPrevHash !== undefined) {
      const current = this.load()
      const currentHash = current?.hash ?? '<missing>'
      if (currentHash !== opts.expectedPrevHash) {
        throw new Error(
          `concurrent-write: graph.json was changed since the caller's read (expected=${opts.expectedPrevHash}, actual=${currentHash})`,
        )
      }
    }

    const finalGraph = this.hydrate({ ...graph, hash: undefined })

    if (this.persist) {
      const dir = dirname(this.path)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const tmp = `${this.path}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`
      writeFileSync(
        tmp,
        opts.compact ? JSON.stringify(finalGraph) : JSON.stringify(finalGraph, null, 2),
        'utf-8',
      )
      renameSync(tmp, this.path)
      this.fileSig = fileSignature(this.path)
    }

    return finalGraph
  }
}
