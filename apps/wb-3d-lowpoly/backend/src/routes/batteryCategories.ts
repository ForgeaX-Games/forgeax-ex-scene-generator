// Battery UI-category projection.
//
// The kernel deliberately keeps UI metadata (category / displayGroup / type)
// OUT of OpSpec — `listOps` only returns id/name/inputs/outputs. But the
// faithful editor groups its palette by category, and in this plugin the
// category is encoded in the on-disk battery layout:
//
//   batteries/{bigTag}/{smallTag}/{batteryId}/meta.json   →  category "bigTag/smallTag"
//
// This module scans that tree once (cached) and maps each registered op id to
// its `bigTag/smallTag` category, so the `/api/v1/ops` route can re-attach the
// UI hint the editor needs. Mirrors the legacy battery.service category rule.

import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, basename } from 'node:path'
import { resolveBatteryScanRoots } from '@forgeax/editor-host/backend'

// This module lives in backend/src/routes, so the repo root is three levels up
// (routes → src → backend → repo).
const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..')
const batteryScanRoots = resolveBatteryScanRoots(repoRoot)

export interface BatteryUiMeta {
  /** "bigTag/smallTag" — drives BatteryBar rail (big) + accordion (small). */
  category: string
  /** Pass-through of meta.frontend.displayGroup, when present. */
  displayGroup?: string
  /** Top-level folder, e.g. 'special' | 'ai' | 'scene30' — the battery type bucket. */
  type?: string
  /** Pass-through of meta.frontend.nodeType — the editor's ReactFlow node component (e.g. 'name_list_panel'). */
  nodeType?: string
  /** Pass-through of meta.frontend.hideOutputs — sink-shaped batteries hide the output handle. */
  hideOutputs?: boolean
  /** Inline SVG loaded from icon.svg beside meta.json, when present. */
  iconSvg?: string
}

let cache: Map<string, BatteryUiMeta> | null = null

/** Recursively collect every meta.json path under the batteries root. */
async function findMetaFiles(dir: string, acc: string[]): Promise<void> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      await findMetaFiles(full, acc)
    } else if (entry.isFile() && entry.name === 'meta.json') {
      acc.push(full)
    }
  }
}

/**
 * Build the id → UI-meta map by scanning battery trees. The op
 * id is `meta.id` when present, else the battery directory name (the same
 * fallback the kernel loader uses), so the map keys line up with `listOps`.
 */
export async function scanBatteryCategories(roots: readonly string[]): Promise<Map<string, BatteryUiMeta>> {
  const map = new Map<string, BatteryUiMeta>()

  for (const root of roots) {
    const metaFiles: string[] = []
    await findMetaFiles(root, metaFiles)

    for (const file of metaFiles) {
      const rel = file.slice(root.length + 1)
      const segments = rel.split(/[\\/]/)
      // segments: [bigTag, smallTag, batteryDir, 'meta.json']
      if (segments.length < 2) continue
      const bigTag = segments[0]
      const smallTag = segments.length >= 4 ? segments[1] : ''
      const category = smallTag ? `${bigTag}/${smallTag}` : bigTag

      let raw: Record<string, unknown> = {}
      try {
        raw = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
      } catch {
        // Unparseable meta — still register the dir-derived id so it groups.
      }
      const dirName = basename(dirname(file))
      const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id : dirName
      const frontend = raw.frontend as
        | { displayGroup?: unknown; nodeType?: unknown; hideOutputs?: unknown }
        | undefined
      const displayGroup =
        typeof frontend?.displayGroup === 'string' && frontend.displayGroup.trim()
          ? frontend.displayGroup
          : undefined
      const nodeType =
        typeof frontend?.nodeType === 'string' && frontend.nodeType.trim()
          ? frontend.nodeType
          : undefined
      const hideOutputs =
        typeof frontend?.hideOutputs === 'boolean' ? frontend.hideOutputs : undefined
      const iconSvg = await readFile(resolve(dirname(file), 'icon.svg'), 'utf8').catch(() => undefined)
      map.set(id, { category, displayGroup, type: bigTag, nodeType, hideOutputs, iconSvg })
    }
  }

  return map
}

/**
 * Build (and cache) the id → UI-meta map by scanning the configured battery
 * roots. Each root's top-level folders become palette big tags.
 */
export async function getBatteryCategories(): Promise<Map<string, BatteryUiMeta>> {
  if (cache) return cache
  const map = await scanBatteryCategories(batteryScanRoots)
  cache = map
  return map
}
