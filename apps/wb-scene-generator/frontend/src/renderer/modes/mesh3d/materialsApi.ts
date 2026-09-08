// 💡 Plugin PBR materials HTTP client — separate from Asset Store libraryApi.

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
  layers: [string, string, string]
  /** Slope where grass begins fading toward rock. */
  slopeGrassEnd: number
  /** Moss blend strength when a noise speck hits. */
  slopeMossEnd: number
  /** Slope where rock becomes dominant. */
  slopeRockStart: number
  /** Moss coverage / probability (sparse speckles). */
  heightMossStart: number
  /** Peak elev accent for rock on slopes. */
  heightRockStart: number
  tiling: number
}

export interface PbrMaterialDetail {
  name: string
  tiling: number
  normalSpace: 'GL' | 'DX'
  shading?: PbrShading
  maps: PbrMapSlot[]
  previewUrl: string
  mapUrls: Partial<Record<PbrMapSlot, string>>
  water?: PhysicalWaterParams
  biome?: TerrainBiomeParams
}

export async function fetchPbrMaterial(name: string): Promise<PbrMaterialDetail | null> {
  if (!name) return null
  const r = await fetch(`/api/v1/materials/${encodeURIComponent(name)}`)
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`/api/v1/materials/${name} → ${r.status}`)
  return (await r.json()) as PbrMaterialDetail
}

export function pbrMapUrl(name: string, slot: PbrMapSlot): string {
  return `/api/v1/materials/${encodeURIComponent(name)}/maps/${slot}`
}
