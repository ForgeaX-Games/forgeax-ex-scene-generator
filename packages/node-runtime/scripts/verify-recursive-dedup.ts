// One-off empirical verification script for the recursive (Merkle-DAG) content
// addressing fix described in wb-scene-generator-scene-tree-storage.md §8.
//
// Read-only against the real project: only ever calls `read()`/`portByteSize()`/
// `envelopeByteSize()` on the EXISTING project directory — never `write()` or
// `gcBlobs()` there — so it cannot corrupt or mutate the live dev server's data.
// All NEW-code writes happen against a throwaway tmp directory.
//
// Usage: npx tsx scripts/verify-recursive-dedup.ts <projectStateDir> <nodeId> <portId>
import { mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OutputCache } from '../src/layer1/storage/output-cache.js'

const [stateDir, nodeId, portId] = process.argv.slice(2)
if (!stateDir || !nodeId || !portId) {
  console.error('usage: verify-recursive-dedup.ts <projectStateDir> <nodeId> <portId>')
  process.exit(1)
}

function blobDirStats(outputsDir: string): { count: number; bytes: number } {
  const dir = join(outputsDir, '_blobs')
  let count = 0
  let bytes = 0
  try {
    for (const f of readdirSync(dir)) {
      count += 1
      bytes += statSync(join(dir, f)).size
    }
  } catch {
    /* no blob dir */
  }
  return { count, bytes }
}

async function main() {
  // 1. BEFORE (real, on-disk, written by the OLD flat-hash scheme): read-only.
  const before = blobDirStats(join(stateDir, 'outputs'))
  console.log(`[BEFORE / real on-disk, old scheme]  n_merge chunk-dir blobs: count=${before.count} bytes=${before.bytes} (${(before.bytes / 1024).toFixed(1)}KB)`)

  const realCache = new OutputCache(join(stateDir, 'outputs'))
  const realChunkCount = (() => {
    try {
      return readdirSync(join(stateDir, 'outputs', nodeId, `${portId}.data`)).length
    } catch {
      return 0
    }
  })()
  console.log(`[BEFORE] ${nodeId}/${portId} chunk files: ${realChunkCount}`)

  const t0 = Date.now()
  const beforePortBytes = realCache.portByteSize(nodeId, portId)
  const beforeScanMs = Date.now() - t0
  console.log(`[BEFORE] portByteSize()=${beforePortBytes} (${(beforePortBytes / 1024 / 1024).toFixed(2)}MB), scan took ${beforeScanMs}ms`)

  const t0b = Date.now()
  const beforeEnvelopeBytes = realCache.envelopeByteSize(nodeId, portId)
  const beforeEnvelopeMs = Date.now() - t0b
  console.log(`[BEFORE] envelopeByteSize()=${beforeEnvelopeBytes} (${(beforeEnvelopeBytes / 1024 / 1024).toFixed(2)}MB), scan took ${beforeEnvelopeMs}ms`)

  const readStart = Date.now()
  const real = realCache.read(nodeId, portId)
  const readMs = Date.now() - readStart
  if (!real) {
    console.error(`no data at ${nodeId}/${portId}`)
    process.exit(1)
  }
  console.log(`[BEFORE] read() took ${readMs}ms`)

  // 2. AFTER (same REAL data, re-written through a FRESH OutputCache using the
  // NEW recursive-dedup code) — entirely in a scratch tmp dir, zero risk to the
  // real project.
  const scratch = mkdtempSync(join(tmpdir(), 'recursive-dedup-verify-'))
  try {
    const freshCache = new OutputCache(join(scratch, 'outputs'))
    const writeStart = Date.now()
    freshCache.write(nodeId, portId, {
      valid: true,
      executedAt: new Date().toISOString(),
      executedHash: 'verify',
      type: real.type,
      data: real.data,
    })
    const writeMs = Date.now() - writeStart
    console.log(`[AFTER] write() (recursive dedup) took ${writeMs}ms`)

    const after = blobDirStats(join(scratch, 'outputs'))
    console.log(`[AFTER / new scheme]  blobs: count=${after.count} bytes=${after.bytes} (${(after.bytes / 1024).toFixed(1)}KB)`)

    const afterScanStart = Date.now()
    const afterPortBytes = freshCache.portByteSize(nodeId, portId)
    const afterScanMs = Date.now() - afterScanStart
    console.log(`[AFTER] portByteSize()=${afterPortBytes} (${(afterPortBytes / 1024 / 1024).toFixed(2)}MB), scan (should be O(1), cached) took ${afterScanMs}ms`)

    const afterEnvelopeStart = Date.now()
    const afterEnvelopeBytes = freshCache.envelopeByteSize(nodeId, portId)
    const afterEnvelopeMs = Date.now() - afterEnvelopeStart
    console.log(`[AFTER] envelopeByteSize()=${afterEnvelopeBytes} (${(afterEnvelopeBytes / 1024 / 1024).toFixed(2)}MB), took ${afterEnvelopeMs}ms`)

    console.log(`\n=== SUMMARY ===`)
    console.log(`blob count:  before=${before.count}  after=${after.count}`)
    console.log(`blob bytes:  before=${(before.bytes / 1024).toFixed(1)}KB  after=${(after.bytes / 1024).toFixed(1)}KB  ratio=${(before.bytes / after.bytes).toFixed(2)}x`)
    console.log(`portByteSize (expanded true wire size): before=${(beforePortBytes / 1024 / 1024).toFixed(2)}MB  after=${(afterPortBytes / 1024 / 1024).toFixed(2)}MB`)
    console.log(
      `envelopeByteSize (wire size with dedup):  before=${(beforeEnvelopeBytes / 1024 / 1024).toFixed(2)}MB  after=${(afterEnvelopeBytes / 1024 / 1024).toFixed(2)}MB  ratio=${(beforeEnvelopeBytes / afterEnvelopeBytes).toFixed(2)}x`,
    )
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
