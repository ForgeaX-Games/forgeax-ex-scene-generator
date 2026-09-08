import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { OutputCacheBlobStore } from '../output-cache-blob-store.js'

let scratchDir: string

beforeEach(() => {
  scratchDir = join(tmpdir(), `forgeax-blobstore-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(scratchDir, { recursive: true })
})

afterEach(() => {
  rmSync(scratchDir, { recursive: true, force: true })
})

describe('OutputCacheBlobStore', () => {
  it('put() is idempotent for identical content and get() round-trips it', () => {
    const store = new OutputCacheBlobStore(scratchDir)
    const text = JSON.stringify({ name: 'root', blob: 'z'.repeat(100_000) })
    const hash1 = store.put(text)
    const hash2 = store.put(text)
    expect(hash1).toBe(hash2)
    expect(store.get(hash1)).toBe(text)
    expect(store.has(hash1)).toBe(true)
    // Only one file on disk despite two put() calls.
    const dir = join(scratchDir, '_blobs')
    expect(readdirSync(dir)).toHaveLength(1)
  })

  it('gzips highly-repetitive content well below its raw size', () => {
    const store = new OutputCacheBlobStore(scratchDir)
    const text = JSON.stringify({ name: 'root', blob: 'z'.repeat(1_000_000) })
    const hash = store.put(text)
    const gzipBytes = store.byteSize(hash)
    expect(gzipBytes).toBeLessThan(Buffer.byteLength(text, 'utf-8') / 10)
  })

  it('distinct content produces distinct hashes/blobs', () => {
    const store = new OutputCacheBlobStore(scratchDir)
    const hashA = store.put(JSON.stringify({ a: 1 }))
    const hashB = store.put(JSON.stringify({ a: 2 }))
    expect(hashA).not.toBe(hashB)
    expect(store.get(hashA)).toBe(JSON.stringify({ a: 1 }))
    expect(store.get(hashB)).toBe(JSON.stringify({ a: 2 }))
  })

  it('get() returns null for a missing hash', () => {
    const store = new OutputCacheBlobStore(scratchDir)
    expect(store.get('does-not-exist')).toBeNull()
    expect(store.has('does-not-exist')).toBe(false)
  })

  it('stats() reports blob count and total gzip bytes', () => {
    const store = new OutputCacheBlobStore(scratchDir)
    expect(store.stats()).toEqual({ blobCount: 0, totalBytes: 0 })
    store.put(JSON.stringify({ a: 1 }))
    store.put(JSON.stringify({ b: 2 }))
    const stats = store.stats()
    expect(stats.blobCount).toBe(2)
    expect(stats.totalBytes).toBeGreaterThan(0)
  })

  it('gc() removes only blobs absent from liveHashes', () => {
    const store = new OutputCacheBlobStore(scratchDir)
    const hashA = store.put(JSON.stringify({ a: 1 }))
    const hashB = store.put(JSON.stringify({ b: 2 }))
    const removed = store.gc(new Set([hashA]))
    expect(removed).toBe(1)
    expect(store.has(hashA)).toBe(true)
    expect(store.has(hashB)).toBe(false)
  })

  it('gc() on an empty/missing store is a no-op', () => {
    const store = new OutputCacheBlobStore(join(scratchDir, 'never-created'))
    expect(store.gc(new Set())).toBe(0)
    expect(existsSync(join(scratchDir, 'never-created'))).toBe(false)
  })

  it('put() creates the _blobs dir lazily, not at construction', () => {
    const store = new OutputCacheBlobStore(scratchDir)
    expect(existsSync(join(scratchDir, '_blobs'))).toBe(false)
    store.put(JSON.stringify({ a: 1 }))
    expect(existsSync(join(scratchDir, '_blobs'))).toBe(true)
    expect(statSync(join(scratchDir, '_blobs')).isDirectory()).toBe(true)
  })
})
