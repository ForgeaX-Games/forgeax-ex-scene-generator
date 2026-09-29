// outputs/<nodeId>/<portId>.{json,bin,data/} — execution cache.
//
// Two responsibilities:
//   1. Persist per-port output values keyed by graph.hash so the next
//      partial-execute can decide whether the cached value is still valid.
//   2. Tear down nodes (and their downstream) when invalidated.
//
// `outputs/` is intentionally NOT the source of truth for produced assets —
// long-lived assets land in <gameRoot>/assets/ via the asset-resolver. This
// cache exists for incremental re-execution and UI replay.
//
// Large-payload safety (why this is not a single JSON.stringify)
// ---------------------------------------------------------------
// A wire value is a DataTreeEntry[] = [{ path, items }]. An `item` can embed an
// entire scene tree with every voxel cell. Two independent blow-ups push the
// serialized text past V8's single-string limit (~512MB), at which point a
// naive `JSON.stringify(entry)` throws `Invalid string length` and takes the
// whole execution down with it:
//   • many ITEMS in one branch — tree_flatten collapses N fan-out branches into
//     a single entry whose `items` each carry a full scene copy (so one entry
//     alone can be hundreds of MB);
//   • many BRANCHES — fan-out producers emit one entry per branch, each a full
//     scene copy.
// Per-element (per-entry) sharding alone does NOT fix the first case, so we
// shard at the finest safe granularity: one chunk file per (branch-path, item)
// pair. Each chunk holds exactly one item (≈ one scene tree, sub-MB in
// practice), so neither write nor read ever builds a string near the limit,
// no matter how many nodes/layers/branches the scene has. Read reassembles the
// DataTreeEntry[] in memory (a large in-memory array is fine — only the
// *string* form is what blows up).
//
// Non-DataTreeEntry array payloads (rare) fall back to per-element sharding.


import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { OutputCacheV1 } from './types.js'
import { compressPayload, expandPayload, compressedPayloadByteLength, expandedPayloadByteLength } from './voxel-cells-codec.js'
import { BLOB_DIR_NAME, OutputCacheBlobStore } from './output-cache-blob-store.js'
import { OUTPUT_CACHE_BLOB_REF_KEY, isOutputCacheBlobRef, makeOutputCacheBlobRef, type OutputCacheBlobRef } from './blob-ref-contract.js'
import {
  INLINE_DATA_MAX_BYTES,
  BLOB_MIN_BYTES,
  BLOB_VALUE_CACHE_MAX,
  stringifyEntry,
  type DataChunk,
  SHARED_REF_KEY,
  SHARED_REF_FIELD_KEY,
  type SharedRef,
  isSharedRef,
  chunkName,
  isDataTreeEntry,
  isSceneNodeLike,
  directoryByteSize,
  DEFAULT_OUTPUT_CACHE_RETENTION,
  type OutputCacheRetention,
  type OutputCachePruneResult,
  type OutputCacheMeta,
  samePath,
} from './output-cache-format.js'

export type { OutputCacheMeta, OutputCacheRetention, OutputCachePruneResult } from './output-cache-format.js'
export { DEFAULT_OUTPUT_CACHE_RETENTION } from './output-cache-format.js'

export class OutputCache {
  // Content-addressed store for large top-level item fields (see
  // scene-generator-scene-tree-storage.md) — one instance per project,
  // shared across every node/port so "same tree, N focuses" dedupes even
  // across write() calls and across ports, not just within one write().
  private readonly blobStore: OutputCacheBlobStore

  constructor(private readonly root: string) {
    this.blobStore = new OutputCacheBlobStore(root)
  }

  // Parsed-metadata cache keyed by `${nodeId}\0${portId}` → the port's .json
  // file's (mtime, size) signature — same pattern as GraphStore.load(). A
  // project switch fans out getNodeOutput()/batch-output reads for the SAME
  // ports from multiple independent callers in quick succession (the editor's
  // own output hydration AND the renderer iframe's useNodePreviews, each
  // re-fetching every grid/voxel port on `authoring:project-changed` — see
  // scene-generator-project-switch.md §2.3/§2.4) plus repeat UI refreshes.
  // Without a cache, EVERY one of those calls re-does readFileSync + JSON.parse
  // (and, for large sharded voxel payloads, re-reads + re-parses every chunk
  // file) even though the output hasn't changed since the last read — this is
  // synchronous, event-loop-blocking I/O, so N duplicate reads serialize on top
  // of each other. We cache the raw parse (pre shard-reassembly, for readMeta())
  // and the fully-expanded entry (post shard-reassembly, for read()) separately,
  // reusing either while the underlying file's signature is unchanged.
  private rawCache = new Map<string, { sig: string; raw: OutputCacheV1 }>()
  private expandedCache = new Map<string, { sig: string; entry: OutputCacheV1 }>()

  // Cache of hash -> PARSED (compact, pre-`expandPayload`) blob content, so N
  // chunks referencing the same blob hash share one gunzip+JSON.parse instead
  // of repeating it per chunk. Deliberately NOT a cache of the final expanded
  // value: `expandPayload` is always re-run per resolution so every caller
  // gets a fresh, independent object graph — two branches (or two unrelated
  // ports) that happen to share a hash must never end up holding the SAME
  // mutable object reference post-read, only equal content (mirrors the
  // existing SharedRef invariant tested by "does not dedupe
  // structurally-equal-but-distinct object references" in storage.test.ts —
  // content-addressing dedupes bytes on disk, never live object identity on
  // read).
  private readonly blobParsedCache = new Map<string, unknown>()

  private cacheKey(nodeId: string, portId: string): string {
    return `${nodeId}\u0000${portId}`
  }

  /** Cheap freshness probe mirroring GraphStore.load(); null when stat fails. */
  private statSig(path: string): string | null {
    try {
      const st = statSync(path)
      return `${st.mtimeMs}:${st.size}`
    } catch {
      return null
    }
  }

  /** Drop cached entries for one port — called on every write() to this port. */
  private purgeCache(nodeId: string, portId: string): void {
    const key = this.cacheKey(nodeId, portId)
    this.rawCache.delete(key)
    this.expandedCache.delete(key)
  }

  /** Drop every cached entry for a node — called on invalidate()/clearAll(). */
  private purgeCacheForNode(nodeId: string): void {
    const prefix = `${nodeId}\u0000`
    for (const k of this.rawCache.keys()) if (k.startsWith(prefix)) this.rawCache.delete(k)
    for (const k of this.expandedCache.keys()) if (k.startsWith(prefix)) this.expandedCache.delete(k)
  }

