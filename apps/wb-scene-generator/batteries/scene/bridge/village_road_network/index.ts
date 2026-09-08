/**
 * village_road_network: Plaza-centric alpine settlement graph.
 * The plaza is the hub. The arterial follows the river bank; it wraps the
 * civic ring with smooth joins when the plaza sits on the bank, or sends one
 * curved approach when the plaza is inland. Trail / feeder leave along the
 * landward tangent. One surface-draped ribbon mesh.
 */

import { generateVillageRoadNetwork } from '../../../../vendor/shared/types/index.js'

export function villageRoadNetwork(input: Record<string, unknown>): Record<string, unknown> {
  const res = generateVillageRoadNetwork({
    plazaCenter: input.plazaCenter ?? input.center,
    plazaRadius: typeof input.plazaRadius === 'number' ? input.plazaRadius : undefined,
    riverPoints: input.riverPoints,
    heightGrid: input.heightGrid,
    seed: typeof input.seed === 'number' ? input.seed : undefined,
    riverWidth: typeof input.riverWidth === 'number' ? input.riverWidth : undefined,
  })

  return {
    arterialPoints: res.arterialPoints,
    ringPoints: res.ringPoints,
    trailPoints: res.trailPoints,
    feederPoints: res.feederPoints,
    millAccessPoints: res.millAccessPoints,
    towerPosition: res.towerPosition,
    millPosition: res.millPosition,
    millYaw: res.millYaw,
    bridgeStart: res.bridgeStart,
    bridgeEnd: res.bridgeEnd,
    plazaCenter: res.plazaCenter,
    plazaRadius: res.plazaRadius,
    mesh: res.mesh,
  }
}
