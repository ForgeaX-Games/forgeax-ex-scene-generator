/**
 * Plugin-builtin PBR material packs — separate from the Asset Store library.
 *
 * Root: `<repoRoot>/materials/pbr/<Folder>/material.json` + optional map images.
 * Matching for 3DMesh Asset mode is exact `assetName === material.name`.
 *
 * `shading: "physicalWater"` — procedural water (Water2).
 * `shading: "terrainBiome"` — slope/height mix of named packs (Mount1).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, normalize, resolve, sep } from 'node:path'
import { repoRoot } from '../library/db.js'

export const PBR_MATERIALS_DIR = join(repoRoot, 'materials', 'pbr')

export type PbrMapSlot = 'color' | 'normal' | 'roughness' | 'ao' | 'displacement'
export type PbrShading = 'textured' | 'physicalWater' | 'terrainBiome'

export interface PhysicalWaterParams {
  shallowColor: [number, number, number]
  deepColor: [number, number, number]
  skyColor: [number, number, number]
  ior: number
  roughness: number
  specular: number
  waveScale: number
  waveSpeed: number
  opacity: number
}

export interface TerrainBiomeParams {
  /** Exact pack names to blend, typically [Grass, Moss, Rock]. */
  layers: [string, string, string]
  /** Slope where grass begins fading toward rock. */
  slopeGrassEnd: number
  /** Moss blend strength when a noise speck hits (0–1). */
  slopeMossEnd: number
  /** Slope where rock becomes dominant (cliffs). */
  slopeRockStart: number
  /** Moss coverage / probability (0–1), sparse speckles. */
  heightMossStart: number
  /** Peak elev accent for rock on already-sloped ground. */
  heightRockStart: number
  tiling: number
}

export interface PbrMaterialManifest {
  name: string
  maps: Partial<Record<PbrMapSlot, string>>
  shading: PbrShading
  water?: PhysicalWaterParams
  biome?: TerrainBiomeParams
  normalSpace?: 'GL' | 'DX'
  tiling?: number
}

export interface PbrMaterialSummary {
  name: string
  tiling: number
  normalSpace: 'GL' | 'DX'
  shading: PbrShading
  maps: PbrMapSlot[]
  previewUrl: string
}

export interface PbrMaterialDetail extends PbrMaterialSummary {
  mapUrls: Partial<Record<PbrMapSlot, string>>
  water?: PhysicalWaterParams
  biome?: TerrainBiomeParams
}

const SLOT_SET = new Set<PbrMapSlot>(['color', 'normal', 'roughness', 'ao', 'displacement'])

const DEFAULT_WATER: PhysicalWaterParams = {
  shallowColor: [0.12, 0.38, 0.48],
  deepColor: [0.02, 0.10, 0.22],
  skyColor: [0.35, 0.48, 0.62],
  ior: 1.333,
  roughness: 0.08,
  specular: 0.95,
  waveScale: 0.4,
  waveSpeed: 0.55,
  opacity: 0.62,
}

function safeToken(name: string): string | null {
  if (!name || name.includes('..') || name.includes('/') || name.includes('\\') || name.includes('\0')) {
    return null
  }
  return name
}

function clamp01(n: number, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback
}

function parseColor3(v: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(v) || v.length < 3) return fallback
  return [
    clamp01(Number(v[0]), fallback[0]),
    clamp01(Number(v[1]), fallback[1]),
    clamp01(Number(v[2]), fallback[2]),
  ]
}

function parseWater(raw: unknown): PhysicalWaterParams {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  return {
    shallowColor: parseColor3(o.shallowColor, DEFAULT_WATER.shallowColor),
    deepColor: parseColor3(o.deepColor, DEFAULT_WATER.deepColor),
    skyColor: parseColor3(o.skyColor, DEFAULT_WATER.skyColor),
    ior: typeof o.ior === 'number' && o.ior > 1 ? o.ior : DEFAULT_WATER.ior,
    roughness: clamp01(Number(o.roughness), DEFAULT_WATER.roughness),
    specular: typeof o.specular === 'number' && o.specular > 0 ? o.specular : DEFAULT_WATER.specular,
    waveScale: typeof o.waveScale === 'number' && o.waveScale >= 0 ? o.waveScale : DEFAULT_WATER.waveScale,
    waveSpeed: typeof o.waveSpeed === 'number' && o.waveSpeed >= 0 ? o.waveSpeed : DEFAULT_WATER.waveSpeed,
    opacity: clamp01(Number(o.opacity), DEFAULT_WATER.opacity),
  }
}

const DEFAULT_BIOME: TerrainBiomeParams = {
  layers: ['Grass', 'Moss', 'Rock'],
  slopeGrassEnd: 0.28,
  slopeMossEnd: 0.55,
  slopeRockStart: 0.32,
  heightMossStart: 0.22,
  heightRockStart: 0.85,
  tiling: 0.25,
}

