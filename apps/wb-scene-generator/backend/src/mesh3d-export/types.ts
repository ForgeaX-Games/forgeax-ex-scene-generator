/** Generic 3D game scene package written by wb-scene-generator mesh3d export. */

export const MESH3D_SCENE_FORMAT = 'forgeax.mesh3d-scene' as const
export const MESH3D_SCENE_VERSION = 1 as const
export const MESH3D_WORKBENCH_PREFIX = 'wb-scene-generator' as const
export const MESH3D_CELL_SIZE = 8

export interface Mesh3dSceneMeta {
  format: typeof MESH3D_SCENE_FORMAT
  version: typeof MESH3D_SCENE_VERSION
  source: {
    workbench: typeof MESH3D_WORKBENCH_PREFIX
    projectId: string
    sceneName: string
  }
  sceneId: string
  gameSlug: string
  generatedAt: string
  cellSize: number
  bounds: {
    minX: number
    maxX: number
    minY: number
    maxY: number
  }
  /** Package-relative paths keyed by material / model name. */
  materials: Record<string, string>
  models: Record<string, string>
  terrain: {
    cells: Array<{
      x: number
      y: number
      /** Top voxel z of the surface owner. */
      z: number
      material: string
    }>
  }
  objects: Array<{
    instanceKey: string
    requestedName: string
    model: string
    modelPath: string
    cell: { x: number; y: number }
    /** World-space position (same convention as 3DMesh preview). */
    position: { x: number; y: number; z: number }
  }>
  warnings: string[]
}

export interface Mesh3dExportCookResult {
  sceneId: string
  gameSlug: string
  sceneDir: string
  metaPath: string
  /** Path relative to the game root (`assets/3d/scenes/wb-scene-generator/...`). */
  relativeDir: string
  /** Path relative to FORGEAX_PROJECT_ROOT (includes `.forgeax/games/<slug>/...`). */
  projectRelativeDir: string
  warnings: string[]
}
