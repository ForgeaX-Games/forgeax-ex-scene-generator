// Mode-local PBR texture loader (Three.js). No shared asset-store caches.

import * as THREE from 'three'
import type {
  PhysicalWaterParams,
  PbrMapSlot,
  PbrMaterialDetail,
  TerrainBiomeParams,
} from './materialsApi'
import { fetchPbrMaterial } from './materialsApi'

export interface LoadedBiomeMaps {
  grass: LoadedPbrMaps | null
  moss: LoadedPbrMaps | null
  rock: LoadedPbrMaps | null
  params: TerrainBiomeParams
}

export interface LoadedPbrMaps {
  map?: THREE.Texture
  normalMap?: THREE.Texture
  roughnessMap?: THREE.Texture
  aoMap?: THREE.Texture
  tiling: number
  normalSpace: 'GL' | 'DX'
  procedural?: 'physicalWater' | 'terrainBiome'
  water?: PhysicalWaterParams
  biomeMaps?: LoadedBiomeMaps
}

const loader = new THREE.TextureLoader()

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

const DEFAULT_BIOME: TerrainBiomeParams = {
  layers: ['Grass', 'Moss', 'Rock'],
  slopeGrassEnd: 0.28,
  slopeMossEnd: 0.55,
  slopeRockStart: 0.32,
  heightMossStart: 0.22,
  heightRockStart: 0.85,
  tiling: 0.25,
}

function loadTex(url: string, colorSpace: '' | typeof THREE.SRGBColorSpace): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (tex) => {
        tex.wrapS = THREE.RepeatWrapping
        tex.wrapT = THREE.RepeatWrapping
        tex.colorSpace = colorSpace
        tex.needsUpdate = true
        resolve(tex)
      },
      undefined,
      (err) => reject(err),
    )
  })
}

async function loadTexturedPack(detail: PbrMaterialDetail): Promise<LoadedPbrMaps> {
  const out: LoadedPbrMaps = {
    tiling: detail.tiling > 0 ? detail.tiling : 1,
    normalSpace: detail.normalSpace,
  }
  const jobs: Array<Promise<void>> = []
  const add = (slot: PbrMapSlot, apply: (t: THREE.Texture) => void, srgb: boolean) => {
    const url = detail.mapUrls[slot]
    if (!url) return
    jobs.push(
      loadTex(url, srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace).then(apply),
    )
  }
  add('color', (t) => { out.map = t }, true)
  add('normal', (t) => { out.normalMap = t }, false)
  add('roughness', (t) => { out.roughnessMap = t }, false)
  add('ao', (t) => { out.aoMap = t }, false)
  await Promise.all(jobs)
  return out
}

export async function loadPbrMaps(detail: PbrMaterialDetail): Promise<LoadedPbrMaps> {
  if (detail.shading === 'physicalWater') {
    return {
      tiling: 1,
      normalSpace: 'GL',
      procedural: 'physicalWater',
      water: detail.water ?? DEFAULT_WATER,
    }
  }

  if (detail.shading === 'terrainBiome') {
    const params = detail.biome ?? DEFAULT_BIOME
    const names = params.layers
    const loaded = await Promise.all(
      names.map(async (n) => {
        const d = await fetchPbrMaterial(n)
        if (!d || d.shading === 'terrainBiome' || d.shading === 'physicalWater') return null
        return loadTexturedPack(d)
      }),
    )
    return {
      tiling: 1,
      normalSpace: 'GL',
      procedural: 'terrainBiome',
      biomeMaps: {
        grass: loaded[0] ?? null,
        moss: loaded[1] ?? null,
        rock: loaded[2] ?? null,
        params,
      },
    }
  }

  return loadTexturedPack(detail)
}

export function disposePbrMaps(maps: LoadedPbrMaps | null | undefined): void {
  if (!maps) return
  maps.map?.dispose()
  maps.normalMap?.dispose()
  maps.roughnessMap?.dispose()
  maps.aoMap?.dispose()
  if (maps.biomeMaps) {
    disposePbrMaps(maps.biomeMaps.grass)
    disposePbrMaps(maps.biomeMaps.moss)
    disposePbrMaps(maps.biomeMaps.rock)
  }
}
