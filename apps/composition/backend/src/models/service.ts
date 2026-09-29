/**
 * Plugin-builtin 3D object models (GLB) — separate from Asset Store PNGs and PBR packs.
 *
 * Root: `<repoRoot>/materials/models/<Folder>/model.json` + `model.glb`
 * Matching for 3DMesh object layers: exact `assetName === model.name`.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, normalize, resolve, sep } from 'node:path'
import { repoRoot } from '../library/db.js'

export const OBJECT_MODELS_DIR = join(repoRoot, 'materials', 'models')

export interface ObjectModelManifest {
  name: string
  file: string
  /** Desired world height in voxel cells (default 4). */
  targetHeightCells: number
  category?: string
  tags?: string[]
}

export interface ObjectModelSummary {
  name: string
  targetHeightCells: number
  category: string
  tags: string[]
  fileUrl: string
}

export interface ObjectModelDetail extends ObjectModelSummary {
  file: string
}

function safeToken(name: string): string | null {
  if (!name || name.includes('..') || name.includes('/') || name.includes('\\') || name.includes('\0')) {
    return null
  }
  return name
}

interface LoadedPack {
  dirName: string
  manifest: ObjectModelManifest
}

function readManifestInDir(dirName: string): ObjectModelManifest | null {
  const dir = join(OBJECT_MODELS_DIR, dirName)
  const jsonPath = join(dir, 'model.json')
  if (!existsSync(jsonPath)) return null
  try {
    const raw = JSON.parse(readFileSync(jsonPath, 'utf8')) as Record<string, unknown>
    const name = typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : dirName
    const file = typeof raw.file === 'string' && raw.file.length > 0 ? raw.file : 'model.glb'
    if (file.includes('..') || file.includes('/') || file.includes('\\')) return null
    if (!existsSync(join(dir, file))) return null
    const targetHeightCells =
      typeof raw.targetHeightCells === 'number' && raw.targetHeightCells > 0
        ? raw.targetHeightCells
        : 4
    const tags = Array.isArray(raw.tags)
      ? raw.tags.filter((t): t is string => typeof t === 'string')
      : []
    return {
      name,
      file,
      targetHeightCells,
      category: typeof raw.category === 'string' ? raw.category : 'prop',
      tags,
    }
  } catch {
    return null
  }
}

function listPacks(): LoadedPack[] {
  if (!existsSync(OBJECT_MODELS_DIR)) return []
  const out: LoadedPack[] = []
  for (const ent of readdirSync(OBJECT_MODELS_DIR, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue
    const manifest = readManifestInDir(ent.name)
    if (!manifest) continue
    out.push({ dirName: ent.name, manifest })
  }
  return out
}

function findPackByName(name: string): LoadedPack | null {
  const safe = safeToken(name)
  if (!safe) return null
  for (const pack of listPacks()) {
    if (pack.manifest.name === safe) return pack
  }
  return null
}

function toDetail(pack: LoadedPack): ObjectModelDetail {
  const { manifest } = pack
  return {
    name: manifest.name,
    file: manifest.file,
    targetHeightCells: manifest.targetHeightCells,
    category: manifest.category ?? 'prop',
    tags: manifest.tags ?? [],
    fileUrl: `/api/v1/models/${encodeURIComponent(manifest.name)}/file`,
  }
}

export function listObjectModels(): ObjectModelSummary[] {
  return listPacks()
    .map((p) => {
      const d = toDetail(p)
      return {
        name: d.name,
        targetHeightCells: d.targetHeightCells,
        category: d.category,
        tags: d.tags,
        fileUrl: d.fileUrl,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function getObjectModel(name: string): ObjectModelDetail | null {
  const pack = findPackByName(name)
  return pack ? toDetail(pack) : null
}

export function resolveObjectModelPath(name: string): string | null {
  const pack = findPackByName(name)
  if (!pack) return null
  const abs = resolve(join(OBJECT_MODELS_DIR, pack.dirName, pack.manifest.file))
  const root = resolve(OBJECT_MODELS_DIR) + sep
  const norm = normalize(abs)
  if (!norm.startsWith(root)) return null
  if (!existsSync(norm)) return null
  return norm
}

/** Absolute pack directory for a model name, or null if missing / escape. */
export function resolveObjectModelDir(name: string): string | null {
  const pack = findPackByName(name)
  if (!pack) return null
  const abs = resolve(join(OBJECT_MODELS_DIR, pack.dirName))
  const root = resolve(OBJECT_MODELS_DIR) + sep
  const norm = normalize(abs)
  if (!norm.startsWith(root) || !existsSync(norm)) return null
  return norm
}

/** On-disk folder name for a model pack (may differ from manifest.name). */
export function resolveObjectModelDirName(name: string): string | null {
  const pack = findPackByName(name)
  return pack?.dirName ?? null
}
