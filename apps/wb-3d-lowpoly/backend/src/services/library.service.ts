/**
 * Slim filesystem blob store — the minimal subset of the legacy
 * `library.service.ts` the baker handle needs.
 *
 * The legacy library was a full asset store (better-sqlite3 + sharp + zones +
 * ref-counting + image dims + tags + search). The baker only ever touches three
 * capabilities, so we implement just those over the filesystem and skip the DB
 * and image deps entirely:
 *
 *   - importFromBuffer(buffer, filename, alias?, opts?)  → write a content-
 *       addressed blob + remember its alias→sha mapping
 *   - getByAlias(alias, zone?)                            → disk-cache short-circuit
 *   - resolveBlobPath(alias, zone?)                       → read OBJ counts w/o re-bake
 *   - resolveBlobPathBySha(sha256)                        → /library/blob/:sha route
 *   - getMimeBySha(sha256)                                → /library/blob/:sha route
 *
 * Blob layout mirrors legacy: <libRoot>/blobs/{sha[0:2]}/{sha[2:4]}/{sha}.
 * Content-addressed, so identical OBJ bytes dedupe automatically. An alias index
 * (<libRoot>/index.json) maps (zone, alias) → sha so the baker's disk cache
 * survives a backend restart, exactly like the legacy sqlite-backed lookup.
 */

import { createHash } from 'crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'fs'
import { basename, join } from 'path'

export type AssetZone = string

export interface ImportOptions {
  zone?: AssetZone
  source?: 'manual' | 'pipeline' | 'ai_gen'
  tags?: string[]
  mime?: string
}

export interface AssetRecord {
  alias: string
  zone: AssetZone
  blobSha256: string
  sizeBytes: number
  mimeType: string
}

interface IndexEntry {
  blobSha256: string
  sizeBytes: number
  mimeType: string
}

const DEFAULT_ZONE = 'raw'

/** Matches the `/library/blob/:sha256` route's own guard — 64 lowercase/uppercase hex chars. */
const SHA256_RE = /^[0-9a-f]{64}$/i

function indexKey(zone: AssetZone, alias: string): string {
  return `${zone}\u0000${alias}`
}

/** OBJ + a few common mesh/text mimes; defaults to octet-stream like legacy. */
function detectMime(filename: string, explicit?: string): string {
  if (explicit) return explicit
  const lower = filename.toLowerCase()
  if (lower.endsWith('.obj')) return 'model/obj'
  if (lower.endsWith('.stl')) return 'model/stl'
  if (lower.endsWith('.glb')) return 'model/gltf-binary'
  if (lower.endsWith('.gltf')) return 'model/gltf+json'
  return 'application/octet-stream'
}

export class LibraryService {
  /** alias index, keyed by (zone, alias). */
  private readonly aliasIndex = new Map<string, IndexEntry>()
  /** reverse map sha → mime, for the content-addressed blob route. */
  private readonly mimeBySha = new Map<string, string>()
  private readonly indexFile: string

  constructor(private readonly libRoot: string) {
    this.indexFile = join(libRoot, 'index.json')
    this.loadIndex()
  }

  // ── blob path helpers (content-addressed, mirrors legacy layout) ────────

  private blobFilePath(sha256: string): string {
    return join(this.libRoot, 'blobs', sha256.slice(0, 2), sha256.slice(2, 4), sha256)
  }

  private loadIndex(): void {
    try {
      if (!existsSync(this.indexFile)) return
      const raw = JSON.parse(readFileSync(this.indexFile, 'utf-8')) as Record<string, IndexEntry>
      for (const [key, entry] of Object.entries(raw)) {
        this.aliasIndex.set(key, entry)
        this.mimeBySha.set(entry.blobSha256, entry.mimeType)
      }
    } catch {
      /* corrupt / partial index is non-fatal — the baker just re-bakes. */
    }
  }

  private persistIndex(): void {
    const obj: Record<string, IndexEntry> = {}
    for (const [key, entry] of this.aliasIndex) obj[key] = entry
    try {
      mkdirSync(this.libRoot, { recursive: true })
      const tmp = `${this.indexFile}.tmp`
      writeFileSync(tmp, JSON.stringify(obj))
      renameSync(tmp, this.indexFile)
    } catch {
      /* best-effort persistence; an unwritable index only costs re-bakes. */
    }
  }

