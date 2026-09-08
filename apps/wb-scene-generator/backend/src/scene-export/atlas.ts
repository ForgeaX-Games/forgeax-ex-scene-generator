import type { CookedScene, SceneTileCollider } from './types.js'
import { blankImage, blit, cropImage, decodePng, encodePng, type RgbaImage } from './png.js'

export interface SceneTilesetTile {
  id: number
  x: number
  y: number
  width: number
  height: number
  pivot: { x: number; y: number }
  collider: SceneTileCollider
}

export interface SceneTileset {
  type: 'tileset'
  version: '1.10'
  tiledversion: string
  name: string
  image: string
  imagewidth: number
  imageheight: number
  tilewidth: number
  tileheight: number
  tilecount: number
  columns: 0
  margin: 0
  spacing: 0
  tiles: SceneTilesetTile[]
}

export interface SceneAtlas {
  png: Buffer
  tsj: SceneTileset
}

export interface SceneAtlases {
  terrain: SceneAtlas
  object: SceneAtlas
}

export interface AssetContent {
  bytes: Buffer
  mimeType: string
  widthPx?: number
  heightPx?: number
}

export interface BuildSceneAtlasesOptions {
  allowMissingAssets: boolean
  resolveAssetContent(alias: string): Promise<AssetContent | null> | AssetContent | null
}

/** Horizontal gap (px) inserted between packed tiles, matching the reference atlas. */
const TILE_SPACING = 1

export async function buildSceneAtlases(cooked: CookedScene, options: BuildSceneAtlasesOptions): Promise<SceneAtlases> {
  const terrain = await buildAtlas('terrain', 'terrain_atlas.png', cooked.terrainAtlasInputs, options)
  const object = await buildAtlas('object', 'object_atlas.png', cooked.objectAtlasInputs, options)
  return { terrain, object }
}

interface PackedTile {
  id: number
  image: RgbaImage | null
  width: number
  height: number
  anchorX?: number
  anchorY?: number
  collider?: SceneTileCollider
}

async function buildAtlas(
  name: string,
  image: string,
  inputs: CookedScene['terrainAtlasInputs'],
  options: BuildSceneAtlasesOptions,
): Promise<SceneAtlas> {
  const ordered = [...inputs].sort((a, b) => a.id - b.id || a.name.localeCompare(b.name))
  const packed: PackedTile[] = []

  for (const input of ordered) {
    let content: AssetContent | null = null
    if (input.alias) content = await (options.resolveAssetContent(input.alias) ?? null)
    if (input.alias && !content && !options.allowMissingAssets) {
      throw new Error(`missing asset content for alias: ${input.alias}`)
    }
    let decoded: RgbaImage | null = null
    if (content?.bytes.length) {
      try {
        decoded = decodePng(content.bytes)
      } catch {
        decoded = null
      }
    }
    // Tile-group slicing: when the input carries a source sub-rect, pack only
    // that slice as the tile so the cell binds the correct sub-tile, not the
    // whole sheet.
    if (decoded && input.srcRect) {
      const r = input.srcRect
      decoded = cropImage(decoded, r.x, r.y, r.w, r.h)
    }
    const width = input.srcRect?.w ?? decoded?.width ?? content?.widthPx ?? input.widthPx ?? 16
    const height = input.srcRect?.h ?? decoded?.height ?? content?.heightPx ?? input.heightPx ?? 16
    packed.push({
      id: input.id,
      image: decoded,
      width: Math.max(1, width),
      height: Math.max(1, height),
      ...(input.anchorX !== undefined ? { anchorX: input.anchorX } : {}),
      ...(input.anchorY !== undefined ? { anchorY: input.anchorY } : {}),
      ...(input.collider ? { collider: input.collider } : {}),
    })
  }

  const totalWidth = packed.reduce((sum, t) => sum + t.width, 0) + Math.max(0, packed.length - 1) * TILE_SPACING
  const totalHeight = packed.reduce((max, t) => Math.max(max, t.height), 0)
  const surface = blankImage(Math.max(1, totalWidth), Math.max(1, totalHeight))

  const tiles: SceneTilesetTile[] = []
  let cursorX = 0
  for (const tile of packed) {
    if (tile.image) blit(surface, tile.image, cursorX, 0)
    tiles.push({
      id: tile.id,
      x: cursorX,
      y: 0,
      width: tile.width,
      height: tile.height,
      pivot: {
        // anchorX/anchorY are ALREADY normalized anchor fractions in [0,1]
        // (0=left/bottom, 1=right/top, 0.5=center) — the SAME values the renderer
        // feeds straight into objectSpriteGridRect as ax/ay (see matchAssetEntry:
        // out.anchor = { x: anchorX ?? 0.5, ... }) and the reference object_atlas.tsj
        // stores verbatim (e.g. {x:0.5,y:0.2}). Do NOT divide by tile width/height —
        // that double-normalizes a fraction into a near-zero pivot and slides the
        // sprite off its anchor cell (the ambulance "sprawl" defect).
        x: tile.anchorX !== undefined ? tile.anchorX : 0.5,
        y: tile.anchorY !== undefined ? tile.anchorY : 0.5,
      },
      collider: tile.collider ?? { type: 'none' },
    })
    cursorX += tile.width + TILE_SPACING
  }

  return {
    png: encodePng(surface),
    tsj: {
      type: 'tileset',
      version: '1.10',
      tiledversion: '1.10.2',
      name,
      image,
      imagewidth: surface.width,
      imageheight: surface.height,
      tilewidth: 16,
      tileheight: 16,
      tilecount: tiles.length,
      columns: 0,
      margin: 0,
      spacing: 0,
      tiles,
    },
  }
}
