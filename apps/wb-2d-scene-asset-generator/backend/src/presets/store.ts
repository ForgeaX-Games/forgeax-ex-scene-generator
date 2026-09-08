/**
 * Text-preset store — saved Panel texts surfaced in the editor's big-tag rail.
 *
 * A preset is one JSON file per entry. There are TWO sources, merged at read
 * time (user source wins on id collision):
 *
 *   1. BUILTIN — shipped with the plugin at `apps/<app>/presets/` (version
 *      controlled, read-only). Marked `builtin: true` in the response.
 *   2. USER — written under the active workspace at `<workspaceRoot>/text-presets/`
 *      (runtime = `.forgeax/workbench/<plugin>/text-presets/`). Honours the
 *      runtime-isolation rule: the backend only reads/writes its own
 *      FORGEAX_PROJECT_ROOT workspace, never the host's top-level dirs.
 *
 * On-disk file shape (`<id>.json`):
 *   { "id", "title", "text", "createdAt" }
 * The `builtin` flag is derived from the source dir at read time and is never
 * persisted into a file.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveWorkspaceRoot } from '../runtime.js'

const here = dirname(fileURLToPath(import.meta.url))
// backend/src/presets → app root is three levels up (backend/src/presets → backend/src → backend → app).
const appRoot = resolve(here, '..', '..', '..')

/** Built-in presets shipped with the plugin (read-only, version controlled). */
const BUILTIN_DIR = join(appRoot, 'presets')

/** User presets live under the active workspace, isolated per plugin. */
function userDir(): string {
  return join(resolveWorkspaceRoot(), 'text-presets')
}

export interface TextPreset {
  id: string
  title: string
  text: string
  createdAt: number
  /** True for plugin built-in presets (cannot be deleted). Derived, not persisted. */
  builtin: boolean
}

interface StoredPreset {
  id?: unknown
  title?: unknown
  text?: unknown
  createdAt?: unknown
}

function parsePreset(raw: string, fallbackId: string, builtin: boolean): TextPreset | null {
  let obj: StoredPreset
  try {
    obj = JSON.parse(raw) as StoredPreset
  } catch {
    return null
  }
  const text = typeof obj.text === 'string' ? obj.text : ''
  if (!text) return null
  const id = typeof obj.id === 'string' && obj.id.trim() ? obj.id : fallbackId
  const title = typeof obj.title === 'string' ? obj.title : ''
  const createdAt = typeof obj.createdAt === 'number' ? obj.createdAt : 0
  return { id, title, text, createdAt, builtin }
}

function readDir(dir: string, builtin: boolean): TextPreset[] {
  if (!existsSync(dir)) return []
  const out: TextPreset[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    const fallbackId = name.slice(0, -'.json'.length)
    let raw: string
    try {
      raw = readFileSync(join(dir, name), 'utf8')
    } catch {
      continue
    }
    const preset = parsePreset(raw, fallbackId, builtin)
    if (preset) out.push(preset)
  }
  return out
}

/**
 * All presets, built-in + user, merged (user wins on id collision), newest
 * first (by createdAt, then id for stability).
 */
export function listPresets(): TextPreset[] {
  const byId = new Map<string, TextPreset>()
  for (const p of readDir(BUILTIN_DIR, true)) byId.set(p.id, p)
  for (const p of readDir(userDir(), false)) byId.set(p.id, p)
  return Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
}

function genId(): string {
  return `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** Create a user preset (one new file). Returns the created entry. */
export function createPreset(input: { title?: string; text: string }): TextPreset {
  const text = input.text
  const title = (input.title ?? '').trim()
  const dir = userDir()
  mkdirSync(dir, { recursive: true })
  const id = genId()
  const createdAt = Date.now()
  const stored = { id, title, text, createdAt }
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(stored, null, 2), 'utf8')
  return { ...stored, builtin: false }
}

/**
 * Delete a USER preset by id. Built-in presets cannot be deleted. Returns
 * `{ ok: true }` on success, or an error reason.
 */
export function deletePreset(id: string): { ok: true } | { ok: false; reason: string } {
  if (!/^[\w.-]+$/.test(id)) return { ok: false, reason: 'invalid id' }
  const file = join(userDir(), `${id}.json`)
  if (!existsSync(file)) {
    // Either unknown id or a built-in entry (built-ins live in BUILTIN_DIR).
    const isBuiltin = existsSync(join(BUILTIN_DIR, `${id}.json`))
    return { ok: false, reason: isBuiltin ? 'cannot delete built-in preset' : 'preset not found' }
  }
  rmSync(file)
  return { ok: true }
}
