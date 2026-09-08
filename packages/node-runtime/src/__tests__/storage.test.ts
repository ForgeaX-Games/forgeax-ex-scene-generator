// Storage layer integration tests against a real tmp filesystem.
//
// Covers:
//   * graph.json hash invariant (load rejects mismatch)
//   * graph.json optimistic-concurrency check (expectedPrevHash)
//   * canonicalize stable across key-order permutations
//   * history.jsonl chain validation
//   * outputs/<id>/<port>.json read/write/invalidate

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  GraphStore,
  HistoryLog,
  OutputCache,
  canonicalize,
  computeGraphHash,
  type GraphFileV1,
  type HistoryEntryV1,
} from '../layer1/index.js'

let scratchDir: string

beforeEach(() => {
  scratchDir = join(tmpdir(), `forgeax-storage-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(scratchDir, { recursive: true })
})

afterEach(() => {
  rmSync(scratchDir, { recursive: true, force: true })
})

function makeGraph(overrides: Partial<GraphFileV1> = {}): Omit<GraphFileV1, 'hash'> {
  return {
    schemaVersion: 1,
    id: 'test-graph',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    nodes: {
      n1: { id: 'n1', opId: 'plugin.echo', position: { x: 0, y: 0 }, params: {} },
    },
    edges: {},
    ...overrides,
  }
}

describe('canonicalize / computeGraphHash', () => {
  it('produces the same hash regardless of key order', () => {
    const a = makeGraph()
    const b = makeGraph()
    // Wrap b's nodes object with reversed keys to ensure the hash ignores order.
    const reordered = {
      hash: 'placeholder',
      // intentionally pile keys in a different order than makeGraph emits
      edges: b.edges,
      updatedAt: b.updatedAt,
      createdAt: b.createdAt,
      nodes: b.nodes,
      id: b.id,
      schemaVersion: b.schemaVersion,
    }
    expect(computeGraphHash(a)).toEqual(computeGraphHash(reordered as Omit<GraphFileV1, 'hash'>))
  })

  it('canonicalize sorts every nested object', () => {
    const out = canonicalize({ b: 1, a: { z: 2, y: 1 }, c: [{ d: 1, b: 2 }] })
    expect(JSON.stringify(out)).toEqual('{"a":{"y":1,"z":2},"b":1,"c":[{"b":2,"d":1}]}')
  })
})

describe('GraphStore', () => {
  it('round-trips a graph and validates the stored hash', () => {
    const store = new GraphStore(join(scratchDir, 'graph.json'))
    expect(store.exists()).toBe(false)
    const written = store.save(makeGraph())
    expect(written.hash).toMatch(/^[0-9a-f]{64}$/)
    const loaded = store.load()
    expect(loaded).not.toBeNull()
    expect(loaded?.id).toBe('test-graph')
    expect(loaded?.hash).toBe(written.hash)
  })

  it('rejects an externally edited file (hash mismatch)', () => {
    const path = join(scratchDir, 'graph.json')
    const store = new GraphStore(path)
    store.save(makeGraph())
    // Tamper with the file: change a node's position without touching the hash.
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as GraphFileV1
    raw.nodes.n1.position = { x: 999, y: 999 }
    writeFileSync(path, JSON.stringify(raw, null, 2), 'utf-8')
    expect(() => store.load()).toThrow(/hash mismatch/)
  })

  it('honours expectedPrevHash for concurrent-write detection', () => {
    const store = new GraphStore(join(scratchDir, 'graph.json'))
    const v1 = store.save(makeGraph())
    // Simulate a second writer racing in under us.
    const racer = makeGraph({ updatedAt: '2026-01-02T00:00:00Z' })
    store.save(racer)
    // Now we try to save based on the (stale) v1.hash:
    expect(() => store.save(makeGraph({ updatedAt: '2026-01-03T00:00:00Z' }), { expectedPrevHash: v1.hash })).toThrow(
      /concurrent-write/,
    )
  })
})

describe('HistoryLog', () => {
  function entry(prev: string, next: string, ts = '2026-01-01T00:00:00Z'): HistoryEntryV1 {
    return {
      schemaVersion: 1,
      ts,
      actor: 'user',
      batchId: `b-${prev.slice(0, 4)}-${next.slice(0, 4)}`,
      prevHash: prev,
      newHash: next,
      ops: [{ kind: 'noop' }],
    }
  }

  it('appends entries and reports the tip hash', () => {
    const log = new HistoryLog(join(scratchDir, 'history.jsonl'))
    expect(log.exists()).toBe(false)
    expect(log.tipHash()).toBeUndefined()

    log.append(entry('aaaa', 'bbbb'))
    log.append(entry('bbbb', 'cccc'))
    expect(log.exists()).toBe(true)
    expect(log.tipHash()).toBe('cccc')
    expect(log.readAll()).toHaveLength(2)
  })

  it('detects a broken chain', () => {
    const log = new HistoryLog(join(scratchDir, 'history.jsonl'))
    log.append(entry('aaaa', 'bbbb'))
    log.append(entry('XXXX', 'cccc')) // intentional mismatch
    const v = log.validate()
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.reason).toMatch(/chain break/)
      expect(v.lineIndex).toBe(1)
    }
  })

  it('validates against an external expected tip hash', () => {
    const log = new HistoryLog(join(scratchDir, 'history.jsonl'))
    log.append(entry('aaaa', 'bbbb'))
    log.append(entry('bbbb', 'cccc'))
    expect(log.validate({ expectedTipHash: 'cccc' })).toEqual({ ok: true })
    const bad = log.validate({ expectedTipHash: 'WRONG' })
    expect(bad.ok).toBe(false)
  })

  it('streams entries lazily', () => {
    const log = new HistoryLog(join(scratchDir, 'history.jsonl'))
    log.append(entry('aaaa', 'bbbb'))
    log.append(entry('bbbb', 'cccc'))
    log.append(entry('cccc', 'dddd'))
    const seen: string[] = []
    for (const e of log.stream()) seen.push(e.newHash)
    expect(seen).toEqual(['bbbb', 'cccc', 'dddd'])
  })
})

describe('OutputCache', () => {
  it('writes and reads a JSON entry', () => {
    const cache = new OutputCache(join(scratchDir, 'outputs'))
    cache.write('n1', 'out1', {
      valid: true,
      executedAt: '2026-01-01T00:00:00Z',
      executedHash: 'abc',
      type: 'string',
      data: { foo: 'bar' },
    })
    const got = cache.read('n1', 'out1')
    expect(got?.valid).toBe(true)
    expect((got?.data as { foo: string }).foo).toBe('bar')
  })

  it('writes a sibling .bin payload when one is provided', () => {
    const cache = new OutputCache(join(scratchDir, 'outputs'))
    const payload = Buffer.from([0x01, 0x02, 0x03, 0x04])
    cache.write(
      'n1',
      'tex',
      { valid: true, executedAt: '2026-01-01T00:00:00Z', executedHash: 'abc', type: 'image' },
      payload,
    )
    const got = cache.read('n1', 'tex')
    expect(got?.binFile).toBe('tex.bin')
    expect(readFileSync(cache.binPath('n1', 'tex'))).toEqual(payload)
  })

  it('invalidates a node by removing its directory', () => {
    const cache = new OutputCache(join(scratchDir, 'outputs'))
    cache.write('n1', 'out1', {
      valid: true,
      executedAt: '2026-01-01T00:00:00Z',
      executedHash: 'abc',
      type: 'string',
    })
    expect(cache.read('n1', 'out1')).not.toBeNull()
    cache.invalidate('n1')
    expect(cache.read('n1', 'out1')).toBeNull()
  })

  it('pruneOrphans removes cache dirs whose node id is not in the graph', () => {
    const cache = new OutputCache(join(scratchDir, 'outputs'))
    cache.write('alive', 'out', {
      valid: true,
      executedAt: '2026-01-01T00:00:00Z',
      executedHash: 'abc',
      type: 'string',
      data: 1,
    })
    cache.write('stranded_inner', 'out', {
      valid: true,
      executedAt: '2026-01-01T00:00:00Z',
      executedHash: 'abc',
      type: 'string',
      data: 2,
    })
    expect(cache.pruneOrphans(new Set(['alive']))).toBe(1)
    expect(cache.read('alive', 'out')).not.toBeNull()
    expect(cache.read('stranded_inner', 'out')).toBeNull()
  })

  it('pruneByRetention drops oversized dirs and caps count', () => {
    const cache = new OutputCache(join(scratchDir, 'outputs'))
    cache.write('keep', 'out', {
      valid: true,
      executedAt: '2026-01-01T00:00:00Z',
      executedHash: 'a',
      type: 'string',
      data: 1,
    })
    const hugeDir = join(scratchDir, 'outputs', 'huge')
    mkdirSync(hugeDir, { recursive: true })
    writeFileSync(join(hugeDir, 'x.bin'), Buffer.alloc(200 * 1024))
    const pruned = cache.pruneByRetention({ maxDirBytes: 128 * 1024, maxNodeDirs: 10 })
    expect(pruned.removed).toBe(1)
    expect(cache.read('keep', 'out')).not.toBeNull()
    expect(existsSync(hugeDir)).toBe(false)
  })

  // Large DataTreeEntry[] payloads must round-trip without ever building a
  // string near V8's single-string limit. The wire shape is sharded one chunk
  // per (branch-path, item); read regroups it back into identical entries.
  it('shards a large multi-item single-branch payload and round-trips it', () => {
    const cache = new OutputCache(join(scratchDir, 'outputs'))
    // One branch [0] whose items each carry a ~1MB blob → > the inline budget
    // forces sharding, and the multi-item-in-one-entry shape is exactly the
    // tree_flatten case that per-element sharding could not split.
    const big = 'x'.repeat(1024 * 1024)
    const items = Array.from({ length: 40 }, (_, i) => ({ id: i, blob: big }))
    const data = [{ path: [0], items }]
    cache.write('flat', 'tree', {
      valid: true,
      executedAt: '2026-01-01T00:00:00Z',
      executedHash: 'abc',
      type: 'any',
      data,
    })
    const got = cache.read('flat', 'tree')
    expect(got?.data).toEqual(data)
    // Metadata file stays tiny (no inline data); the value lives in shards.
    const meta = JSON.parse(readFileSync(cache.jsonPath('flat', 'tree'), 'utf-8')) as {
      data?: unknown
      dataChunks?: number
    }
    expect(meta.data).toBeUndefined()
    expect(meta.dataChunks).toBe(40)
  })

  // Mirrors the real g_veg_* blow-up (wb-scene-generator-project-switch.md §2.10):
  // a `scene_focus_path`-style fan-out returns `{ tree, focus }` for every branch,
  // reusing the SAME `tree` object across all of them (only `focus` differs). Sharding
  // must not re-embed that shared tree once per branch.
  it('dedupes a top-level field shared by reference across many branches instead of re-embedding it', () => {
    const cache = new OutputCache(join(scratchDir, 'outputs'))
    const sharedTree = { name: 'root', blob: 'z'.repeat(1024 * 1024) }
    const data = Array.from({ length: 125 }, (_, i) => ({
      path: [0, i],
      items: [{ tree: sharedTree, focus: `/decor${i}` }],
    }))
    cache.write('g_veg_wildflower', 'out_1', {
      valid: true,
      executedAt: '2026-01-01T00:00:00Z',
      executedHash: 'abc',
      type: 'scene',
      data,
    })
    // Correctness: reading back yields 125 branches, each with its own focus and an
    // (expanded) tree equal in content to the shared original.
    const got = cache.read('g_veg_wildflower', 'out_1')?.data as Array<{
      path: number[]
      items: Array<{ tree: { name: string; blob: string }; focus: string }>
    }>
    expect(got).toHaveLength(125)
    expect(got[0]!.items[0]!.focus).toBe('/decor0')
    expect(got[124]!.items[0]!.focus).toBe('/decor124')
    for (const branch of got) {
      expect(branch.items[0]!.tree).toEqual(sharedTree)
    }
    // The whole point: on-disk footprint should be close to ONE tree copy, not 125.
    const dir = join(scratchDir, 'outputs', 'g_veg_wildflower', 'out_1.data')
    let totalBytes = 0
    for (const f of readdirSync(dir)) totalBytes += statSync(join(dir, f)).size
    expect(totalBytes).toBeLessThan(2 * 1024 * 1024) // << 125 * ~1MB if it weren't deduped
  })

  // Guards the P0-5 safety net (see wb-scene-generator-project-switch.md §2.10):
  // portByteSize() is a cheap disk-based PROXY for "how big will this be once the
  // HTTP route actually reassembles + JSON.stringify()s it". Dedup shrinks the disk
  // footprint but NOT the true wire size (every branch still gets its own full copy
  // once resolveSharedRefs() runs) — if portByteSize() naively summed raw shard-file
  // bytes, it would drastically underestimate a deduped port and let the batch route's
  // "skip reassembly, this is obviously too large" short-circuit silently stop firing.
  it('portByteSize() reflects the TRUE (post-dedup-resolution) size, not the deduped on-disk footprint', () => {
    const cache = new OutputCache(join(scratchDir, 'outputs'))
    const sharedTree = { name: 'root', blob: 'z'.repeat(1024 * 1024) }
    const branchCount = 125
    const data = Array.from({ length: branchCount }, (_, i) => ({
      path: [0, i],
      items: [{ tree: sharedTree, focus: `/decor${i}` }],
    }))
    cache.write('g_veg_wildflower', 'out_1', {
      valid: true,
      executedAt: '2026-01-01T00:00:00Z',
      executedHash: 'abc',
      type: 'scene',
      data,
    })
    const dir = join(scratchDir, 'outputs', 'g_veg_wildflower', 'out_1.data')
    let onDiskBytes = 0
    for (const f of readdirSync(dir)) onDiskBytes += statSync(join(dir, f)).size
    const reported = cache.portByteSize('g_veg_wildflower', 'out_1')
    // The on-disk footprint is deduped (~1 tree copy); portByteSize() must NOT just
    // report that — it should be close to branchCount full tree copies (what
    // JSON.stringify(read()) will actually produce), not the tiny deduped footprint.
    expect(onDiskBytes).toBeLessThan(2 * 1024 * 1024)
    expect(reported).toBeGreaterThan((branchCount - 1) * 1024 * 1024)
    // And it should be a much better estimate of the real stringified size than the
    // raw on-disk footprint is.
    const trueBytes = Buffer.byteLength(JSON.stringify(cache.read('g_veg_wildflower', 'out_1')?.data), 'utf-8')
    expect(Math.abs(reported - trueBytes)).toBeLessThan(trueBytes * 0.1)
  })

  // Guards against the OTHER way portByteSize() can silently underestimate:
  // chunk files hold voxel cells in the compact `{__voxelCells:1,t,d}`
  // encoding, which is much smaller than the expanded `{x,y,z,token}[]` wire
  // form `read()` actually hands back to the HTTP route. A proxy built from
  // raw compressed file bytes alone (no dedup involved here) still misses the
  // real cost of a cell-heavy scene by that expansion ratio.
  // 3.5M cells is heavy enough (stringify/parse/gzip of tens-of-MB buffers) that
  // this legitimately runs close to vitest's 5s default even at baseline — bump
  // the timeout rather than let it flake.
  it(
    'portByteSize() accounts for voxel-cell expansion, not just the compressed on-disk size',
    () => {
      const cache = new OutputCache(join(scratchDir, 'outputs'))
      // Large enough that the compact-encoded data crosses INLINE_DATA_MAX_BYTES
      // and actually sheds into `.data/` shard chunks (the code path under test).
      const cells = Array.from({ length: 3_500_000 }, (_, i) => ({
        x: i % 1000,
        y: Math.floor(i / 1000),
        z: 0,
        token: i % 7 === 0 ? 'flower_rare_variant' : 'grass',
      }))
      cache.write('g_cellheavy', 'out_1', {
        valid: true,
        executedAt: '2026-01-01T00:00:00Z',
        executedHash: 'abc',
        type: 'scene',
        data: [{ path: [0], items: [{ tree: { cells }, focus: '/x' }] }],
      })
      const dir = join(scratchDir, 'outputs', 'g_cellheavy', 'out_1.data')
      let onDiskBytes = 0
      for (const f of readdirSync(dir)) onDiskBytes += statSync(join(dir, f)).size
      const reported = cache.portByteSize('g_cellheavy', 'out_1')
      const trueBytes = Buffer.byteLength(JSON.stringify(cache.read('g_cellheavy', 'out_1')?.data), 'utf-8')
      // Expanded form repeats field names + full token strings per cell, so it's
      // meaningfully larger than the flat-number-array compact encoding.
      expect(trueBytes).toBeGreaterThan(onDiskBytes * 1.5)
      expect(Math.abs(reported - trueBytes)).toBeLessThan(trueBytes * 0.05)
    },
    15000,
  )

  // Blob-store content-addressed dedup (see wb-scene-generator-scene-tree-storage.md)
  // is a superset of SharedRef: it also catches duplicates that AREN'T the same
  // object reference — across different write() calls, and across different ports —
  // as long as the content is byte-identical once compact-encoded.
  it('dedupes a large field with equal content across two SEPARATE write() calls to different ports', () => {
    const cache = new OutputCache(join(scratchDir, 'outputs'))
    const bigContent = { name: 'root', blob: 'w'.repeat(1024 * 1024) }
    const branchCount = 40
    const makeData = (portTag: string) =>
      Array.from({ length: branchCount }, (_, i) => ({
        path: [i],
        // A FRESH object literal per branch/port — never the same reference as
        // any other branch, in either write() call — so only content-hash dedup
        // (not SharedRef identity) can possibly collapse these.
        items: [{ tree: { name: bigContent.name, blob: bigContent.blob }, focus: `/${portTag}${i}` }],
      }))
    cache.write('g_veg_a', 'out_1', {
      valid: true,
      executedAt: '2026-01-01T00:00:00Z',
      executedHash: 'abc',
      type: 'scene',
      data: makeData('a'),
    })
    cache.write('g_veg_b', 'out_1', {
      valid: true,
      executedAt: '2026-01-01T00:00:00Z',
      executedHash: 'abc',
      type: 'scene',
      data: makeData('b'),
    })
    const blobDir = join(scratchDir, 'outputs', '_blobs')
    // One tree, written from two unrelated nodes/ports/write() calls — must still
    // collapse to a single blob file, not two.
    expect(readdirSync(blobDir)).toHaveLength(1)

    const gotA = cache.read('g_veg_a', 'out_1')?.data as Array<{ items: Array<{ tree: unknown; focus: string }> }>
    const gotB = cache.read('g_veg_b', 'out_1')?.data as Array<{ items: Array<{ tree: unknown; focus: string }> }>
    expect(gotA).toHaveLength(branchCount)
    expect(gotB).toHaveLength(branchCount)
    expect(gotA[0]!.items[0]!.tree).toEqual(bigContent)
    expect(gotB[0]!.items[0]!.tree).toEqual(bigContent)
    // Independence: mutating one branch's resolved tree must never affect another's
    // (content-addressing dedupes bytes on disk, never live object identity on read).
    ;(gotA[0]!.items[0]!.tree as { blob: string }).blob = 'mutated'
    expect((gotB[0]!.items[0]!.tree as { blob: string }).blob).toBe(bigContent.blob)
    expect((cache.read('g_veg_a', 'out_1')?.data as typeof gotA)[1]!.items[0]!.tree).toEqual(bigContent)
  })

  it('envelopeByteSize()/readWithBlobRefs() ship ~1 tree copy instead of N — the Phase-2 wire win', () => {
    const cache = new OutputCache(join(scratchDir, 'outputs'))
    const sharedTree = { name: 'root', blob: 'v'.repeat(1024 * 1024) }
    const branchCount = 125
    const data = Array.from({ length: branchCount }, (_, i) => ({
      path: [0, i],
      items: [{ tree: sharedTree, focus: `/decor${i}` }],
    }))
    cache.write('g_veg_wildflower', 'out_1', {
      valid: true,
      executedAt: '2026-01-01T00:00:00Z',
      executedHash: 'abc',
      type: 'scene',
      data,
    })
    const trueWireBytes = cache.portByteSize('g_veg_wildflower', 'out_1')
    const envelopeBytes = cache.envelopeByteSize('g_veg_wildflower', 'out_1')
    // Envelope should be dramatically smaller than the true (non-deduped) wire size —
    // close to one tree copy, not branchCount copies.
    expect(envelopeBytes).toBeLessThan(trueWireBytes / 10)
    expect(envelopeBytes).toBeLessThan(3 * 1024 * 1024)

    const withRefs = cache.readWithBlobRefs('g_veg_wildflower', 'out_1')
    expect(withRefs).not.toBeNull()
    const { entry, blobs } = withRefs!
    // Exactly one distinct blob referenced despite 125 branches.
    expect(Object.keys(blobs)).toHaveLength(1)
    const hash = Object.keys(blobs)[0]!
    expect(blobs[hash]).toEqual(sharedTree)

    // Hydration contract: replace every `{ __outputCacheBlobRef }` occurrence with
    // its sidecar value and the result must equal plain read()'s output exactly.
    const hydrate = (v: unknown): unknown => {
      if (v === null || typeof v !== 'object') return v
      if (Array.isArray(v)) return v.map(hydrate)
      const obj = v as Record<string, unknown>
      if (typeof obj.__outputCacheBlobRef === 'string') return blobs[obj.__outputCacheBlobRef as string]
      const out: Record<string, unknown> = {}
      for (const [k, val] of Object.entries(obj)) out[k] = hydrate(val)
      return out
    }
    const hydrated = hydrate(entry.data)
    expect(hydrated).toEqual(cache.read('g_veg_wildflower', 'out_1')?.data)
  })

  it('gcBlobs() removes blobs once every referencing chunk is gone, keeps blobs still referenced elsewhere', () => {
    const cache = new OutputCache(join(scratchDir, 'outputs'))
    const bigA = { blob: 'p'.repeat(1024 * 1024) }
    const bigB = { blob: 'q'.repeat(1024 * 1024) }
    const mkBranches = (tree: unknown, n: number) =>
      Array.from({ length: n }, (_, i) => ({ path: [i], items: [{ tree, focus: `/${i}` }] }))
    // Two ports share bigA; a third port alone holds bigB.
    cache.write('n1', 'out', {
      valid: true,
      executedAt: 't',
      executedHash: 'h',
      type: 'scene',
      data: mkBranches({ blob: bigA.blob }, 40),
    })
    cache.write('n2', 'out', {
      valid: true,
      executedAt: 't',
      executedHash: 'h',
      type: 'scene',
      data: mkBranches({ blob: bigA.blob }, 40),
    })
    cache.write('n3', 'out', {
      valid: true,
      executedAt: 't',
      executedHash: 'h',
      type: 'scene',
      data: mkBranches({ blob: bigB.blob }, 40),
    })
    const blobDir = join(scratchDir, 'outputs', '_blobs')
    expect(readdirSync(blobDir)).toHaveLength(2) // bigA + bigB, each stored once

    // Removing only one of the two bigA-referencing ports must NOT collect bigA yet.
    cache.invalidate('n1')
    expect(cache.gcBlobs()).toBe(0)
    expect(readdirSync(blobDir)).toHaveLength(2)

    // Removing the LAST bigA reference (n2) must collect bigA but keep bigB (n3 alive).
    cache.invalidate('n2')
    expect(cache.gcBlobs()).toBe(1)
    expect(readdirSync(blobDir)).toHaveLength(1)
    expect(cache.read('n3', 'out')?.data).toEqual(mkBranches(bigB, 40))
  })

  // Recursive (Merkle-DAG) content addressing — see wb-scene-generator-scene-tree-storage.md
  // §8. `add_child`'s append-only merge chain re-embeds "the whole tree so far" as a
  // fresh top-level object at every step; the old flat "hash the whole tree" scheme
  // stored ~N almost-entirely-overlapping copies. Recursing into `children` and hashing
  // each subtree independently should collapse this back down to ~1 copy of unique content.
  it(
    'recursively dedupes a growing chain of scene-tree snapshots (add_child-style merge chain)',
    () => {
      const cache = new OutputCache(join(scratchDir, 'outputs'))
      const makeLeaf = (name: string, version: number): unknown => ({
        name,
        path: `/${name}`,
        version,
        children: [],
        schema: 'voxel-mass',
        // Big enough that 20 accumulating leaves' summed compact size crosses
        // INLINE_DATA_MAX_BYTES (32MB) — the threshold that decides whether
        // write() shards at all (and therefore whether dedupeTopLevel/
        // externalizeValue — the code path under test — ever runs).
        cells: Array.from({ length: 20_000 }, (_, i) => ({ x: i % 50, y: Math.floor(i / 50), z: 0, token: 'grass' })),
      })
      const makeRoot = (children: unknown[], version: number): unknown => ({
        name: '',
        path: '/',
        version,
        children,
      })

      const stepCount = 20
      let children: unknown[] = []
      const snapshots: unknown[] = []
      for (let i = 0; i < stepCount; i++) {
        // Persistent-tree structural sharing: every earlier leaf is carried forward
        // BY REFERENCE, unchanged — exactly what `rewriteAtPath`/`graftAt` guarantee
        // for untouched sibling subtrees in scene/tree.ts.
        children = [...children, makeLeaf(`leaf${i}`, i + 1)]
        snapshots.push(makeRoot(children, i + 1))
      }
      // One focus-broadcast item per snapshot, mirroring scene_focus_path/n_merge's shape.
      const data = snapshots.map((tree, i) => ({ path: [i], items: [{ tree, focus: `/leaf${i}` }] }))
      cache.write('n_merge', 'tree', {
        valid: true,
        executedAt: '2026-01-01T00:00:00Z',
        executedHash: 'abc',
        type: 'scene',
        data,
      })

      const blobDir = join(scratchDir, 'outputs', '_blobs')
      // Exactly one blob per distinct leaf — reused across every snapshot that
      // includes it, not re-stored per snapshot.
      expect(readdirSync(blobDir)).toHaveLength(stepCount)

      let chainBlobBytes = 0
      for (const f of readdirSync(blobDir)) chainBlobBytes += statSync(join(blobDir, f)).size

      // Storing all 20 growing snapshots' worth of unique leaves should cost far
      // less than 20 raw (uncompressed) copies of just the FINAL snapshot alone —
      // strong evidence against the old flat "hash the whole tree" scheme, which
      // would have stored ~20 almost-entirely-overlapping full-tree blobs (see the
      // 60x60 case study: 24 snapshots stored 11.3x more than the final tree alone
      // needed). Compact-encoding + gzip alone typically beats raw JSON by several
      // times, so even a generous single-snapshot (not divided by 20) bound is a
      // meaningful, non-trivial assertion here.
      const rawFinalSnapshotBytes = Buffer.byteLength(JSON.stringify(snapshots[snapshots.length - 1]), 'utf-8')
      expect(chainBlobBytes).toBeLessThan(rawFinalSnapshotBytes)

      // Round-trip correctness: every snapshot must still read back exactly.
      const read = cache.read('n_merge', 'tree')?.data as Array<{ path: number[]; items: unknown[] }>
      for (let i = 0; i < stepCount; i++) {
        expect(read[i]?.items[0]).toEqual({ tree: snapshots[i], focus: `/leaf${i}` })
      }
    },
    15000,
  )

  it('gcBlobs() follows blob refs NESTED inside another blob (transitive reachability)', () => {
    const cache = new OutputCache(join(scratchDir, 'outputs'))
    const leaf = {
      name: 'leaf',
      path: '/leaf',
      version: 1,
      children: [] as unknown[],
      cells: Array.from({ length: 2000 }, (_, i) => ({ x: i, y: 0, z: 0, token: 'grass' })),
    }
    const root = {
      name: '',
      path: '/',
      version: 2,
      children: [leaf],
      // Padding so (a) the ROOT itself — even with `children` already collapsed
      // to a tiny blob-ref — is ALSO big enough to be externalized as its OWN,
      // separate blob (`leaf`'s blob then becomes reachable only THROUGH root's
      // blob content, never directly from the chunk file — the case a flat
      // top-level-only gcBlobs() scan would have missed), and (b) the write as a
      // whole crosses INLINE_DATA_MAX_BYTES so it shards at all.
      attributes: { pad: 'z'.repeat(34 * 1024 * 1024) },
    }
    cache.write('n_nested', 'tree', {
      valid: true,
      executedAt: 't',
      executedHash: 'h',
      type: 'scene',
      data: [{ path: [0], items: [{ tree: root, focus: '/leaf' }] }],
    })
    const blobDir = join(scratchDir, 'outputs', '_blobs')
    expect(readdirSync(blobDir)).toHaveLength(2) // root's own blob + leaf's own blob

    const chunkFile = join(scratchDir, 'outputs', 'n_nested', 'tree.data', 'chunk-000000.json')
    const chunk = JSON.parse(readFileSync(chunkFile, 'utf-8')) as { item: { tree: { __outputCacheBlobRef?: string } } }
    // Sanity: the chunk's top-level `tree` field is a ref to ROOT's blob only —
    // leaf's hash never appears directly in the chunk file.
    expect(chunk.item.tree.__outputCacheBlobRef).toBeTypeOf('string')

    // Nothing is collectible while the chunk is still alive.
    expect(cache.gcBlobs()).toBe(0)
    expect(readdirSync(blobDir)).toHaveLength(2)

    // Once the referencing chunk is gone, BOTH blobs — including the
    // only-nested-reachable leaf — must be collected.
    cache.invalidate('n_nested')
    expect(cache.gcBlobs()).toBe(2)
    expect(readdirSync(blobDir)).toHaveLength(0)
  })

  it('envelope recursively flattens NESTED blob refs into the sidecar (not just top-level)', () => {
    const cache = new OutputCache(join(scratchDir, 'outputs'))
    const leaf = {
      name: 'leaf',
      path: '/leaf',
      version: 1,
      children: [] as unknown[],
      cells: Array.from({ length: 2000 }, (_, i) => ({ x: i, y: 0, z: 0, token: 'grass' })),
    }
    const makeRoot = (version: number): unknown => ({
      name: '',
      path: '/',
      version,
      children: [leaf],
      // Same rationale as the gcBlobs nested-reachability test above: big enough
      // that (a) each root is independently blob-worthy and (b) the write as a
      // whole crosses INLINE_DATA_MAX_BYTES so it shards (the code path under test).
      attributes: { pad: 'z'.repeat(20 * 1024 * 1024) },
    })
    // Two DIFFERENT top-level roots (different `version` ⇒ different hash) that
    // nonetheless share the SAME nested `leaf` subtree by reference — mirrors two
    // different merge-chain snapshots sharing one untouched ancestor subtree.
    const data = [
      { path: [0], items: [{ tree: makeRoot(2), focus: '/a' }] },
      { path: [1], items: [{ tree: makeRoot(3), focus: '/b' }] },
    ]
    cache.write('n_nested2', 'tree', {
      valid: true,
      executedAt: 't',
      executedHash: 'h',
      type: 'scene',
      data,
    })
    const withRefs = cache.readWithBlobRefs('n_nested2', 'tree')
    expect(withRefs).not.toBeNull()
    const { entry, blobs } = withRefs!
    // Two distinct root blobs (differ by `version`) + ONE shared leaf blob = 3 total —
    // the leaf must NOT be re-embedded once per parent root.
    expect(Object.keys(blobs)).toHaveLength(3)

    const hydrate = (v: unknown): unknown => {
      if (v === null || typeof v !== 'object') return v
      if (Array.isArray(v)) return v.map(hydrate)
      const obj = v as Record<string, unknown>
      if (typeof obj.__outputCacheBlobRef === 'string') return hydrate(blobs[obj.__outputCacheBlobRef as string])
      const out: Record<string, unknown> = {}
      for (const [k, val] of Object.entries(obj)) out[k] = hydrate(val)
      return out
    }
    expect(hydrate(entry.data)).toEqual(cache.read('n_nested2', 'tree')?.data)
  })

  it('does not dedupe structurally-equal-but-distinct object references (only true reference sharing)', () => {
    const cache = new OutputCache(join(scratchDir, 'outputs'))
    const big = 'q'.repeat(1024 * 1024)
    // Two DISTINCT objects that happen to look identical — must NOT be collapsed into
    // a shared ref that would corrupt one branch if the other is later mutated upstream.
    const data = [
      { path: [0], items: [{ tree: { blob: big }, focus: '/a' }] },
      { path: [1], items: [{ tree: { blob: big }, focus: '/b' }] },
    ]
    cache.write('n', 'out', {
      valid: true,
      executedAt: '2026-01-01T00:00:00Z',
      executedHash: 'abc',
      type: 'scene',
      data,
    })
    expect(cache.read('n', 'out')?.data).toEqual(data)
  })

  it('round-trips a large multi-branch payload, preserving branch order and empty branches', () => {
    const cache = new OutputCache(join(scratchDir, 'outputs'))
    const big = 'y'.repeat(1024 * 1024)
    const data = [
      { path: [0], items: [{ k: 0, blob: big }] },
      { path: [1], items: [] }, // empty branch must survive
      { path: [2], items: [{ k: 2, blob: big }, { k: 3, blob: big }] },
    ]
    cache.write('m', 'scene', {
      valid: true,
      executedAt: '2026-01-01T00:00:00Z',
      executedHash: 'abc',
      type: 'scene',
      data,
    })
    expect(cache.read('m', 'scene')?.data).toEqual(data)
  })

  it('keeps a small payload inline (no shard dir)', () => {
    const cache = new OutputCache(join(scratchDir, 'outputs'))
    const data = [{ path: [0], items: [{ small: true }] }]
    cache.write('s', 'out', {
      valid: true,
      executedAt: '2026-01-01T00:00:00Z',
      executedHash: 'abc',
      type: 'scene',
      data,
    })
    const meta = JSON.parse(readFileSync(cache.jsonPath('s', 'out'), 'utf-8')) as {
      data?: unknown
      dataChunks?: number
    }
    expect(meta.dataChunks).toBeUndefined()
    expect(meta.data).toEqual(data)
    expect(cache.read('s', 'out')?.data).toEqual(data)
  })

  it('writes voxel cells in compact encoding on disk and expands on read', () => {
    const cache = new OutputCache(join(scratchDir, 'outputs'))
    const cells = [
      { x: 0, y: 0, z: 0, token: 'ground' },
      { x: 3, y: 1, z: 2, token: 'wall' },
    ]
    const data = [
      {
        path: [0],
        items: [
          {
            tree: {
              name: '',
              path: '/',
              version: 1,
              children: [
                {
                  name: 'L',
                  path: '/L',
                  version: 1,
                  schema: 'layer',
                  cells,
                  children: [],
                },
              ],
            },
            focus: '/L',
          },
        ],
      },
    ]
    cache.write('scene', 'out', {
      valid: true,
      executedAt: '2026-01-01T00:00:00Z',
      executedHash: 'abc',
      type: 'scene',
      data,
    })
    const onDisk = JSON.parse(readFileSync(cache.jsonPath('scene', 'out'), 'utf-8')) as Record<string, unknown>
    const diskData = onDisk.data as Array<{ items: Array<{ tree: { children: Array<{ cells: unknown }> } }> }>
    const diskCells = diskData[0]?.items[0]?.tree.children[0]?.cells
    expect(diskCells).toMatchObject({ __voxelCells: 1 })
    expect(cache.read('scene', 'out')?.data).toEqual(data)
  })

  // Guards the v3 `ScenePortValue` regression: `graph` is a class instance
  // (e.g. `PersistentStringMap`) whose real wire shape is a flat `{id: node}`
  // map, produced only via `.toJSON()` — its own enumerable fields are private
  // trie internals (`root`/`size`). Before compressPayload() respected
  // `.toJSON()`, this got flattened to `{root, size}` on disk, silently
  // corrupting every v3 scene port the moment it round-tripped through cache.
  it('round-trips a class-instance graph field (.toJSON()-backed) without leaking its private shape', () => {
    class MockPersistentMap {
      private root = { fakeTrieNode: true }
      private size = 1
      toJSON(): Record<string, unknown> {
        return {
          id1: {
            id: 'id1',
            name: 'Root',
            children: {},
            content: { kind: 'dense' as const, bbox: [0, 0, 0, 1, 0, 1], dict: ['wall'], data: [1, 1] },
          },
        }
      }
    }
    const cache = new OutputCache(join(scratchDir, 'outputs'))
    cache.write('scene_v3', 'out', {
      valid: true,
      executedAt: '2026-01-01T00:00:00Z',
      executedHash: 'abc',
      type: 'scene',
      data: { graph: new MockPersistentMap(), focus: 'id1' },
    })
    const onDisk = JSON.parse(readFileSync(cache.jsonPath('scene_v3', 'out'), 'utf-8')) as {
      data: { graph: Record<string, unknown> }
    }
    expect(onDisk.data.graph).not.toHaveProperty('root')
    expect(onDisk.data.graph).not.toHaveProperty('size')
    expect(onDisk.data.graph.id1).toMatchObject({ id: 'id1', name: 'Root' })

    const got = cache.read('scene_v3', 'out')?.data as { graph: Record<string, unknown>; focus: string }
    expect(got.focus).toBe('id1')
    expect(got.graph.id1).toEqual({
      id: 'id1',
      name: 'Root',
      children: {},
      content: { kind: 'dense', bbox: [0, 0, 0, 1, 0, 1], dict: ['wall'], data: [1, 1] },
    })
  })

  it('clears a stale shard dir when a later write is small (no resurrection)', () => {
    const cache = new OutputCache(join(scratchDir, 'outputs'))
    const big = 'z'.repeat(1024 * 1024)
    cache.write('r', 'out', {
      valid: true,
      executedAt: '2026-01-01T00:00:00Z',
      executedHash: 'abc',
      type: 'scene',
      data: [{ path: [0], items: Array.from({ length: 40 }, (_, i) => ({ i, big })) }],
    })
    // Re-execute produces a small value at the same port.
    const small = [{ path: [0], items: [{ tiny: 1 }] }]
    cache.write('r', 'out', {
      valid: true,
      executedAt: '2026-01-01T00:00:01Z',
      executedHash: 'def',
      type: 'scene',
      data: small,
    })
    expect(cache.read('r', 'out')?.data).toEqual(small)
  })
})
