import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { BakedLayer } from '../baked/store.js'
import {
  getPbrMaterial,
  resolvePbrMaterialDir,
  resolvePbrMaterialDirName,
} from '../materials/service.js'
import {
  listObjectModels,
  resolveObjectModelDir,
  resolveObjectModelDirName,
} from '../models/service.js'
import {
  buildObjectPlacements,
  buildSurfaceField,
  isObjectPropLayer,
  isTileTerrainLayer,
  worldXY,
  type ObjectCellSample,
  type TileCellSample,
} from './placements.js'
import {
  MESH3D_CELL_SIZE,
  MESH3D_SCENE_FORMAT,
  MESH3D_SCENE_VERSION,
  MESH3D_WORKBENCH_PREFIX,
  type Mesh3dExportCookResult,
  type Mesh3dSceneMeta,
} from './types.js'

export interface CookMesh3dSceneInput {
  projectId: string
  sceneId: string
  sceneName: string
  gameSlug: string
  /** Absolute game root: `<projectRoot>/.forgeax/games/<slug>` */
  gameRoot: string
  layers: readonly BakedLayer[]
  generatedAt?: Date
  allowMissingAssets?: boolean
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'scene'
}

export function mesh3dSceneDir(gameRoot: string, sceneId: string): string {
  return join(gameRoot, 'assets', '3d', 'scenes', MESH3D_WORKBENCH_PREFIX, sceneId)
}

function safeSceneId(raw: string): string {
  const s = slugify(raw)
  if (!/^[a-z0-9][a-z0-9._-]{0,120}$/.test(s)) {
    throw new Error(`invalid sceneId: ${raw}`)
  }
  return s
}

function copyPack(srcDir: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true })
  cpSync(srcDir, destDir, { recursive: true, force: true })
}

function collectMaterialClosure(rootNames: Iterable<string>): {
  names: string[]
  warnings: string[]
} {
  const warnings: string[] = []
  const seen = new Set<string>()
  const queue: string[] = []
  for (const n of rootNames) {
    const t = n.trim()
    if (t && !seen.has(t)) {
      seen.add(t)
      queue.push(t)
    }
  }
  while (queue.length) {
    const name = queue.shift()!
    const detail = getPbrMaterial(name)
    if (!detail) {
      warnings.push(`missing material pack: ${name}`)
      continue
    }
    if (detail.shading === 'terrainBiome' && detail.biome?.layers) {
      for (const layer of detail.biome.layers) {
        if (layer && !seen.has(layer)) {
          seen.add(layer)
          queue.push(layer)
        }
      }
    }
  }
  return { names: [...seen], warnings }
}

