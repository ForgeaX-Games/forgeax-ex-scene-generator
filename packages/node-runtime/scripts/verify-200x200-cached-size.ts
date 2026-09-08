// One-off empirical check for the 200x200 scale re-test (recursive-dedup plan,
// empirical-verify todo). Read-only against a SCRATCH COPY of the real
// 200x200 project's outputs dir (never the live project) — measures:
//  - portByteSize()/envelopeByteSize() timing (should be O(1), cache-hit)
//  - gcBlobs() dry-run-ish correctness (reports live vs deletable, does NOT
//    delete unless --gc is passed)
//
// Usage: npx tsx scripts/verify-200x200-cached-size.ts <outputsDir> <nodeId> <portId> [--gc]
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { OutputCache } from '../src/layer1/storage/output-cache.js'

const [outputsDir, nodeId, portId, flag] = process.argv.slice(2)
if (!outputsDir || !nodeId || !portId) {
  console.error('usage: verify-200x200-cached-size.ts <outputsDir> <nodeId> <portId> [--gc]')
  process.exit(1)
}

function blobDirStats(dir: string): { count: number; bytes: number } {
  let count = 0
  let bytes = 0
  try {
    for (const f of readdirSync(join(dir, '_blobs'))) {
      count += 1
      bytes += statSync(join(dir, '_blobs', f)).size
    }
  } catch {
    /* no blob dir */
  }
  return { count, bytes }
}

async function main() {
  const cache = new OutputCache(outputsDir)

  const before = blobDirStats(outputsDir)
  console.log(`blob store: count=${before.count} bytes=${before.bytes} (${(before.bytes / 1024 / 1024).toFixed(2)}MB)`)

  for (let i = 0; i < 3; i++) {
    const t0 = Date.now()
    const portBytes = cache.portByteSize(nodeId, portId)
    const t1 = Date.now()
    const envBytes = cache.envelopeByteSize(nodeId, portId)
    const t2 = Date.now()
    console.log(
      `[call ${i}] portByteSize()=${portBytes} (${(portBytes / 1024 / 1024 / 1024).toFixed(2)}GB) took ${t1 - t0}ms | ` +
        `envelopeByteSize()=${envBytes} (${(envBytes / 1024 / 1024).toFixed(2)}MB) took ${t2 - t1}ms`,
    )
  }

  if (flag === '--gc') {
    const t0 = Date.now()
    const removed = cache.gcBlobs()
    const ms = Date.now() - t0
    console.log(`gcBlobs() took ${ms}ms, removed ${removed} blobs`)
    const after = blobDirStats(outputsDir)
    console.log(`blob store after gc: count=${after.count} bytes=${after.bytes} (${(after.bytes / 1024 / 1024).toFixed(2)}MB)`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
