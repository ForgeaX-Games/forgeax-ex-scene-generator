/**
 * Preset-asset source — a read-only, plugin-shipped column of images surfaced in
 * the Asset Store's left rail under the virtual folder `presets`.
 *
 * Mirrors the built-in text-preset model (`presets/store.ts`): images ship WITH
 * the plugin at `apps/<app>/presets-assets/` (version controlled, read-only) and
 * are never written into the user's generated-asset index. They are derived at
 * read time, tagged `readonly: true`, and given a `preset:`-prefixed alias so the
 * rest of the store (folders list, blob serving, delete guard) can recognise and
 * protect them without ever touching the file-backed index on disk.
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { GeneratedAssetRecord } from './generatedAssets.js'

const here = dirname(fileURLToPath(import.meta.url))
// backend/src/assets → app root is three levels up (assets → src → backend → app).
const appRoot = resolve(here, '..', '..', '..')

/** Plugin-shipped preset images live here (read-only, version controlled). */
const PRESET_DIR = join(appRoot, 'presets-assets')

/** The virtual left-rail folder these images appear under. */
export const PRESET_FOLDER = 'presets'

/** Alias prefix marking a record as a read-only preset (vs a real index alias). */
const PRESET_ALIAS_PREFIX = 'preset:'

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/** True when an alias refers to a preset asset (so callers can guard deletes). */
export function isPresetAlias(alias: string): boolean {
  return alias.startsWith(PRESET_ALIAS_PREFIX)
}

function fileToRecord(relName: string): GeneratedAssetRecord | null {
  const ext = extname(relName).toLowerCase()
  const mimeType = MIME_BY_EXT[ext]
  if (!mimeType) return null
  const abs = join(PRESET_DIR, relName)
  let sizeBytes = 0
  let createdAt = new Date(0).toISOString()
  try {
    const st = statSync(abs)
    if (!st.isFile()) return null
    sizeBytes = st.size
    createdAt = st.mtime.toISOString()
  } catch {
    return null
  }
  // A preset in a sub-directory (`presets-assets/<sub>/img.png`) appears under
  // the two-level rail column `presets/<sub>`; a top-level file stays in
  // `presets`. The alias encodes the relative path so blob serving can resolve
  // it back to the on-disk file (forward-slash normalized, never backslashes).
  const rel = relName.split('\\').join('/')
  const slash = rel.indexOf('/')
  const folder = slash === -1 ? PRESET_FOLDER : `${PRESET_FOLDER}/${rel.slice(0, slash)}`
  const baseName = slash === -1 ? rel : rel.slice(slash + 1)
  return {
    alias: `${PRESET_ALIAS_PREFIX}${rel}`,
    blobId: createHash('sha256').update(`${PRESET_FOLDER}/${rel}`).digest('hex'),
    relPath: `presets-assets/${rel}`,
    mimeType,
    sizeBytes,
    createdAt,
    name: baseName.replace(/\.[^.]+$/u, ''),
    source: 'plugin-preset',
    folder,
    tags: ['preset', 'readonly'],
    readonly: true,
  }
}

/** All preset-asset records derived from the plugin's `presets-assets/` dir.
 *  Scans the top level plus one level of sub-directories (each becomes a
 *  `presets/<sub>` two-level column); deeper nesting is flattened/ignored. */
export function listPresetAssets(): GeneratedAssetRecord[] {
  if (!existsSync(PRESET_DIR)) return []
  const out: GeneratedAssetRecord[] = []
  for (const name of readdirSync(PRESET_DIR)) {
    const abs = join(PRESET_DIR, name)
    let isDir = false
    try {
      isDir = statSync(abs).isDirectory()
    } catch {
      continue
    }
    if (isDir) {
      for (const child of readdirSync(abs)) {
        const rec = fileToRecord(`${name}/${child}`)
        if (rec) out.push(rec)
      }
    } else {
      const rec = fileToRecord(name)
      if (rec) out.push(rec)
    }
  }
  return out.sort((a, b) => a.alias.localeCompare(b.alias))
}

/**
 * Read a preset image's record + bytes by its content-addressed blobId.
 * Preset records live only in-memory (derived from the plugin dir, never in the
 * file-backed index), so a blobId lookup must scan the derived list rather than
 * the index. Used by the `/api/v1/library/blob/:id` route so an `image_source`
 * node whose param encodes a preset as `{alias,blobId}` (blobId preferred)
 * still resolves to the preset bytes.
 */
export function readPresetAssetByBlobId(blobId: string): { record: GeneratedAssetRecord; bytes: Buffer } | null {
  if (!blobId) return null
  const record = listPresetAssets().find((r) => r.blobId === blobId)
  if (!record) return null
  return readPresetAsset(record.alias)
}

/** Read a preset image's record + bytes by its `preset:`-prefixed alias. */
export function readPresetAsset(alias: string): { record: GeneratedAssetRecord; bytes: Buffer } | null {
  if (!isPresetAlias(alias)) return null
  const relName = alias.slice(PRESET_ALIAS_PREFIX.length).split('\\').join('/')
  // Reject path traversal and deep nesting: the alias must name a file directly
  // in PRESET_DIR or in exactly one sub-directory (`<sub>/file`).
  if (relName.includes('..') || relName.startsWith('/') || relName.split('/').length > 2) return null
  const record = fileToRecord(relName)
  if (!record) return null
  try {
    const bytes = readFileSync(join(PRESET_DIR, relName))
    return { record, bytes }
  } catch {
    return null
  }
}