function parseBiome(raw: unknown): TerrainBiomeParams {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const layersRaw = Array.isArray(o.layers) ? o.layers.filter((x): x is string => typeof x === 'string' && !!x) : []
  const layers: [string, string, string] = [
    layersRaw[0] ?? DEFAULT_BIOME.layers[0],
    layersRaw[1] ?? DEFAULT_BIOME.layers[1],
    layersRaw[2] ?? DEFAULT_BIOME.layers[2],
  ]
  return {
    layers,
    slopeGrassEnd: clamp01(Number(o.slopeGrassEnd), DEFAULT_BIOME.slopeGrassEnd),
    slopeMossEnd: clamp01(Number(o.slopeMossEnd), DEFAULT_BIOME.slopeMossEnd),
    slopeRockStart: clamp01(Number(o.slopeRockStart), DEFAULT_BIOME.slopeRockStart),
    heightMossStart: clamp01(Number(o.heightMossStart), DEFAULT_BIOME.heightMossStart),
    heightRockStart: clamp01(Number(o.heightRockStart), DEFAULT_BIOME.heightRockStart),
    tiling: typeof o.tiling === 'number' && o.tiling > 0 ? o.tiling : DEFAULT_BIOME.tiling,
  }
}

interface LoadedPack {
  dirName: string
  manifest: PbrMaterialManifest
}

function readManifestInDir(dirName: string): PbrMaterialManifest | null {
  const dir = join(PBR_MATERIALS_DIR, dirName)
  const jsonPath = join(dir, 'material.json')
  if (!existsSync(jsonPath)) return null
  try {
    const raw = JSON.parse(readFileSync(jsonPath, 'utf8')) as Record<string, unknown>
    const name = typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : dirName
    let shading: PbrShading = 'textured'
    if (raw.shading === 'physicalWater') shading = 'physicalWater'
    else if (raw.shading === 'terrainBiome') shading = 'terrainBiome'
    const maps: Partial<Record<PbrMapSlot, string>> = {}
    if (raw.maps && typeof raw.maps === 'object') {
      for (const [k, v] of Object.entries(raw.maps as object)) {
        if (!SLOT_SET.has(k as PbrMapSlot)) continue
        if (typeof v !== 'string' || !v || v.includes('..') || v.includes('/') || v.includes('\\')) continue
        if (!existsSync(join(dir, v))) continue
        maps[k as PbrMapSlot] = v
      }
    }
    if (shading === 'textured' && !maps.color) return null
    return {
      name,
      maps,
      shading,
      ...(shading === 'physicalWater' ? { water: parseWater(raw.water) } : {}),
      ...(shading === 'terrainBiome' ? { biome: parseBiome(raw.biome) } : {}),
      normalSpace: raw.normalSpace === 'DX' ? 'DX' : 'GL',
      tiling: typeof raw.tiling === 'number' && raw.tiling > 0 ? raw.tiling : 1,
    }
  } catch {
    return null
  }
}

function listPacks(): LoadedPack[] {
  if (!existsSync(PBR_MATERIALS_DIR)) return []
  const out: LoadedPack[] = []
  for (const ent of readdirSync(PBR_MATERIALS_DIR, { withFileTypes: true })) {
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

function toDetail(pack: LoadedPack): PbrMaterialDetail {
  const { manifest } = pack
  const slots = Object.keys(manifest.maps) as PbrMapSlot[]
  const mapUrls: Partial<Record<PbrMapSlot, string>> = {}
  for (const s of slots) {
    mapUrls[s] = `/api/v1/materials/${encodeURIComponent(manifest.name)}/maps/${s}`
  }
  return {
    name: manifest.name,
    tiling: manifest.tiling ?? 1,
    normalSpace: manifest.normalSpace ?? 'GL',
    shading: manifest.shading,
    maps: slots,
    previewUrl: mapUrls.color ?? '',
    mapUrls,
    ...(manifest.water ? { water: manifest.water } : {}),
    ...(manifest.biome ? { biome: manifest.biome } : {}),
  }
}

/** List installed PBR packs. */
export function listPbrMaterials(): PbrMaterialSummary[] {
  return listPacks()
    .map((p) => {
      const d = toDetail(p)
      return {
        name: d.name,
        tiling: d.tiling,
        normalSpace: d.normalSpace,
        shading: d.shading,
        maps: d.maps,
        previewUrl: d.previewUrl,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Exact-name lookup on `material.json` `name` field. */
export function getPbrMaterial(name: string): PbrMaterialDetail | null {
  const pack = findPackByName(name)
  return pack ? toDetail(pack) : null
}

/** Absolute path to a map file, or null if missing / escape attempt. */
export function resolvePbrMapPath(name: string, slot: string): string | null {
  if (!SLOT_SET.has(slot as PbrMapSlot)) return null
  const pack = findPackByName(name)
  if (!pack) return null
  const file = pack.manifest.maps[slot as PbrMapSlot]
  if (!file) return null
  const abs = resolve(join(PBR_MATERIALS_DIR, pack.dirName, file))
  const root = resolve(PBR_MATERIALS_DIR) + sep
  const norm = normalize(abs)
  if (!norm.startsWith(root)) return null
  if (!existsSync(norm)) return null
  return norm
}

/** Absolute pack directory for a material name, or null if missing / escape. */
export function resolvePbrMaterialDir(name: string): string | null {
  const pack = findPackByName(name)
  if (!pack) return null
  const abs = resolve(join(PBR_MATERIALS_DIR, pack.dirName))
  const root = resolve(PBR_MATERIALS_DIR) + sep
  const norm = normalize(abs)
  if (!norm.startsWith(root) || !existsSync(norm)) return null
  return norm
}

/** On-disk folder name for a PBR pack (may differ from manifest.name). */
export function resolvePbrMaterialDirName(name: string): string | null {
  const pack = findPackByName(name)
  return pack?.dirName ?? null
}
