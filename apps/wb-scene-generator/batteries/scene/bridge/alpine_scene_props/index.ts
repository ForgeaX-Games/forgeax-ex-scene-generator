/**
 * alpine_scene_props: Procedural storytelling scene props & decorations.
 */

import { buildAlpineScenePropsMesh, type SceneMesh } from '../../../../vendor/shared/types/index.js'

export interface AlpineScenePropsResult {
  mesh?: SceneMesh
  triangleCount: number
  error?: string
}

export function alpineSceneProps(input: Record<string, unknown>): AlpineScenePropsResult {
  if (!input.heightGrid) {
    return { triangleCount: 0, error: 'heightGrid is required' }
  }

  const mesh = buildAlpineScenePropsMesh({
    heightGrid: input.heightGrid,
    slopeGrid: input.slopeGrid,
    terraceMask: input.terraceMask,
    forestMask: input.forestMask,
    roadPoints: input.roadPoints,
    ringPoints: input.ringPoints,
    trailPoints: input.trailPoints,
    feederPoints: input.feederPoints,
    millAccessPoints: input.millAccessPoints,
    riverPoints: input.riverPoints,
    plazaCenter: input.plazaCenter,
    plazaRadius: typeof input.plazaRadius === 'number' ? input.plazaRadius : undefined,
    bridgeStart: input.bridgeStart,
    bridgeEnd: input.bridgeEnd,
    towerPosition: input.towerPosition,
    millPosition: input.millPosition,
    avoidPoints: input.avoidPoints,
    seed: typeof input.seed === 'number' ? input.seed : undefined,
    cellSize: typeof input.cellSize === 'number' ? input.cellSize : undefined,
    riverWidth: typeof input.riverWidth === 'number' ? input.riverWidth : undefined,
  })

  if (!mesh) return { triangleCount: 0, error: 'failed to generate alpine scene props mesh' }
  return { mesh, triangleCount: mesh.indices.length / 3 }
}
