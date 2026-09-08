import type { BakedLayer } from '../baked/store.js'
import type { AliasMeta } from '../library/service.js'
import type { RgbaImage } from './png.js'

export interface CookBakedSceneInput {
  bundleId: string
  sceneName: string
  layers: BakedLayer[]
  aliases: AliasMeta[]
  generatedAt: Date
  /**
   * Optional sync resolver from an asset alias to its decoded RGBA image. Used
   * ONLY to pixel-filter autotile variant candidates exactly like the renderer
   * (drop transparent variant slots before randomRules sampling). When omitted
   * (e.g. tests), variant sampling falls back to the raw candidate range — the
   * same behaviour the renderer shows before its atlas image has loaded.
   */
  resolveRuleImage?: (alias: string) => RgbaImage | null
  /**
   * Optional debug-only sink fired for each terrain face the cook emits, BEFORE
   * the global coordinate normalization offset is applied. Carries the true
   * source identity (world voxel x,y,z + face + layerSeq + picked sprite index)
   * so a parity harness can align cook emissions to renderer draws WITHOUT
   * reverse-engineering them from the stacked terrain.json arrays. Never
   * affects cook output; ignored when omitted.
   */
  onTerrainLayerDebug?: (entry: {
    x: number
    srcY: number
    z: number
    face: 'top' | 'front'
    layerSeq: number
    nodePath?: string
    templateId: string
    graphicIndex: number
    validVariantIdxs: number[]
    neighborKey: string
  }) => void
}

export interface TerrainCellExport {
  x: number
  y: number
  height: number
  template_id: string[]
  graphic_index: number[]
  areaTags?: Record<string, string[]>
}

export interface TerrainObjectExport {
  instanceId: string
  typeId: string
  x: number
  y: number
  height: number
  direction: number
  interacted: boolean
}

export interface TerrainJson {
  version: '2.0'
  cols: number
  rows: number
  cells: Record<string, TerrainCellExport[]>
  objects: TerrainObjectExport[]
}

export interface TerrainPassability {
  category: string
  moveCost: number
  exploreSpeedMod: number
  requiredTags: string[]
  failMoveCost: number | null
  maxClimbDelta: number
  blocksLineOfSight: boolean
}

export interface TerrainTemplateConfig {
  terrain_type: string
  region: string
  water_body_id: string | null
  passability: TerrainPassability
  navTerrain: string
  ramp: unknown | null
  graphic: { ids: number[]; basePieces: number; variantProb: number; placement: string }
  base_pieces: number
  variant_prob: number
  graphic_id: number[]
  explore_speed_mod: number
  battle_move_cost: number
}

export interface TerrainConfigJson {
  schemaVersion: '3.0'
  templates: Record<string, TerrainTemplateConfig>
}

export interface ObjectTypeConfig {
  name: string
  category: string
  graphic: number
  graphicSize: { cols: number; rows: number }
  graphicOffset: { x: number; y: number }
  objectHeight: number
  collisionMask: unknown[]
  passability: { blocksMovement: boolean; blocksLineOfSight: boolean; provideCover: unknown | null }
  interaction: { type: string; range: number }
  interactionLegacy: string
  variants: Record<string, unknown>
}

export interface ObjectTypeConfigJson {
  schemaVersion: '3.0'
  types: Record<string, ObjectTypeConfig>
}

export interface PassabilityConfigJson {
  schemaVersion: '3.0'
  heightThresholds: { normalMaxDelta: number; slopeMaxDelta: number; bridgeIgnored: boolean }
  sentinelHeights: { cliff: number; abyss: number; validRange: { min: number; max: number } }
  movementTags: Record<string, { label: string; ignoresHeightDelta: boolean }>
  cellMobilityArbitration: {
    blockedRule: string
    moveCostRule: string
    navTerrainRule: string
    conditionalUnsatisfied: string
  }
  objectFootprintRule: { source: string; respectsBlocksMovement: boolean; ignoresObjectHeight: boolean }
  lineOfSight: { enabled: boolean }
}

export interface SceneManifestJson {
  schemaVersion: '3.0'
  bundleId: string
  generatedAt: string
  generatedAtUtc: string
  files: {
    terrain: 'terrain.json'
    terrainConfig: 'terrain-config.json'
    objectTypeConfig: 'object-type-config.json'
    passabilityConfig: 'passability-config.json'
    terrainAtlas: { tsj: 'terrain_atlas.tsj'; image: 'terrain_atlas.png' }
    objectAtlas: { tsj: 'object_atlas.tsj'; image: 'object_atlas.png' }
  }
}

export interface CookedScene {
  bundleId: string
  sceneName: string
  terrain: TerrainJson
  terrainConfig: TerrainConfigJson
  objectTypeConfig: ObjectTypeConfigJson
  passabilityConfig: PassabilityConfigJson
  manifest: SceneManifestJson
  warnings: string[]
  terrainAtlasInputs: SceneAtlasInput[]
  objectAtlasInputs: SceneAtlasInput[]
}

/**
 * TSJ collider descriptor (normalized [0,1], origin bottom-left, Y-up — same
 * convention as `pivot`). Mirrors the reference bundle's `object_atlas.tsj` /
 * `terrain_atlas.tsj` tile.collider field so the shipped viewer's
 * `pointInCollider` / `bakeCollisionCells` can bake it without any format
 * translation.
 */
export type SceneTileCollider =
  | { type: 'none' }
  | { type: 'rect'; rect: [number, number, number, number] }
  | { type: 'polygon'; points: Array<[number, number]> }

export interface SceneAtlasInput {
  id: number
  role: 'terrain' | 'object'
  alias?: string
  name: string
  widthPx?: number
  heightPx?: number
  anchorX?: number
  anchorY?: number
  /**
   * Optional source sub-rect within the resolved asset image. When set, only
   * this rect is blitted into the atlas (tile-group slicing). Absent → the
   * whole image is packed as one tile (objects / single-image tiles).
   */
  srcRect?: { x: number; y: number; w: number; h: number }
  /**
   * Collision shape for this atlas tile, derived from the library asset's
   * `geometry_json.collision_mask`. Absent → the atlas builder writes
   * `{ type: 'none' }` (no collider), matching prior behaviour.
   */
  collider?: SceneTileCollider
}
