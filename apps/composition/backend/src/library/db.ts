/**
 * Read-only, single-tenant asset-library SQLite handle.
 *
 * Opens the built-in shared library at `<repoRoot>/materials/asset-store/library.db`
 * in read-only mode. No migrations, no per-game pool, no write paths — the DB is
 * shipped content. If the file is missing or the open throws, returns null so
 * callers can degrade gracefully (empty lists / null lookups).
 */

import Database from 'better-sqlite3'
import { existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
// backend/src/library/db.ts -> repo root is three levels up.
export const repoRoot = resolve(here, '..', '..', '..')

/** Built-in asset-store root: contains library.db + blobs/. */
export const ASSET_STORE_DIR = join(repoRoot, 'materials', 'asset-store')

/** Process-level singleton — the read-only library is opened once. */
let sharedDbInstance: Database.Database | null = null
let sharedDbPath: string | null = null
let sharedDbMtimeMs: number | null = null
/** Timestamp (ms) of last failed open; throttles retries to once per interval. */
let lastFailedAttempt = 0
const RETRY_INTERVAL_MS = 5_000

/**
 * Open (or return the cached) read-only library connection.
 * Returns null if the file is missing or the open throws (e.g. native addon
 * not yet compiled). Retries periodically so a late `node-gyp rebuild` or a
 * newly-appearing library.db is picked up without a full backend restart.
 */
export function getSharedDb(): Database.Database | null {
  const dbPath = join(ASSET_STORE_DIR, 'library.db')
  if (!existsSync(dbPath)) {
    closeSharedDb()
    lastFailedAttempt = Date.now()
    console.warn(`[LibraryDB] library.db not present at ${dbPath} — will retry in ${RETRY_INTERVAL_MS / 1000}s`)
    return null
  }

  const mtimeMs = statSync(dbPath).mtimeMs
  if (sharedDbInstance && sharedDbPath === dbPath && sharedDbMtimeMs === mtimeMs) return sharedDbInstance
  if (sharedDbInstance) closeSharedDb()
  if (lastFailedAttempt && Date.now() - lastFailedAttempt < RETRY_INTERVAL_MS) return null

  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: false })
    registerBracketValue(db)
    sharedDbInstance = db
    sharedDbPath = dbPath
    sharedDbMtimeMs = mtimeMs
    lastFailedAttempt = 0
    return db
  } catch (e) {
    lastFailedAttempt = Date.now()
    console.warn(`[LibraryDB] Failed to open read-only library: ${(e as Error).message} — will retry in ${RETRY_INTERVAL_MS / 1000}s`)
    return null
  }
}

function closeSharedDb(): void {
  try {
    sharedDbInstance?.close()
  } catch {
    // Ignore close failures; the next open attempt should decide availability.
  }
  sharedDbInstance = null
  sharedDbPath = null
  sharedDbMtimeMs = null
}

export function __resetSharedDbForTests(): void {
  closeSharedDb()
  lastFailedAttempt = 0
}

/**
 * Register the `bracket_value(alias, n)` UDF used by list/sort/filter queries.
 * Extracts the content of the Nth (0-based) bracket field from an alias string.
 * Alias format: [f0]_[f1]__[f2]_..._[f12].ext. Returns the field value, or NULL.
 */
function registerBracketValue(db: Database.Database): void {
  db.function('bracket_value', (alias: string, n: number): string | null => {
    let count = 0
    let i = 0
    while (i < alias.length) {
      if (alias[i] === '[') {
        const close = alias.indexOf(']', i + 1)
        if (close === -1) break
        if (count === n) return alias.slice(i + 1, close)
        count++
        i = close + 1
      } else {
        i++
      }
    }
    return null
  })
}