export function cookMesh3dScene(input: CookMesh3dSceneInput): Mesh3dExportCookResult {
  const sceneId = safeSceneId(input.sceneId)
  const generatedAt = input.generatedAt ?? new Date()
  const warnings: string[] = []
  const allowMissing = input.allowMissingAssets === true

  const tileSamples: TileCellSample[] = []
  const objSamples: ObjectCellSample[] = []

  input.layers.forEach((layer, layerIdx) => {
    const layerKey = layer.nodePath || layer.nodeName || `layer:${layerIdx}`
    if (isTileTerrainLayer(layer.assetType)) {
      for (const c of layer.cells) {
        tileSamples.push({
          x: c.x,
          y: c.y,
          z: c.z,
          layerIdx,
          assetName: layer.assetName?.trim() ?? '',
          layerKey,
        })
      }
      return
    }
    if (isObjectPropLayer(layer.assetType)) {
      for (const c of layer.cells) {
        const id = c.state?.instanceId
        objSamples.push({
          x: c.x,
          y: c.y,
          z: c.z,
          assetName: layer.assetName?.trim() ?? '',
          instanceId: typeof id === 'string' && id ? id : null,
          layerKey,
        })
      }
    }
  })

  const terrain = tileSamples.length ? buildSurfaceField(tileSamples) : null
  const catalog = listObjectModels().map((m) => m.name)
  const placements = buildObjectPlacements(objSamples, terrain, catalog)

  let minX = terrain?.minX ?? Infinity
  let maxX = terrain?.maxX ?? -Infinity
  let minY = terrain?.minY ?? Infinity
  let maxY = terrain?.maxY ?? -Infinity
  for (const p of placements) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
  }
  if (!Number.isFinite(minX)) {
    minX = 0
    maxX = -1
    minY = 0
    maxY = -1
  }

  const materialRoots = new Set<string>()
  if (terrain) {
    for (const o of terrain.owners.values()) {
      if (o.assetName) materialRoots.add(o.assetName)
    }
  }
  const materialClosure = collectMaterialClosure(materialRoots)
  warnings.push(...materialClosure.warnings)

  const modelNames = [...new Set(placements.map((p) => p.name).filter(Boolean))]
  for (const name of modelNames) {
    if (!resolveObjectModelDir(name)) warnings.push(`missing model pack: ${name}`)
  }

  const hardMissing = warnings.filter((w) => w.startsWith('missing '))
  if (hardMissing.length > 0 && !allowMissing) {
    throw new Error(hardMissing.join('; '))
  }

  const sceneDir = mesh3dSceneDir(input.gameRoot, sceneId)
  if (existsSync(sceneDir)) {
    rmSync(sceneDir, { recursive: true, force: true })
  }
  mkdirSync(sceneDir, { recursive: true })

  const materialsRel: Record<string, string> = {}
  for (const name of materialClosure.names) {
    const src = resolvePbrMaterialDir(name)
    const dirName = resolvePbrMaterialDirName(name)
    if (!src || !dirName) continue
    const dest = join(sceneDir, 'materials', dirName)
    copyPack(src, dest)
    materialsRel[name] = `materials/${dirName}/material.json`
  }

  const modelsRel: Record<string, string> = {}
  for (const name of modelNames) {
    const src = resolveObjectModelDir(name)
    const dirName = resolveObjectModelDirName(name)
    if (!src || !dirName) continue
    const dest = join(sceneDir, 'models', dirName)
    copyPack(src, dest)
    modelsRel[name] = `models/${dirName}/model.json`
  }

  const terrainCells = terrain
    ? [...terrain.owners.values()]
      .map((o) => ({
        x: o.x,
        y: o.y,
        z: o.z,
        material: o.assetName,
      }))
      .sort((a, b) => (a.y - b.y) || (a.x - b.x))
    : []

  const objects = placements.map((p) => {
    const { wx, wy } = worldXY(p.x, p.y, minX, maxX, minY, maxY)
    const modelPath = modelsRel[p.name] ?? `models/${p.name}/model.json`
    return {
      instanceKey: p.instanceKey,
      requestedName: p.requestedName,
      model: p.name,
      modelPath,
      cell: { x: p.x, y: p.y },
      position: { x: wx, y: wy, z: p.groundZ },
    }
  })

  const meta: Mesh3dSceneMeta = {
    format: MESH3D_SCENE_FORMAT,
    version: MESH3D_SCENE_VERSION,
    source: {
      workbench: MESH3D_WORKBENCH_PREFIX,
      projectId: input.projectId,
      sceneName: input.sceneName,
    },
    sceneId,
    gameSlug: input.gameSlug,
    generatedAt: generatedAt.toISOString(),
    cellSize: MESH3D_CELL_SIZE,
    bounds: { minX, maxX, minY, maxY },
    materials: materialsRel,
    models: modelsRel,
    terrain: { cells: terrainCells },
    objects,
    warnings,
  }

  const metaPath = join(sceneDir, 'meta.json')
  writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8')

  const relativeDir = relative(input.gameRoot, sceneDir).split('\\').join('/')
  const projectRelativeDir = join('.forgeax', 'games', input.gameSlug, relativeDir).split('\\').join('/')
  return {
    sceneId,
    gameSlug: input.gameSlug,
    sceneDir,
    metaPath,
    relativeDir,
    projectRelativeDir,
    warnings,
  }
}
