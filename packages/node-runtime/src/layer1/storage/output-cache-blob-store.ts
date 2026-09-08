// Content-addressed blob store for large DataTree item fields — see
// wb-scene-generator-scene-tree-storage.md. Lives under
// `<outputsRoot>/_blobs/<sha256>.json.gz`, ONE instance per OutputCache (i.e.
// per project), shared across every node/port. This is what lets
// "same scene tree, N different focuses" (the `scene_focus_path` broadcast
// pattern, see wb-scene-generator-project-switch.md §2.10) collapse to a
// single stored copy regardless of which port/node/write() call first wrote
// it — a strict superset of OutputCache's own `dedupeTopLevel` SharedRef
// mechanism, which only catches same-write, same-reference (`===`) matches.
//
// Each blob is content-addressed (sha256 of its compact-encoded JSON text) so
// `put()` is naturally idempotent: writing the same content twice, from two
// different ports or two structurally-equal-but-reference-distinct objects,
// is a no-op the second time. Gzip on top squeezes the still-fairly-verbose
// JSON-of-numbers voxel encoding further — deflate handles the highly
// repetitive digit/comma/field-name patterns well.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'

/** Directory name reserved for the blob store — every other entry under an
 * OutputCache root is a node id, so callers that enumerate node dirs
 * (`pruneOrphans`, `pruneByRetention`) must skip this name explicitly. */
export const BLOB_DIR_NAME = '_blobs'

const BLOB_EXT = '.json.gz'

export class OutputCacheBlobStore {
  constructor(private readonly root: string) {}

  private dir(): string {
    return join(this.root, BLOB_DIR_NAME)
  }

  private path(hash: string): string {
    return join(this.dir(), `${hash}${BLOB_EXT}`)
  }

  /**
   * Store `jsonText` (already compact-encoded, e.g. via `compressPayload` +
   * `JSON.stringify`) under its sha256 hash. No-ops when a blob with that hash
   * already exists — same content, whatever the caller's object identity or
   * originating port. Returns the hash so the caller can embed a
   * `{ __outputCacheBlobRef: hash }` pointer in place of the field.
   */
  put(jsonText: string): string {
    const hash = createHash('sha256').update(jsonText, 'utf-8').digest('hex')
    const p = this.path(hash)
    if (!existsSync(p)) {
      const dir = this.dir()
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(p, gzipSync(Buffer.from(jsonText, 'utf-8')))
    }
    return hash
  }

  /** Read back the original (pre-gzip) JSON text for `hash`, or null if missing/corrupt. */
  get(hash: string): string | null {
    try {
      return gunzipSync(readFileSync(this.path(hash))).toString('utf-8')
    } catch {
      return null
    }
  }

  has(hash: string): boolean {
    return existsSync(this.path(hash))
  }

  /** Gzip'd on-disk size of one blob, or 0 if missing. */
  byteSize(hash: string): number {
    try {
      return statSync(this.path(hash)).size
    } catch {
      return 0
    }
  }

  /** Total blob count + gzip'd byte size across the whole store — for logging/verification. */
  stats(): { blobCount: number; totalBytes: number } {
    if (!existsSync(this.dir())) return { blobCount: 0, totalBytes: 0 }
    let totalBytes = 0
    let blobCount = 0
    for (const name of readdirSync(this.dir())) {
      try {
        totalBytes += statSync(join(this.dir(), name)).size
        blobCount += 1
      } catch {
        /* race */
      }
    }
    return { blobCount, totalBytes }
  }

  /**
   * Delete every blob whose hash is not in `liveHashes`. Called from
   * `OutputCache.gcBlobs()` after a full scan of every chunk file still on
   * disk — expensive (O(all chunks)), so it is wired into the existing
   * periodic `pruneByRetention()` sweep rather than run after every write.
   */
  gc(liveHashes: ReadonlySet<string>): number {
    if (!existsSync(this.dir())) return 0
    let removed = 0
    for (const name of readdirSync(this.dir())) {
      const hash = name.endsWith(BLOB_EXT) ? name.slice(0, -BLOB_EXT.length) : name
      if (liveHashes.has(hash)) continue
      try {
        rmSync(join(this.dir(), name))
        removed += 1
      } catch {
        /* concurrent write/race — best-effort sweep */
      }
    }
    return removed
  }
}
