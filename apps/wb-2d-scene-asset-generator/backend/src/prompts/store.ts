/**
 * Prompt store — saved Panel prompts surfaced as draggable batteries under the
 * editor's "Prompts" big tag.
 *
 * A prompt is one JSON file per entry. There are TWO sources, merged at read
 * time (user source wins on id collision):
 *
 *   1. BUILTIN — shipped with the plugin at `apps/<app>/prompts/` (version
 *      controlled, read-only). Marked `builtin: true` in the response.
 *   2. USER — written under the active workspace at `<workspaceRoot>/prompts/`
 *      (runtime = `.forgeax/workbench/<plugin>/prompts/`). Honours the
 *      runtime-isolation rule: the backend only reads/writes its own
 *      FORGEAX_PROJECT_ROOT workspace, never the host's top-level dirs.
 *
 * On-disk file shape (`<id>.json`):
 *   { "id", "name", "tag", "template", "vars": ["x", "y"], "createdAt" }
 * `vars` is the ordered, de-duplicated list of `[placeholder]` names parsed from
 * the template; each becomes a `str` input port on the dropped prompt battery.
 * `tag` is the user-entered sub-group (small label) under the "Prompts" big tag;
 * it defaults to `saved`. The `builtin` flag is derived from the source dir at
 * read time and is never persisted into a file.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveWorkspaceRoot } from '../runtime.js'

const here = dirname(fileURLToPath(import.meta.url))
// backend/src/prompts → app root is three levels up (prompts → src → backend → app).
const appRoot = resolve(here, '..', '..', '..')

/** Built-in prompts shipped with the plugin (read-only, version controlled). */
const BUILTIN_DIR = join(appRoot, 'prompts')

/** User prompts live under the active workspace, isolated per plugin. */
function userDir(): string {
  return join(resolveWorkspaceRoot(), 'prompts')
}

export interface PromptEntry {
  id: string
  name: string
  /** Sub-group (small label) under the "Prompts" big tag. Defaults to 'saved'. */
  tag: string
  template: string
  vars: string[]
  createdAt: number
  /** True for plugin built-in prompts (cannot be deleted). Derived, not persisted. */
  builtin: boolean
  /** Palette icon SVG — preset vs user variant, by `builtin`. Derived, not persisted. */
  iconSvg?: string
}

/**
 * Two shipped palette icons distinguishing preset (built-in) from user prompts,
 * authored as files under the plugin's `prompts/` dir. Read once, lazily.
 */
let iconCache: { preset?: string; user?: string } | null = null
function promptIcon(builtin: boolean): string | undefined {
  if (!iconCache) {
    const read = (file: string): string | undefined => {
      try {
        return readFileSync(join(BUILTIN_DIR, file), 'utf8').trim() || undefined
      } catch {
        return undefined
      }
    }
    iconCache = { preset: read('_preset.icon.svg'), user: read('_user.icon.svg') }
  }
  return builtin ? iconCache.preset : iconCache.user
}

interface StoredPrompt {
  id?: unknown
  name?: unknown
  tag?: unknown
  template?: unknown
  vars?: unknown
  createdAt?: unknown
}

/** Default sub-group when the user leaves the small tag blank. */
const DEFAULT_TAG = 'saved'

/** Sanitise a small-tag into a single path segment (no slashes/spaces edges). */
function normalizeTag(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_TAG
  const t = raw.trim().replace(/[/\\]/g, '-')
  return t || DEFAULT_TAG
}

/**
 * Parse the ordered, de-duplicated `[placeholder]` names out of a template.
 * A placeholder is `[` then any run of non-`]`/non-`[` chars then `]`; the
 * inner text (trimmed) becomes a port name. Empty `[]` is ignored.
 */
export function parseTemplateVars(template: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const re = /\[([^[\]]+)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(template)) !== null) {
    const name = m[1].trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

function parsePrompt(raw: string, fallbackId: string, builtin: boolean): PromptEntry | null {
  let obj: StoredPrompt
  try {
    obj = JSON.parse(raw) as StoredPrompt
  } catch {
    return null
  }
  const template = typeof obj.template === 'string' ? obj.template : ''
  if (!template) return null
  const id = typeof obj.id === 'string' && obj.id.trim() ? obj.id : fallbackId
  const name = typeof obj.name === 'string' && obj.name.trim() ? obj.name : id
  const tag = normalizeTag(obj.tag)
  // Prefer the persisted vars (preserves authoring order); re-derive if absent.
  const vars = Array.isArray(obj.vars)
    ? obj.vars.filter((v): v is string => typeof v === 'string')
    : parseTemplateVars(template)
  const createdAt = typeof obj.createdAt === 'number' ? obj.createdAt : 0
  return { id, name, tag, template, vars, createdAt, builtin }
}

function readDir(dir: string, builtin: boolean): PromptEntry[] {
  if (!existsSync(dir)) return []
  const out: PromptEntry[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    const fallbackId = name.slice(0, -'.json'.length)
    let raw: string
    try {
      raw = readFileSync(join(dir, name), 'utf8')
    } catch {
      continue
    }
    const prompt = parsePrompt(raw, fallbackId, builtin)
    if (prompt) out.push(prompt)
  }
  return out
}

/**
 * All prompts, built-in + user, merged (user wins on id collision), newest
 * first (by createdAt, then id for stability).
 */
export function listPrompts(): PromptEntry[] {
  const byId = new Map<string, PromptEntry>()
  for (const p of readDir(BUILTIN_DIR, true)) byId.set(p.id, p)
  for (const p of readDir(userDir(), false)) byId.set(p.id, p)
  return Array.from(byId.values())
    .map((p) => ({ ...p, iconSvg: promptIcon(p.builtin) }))
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
}

function genId(): string {
  return `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** Create a user prompt (one new file). Vars are re-derived from the template. Returns the created entry. */
export function createPrompt(input: { name?: string; tag?: string; template: string }): PromptEntry {
  const template = input.template
  const name = (input.name ?? '').trim() || 'Prompt'
  const tag = normalizeTag(input.tag)
  const vars = parseTemplateVars(template)
  const dir = userDir()
  mkdirSync(dir, { recursive: true })
  const id = genId()
  const createdAt = Date.now()
  const stored = { id, name, tag, template, vars, createdAt }
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(stored, null, 2), 'utf8')
  return { ...stored, builtin: false, iconSvg: promptIcon(false) }
}

/**
 * Delete a USER prompt by id. Built-in prompts cannot be deleted. Returns
 * `{ ok: true }` on success, or an error reason.
 */
export function deletePrompt(id: string): { ok: true } | { ok: false; reason: string } {
  if (!/^[\w.-]+$/.test(id)) return { ok: false, reason: 'invalid id' }
  const file = join(userDir(), `${id}.json`)
  if (!existsSync(file)) {
    const isBuiltin = existsSync(join(BUILTIN_DIR, `${id}.json`))
    return { ok: false, reason: isBuiltin ? 'cannot delete built-in prompt' : 'prompt not found' }
  }
  rmSync(file)
  return { ok: true }
}
