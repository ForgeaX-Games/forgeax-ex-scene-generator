import type { Point } from './geom.generator-lib.ts'

export type DistrictKey =
  | 'harbor'
  | 'civic'
  | 'urban-west'
  | 'urban-east'
  | 'suburb-west'
  | 'suburb-east'
  | 'market'
  | 'urban'
  | 'suburb'
  | 'residential'

export type StreetStory =
  | 'quay-unload'
  | 'fish-alley'
  | 'civic-promenade'
  | 'plaza-cross'
  | 'sea-front-lane'
  | 'shop-row'
  | 'garden-lane'
  | 'arterial'

export type DecorSpec = {
  prototypeKey: string
  spacing: number
  kerb: number
  jitter: number
  side: 'both' | 'left' | 'right'
}

export type DistrictFabric = {
  purpose: string
  story: string
  landmarkKey: string
  buildingFamily: string[]
  laneDepths: number[]
  alleySpacing: number
  alleyLength: number
  localWidth: number
  lotWidth: number
  lotDepth: number
  density: number
  decor: DecorSpec[]
}

export const FABRIC: Record<string, DistrictFabric> = {
  harbor: {
    purpose: 'working-waterfront',
    story: 'Dawn unload: barrels roll from the quay into the fish alleys.',
    landmarkKey: 'lighthouse',
    buildingFamily: ['warehouse', 'pier', 'row-house', 'shop-house'],
    laneDepths: [12, 30],
    alleySpacing: 24,
    alleyLength: 34,
    localWidth: 5.2,
    lotWidth: 9,
    lotDepth: 11,
    density: 0.9,
    decor: [
      { prototypeKey: 'crate', spacing: 5.5, kerb: 1.3, jitter: 0.6, side: 'both' },
      { prototypeKey: 'barrel', spacing: 7.5, kerb: 1.6, jitter: 0.5, side: 'both' },
      { prototypeKey: 'harbor-quay-set', spacing: 20, kerb: 2.0, jitter: 0.5, side: 'left' },
      { prototypeKey: 'lantern', spacing: 14, kerb: 1.1, jitter: 0.15, side: 'both' },
    ],
  },
  civic: {
    purpose: 'river-spine',
    story: 'Processions along the creek; benches face the water between hearings.',
    landmarkKey: 'town-hall',
    buildingFamily: ['civic', 'mid-rise', 'shop-house', 'row-house'],
    laneDepths: [18, 40],
    alleySpacing: 32,
    alleyLength: 40,
    localWidth: 5.6,
    lotWidth: 12,
    lotDepth: 14,
    density: 0.86,
    decor: [
      { prototypeKey: 'bench', spacing: 10, kerb: 1.5, jitter: 0.25, side: 'both' },
      { prototypeKey: 'civic-plaza-set', spacing: 24, kerb: 2.2, jitter: 0.3, side: 'left' },
      { prototypeKey: 'lantern', spacing: 13, kerb: 1.2, jitter: 0.1, side: 'both' },
      { prototypeKey: 'planter', spacing: 11, kerb: 1.4, jitter: 0.3, side: 'both' },
    ],
  },
  'urban-west': {
    purpose: 'coastal-fabric',
    story: 'Shop rows keep the sea in view; stalls spill onto the lane at dusk.',
    landmarkKey: 'clock-tower',
    buildingFamily: ['high-rise', 'mid-rise', 'shop-house', 'row-house'],
    laneDepths: [28, 52, 90, 140, 200],
    alleySpacing: 26,
    alleyLength: 52,
    localWidth: 5.4,
    lotWidth: 8.6,
    lotDepth: 11,
    density: 0.94,
    decor: [
      { prototypeKey: 'stall', spacing: 8.5, kerb: 1.4, jitter: 0.45, side: 'both' },
      { prototypeKey: 'urban-stall-set', spacing: 22, kerb: 2.2, jitter: 0.4, side: 'left' },
      { prototypeKey: 'lantern', spacing: 12, kerb: 1.1, jitter: 0.15, side: 'both' },
      { prototypeKey: 'planter', spacing: 10, kerb: 1.3, jitter: 0.25, side: 'both' },
    ],
  },
  'urban-east': {
    purpose: 'coastal-fabric',
    story: 'Twin of the west quay: quieter shops, same sea-facing rhythm.',
    landmarkKey: 'clock-tower',
    buildingFamily: ['high-rise', 'mid-rise', 'shop-house', 'row-house'],
    laneDepths: [28, 52, 90, 140, 200],
    alleySpacing: 26,
    alleyLength: 52,
    localWidth: 5.4,
    lotWidth: 8.6,
    lotDepth: 11,
    density: 0.94,
    decor: [
      { prototypeKey: 'stall', spacing: 8.5, kerb: 1.4, jitter: 0.45, side: 'both' },
      { prototypeKey: 'urban-stall-set', spacing: 22, kerb: 2.2, jitter: 0.4, side: 'left' },
      { prototypeKey: 'lantern', spacing: 12, kerb: 1.1, jitter: 0.15, side: 'both' },
      { prototypeKey: 'planter', spacing: 10, kerb: 1.3, jitter: 0.25, side: 'both' },
    ],
  },
  'suburb-west': {
    purpose: 'hinterland',
    story: 'Garden lanes wander from the chapel to the last cottage hedge.',
    landmarkKey: 'chapel',
    buildingFamily: ['cottage', 'row-house'],
    laneDepths: [22, 44, 68, 96],
    alleySpacing: 24,
    alleyLength: 72,
    localWidth: 5.2,
    lotWidth: 12,
    lotDepth: 15,
    density: 0.84,
    decor: [
      { prototypeKey: 'hedge', spacing: 7, kerb: 1.8, jitter: 0.3, side: 'both' },
      { prototypeKey: 'planter', spacing: 8, kerb: 1.6, jitter: 0.35, side: 'both' },
      { prototypeKey: 'suburb-garden-set', spacing: 22, kerb: 2.6, jitter: 0.5, side: 'left' },
      { prototypeKey: 'grass-clump', spacing: 6.5, kerb: 2.0, jitter: 0.55, side: 'both' },
      { prototypeKey: 'well', spacing: 32, kerb: 2.4, jitter: 0.7, side: 'left' },
    ],
  },
  'suburb-east': {
    purpose: 'hinterland',
    story: 'Same hinterland cadence, facing the east hills.',
    landmarkKey: 'chapel',
    buildingFamily: ['cottage', 'row-house'],
    laneDepths: [22, 44, 68, 96],
    alleySpacing: 24,
    alleyLength: 72,
    localWidth: 5.2,
    lotWidth: 12,
    lotDepth: 15,
    density: 0.84,
    decor: [
      { prototypeKey: 'hedge', spacing: 7, kerb: 1.8, jitter: 0.3, side: 'both' },
      { prototypeKey: 'planter', spacing: 8, kerb: 1.6, jitter: 0.35, side: 'both' },
      { prototypeKey: 'suburb-garden-set', spacing: 22, kerb: 2.6, jitter: 0.5, side: 'left' },
      { prototypeKey: 'grass-clump', spacing: 6.5, kerb: 2.0, jitter: 0.55, side: 'both' },
      { prototypeKey: 'well', spacing: 32, kerb: 2.4, jitter: 0.7, side: 'left' },
    ],
  },
  market: {
    purpose: 'market',
    story: 'Stall streets packed against the civic edge.',
    landmarkKey: 'clock-tower',
    buildingFamily: ['high-rise', 'mid-rise', 'shop-house', 'row-house'],
    laneDepths: [24, 48],
    alleySpacing: 22,
    alleyLength: 30,
    localWidth: 4.8,
    lotWidth: 9,
    lotDepth: 11,
    density: 0.86,
    decor: [
      { prototypeKey: 'stall', spacing: 6.5, kerb: 1.3, jitter: 0.4, side: 'both' },
      { prototypeKey: 'crate', spacing: 8, kerb: 1.4, jitter: 0.5, side: 'both' },
    ],
  },
  urban: {
    purpose: 'coastal-fabric',
    story: 'Generic urban shop-row.',
    landmarkKey: 'clock-tower',
    buildingFamily: ['high-rise', 'mid-rise', 'shop-house', 'row-house'],
    laneDepths: [28, 56],
    alleySpacing: 30,
    alleyLength: 40,
    localWidth: 5.2,
    lotWidth: 9.5,
    lotDepth: 12,
    density: 0.84,
    decor: [
      { prototypeKey: 'stall', spacing: 9, kerb: 1.4, jitter: 0.4, side: 'both' },
      { prototypeKey: 'lantern', spacing: 12, kerb: 1.1, jitter: 0.15, side: 'both' },
    ],
  },
  suburb: {
    purpose: 'hinterland',
    story: 'Generic hinterland lane.',
    landmarkKey: 'chapel',
    buildingFamily: ['cottage', 'row-house'],
    laneDepths: [24, 48, 72],
    alleySpacing: 28,
    alleyLength: 48,
    localWidth: 5.2,
    lotWidth: 12,
    lotDepth: 15,
    density: 0.82,
    decor: [
      { prototypeKey: 'hedge', spacing: 8, kerb: 1.8, jitter: 0.3, side: 'both' },
      { prototypeKey: 'suburb-garden-set', spacing: 24, kerb: 2.6, jitter: 0.5, side: 'left' },
    ],
  },
  residential: {
    purpose: 'residential',
    story: 'Quiet residential fabric between the hub and the periphery.',
    landmarkKey: 'chapel',
    buildingFamily: ['shop-house', 'row-house', 'cottage', 'mid-rise'],
    laneDepths: [24, 48],
    alleySpacing: 28,
    alleyLength: 40,
    localWidth: 5.2,
    lotWidth: 10,
    lotDepth: 12,
    density: 0.82,
    decor: [
      { prototypeKey: 'planter', spacing: 9, kerb: 1.4, jitter: 0.3, side: 'both' },
      { prototypeKey: 'lantern', spacing: 14, kerb: 1.2, jitter: 0.1, side: 'both' },
    ],
  },
}