  /** Write blob atomically: temp → fsync → rename. No-op if it already exists. */
  private writeBlobFile(sha256: string, buffer: Buffer): void {
    const finalPath = this.blobFilePath(sha256)
    if (existsSync(finalPath)) return
    mkdirSync(join(finalPath, '..'), { recursive: true })
    const tmpPath = `${finalPath}.tmp`
    writeFileSync(tmpPath, buffer)
    const fd = openSync(tmpPath, 'r+')
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(tmpPath, finalPath)
  }

  // ── public API (baker + blob route) ─────────────────────────────────────

  async importFromBuffer(
    buffer: Buffer,
    filename: string,
    alias?: string,
    opts?: ImportOptions,
  ): Promise<AssetRecord> {
    const sha256 = createHash('sha256').update(buffer).digest('hex')
    const resolvedAlias = alias ?? basename(filename)
    const zone = opts?.zone ?? DEFAULT_ZONE
    const mimeType = detectMime(resolvedAlias, opts?.mime)

    this.writeBlobFile(sha256, buffer)

    const entry: IndexEntry = { blobSha256: sha256, sizeBytes: buffer.length, mimeType }
    const key = indexKey(zone, resolvedAlias)
    const prev = this.aliasIndex.get(key)
    this.aliasIndex.set(key, entry)
    this.mimeBySha.set(sha256, mimeType)
    if (!prev || prev.blobSha256 !== sha256) this.persistIndex()

    return { alias: resolvedAlias, zone, blobSha256: sha256, sizeBytes: buffer.length, mimeType }
  }

  /** Locate alias metadata; private→shared fallback collapses to "any zone". */
  getByAlias(alias: string, zone?: AssetZone): AssetRecord | null {
    if (zone) {
      const entry = this.aliasIndex.get(indexKey(zone, alias))
      if (!entry) return null
      return { alias, zone, blobSha256: entry.blobSha256, sizeBytes: entry.sizeBytes, mimeType: entry.mimeType }
    }
    for (const [key, entry] of this.aliasIndex) {
      const sep = key.indexOf('\u0000')
      if (key.slice(sep + 1) === alias) {
        return { alias, zone: key.slice(0, sep), blobSha256: entry.blobSha256, sizeBytes: entry.sizeBytes, mimeType: entry.mimeType }
      }
    }
    return null
  }

  resolveBlobPath(alias: string, zone?: AssetZone): string | null {
    const record = this.getByAlias(alias, zone)
    if (!record) return null
    const path = this.blobFilePath(record.blobSha256)
    return existsSync(path) ? path : null
  }

  /**
   * Resolve a blob file by content hash (the /library/blob/:sha256 route, and
   * the baker's colored-assembly mesh-part re-read). The HTTP route validates
   * the sha with the same regex before calling in, but callers that build the
   * "sha" from a DSL-authored `filename` arg (e.g. `loadMeshPartRawMesh` in
   * baker.service.ts) do not — without this guard a crafted `filename` like
   * `../../../../etc/passwd.obj` would resolve outside `libRoot/blobs` and let
   * a graph mutation read arbitrary files off disk. Reject anything that isn't
   * exactly 64 hex chars before it ever reaches a path join.
   */
  resolveBlobPathBySha(sha256: string): string | null {
    if (!SHA256_RE.test(sha256)) return null
    const path = this.blobFilePath(sha256.toLowerCase())
    return existsSync(path) ? path : null
  }

  getMimeBySha(sha256: string): string | null {
    if (!SHA256_RE.test(sha256)) return null
    return this.mimeBySha.get(sha256.toLowerCase()) ?? null
  }
}

// ── module singleton ──────────────────────────────────────────────────────

let instance: LibraryService | null = null

/**
 * Returns the process-wide LibraryService. The first call binds the blob root
 * (the 3d-lowpoly backend passes `<projectRoot>/library`). Subsequent calls
 * ignore the argument and reuse the same instance.
 */
export function getLibraryService(libRoot?: string): LibraryService {
  if (!instance) {
    if (!libRoot) throw new Error('getLibraryService: libRoot required on first call')
    instance = new LibraryService(libRoot)
  }
  return instance
}