  /**
   * Parse (or reuse the cached parse of) a port's metadata JSON file. Returns
   * the RAW parse — `data`/`dataChunks` untouched — so callers that reassemble
   * shards must clone before mutating (the cached object is shared/reused).
   */
  private loadRaw(nodeId: string, portId: string, jsonPath: string): OutputCacheV1 {
    const key = this.cacheKey(nodeId, portId)
    const sig = this.statSig(jsonPath)
    const cached = sig !== null ? this.rawCache.get(key) : undefined
    if (cached && cached.sig === sig) return cached.raw
    const parsed = JSON.parse(readFileSync(jsonPath, 'utf-8')) as OutputCacheV1
    if (sig !== null) this.rawCache.set(key, { sig, raw: parsed })
    return parsed
  }

  /** Absolute path to the .json metadata file for one node/port. */
  jsonPath(nodeId: string, portId: string): string {
    return join(this.root, nodeId, `${portId}.json`)
  }

  /** Absolute path to the sibling .bin payload (if the entry uses an external blob). */
  binPath(nodeId: string, portId: string): string {
    return join(this.root, nodeId, `${portId}.bin`)
  }

  /** Absolute path to the directory holding sharded `data` chunks (large array payloads). */
  private dataChunkDir(nodeId: string, portId: string): string {
    return join(this.root, nodeId, `${portId}.data`)
  }

  /**
   * Cheap on-disk size for one port — `statSync` plus one small `JSON.parse`
   * per chunk file (never `expandPayload`/voxel decompression/reassembly).
   * Lets callers (the HTTP batch route) decide "this is way over the
   * inline-response cap" BEFORE paying for `read()`'s full shard reassembly +
   * a `JSON.stringify()` just to learn the size — for a multi-hundred-MB
   * sharded voxel output, that reassemble + stringify is 1-8s of synchronous,
   * event-loop-blocking work wasted on a value the caller was always going to
   * throw away as `tooLarge`.
   */
  portByteSize(nodeId: string, portId: string): number {
    let total = 0
    try {
      total += statSync(this.jsonPath(nodeId, portId)).size
    } catch {
      /* no inline .json — sharded-only or missing */
    }
    try {
      total += statSync(this.binPath(nodeId, portId)).size
    } catch {
      /* no sibling .bin */
    }
    total += this.cachedOrScannedByteSize(nodeId, portId, 'estimatedExpandedBytes', () =>
      this.shardedDataByteSize(nodeId, portId),
    )
    return total
  }