export function fabricOf(district: string | undefined): DistrictFabric {
  if (!district) return FABRIC.residential!
  return FABRIC[district] ?? FABRIC.residential!
}

export function decorFor(district: string | undefined): DecorSpec[] {
  return fabricOf(district).decor
}

export function decorForStory(district: string | undefined, story?: string): DecorSpec[] {
  const base = decorFor(district)
  if (!story) return base
  if (story === 'quay-unload') return base.filter((s) => s.prototypeKey === 'barrel' || s.prototypeKey === 'crate' || s.prototypeKey === 'harbor-quay-set')
  if (story === 'fish-alley') return base.filter((s) => s.prototypeKey === 'crate' || s.prototypeKey === 'lantern' || s.prototypeKey === 'barrel')
  if (story === 'civic-promenade') return base.filter((s) => s.prototypeKey === 'bench' || s.prototypeKey === 'lantern' || s.prototypeKey === 'civic-plaza-set')
  if (story === 'plaza-cross') return base.filter((s) => s.prototypeKey === 'planter' || s.prototypeKey === 'bench' || s.prototypeKey === 'civic-plaza-set')
  if (story === 'shop-row') return base.filter((s) => s.prototypeKey === 'stall' || s.prototypeKey === 'urban-stall-set' || s.prototypeKey === 'lantern' || s.prototypeKey === 'planter')
  if (story === 'garden-lane') return base.filter((s) => s.prototypeKey === 'hedge' || s.prototypeKey === 'suburb-garden-set' || s.prototypeKey === 'grass-clump' || s.prototypeKey === 'well')
  return base
}

export function storyForEdge(district: string | undefined, kind: string): StreetStory {
  if (kind === 'bridge') return 'civic-promenade'
  if (kind === 'waterfront') return 'sea-front-lane'
  if (district === 'harbor') return kind === 'arterial' ? 'quay-unload' : 'fish-alley'
  if (district === 'civic') return kind === 'arterial' ? 'civic-promenade' : 'plaza-cross'
  if (district?.startsWith('urban')) return kind === 'arterial' ? 'sea-front-lane' : 'shop-row'
  if (district?.startsWith('suburb')) return 'garden-lane'
  return kind === 'arterial' ? 'arterial' : 'shop-row'
}
