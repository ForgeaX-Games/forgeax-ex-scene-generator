import { defineGenerator } from '@forgeax/project-generator'
import {
  asPointList,
  centroidOf,
  closeRing,
  distToPolyline,
  jitterRing,
  pointInPolygon,
  rectBoundary,
  rng,
  hashSeed,
  voronoiCells,
  type Point,
} from './lib/geom.generator-lib.ts'

const NAMES = ['harbor', 'civic', 'market', 'residential'] as const

export const districtPlan = defineGenerator({
  id: 'district-plan',
  version: '1.1.0',
  description: 'Voronoi districts from hubs, clipped to the city boundary and labelled by coast proximity.',
  inputs: {
    hubs: { type: 'Any', runtimeType: 'point2d-list', access: 'list' },
    cityBoundary: { type: 'Any', runtimeType: 'point2d-list', access: 'list' },
    coastline: { type: 'Any', runtimeType: 'point2d-list', access: 'list' },
    density: { type: 'NumberValue', defaultValue: 0.7, control: true },
    seed: { type: 'NumberValue', defaultValue: 11, control: true },
    width: { type: 'NumberValue', defaultValue: 600 },
    height: { type: 'NumberValue', defaultValue: 450 },
  },
  outputs: {
    districts: { type: 'Any', runtimeType: 'region-set' },
  },
  run(_ctx, args: {
    hubs: Point[]
    cityBoundary: Point[]
    coastline: Point[]
    density: number
    seed: number
    width: number
    height: number
  }) {
    const hubs = asPointList(args.hubs).slice(0, 4)
    const boundary = closeRing(asPointList(args.cityBoundary))
    const frame = boundary.length >= 4 ? boundary : rectBoundary(Number(args.width) || 600, Number(args.height) || 450)
    const coast = asPointList(args.coastline)
    const random = rng(hashSeed(Number(args.seed) || 11, 23))
    const cells = voronoiCells(hubs, frame)
    let harborAt = 0
    if (coast.length >= 2 && hubs.length > 0) {
      let best = Infinity
      for (let i = 0; i < hubs.length; i++) {
        const d = distToPolyline(hubs[i]!, coast)
        if (d < best) {
          best = d
          harborAt = i
        }
      }
    }
    const labels = NAMES.slice()
    if (harborAt !== 0 && harborAt < labels.length) {
      const moved = labels[harborAt]!
      labels[harborAt] = 'harbor'
      labels[0] = moved
    }
    const regions = cells.flatMap((cell, index) => {
      const polygon = jitterRing(cell, 6 + (1 - Math.min(1, args.density)) * 8, random)
      const usable = polygon.length >= 4 && pointInPolygon(centroidOf(polygon), frame)
      const ring = usable ? polygon : cell
      if (ring.length < 4) return []
      return [{
        key: labels[index] ?? `district-${index}`,
        kind: labels[index] ?? 'district',
        polygon: ring,
        attributes: { hub: hubs[index], density: args.density },
        role: 'derived' as const,
        lineage: { source: 'hubs', via: ['cityBoundary', 'coastline'] },
      }]
    })
    return { districts: { regions, role: 'derived', lineage: { source: 'hubs' } } }
  },
})
