// Output-cache on-disk format helpers: inline vs sharded chunks, DataTree
// duck-types, retention defaults, and directory size. The OutputCache class
// in output-cache.ts orchestrates read/write; this module is the format layer.

import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import type { OutputCacheV1 } from './types.js'
import { compressPayload } from './voxel-cells-codec.js'

// Above this total serialized size (bytes) a port's `data` switches from inline
// JSON to sharded chunk files. Chosen well under V8's ~512MB single-string
// ceiling: the threshold only decides inline-vs-shard; correctness comes from
// each *chunk* (one item) staying far below the limit, which it does because a
// single scene-tree item is sub-MB in practice.
export const INLINE_DATA_MAX_BYTES = 32 * 1024 * 1024

// A top-level item field is only worth externalizing to the blob store once its
// compact-encoded JSON crosses this size — below it, the per-blob-file overhead
// (a whole extra gzip'd file + hash lookup) isn't worth it, and it can just
// inline like today (e.g. a `focus` path string, small param objects).
export const BLOB_MIN_BYTES = 16 * 1024

// Caps the in-process "resolved blob value" intern cache (see resolveContentRef)
// so a long-lived server that reads many distinct large scene trees over time
// doesn't grow this map unboundedly. Evicted in insertion order (oldest first) —
// a blob's content never changes (content-addressed), so eviction only means
// "re-gunzip/re-parse/re-expand next time it's referenced", never a correctness
// issue.
export const BLOB_VALUE_CACHE_MAX = 64

// The cache is machine-read JSON (never hand-edited), so it is written COMPACT
// (no pretty-print indentation). A `voxel-mass` payload is a flat list of
// occupied cells `{x,y,z,token}`; pretty-printing exploded each cell across ~6
// deeply-indented lines — measured at 141 bytes/cell vs 34 bytes compact, a
// ~4.1× blow-up on outputs with millions of cells. Compact also roughly
// quarters the transient string built by JSON.stringify, easing the memory
// spike that was tipping the (already memory-saturated) backend into OOM.
export const stringifyEntry = (entry: OutputCacheV1): string =>
  JSON.stringify(compressPayload(entry) as OutputCacheV1)

/** One sharded unit: a single item tagged with its branch path so read can regroup entries. */
export interface DataChunk {
  /** Branch path of the DataTreeEntry this item belongs to (null = non-DataTree element fallback). */
  path: readonly number[] | null
  /** The single item payload (for the fallback path, the whole array element). */
  item?: unknown
  /** True when this chunk records an empty branch (a DataTreeEntry with zero items). */
  empty?: boolean
}

// Sentinel left in place of a duplicated top-level field value — resolved back to the
// earlier chunk's already-expanded value on read. This is what lets a scene-typed op
// like `scene_focus_path` (which returns `{ tree: input.tree, focus }`, reusing the SAME
// tree object across every fan-out branch — see wb-scene-generator-project-switch.md
// §2.10) avoid re-embedding (and re-compressing) that tree once per branch: N sibling
// items sharing one un-mutated object by reference get serialized once, not N times.
// Only top-level fields are checked — every known port value (`{tree,focus}` and friends)
// shares at that level, so a shallow check is enough without walking into nested objects.
// If a code path ever stops sharing the reference (e.g. starts deep-cloning), this simply
// finds no match and falls back to today's behaviour — never a correctness risk, only a
// missed optimization.
export const SHARED_REF_KEY = '__outputCacheRef' as const
export const SHARED_REF_FIELD_KEY = '__outputCacheKey' as const

export interface SharedRef {
  readonly [SHARED_REF_KEY]: number
  readonly [SHARED_REF_FIELD_KEY]: string
}

export function isSharedRef(v: unknown): v is SharedRef {
  return (
    v !== null &&
    typeof v === 'object' &&
    typeof (v as Partial<SharedRef>)[SHARED_REF_KEY] === 'number' &&
    typeof (v as Partial<SharedRef>)[SHARED_REF_FIELD_KEY] === 'string'
  )
}

/** Zero-padded chunk file name so a lexicographic dir read restores chunk order. */
export function chunkName(index: number): string {
  return `chunk-${String(index).padStart(6, '0')}.json`
}

/** Duck-type a DataTreeEntry: `{ path: number[], items: unknown[] }`. */
export function isDataTreeEntry(v: unknown): v is { path: number[]; items: unknown[] } {
  return (
    v !== null &&
    typeof v === 'object' &&
    Array.isArray((v as { path?: unknown }).path) &&
    Array.isArray((v as { items?: unknown }).items)
  )
}

/**
 * Duck-type a `SceneNodeSnapshot` (see wb-scene-generator's scene/types.ts) without
 * importing it — `node-runtime` stays app-agnostic. Detected shape:
 * `{ name: string, path: string, version: number, children: unknown[] }`. Used only
 * to decide whether a big field is worth recursing into for per-subtree content
 * addressing (see `externalizeValue`) — a false negative just falls back to the
 * original flat "hash the whole value" behaviour, never a correctness risk.
 *
 * NOTE: this shape is the pre-v3 `SceneNodeSnapshot` (nested tree + string `path`).
 * The current `ScenePortValue` v3 shape (`SceneGraph`/`SceneNode`, id-addressed via
 * `children: Record<name, NodeId>`, no `path`/`version`) never matches here, so v3
 * scene graphs always fall back to whole-value hashing instead of per-subtree
 * dedup. That's a known perf-only gap (not a correctness bug — see docstring
 * above) left for a follow-up; not in scope for the v3 schema sync fix.
 */
export function isSceneNodeLike(
  v: unknown,
): v is { name: string; path: string; version: number; children: readonly unknown[] } {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  const obj = v as Record<string, unknown>
  return (
    typeof obj.name === 'string' &&
    typeof obj.path === 'string' &&
    typeof obj.version === 'number' &&
    Array.isArray(obj.children)
  )
}

export interface OutputCacheRetention {
  /** Max node output directories to keep (by mtime, newest first). */
  maxNodeDirs?: number
  /** Max total bytes under outputs/ for one project. */
  maxTotalBytes?: number
  /** Drop any single node dir larger than this (oldest oversized first). */
  maxDirBytes?: number
  /** In-graph node ids never dropped by the maxNodeDirs cap (still subject to maxTotalBytes / maxDirBytes). */
  protectedNodeIds?: ReadonlySet<string>
}

export interface OutputCachePruneResult {
  removed: number
  kept: number
  freedBytes: number
}

export const DEFAULT_OUTPUT_CACHE_RETENTION: Required<Omit<OutputCacheRetention, 'protectedNodeIds'>> = {
  maxNodeDirs: 30,
  maxTotalBytes: 1024 * 1024 * 1024,
  maxDirBytes: 128 * 1024 * 1024,
}

export function directoryByteSize(dir: string): number {
  let total = 0
  const stack = [dir]
  while (stack.length > 0) {
    const cur = stack.pop()!
    let entries
    try {
      entries = readdirSync(cur, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const p = join(cur, e.name)
      try {
        if (e.isDirectory()) stack.push(p)
        else if (e.isFile()) total += statSync(p).size
      } catch {
        /* concurrent write */
      }
    }
  }
  return total
}

export interface OutputCacheMeta {
  executedHash: string
  valid: boolean
  sharded: boolean
  dataChunks?: number
  type?: string
  opRevision?: string
}

/** Branch-path equality for regrouping contiguous per-item chunks. */
export function samePath(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
