/**
 * procedural_village_layout: Intelligent procedural layout generator for 3A hillside valley settlements.
 *
 * Automatically generates organic, collision-free, zoning-aware building parcels:
 *   - Town Center / High Street: Dense townhouses with active street frontages aligned with road normals
 *   - Marketplace Perimeter: Ring of townhouses framing the village plaza and monument
 *   - Hillside Terraces: Contoured chalets and cottages facing downhill toward the valley basin
 *   - Rural Outskirts: Clustered farmsteads and barns nestled near agricultural terraces
 *   - Forest Edge / Ridges: Secluded timber cabins with panoramic mountain vistas
 *
 * Guarantees zero road clipping, river clearance, slope validation, and non-overlapping footprints.
 */

import {
  generateProceduralVillageLayout,
  type MultiTierHousePlot,
} from '../../../../vendor/shared/types/index.js'

export interface ProceduralVillageLayoutInput {
  heightGrid?: unknown
  buildableMask?: unknown
  valleyMask?: unknown
  terraceMask?: unknown
  forestMask?: unknown
  slopeGrid?: unknown
  roadPoints?: unknown
  ringPoints?: unknown
  trailPoints?: unknown
  feederPoints?: unknown
  millAccessPoints?: unknown
  riverPoints?: unknown
  plazaCenter?: unknown
  plazaRadius?: number
  towerPosition?: unknown
  millPosition?: unknown
  targetCount?: number
  density?: number
  seed?: number
  roadWidth?: number
  riverWidth?: number
  roadSetback?: number
  minSpacing?: number
}

export interface ProceduralVillageLayoutResult {
  plots: MultiTierHousePlot[]
  points: Array<[number, number]>
  yaws: number[]
  types: string[]
  count: number
}

export function proceduralVillageLayout(input: Record<string, unknown>): ProceduralVillageLayoutResult {
  const plots = generateProceduralVillageLayout({
    heightGrid: input.heightGrid,
    buildableMask: input.buildableMask,
    valleyMask: input.valleyMask,
    terraceMask: input.terraceMask,
    forestMask: input.forestMask,
    slopeGrid: input.slopeGrid,
    roadPoints: input.roadPoints,
    ringPoints: input.ringPoints,
    trailPoints: input.trailPoints,
    feederPoints: input.feederPoints,
    millAccessPoints: input.millAccessPoints,
    riverPoints: input.riverPoints,
    plazaCenter: input.plazaCenter,
    plazaRadius: typeof input.plazaRadius === 'number' ? input.plazaRadius : undefined,
    towerPosition: input.towerPosition,
    millPosition: input.millPosition,
    targetCount: typeof input.targetCount === 'number' ? input.targetCount : undefined,
    density: typeof input.density === 'number' ? input.density : undefined,
    seed: typeof input.seed === 'number' ? input.seed : undefined,
    roadWidth: typeof input.roadWidth === 'number' ? input.roadWidth : undefined,
    riverWidth: typeof input.riverWidth === 'number' ? input.riverWidth : undefined,
    roadSetback: typeof input.roadSetback === 'number' ? input.roadSetback : undefined,
    minSpacing: typeof input.minSpacing === 'number' ? input.minSpacing : undefined,
  })

  const points: Array<[number, number]> = plots.map((p) => [p.x, p.y])
  const yaws: number[] = plots.map((p) => p.yaw ?? 0)
  const types: string[] = plots.map((p) => p.type ?? 'cottage')

  return {
    plots,
    points,
    yaws,
    types,
    count: plots.length,
  }
}