  /**
   * Read `write()`'s cached `estimatedExpandedBytes`/`estimatedEnvelopeBytes`
   * from the port's (already memoized via `loadRaw`/`rawCache`) metadata JSON
   * when present — O(1) — falling back to `scan()` (the real O(chunk count)
   * directory walk) only for entries written before this caching existed. This
   * is what keeps `portByteSize()`/`envelopeByteSize()` cheap under repeated
   * calls (project switch re-fetches the same ports from multiple callers, see
   * scene-generator-project-switch.md §2.3/§2.4) even as chunk count grows
   * with map scale — the expensive scan happens once, at write() time, instead
   * of once per read-side caller.
   */
  /**
   * Parse a port's whole `.data/` shard dir back into memory — the shared
   * prologue of both size scans. `write()` hands its freshly serialized chunks
   * to those scans directly instead of coming through here, so sizing a port we
   * just wrote no longer re-reads and re-parses every shard file (twice) that
   * the same call had just produced.
   */
  private loadChunksFromDisk(nodeId: string, portId: string): Array<DataChunk | null> {
    const dir = this.dataChunkDir(nodeId, portId)
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      return []
    }
    names.sort()
    const chunks: Array<DataChunk | null> = []
    for (const name of names) {
      try {
        chunks.push(JSON.parse(readFileSync(join(dir, name), 'utf-8')) as DataChunk)
      } catch {
        chunks.push(null)
      }
    }
    return chunks
  }

  private cachedOrScannedByteSize(
    nodeId: string,
    portId: string,
    field: 'estimatedExpandedBytes' | 'estimatedEnvelopeBytes',
    scan: () => number,
  ): number {
    const jsonPath = this.jsonPath(nodeId, portId)
    try {
      const raw = this.loadRaw(nodeId, portId, jsonPath)
      const cached = raw[field]
      if (typeof cached === 'number') return cached
    } catch {
      /* missing/corrupt metadata — fall through to scan (matches other read paths' behaviour) */
    }
    return scan()
  }

  /**
   * TRUE wire byte size of a port's `.data/` shard dir — what
   * `JSON.stringify(read().data)` would actually produce — computed WITHOUT
   * ever calling `expandPayload`/`resolveSharedRefs`/building that (possibly
   * hundreds-of-MB) structure. Two independent corrections vs. a naive
   * `directoryByteSize` of the raw chunk files, both required (see
   * scene-generator-project-switch.md §2.10):
   *   1. Dedup-aware: a `SharedRef` pointer is a few dozen bytes on disk but
   *      contributes a FULL re-embedded copy to the eventual JSON (every
   *      occurrence gets independently stringified — JSON has no way to
   *      represent "same object as before"). Resolved from whichever earlier
   *      chunk/key the pointer targets (memoized, so N shared occurrences
   *      cost one real computation + N cheap lookups, not N recomputations).
   *   2. Expansion-aware: chunk files hold voxel cells in a COMPRESSED
   *      `{__voxelCells:1,t,d}` encoding (a flat number array + small token
   *      dictionary) that is several times smaller than the expanded
   *      `{x,y,z,token}[]` wire form `read()` hands back — see
   *      `expandedPayloadByteLength`. Using the raw compressed file size here
   *      would still underestimate a large voxel payload by that same
   *      multiple, defeating the entire point of this being a size proxy.
   * Still cheap: one `JSON.parse` per chunk file, then a numeric walk over
   * each cell's 4 flat numbers — no per-cell object allocation, no
   * cross-chunk regrouping.
   */
  private shardedDataByteSize(
    nodeId: string,
    portId: string,
    preloaded?: ReadonlyArray<DataChunk | null>,
  ): number {
    const chunks = preloaded ?? this.loadChunksFromDisk(nodeId, portId)
    // Per-chunk memo of each top-level field's OWN expanded byte length (not
    // the whole item's), so a SharedRef pointing at chunk i's key `focus` can
    // resolve to exactly that field's contribution without recomputing it.
    const fieldBytes: Array<Map<string, number>> = chunks.map(() => new Map())
    // Per-hash memo of a blob's expanded byte length — N branches referencing
    // the SAME blob hash must each still count the FULL expanded size (that's
    // what JSON.stringify(read()) actually produces — no object sharing on the
    // wire), but the (cheap-ish) parse+walk to compute that size only needs to
    // happen once per distinct hash, not once per occurrence.
    const blobBytes = new Map<string, number>()
    let total = 0
    for (let i = 0; i < chunks.length; i++) {
      const item = chunks[i]?.item
      if (item === null || typeof item !== 'object' || Array.isArray(item)) {
        if (item !== undefined) total += expandedPayloadByteLength(item)
        continue
      }
      for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
        let bytes: number
        if (isSharedRef(value)) {
          bytes = fieldBytes[value[SHARED_REF_KEY]]?.get(value[SHARED_REF_FIELD_KEY]) ?? 0
        } else {
          bytes = this.expandedByteLengthDeep(value, blobBytes)
          fieldBytes[i]!.set(key, bytes)
        }
        total += bytes
      }
    }
    return total
  }

  /**
   * Like `expandedPayloadByteLength`, but a nested `{__outputCacheBlobRef}` (see
   * `externalizeValue` — a subtree can embed refs to its own big-enough children,
   * not just at the top level of an item) contributes its OWN resolved+expanded
   * size instead of the few bytes of the pointer literal — i.e. what
   * `JSON.stringify(read().data)` would actually produce once every level of
   * blob refs is inlined back in. `blobBytes` memoizes per distinct hash so a
   * subtree referenced from many parents (the whole point of the recursive
   * dedup) is only walked once, not once per occurrence.
   */
  private expandedByteLengthDeep(value: unknown, blobBytes: Map<string, number>): number {
    if (value === null || typeof value !== 'object') {
      return Buffer.byteLength(JSON.stringify(value) ?? 'null', 'utf-8')
    }
    if (isOutputCacheBlobRef(value)) {
      const hash = value[OUTPUT_CACHE_BLOB_REF_KEY]
      let cached = blobBytes.get(hash)
      if (cached === undefined) {
        const parsed = this.getParsedBlob(hash)
        cached = parsed === undefined ? 0 : this.expandedByteLengthDeep(parsed, blobBytes)
        blobBytes.set(hash, cached)
      }
      return cached
    }
    if (Array.isArray(value)) {
      if (value.length === 0) return 2
      let total = 2 + (value.length - 1)
      for (const el of value) total += this.expandedByteLengthDeep(el, blobBytes)
      return total
    }
    // A compact voxel-cells blob (see voxel-cells-codec.ts) can appear directly
    // here, not just nested under a `cells` key, if some non-scene port ever
    // stores one at the top level of an externalized value — defer to the
    // codec's own size proxy (cells never nest a blob ref, so no recursion lost).
    const obj = value as Record<string, unknown>
    if (obj.__voxelCells === 1) return expandedPayloadByteLength(obj)
    const entries = Object.entries(obj)
    if (entries.length === 0) return 2
    let total = 2 + (entries.length - 1)
    for (const [key, child] of entries) {
      total +=
        Buffer.byteLength(JSON.stringify(key), 'utf-8') +
        1 +
        (key === 'cells' ? expandedPayloadByteLength(child) : this.expandedByteLengthDeep(child, blobBytes))
    }
    return total
  }

  /**
   * List every port id that has a cached `.json` entry for a node. Used to read
   * back whatever a node actually produced without knowing its (possibly dynamic)
   * output port set in advance. Returns [] when the node has no cache directory.
   */
  listPorts(nodeId: string): string[] {
    const dir = join(this.root, nodeId)
    if (!existsSync(dir)) return []
    try {
      return readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.slice(0, -'.json'.length))
    } catch {
      return []
    }
  }

  /** Read metadata only — no shard reassembly (cheap for refresh skip checks). */
  readMeta(nodeId: string, portId: string): OutputCacheMeta | null {
    const p = this.jsonPath(nodeId, portId)
    if (!existsSync(p)) return null
    try {
      const parsed = this.loadRaw(nodeId, portId, p)
      if (parsed.schemaVersion !== 1) return null
      const sharded = typeof parsed.dataChunks === 'number' && parsed.dataChunks >= 0
      return {
        executedHash: parsed.executedHash,
        valid: parsed.valid,
        sharded,
        ...(sharded ? { dataChunks: parsed.dataChunks } : {}),
        ...(typeof parsed.type === 'string' ? { type: parsed.type } : {}),
        ...(typeof parsed.opRevision === 'string' ? { opRevision: parsed.opRevision } : {}),
      }
    } catch {
      return null
    }
  }

  /** Read one cached entry. Returns null when missing or invalid JSON. */
  read(nodeId: string, portId: string): OutputCacheV1 | null {
    const p = this.jsonPath(nodeId, portId)
    if (!existsSync(p)) return null
    const key = this.cacheKey(nodeId, portId)
    const sig = this.statSig(p)
    if (sig !== null) {
      const hit = this.expandedCache.get(key)
      if (hit && hit.sig === sig) return hit.entry
    }
    try {
      const raw = this.loadRaw(nodeId, portId, p)
      if (raw.schemaVersion !== 1) return null
      // Clone before mutating — `loadRaw`'s cached raw object is shared with
      // readMeta() and future read() calls at the same signature.
      const entry: OutputCacheV1 = { ...raw }
      // Sharded `data`: reassemble from per-item chunk files. Each chunk is
      // parsed on its own (never one giant string), then regrouped in memory.
      if (typeof entry.dataChunks === 'number' && entry.dataChunks >= 0) {
        entry.data = expandPayload(this.readDataChunks(nodeId, portId, entry.dataChunks))
        delete entry.dataChunks
      } else if (entry.data !== undefined) {
        entry.data = expandPayload(entry.data)
      }
      if (sig !== null) this.expandedCache.set(key, { sig, entry })
      return entry
    } catch {
      return null
    }
  }

  /**
   * Reassemble sharded `data` from its per-item chunk files. Chunks are stored
   * in iteration order and regrouped back into DataTreeEntry[] by branch path
   * (contiguous chunks sharing a path collapse into one entry's `items`). A
   * chunk with `path === null` is a non-DataTree fallback element, pushed as-is.
   */
  private readDataChunks(nodeId: string, portId: string, count: number): unknown[] {
    const dir = this.dataChunkDir(nodeId, portId)
    const out: unknown[] = []
    // Resolved (post shared-ref, post expandPayload) item for each chunk index seen so
    // far — a SharedRef only ever points at a strictly earlier index (write() only
    // records a reference AFTER a chunk is fully written), so by the time we hit a ref
    // its target is already in here.
    const resolved: unknown[] = []
    // Scoped to THIS read() call only (never persisted on `this`) — a shared subtree
    // referenced from many chunks (e.g. every decoration's `tree` pointing at the same
    // deduped ancestor blob) is parsed+expanded once per call, not once per occurrence,
    // bounding peak memory to the deduped content size rather than occurrence count ×
    // content size. Discarded when the call returns, so it never becomes the kind of
    // cross-call shared-mutable-object risk `blobParsedCache` deliberately avoids.
    const blobMemo = new Map<string, unknown>()
    let current: { path: number[]; items: unknown[] } | null = null
    for (let i = 0; i < count; i++) {
      const chunk = JSON.parse(readFileSync(join(dir, chunkName(i)), 'utf-8')) as DataChunk
      const item = chunk.item !== undefined ? this.resolveSharedRefs(expandPayload(chunk.item), resolved, blobMemo) : undefined
      resolved[i] = item
      if (chunk.path === null) {
        if (current) {
          out.push(current)
          current = null
        }
        out.push(item)
        continue
      }
      // Open (or switch to) the entry for this branch path. An `empty` chunk
      // opens a zero-item entry and contributes no item.
      if (!current || !samePath(current.path, chunk.path)) {
        if (current) out.push(current)
        current = { path: [...chunk.path], items: [] }
      }
      if (!chunk.empty) current.items.push(item)
    }
    if (current) out.push(current)
    return out
  }

  /**
   * Undo `dedupeTopLevel`: swap each top-level `SharedRef` for the real value
   * it points at, and each `OutputCacheBlobRef` for its resolved blob content
   * (see `resolveBlobRef`). Both sentinels only ever appear at the top level of
   * an item, so a single shallow pass suffices.
   */
  private resolveSharedRefs(item: unknown, resolvedChunks: readonly unknown[], blobMemo: Map<string, unknown>): unknown {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return item
    const obj = item as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      if (isSharedRef(value)) {
        const target = resolvedChunks[value[SHARED_REF_KEY]] as Record<string, unknown> | undefined
        out[key] = target ? target[value[SHARED_REF_FIELD_KEY]] : undefined
      } else {
        // Not a SharedRef itself, but a plain (small, inline, unblobbed) object
        // like a root scene node can still contain a NESTED blob ref somewhere
        // inside (e.g. `children[i]` pointing at one big-enough child — see
        // `externalizeValue`) — `resolveNestedBlobRefs` walks all the way down,
        // not just this one field.
        out[key] = this.resolveNestedBlobRefs(value, blobMemo)
      }
    }
    return out
  }

  /**
   * Resolve a blob ref to its fully expanded value, recursively resolving any
   * `{__outputCacheBlobRef}` found nested inside it too (see `externalizeValue` —
   * a subtree can itself embed refs to its own big-enough children). `blobMemo` is
   * scoped to one top-level `read()`/`readDataChunks()` call (see its call site) —
   * within that call it's safe (and desirable) for two occurrences of the SAME
   * hash to share one resolved object graph, since every `SceneNodeSnapshot` in
   * this codebase is treated as immutable (`Object.freeze`d, path-copy mutation)
   * — but `expandPayload` is always re-run fresh on top of the (persistently
   * cached) PARSED content whenever `blobMemo` doesn't already have an entry, so
   * two DIFFERENT calls never end up sharing the same mutable object (see the
   * `blobParsedCache` comment for why that cross-call invariant matters).
   */
  private resolveBlobRef(ref: OutputCacheBlobRef, blobMemo: Map<string, unknown>): unknown {
    const hash = ref[OUTPUT_CACHE_BLOB_REF_KEY]
    const memoized = blobMemo.get(hash)
    if (memoized !== undefined) return memoized
    const parsed = this.getParsedBlob(hash)
    if (parsed === undefined) return undefined
    const resolved = this.resolveNestedBlobRefs(expandPayload(parsed), blobMemo)
    blobMemo.set(hash, resolved)
    return resolved
  }

  /** Deep-walk an already-`expandPayload`d value, resolving any nested blob ref in place. */
  private resolveNestedBlobRefs(value: unknown, blobMemo: Map<string, unknown>): unknown {
    if (value === null || typeof value !== 'object') return value
    if (isOutputCacheBlobRef(value)) return this.resolveBlobRef(value, blobMemo)
    if (Array.isArray(value)) return value.map((el) => this.resolveNestedBlobRefs(el, blobMemo))
    const obj = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(obj)) out[key] = this.resolveNestedBlobRefs(child, blobMemo)
    return out
  }

  /** Cached `JSON.parse(blobStore.get(hash))`, evicted oldest-first past `BLOB_VALUE_CACHE_MAX`. */
  private getParsedBlob(hash: string): unknown {
    const cached = this.blobParsedCache.get(hash)
    if (cached !== undefined) return cached
    const jsonText = this.blobStore.get(hash)
    if (jsonText === null) return undefined
    const parsed = JSON.parse(jsonText) as unknown
    this.cacheParsedBlob(hash, parsed)
    return parsed
  }

  /** Insert into `blobParsedCache` with the same oldest-first eviction `getParsedBlob` uses. */
  private cacheParsedBlob(hash: string, value: unknown): void {
    if (!this.blobParsedCache.has(hash) && this.blobParsedCache.size >= BLOB_VALUE_CACHE_MAX) {
      const oldest = this.blobParsedCache.keys().next().value
      if (oldest !== undefined) this.blobParsedCache.delete(oldest)
    }
    this.blobParsedCache.set(hash, value)
  }

  /**
   * Phase-2 wire envelope read: like `read()`, but blob-refs are left AS-IS
   * (never expanded inline) — a `SharedRef` pointing at a blob-backed field is
   * copied forward as the SAME blob ref, and every distinct blob hash actually
   * used is resolved (once, via the existing `resolveBlobRef` intern cache)
   * into `blobs[hash]`. The caller ships `{ value: entry.data, blobs }`; a
   * client that hydrates blob refs from `blobs` before use ends up with
   * exactly what plain `read()` would have produced, but the WIRE payload for
   * "same tree, N focuses" is 1 tree + N tiny pointers instead of N full
   * copies — see scene-generator-scene-tree-storage.md §3. Small
   * (non-sharded) entries never had blob refs written in the first place, so
   * they fall back to the identical `read()` behaviour with an empty `blobs`.
   */
  readWithBlobRefs(nodeId: string, portId: string): { entry: OutputCacheV1; blobs: Record<string, unknown> } | null {
    const p = this.jsonPath(nodeId, portId)
    if (!existsSync(p)) return null
    try {
      const raw = this.loadRaw(nodeId, portId, p)
      if (raw.schemaVersion !== 1) return null
      const entry: OutputCacheV1 = { ...raw }
      const blobs: Record<string, unknown> = {}
      if (typeof entry.dataChunks === 'number' && entry.dataChunks >= 0) {
        entry.data = this.readDataChunksWithBlobRefs(nodeId, portId, entry.dataChunks, blobs)
        delete entry.dataChunks
      } else if (entry.data !== undefined) {
        entry.data = expandPayload(entry.data)
      }
      return { entry, blobs }
    } catch {
      return null
    }
  }

  /** Like `readDataChunks`, but resolves via `resolveForEnvelope` (keeps blob refs, fills `blobs`). */
  private readDataChunksWithBlobRefs(
    nodeId: string,
    portId: string,
    count: number,
    blobs: Record<string, unknown>,
  ): unknown[] {
    const dir = this.dataChunkDir(nodeId, portId)
    const out: unknown[] = []
    const resolved: unknown[] = []
    // Scoped to this one envelope build — every hash reachable from ANY chunk
    // (top-level or nested inside another blob, see `externalizeValue`) is parsed
    // and populated into `blobs` at most once, so the wire payload for "same
    // subtree reused N times, M levels deep" stays 1 copy + pointers, matching
    // what the recursive content-addressing already did on disk.
    const visited = new Set<string>()
    let current: { path: number[]; items: unknown[] } | null = null
    for (let i = 0; i < count; i++) {
      const chunk = JSON.parse(readFileSync(join(dir, chunkName(i)), 'utf-8')) as DataChunk
      const item =
        chunk.item !== undefined
          ? this.resolveForEnvelope(expandPayload(chunk.item), resolved, blobs, visited)
          : undefined
      resolved[i] = item
      if (chunk.path === null) {
        if (current) {
          out.push(current)
          current = null
        }
        out.push(item)
        continue
      }
      if (!current || !samePath(current.path, chunk.path)) {
        if (current) out.push(current)
        current = { path: [...chunk.path], items: [] }
      }
      if (!chunk.empty) current.items.push(item)
    }
    if (current) out.push(current)
    return out
  }

  /**
   * Envelope variant of `resolveSharedRefs`: a `SharedRef` still resolves to
   * its target's already-envelope-resolved value (so a SharedRef pointing at
   * a blob-backed field copies forward the SAME blob ref, not a full re-embed),
   * but an `OutputCacheBlobRef` is left in place — the caller collects its
   * resolved value into `blobs` instead of inlining it. Delegates to
   * `envelopeExpand` for the actual blob-ref handling so a hash NESTED inside
   * another blob's content (see `externalizeValue`) also gets its own flat
   * `blobs[hash]` entry with a pointer left behind, instead of being fully
   * inlined into its parent's entry — the whole point of the envelope is that
   * every distinct subtree crosses the wire exactly once, at every nesting level.
   */
  private resolveForEnvelope(
    item: unknown,
    resolvedChunks: readonly unknown[],
    blobs: Record<string, unknown>,
    visited: Set<string>,
  ): unknown {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return item
    const obj = item as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      if (isSharedRef(value)) {
        const target = resolvedChunks[value[SHARED_REF_KEY]] as Record<string, unknown> | undefined
        out[key] = target ? target[value[SHARED_REF_FIELD_KEY]] : undefined
      } else {
        // `envelopeExpand` already walks all the way down (handling both "value
        // IS a blob ref" and "value is a plain object/array that contains one
        // nested somewhere inside" — e.g. a small, inline, unblobbed root scene
        // node whose `children[i]` still points at one big-enough child).
        out[key] = this.envelopeExpand(value, blobs, visited)
      }
    }
    return out
  }

  /**
   * Envelope-mode recursive expand: any `{__outputCacheBlobRef}` found anywhere
   * inside `value` is left in place as a pointer (never inlined), but its
   * target's own content is resolved and, recursively, populated into `blobs`
   * too — so a subtree shared by many parents (whether at the top level or
   * nested several levels deep) is transmitted once, not once per parent.
   * `visited` (scoped to one `readDataChunksWithBlobRefs` call) skips re-parsing
   * a hash already populated earlier in the same envelope build.
   */
  private envelopeExpand(value: unknown, blobs: Record<string, unknown>, visited: Set<string>): unknown {
    if (value === null || typeof value !== 'object') return value
    if (isOutputCacheBlobRef(value)) {
      const hash = value[OUTPUT_CACHE_BLOB_REF_KEY]
      if (!visited.has(hash)) {
        visited.add(hash)
        const parsed = this.getParsedBlob(hash)
        if (parsed !== undefined) {
          blobs[hash] = this.envelopeExpand(expandPayload(parsed), blobs, visited)
        }
      }
      return value
    }
    if (Array.isArray(value)) return value.map((el) => this.envelopeExpand(el, blobs, visited))
    const obj = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(obj)) out[key] = this.envelopeExpand(child, blobs, visited)
    return out
  }

  /**
   * Cheap estimate of what the Phase-2 envelope (`readWithBlobRefs`) would
   * cost on the wire: each distinct blob hash counted ONCE (the whole point of
   * the envelope) plus the small per-branch fields that still inline
   * per-occurrence. Lets the HTTP route decide "dedup gets this under the cap"
   * before actually building the envelope. Same cheap-scan shape as
   * `shardedDataByteSize` (one JSON.parse per chunk file, no reassembly).
   * Prefers `write()`'s cached `estimatedEnvelopeBytes` (O(1)) over rescanning —
   * see `cachedOrScannedByteSize`.
   */
  envelopeByteSize(nodeId: string, portId: string): number {
    return this.cachedOrScannedByteSize(nodeId, portId, 'estimatedEnvelopeBytes', () =>
      this.scanEnvelopeByteSize(nodeId, portId),
    )
  }

  /** The actual O(chunk count) scan behind `envelopeByteSize()` — see that method's cache wrapper. */
  private scanEnvelopeByteSize(
    nodeId: string,
    portId: string,
    preloaded?: ReadonlyArray<DataChunk | null>,
  ): number {
    const chunks = preloaded ?? this.loadChunksFromDisk(nodeId, portId)
    const fieldBytes: Array<Map<string, number>> = chunks.map(() => new Map())
    const visited = new Set<string>()
    let smallFieldTotal = 0
    let blobTotal = 0
    for (let i = 0; i < chunks.length; i++) {
      const item = chunks[i]?.item
      if (item === null || typeof item !== 'object' || Array.isArray(item)) {
        if (item !== undefined) smallFieldTotal += expandedPayloadByteLength(item)
        continue
      }
      for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
        if (isSharedRef(value)) {
          const bytes = fieldBytes[value[SHARED_REF_KEY]]?.get(value[SHARED_REF_FIELD_KEY]) ?? 0
          smallFieldTotal += bytes
          fieldBytes[i]!.set(key, bytes)
          continue
        }
        // `envelopeOwnByteLength` already handles every shape uniformly: `value`
        // directly being a blob ref, `value` being a plain (small, unblobbed)
        // object/array that contains one NESTED somewhere inside (e.g. a small
        // root scene node whose `children[i]` still points at a big-enough
        // child), or `value` having no blob ref at all.
        const ownBytes = this.envelopeOwnByteLength(value, (hash) => {
          blobTotal += this.collectEnvelopeBlobBytes(hash, visited)
        })
        smallFieldTotal += ownBytes
        fieldBytes[i]!.set(key, ownBytes)
      }
    }
    return blobTotal + smallFieldTotal
  }

  /**
   * Envelope-mode blob accounting: returns hash's OWN wire contribution (its
   * content with any NESTED blob ref collapsed back down to just the small
   * pointer literal — matching what `envelopeExpand` actually inlines at that
   * nesting level) PLUS, recursively, every transitively-reachable nested
   * hash's own contribution — each exactly once, thanks to `visited` (scoped to
   * one `envelopeByteSize` call, mirroring `readDataChunksWithBlobRefs`'s
   * `visited`). A hash already visited earlier in this same call contributes 0
   * here (its bytes were already added at first encounter).
   */
  private collectEnvelopeBlobBytes(hash: string, visited: Set<string>): number {
    if (visited.has(hash)) return 0
    visited.add(hash)
    const parsed = this.getParsedBlob(hash)
    if (parsed === undefined) return 0
    let nestedTotal = 0
    const ownBytes = this.envelopeOwnByteLength(parsed, (nestedHash) => {
      nestedTotal += this.collectEnvelopeBlobBytes(nestedHash, visited)
    })
    return ownBytes + nestedTotal
  }

  /**
   * Like `expandedByteLengthDeep`, but a nested blob ref contributes only the
   * small pointer literal's own byte length (what the envelope actually leaves
   * in place at this nesting level) — `onNestedRef` fires once per encountered
   * ref so the caller can separately account for (and recurse into) that hash.
   */
  private envelopeOwnByteLength(value: unknown, onNestedRef: (hash: string) => void): number {
    if (value === null || typeof value !== 'object') {
      return Buffer.byteLength(JSON.stringify(value) ?? 'null', 'utf-8')
    }
    if (isOutputCacheBlobRef(value)) {
      onNestedRef(value[OUTPUT_CACHE_BLOB_REF_KEY])
      return Buffer.byteLength(JSON.stringify(value), 'utf-8')
    }
    if (Array.isArray(value)) {
      if (value.length === 0) return 2
      let total = 2 + (value.length - 1)
      for (const el of value) total += this.envelopeOwnByteLength(el, onNestedRef)
      return total
    }
    const obj = value as Record<string, unknown>
    if (obj.__voxelCells === 1) return expandedPayloadByteLength(obj)
    const entries = Object.entries(obj)
    if (entries.length === 0) return 2
    let total = 2 + (entries.length - 1)
    for (const [key, child] of entries) {
      total +=
        Buffer.byteLength(JSON.stringify(key), 'utf-8') +
        1 +
        (key === 'cells' ? expandedPayloadByteLength(child) : this.envelopeOwnByteLength(child, onNestedRef))
    }
    return total
  }

  /**
   * Write a cached entry. Inline JSON when small, sibling .bin when binary,
   * sharded chunks when huge.
   *
   * Returns `true` when the payload was "large" — sharded or binary — and
   * `false` when it inlined as a small value. Callers (the executor) use this
   * to decide whether to also echo the value back in an HTTP response: a large
   * value must NOT be serialized into the execute response (it would rebuild
   * the same multi-hundred-MB string this sharding exists to avoid), so the
   * client re-fetches it lazily from the cache instead.
   */
  write(nodeId: string, portId: string, entry: Omit<OutputCacheV1, 'schemaVersion'>, binPayload?: Buffer): boolean {
    // Drop any cached parse for this port BEFORE writing — guards against a
    // same-tick signature collision on our own write (mirrors GraphStore.save()).
    this.purgeCache(nodeId, portId)
    const dir = join(this.root, nodeId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    // A stale shard dir from a previous (possibly larger) write must not survive
    // a new inline/binary write, or read() would resurrect the old payload.
    const shardDir = this.dataChunkDir(nodeId, portId)
    if (existsSync(shardDir)) rmSync(shardDir, { recursive: true, force: true })

    const finalEntry: OutputCacheV1 = { schemaVersion: 1, ...entry }

    if (binPayload !== undefined) {
      finalEntry.binFile = `${portId}.bin`
      delete (finalEntry as { data?: unknown }).data
      writeFileSync(this.binPath(nodeId, portId), binPayload)
      writeFileSync(this.jsonPath(nodeId, portId), stringifyEntry(finalEntry), 'utf-8')
      return true
    }

    // Shard only array payloads (the wire shape is DataTreeEntry[]). A non-array
    // value is a scalar/object that the wire contract never grows unbounded, so
    // it inlines safely.
    const data = (finalEntry as { data?: unknown }).data
    if (Array.isArray(data) && this.exceedsInlineBudget(data)) {
      const written = this.writeShardedData(nodeId, portId, data)
      delete (finalEntry as { data?: unknown }).data
      finalEntry.dataChunks = written.count
      // Pay the O(chunk count) directory scan HERE, once, while the chunk files
      // are freshly known — see `cachedOrScannedByteSize`. Without this, every
      // downstream portByteSize()/envelopeByteSize() caller (the HTTP batch
      // route, potentially several times per project switch) would redo this
      // same scan from scratch, and it grows linearly with map scale (chunk
      // count == decorated-cell count, not blob content — recursive dedup does
      // not shrink it).
      // Size from the payloads just written rather than re-reading the shard dir
      // twice — same accounting, minus two full read+parse passes over every
      // chunk file on a path that already holds them.
      finalEntry.estimatedExpandedBytes = this.shardedDataByteSize(nodeId, portId, written.chunks)
      finalEntry.estimatedEnvelopeBytes = this.scanEnvelopeByteSize(nodeId, portId, written.chunks)
      // The metadata file carries no inline `data`, so this stringify is tiny
      // and can never hit the single-string limit.
      writeFileSync(this.jsonPath(nodeId, portId), stringifyEntry(finalEntry), 'utf-8')
      return true
    }

    writeFileSync(this.jsonPath(nodeId, portId), stringifyEntry(finalEntry), 'utf-8')
    return false
  }

  /**
   * Decide if an array `data` is too large to inline. We sum each item's
   * serialized byte length (DataTreeEntry items individually, or whole elements
   * for the fallback) and short-circuit once the running total crosses the
   * budget — so we never build the full combined string just to measure it.
   */
  private exceedsInlineBudget(data: readonly unknown[]): boolean {
    let total = 0
    for (const element of data) {
      if (isDataTreeEntry(element)) {
        for (const item of element.items) {
          total += compressedPayloadByteLength(item)
          if (total > INLINE_DATA_MAX_BYTES) return true
        }
      } else {
        total += compressedPayloadByteLength(element)
        if (total > INLINE_DATA_MAX_BYTES) return true
      }
    }
    return false
  }

  /**
   * Shard `data` into one chunk file per item (per (branch-path, item) pair for
   * DataTreeEntry elements; per whole element for fallback). Each chunk is
   * serialized in isolation and stays far below the single-string limit
   * regardless of how many branches/items exist. Returns the chunk count plus
   * the exact payloads written, so `write()` can size the port from them instead
   * of reading them all back off disk.
   */
  private writeShardedData(
    nodeId: string,
    portId: string,
    data: readonly unknown[],
  ): { count: number; chunks: Array<DataChunk | null> } {
    const dir = this.dataChunkDir(nodeId, portId)
    mkdirSync(dir, { recursive: true })
    const chunks: Array<DataChunk | null> = []
    let index = 0
    // Tracks, within this single write() call, which chunk (and which top-level key of
    // that chunk's item) first held a given object reference — see the SharedRef comment
    // above `DataChunk`. Reset per write() so dedup never reaches across unrelated ports.
    const seen = new Map<object, { chunk: number; key: string }>()
    for (const element of data) {
      if (isDataTreeEntry(element)) {
        const path = element.path
        if (element.items.length === 0) {
          // Preserve an empty branch as a chunk with no item so read can still
          // reconstruct a zero-item entry at this path.
          chunks.push(this.writeChunk(dir, index++, { path, empty: true }, seen))
          continue
        }
        for (const item of element.items) {
          chunks.push(this.writeChunk(dir, index++, { path, item }, seen))
        }
      } else {
        chunks.push(this.writeChunk(dir, index++, { path: null, item: element }, seen))
      }
    }
    return { count: index, chunks }
  }

  /** Writes one chunk file and returns the payload it serialized. */
  private writeChunk(
    dir: string,
    index: number,
    chunk: DataChunk,
    seen: Map<object, { chunk: number; key: string }>,
  ): DataChunk {
    // One item per chunk → serializes independently, never near the limit.
    const payload =
      chunk.item !== undefined
        ? { ...chunk, item: compressPayload(this.dedupeTopLevel(chunk.item, index, seen)) }
        : chunk
    writeFileSync(join(dir, chunkName(index)), JSON.stringify(payload), 'utf-8')
    return payload
  }

  /**
   * Replace any top-level field of a plain-object item with a `SharedRef` when an earlier
   * chunk in this same write() call already holds the IDENTICAL (`===`) value at some key —
   * e.g. a `{ tree, focus }` scene item whose `tree` several fan-out branches share
   * unmutated. First occurrence is recorded and embedded normally (or externalized to the
   * blob store, see `externalizeValue`); every later occurrence of that same reference
   * becomes a small pointer instead of a full re-embed.
   */
  private dedupeTopLevel(item: unknown, chunkIndex: number, seen: Map<object, { chunk: number; key: string }>): unknown {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return item
    const obj = item as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      if (value !== null && typeof value === 'object') {
        const hit = seen.get(value)
        if (hit) {
          out[key] = { [SHARED_REF_KEY]: hit.chunk, [SHARED_REF_FIELD_KEY]: hit.key } satisfies SharedRef
          continue
        }
        seen.set(value, { chunk: chunkIndex, key })
        const { value: externalized, ref } = this.externalizeValue(value)
        out[key] = ref ?? externalized
        continue
      }
      out[key] = value
    }
    return out
  }

  /**
   * Content-address `value`, recursing into `SceneNodeSnapshot.children` first
   * (post-order / bottom-up) so each subtree is hashed independently of its
   * ancestors — see scene-generator-scene-tree-storage.md §8. This is what lets
   * `add_child`'s append-only merge chain (each step re-embeds "the whole tree so
   * far" as a fresh top-level object) collapse to storing every *unique* subtree
   * exactly once: an untouched sibling subtree keeps the same `path`/`version`/
   * content across every step (persistent-tree structural sharing, see
   * `graftAt`/`rewriteAtPath` in scene/tree.ts), so it hashes identically every
   * time and `blobStore.put()` no-ops on the repeat.
   *
   * Returns `{ value, ref }`: `value` is the (possibly child-collapsed) object to
   * embed inline, and `ref` is set when `value` itself was ALSO big enough to
   * externalize — callers should embed `ref ?? value`. Non-scene-tree values keep
   * the original flat "hash the whole value or leave it alone" behaviour (no
   * recursion target), so this is a strict superset of the old `externalizeIfLarge`.
   */
  private externalizeValue(value: unknown): { value: unknown; ref?: OutputCacheBlobRef } {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return { value }
    if (!isSceneNodeLike(value)) {
      const ref = this.hashAndStore(value)
      return ref ? { value, ref } : { value }
    }
    const obj = value as Record<string, unknown>
    const children = obj.children as readonly unknown[]
    let childrenChanged = false
    const nextChildren = children.map((child) => {
      const resolved = this.externalizeValue(child)
      if (resolved.ref) {
        childrenChanged = true
        return resolved.ref
      }
      if (resolved.value !== child) childrenChanged = true
      return resolved.value
    })
    const collapsed = childrenChanged ? { ...obj, children: nextChildren } : obj
    const ref = this.hashAndStore(collapsed)
    return ref ? { value: collapsed, ref } : { value: collapsed }
  }

  /**
   * Content-hash a value and store it in the blob store when it's large enough to
   * be worth externalizing (see `BLOB_MIN_BYTES`) — this is what generalizes
   * `SharedRef`'s same-write reference-identity dedup into a content-addressed
   * dedup that also catches cross-write, cross-port, cross-subtree, and
   * reference-distinct-but-content-equal duplicates (see
   * scene-generator-scene-tree-storage.md). Returns `undefined` for small
   * values, telling the caller to inline it as today. `compressPayload` is
   * idempotent on already-compact `{__voxelCells}` blobs (and on child fields
   * that are already `{__outputCacheBlobRef}` pointers), so calling it again on
   * an object whose descendants were already compacted/externalized is safe.
   */
  private hashAndStore(value: object): OutputCacheBlobRef | undefined {
    const compact = compressPayload(value)
    const jsonText = JSON.stringify(compact) ?? 'null'
    if (Buffer.byteLength(jsonText, 'utf-8') < BLOB_MIN_BYTES) return undefined
    const hash = this.blobStore.put(jsonText)
    // Prime the parsed-blob cache with the compact object we already built in
    // memory, instead of leaving the first `getParsedBlob()` call (which
    // `write()`'s own estimatedExpandedBytes/estimatedEnvelopeBytes caching
    // triggers immediately, see `cachedOrScannedByteSize`) re-parse the very
    // same (potentially many-MB, millions-of-numbers) JSON text we just built.
    this.cacheParsedBlob(hash, compact)
    return makeOutputCacheBlobRef(hash)
  }

  /** Mark a node's cache invalid by removing its directory (json + bin + shards). */
  invalidate(nodeId: string): void {
    this.purgeCacheForNode(nodeId)
    const dir = join(this.root, nodeId)
    if (!existsSync(dir)) return
    rmSync(dir, { recursive: true, force: true })
  }

  /**
   * Remove output-cache directories whose node id no longer exists in the
   * graph (top-level nodes + inner group members). Returns how many dirs were
   * removed. Safe to call after every applyBatch — catches stranded inner-node
   * caches when a group is deleted without cascading invalidate.
   */
  pruneOrphans(validNodeIds: ReadonlySet<string>): number {
    if (!existsSync(this.root)) return 0
    let removed = 0
    for (const name of readdirSync(this.root)) {
      if (name === BLOB_DIR_NAME) continue
      if (validNodeIds.has(name)) continue
      const dir = join(this.root, name)
      try {
        rmSync(dir, { recursive: true, force: true })
        this.purgeCacheForNode(name)
        removed++
      } catch {
        // Best-effort sweep; a concurrent write may recreate the dir.
      }
    }
    return removed
  }

  /** Clear the entire cache root (this also removes `_blobs/`, recursively). */
  clearAll(): void {
    this.rawCache.clear()
    this.expandedCache.clear()
    this.blobParsedCache.clear()
    if (!existsSync(this.root)) return
    rmSync(this.root, { recursive: true, force: true })
  }

  /** Blob-store totals (gzip'd blob count + bytes) — for logging/verification, not gating logic. */
  blobStoreStats(): { blobCount: number; totalBytes: number } {
    return this.blobStore.stats()
  }

  /**
   * Full-tree GC sweep: scan every chunk file under every node/port dir to
   * find which blob hashes are still referenced, then delete every blob that
   * isn't. O(total chunk files across the whole project) — expensive, so this
   * is wired into `pruneByRetention()`'s existing periodic sweep rather than
   * run after every write/invalidate. Safe to call directly too (e.g. tests,
   * an ops script) — it's read-then-conditionally-delete, no invariant to
   * violate if called redundantly.
   */
  gcBlobs(): number {
    if (!existsSync(this.root)) return 0
    const liveHashes = new Set<string>()
    for (const nodeName of readdirSync(this.root)) {
      if (nodeName === BLOB_DIR_NAME) continue
      const nodeDir = join(this.root, nodeName)
      let portEntries: string[]
      try {
        portEntries = readdirSync(nodeDir)
      } catch {
        continue
      }
      for (const entry of portEntries) {
        if (!entry.endsWith('.data')) continue
        const shardDir = join(nodeDir, entry)
        let chunkNames: string[]
        try {
          chunkNames = readdirSync(shardDir)
        } catch {
          continue
        }
        for (const chunkFile of chunkNames) {
          let chunk: DataChunk | null
          try {
            chunk = JSON.parse(readFileSync(join(shardDir, chunkFile), 'utf-8')) as DataChunk
          } catch {
            continue
          }
          const item = chunk?.item
          if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
          this.collectBlobRefHashes(item, liveHashes)
        }
      }
    }
    // `liveHashes` so far only holds hashes reachable directly from a chunk file.
    // A blob's own content can embed further `{__outputCacheBlobRef}` pointers to
    // its (big-enough) children (see `externalizeValue`), so walk out from every
    // hash found so far to its transitive closure — otherwise a child blob only
    // ever reachable THROUGH another blob (never directly from a chunk) would
    // look "dead" and get collected even while still in use.
    const queue = [...liveHashes]
    while (queue.length > 0) {
      const hash = queue.pop()!
      const jsonText = this.blobStore.get(hash)
      if (jsonText === null) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(jsonText)
      } catch {
        continue
      }
      const nested = new Set<string>()
      this.collectBlobRefHashes(parsed, nested)
      for (const nestedHash of nested) {
        if (!liveHashes.has(nestedHash)) {
          liveHashes.add(nestedHash)
          queue.push(nestedHash)
        }
      }
    }
    return this.blobStore.gc(liveHashes)
  }

  /** Recursively record every `{__outputCacheBlobRef}` hash found anywhere inside `value`. */
  private collectBlobRefHashes(value: unknown, out: Set<string>): void {
    if (value === null || typeof value !== 'object') return
    if (isOutputCacheBlobRef(value)) {
      out.add(value[OUTPUT_CACHE_BLOB_REF_KEY])
      return
    }
    if (Array.isArray(value)) {
      for (const el of value) this.collectBlobRefHashes(el, out)
      return
    }
    for (const child of Object.values(value as Record<string, unknown>)) this.collectBlobRefHashes(child, out)
  }

  /**
   * Cap disk use under outputs/ — prevents agent runs from accumulating multi-GB
   * shard dirs that make project switch / listProjects unbearably slow.
   */
  pruneByRetention(opts?: OutputCacheRetention): OutputCachePruneResult {
    if (!existsSync(this.root)) return { removed: 0, kept: 0, freedBytes: 0 }

    const retention = { ...DEFAULT_OUTPUT_CACHE_RETENTION, ...opts }
    const entries = readdirSync(this.root, { withFileTypes: true }).filter(
      (e) => e.isDirectory() && e.name !== BLOB_DIR_NAME,
    )
    if (entries.length === 0) return { removed: 0, kept: 0, freedBytes: 0 }

    type Row = { name: string; bytes: number; mtime: number }
    const rows: Row[] = []
    for (const e of entries) {
      const p = join(this.root, e.name)
      try {
        rows.push({ name: e.name, bytes: directoryByteSize(p), mtime: statSync(p).mtimeMs })
      } catch {
        /* race */
      }
    }

    const toRemove = new Set<string>()
    const mark = (name: string) => toRemove.add(name)

    for (const row of [...rows].sort((a, b) => a.mtime - b.mtime)) {
      if (row.bytes > retention.maxDirBytes) mark(row.name)
    }

    let survivors = rows.filter((r) => !toRemove.has(r.name))
    const protectedIds = retention.protectedNodeIds
    const unprotected = protectedIds
      ? survivors.filter((r) => !protectedIds.has(r.name))
      : survivors
    unprotected.sort((a, b) => b.mtime - a.mtime)
    for (const row of unprotected.slice(retention.maxNodeDirs)) {
      mark(row.name)
    }

    survivors = rows.filter((r) => !toRemove.has(r.name))
    survivors.sort((a, b) => a.mtime - b.mtime)
    let total = survivors.reduce((s, r) => s + r.bytes, 0)
    for (const row of survivors) {
      if (total <= retention.maxTotalBytes) break
      mark(row.name)
      total -= row.bytes
    }

    let freedBytes = 0
    let removed = 0
    for (const name of toRemove) {
      const row = rows.find((r) => r.name === name)
      const p = join(this.root, name)
      try {
        rmSync(p, { recursive: true, force: true })
        this.purgeCacheForNode(name)
        removed += 1
        if (row) freedBytes += row.bytes
      } catch {
        /* best-effort */
      }
    }

    // Sweep the blob store now that any orphaned node dirs are gone — a blob
    // only becomes unreferenced when the last chunk pointing at it is removed,
    // which just happened above (if anything was removed at all).
    if (removed > 0) this.gcBlobs()

    return { removed, kept: rows.length - removed, freedBytes }
  }
}
