import { defineGenerator } from '@forgeax/project-generator'
import { centroidOf, dist, resamplePolyline, sampleGridHeight, type Point } from './lib/geom.generator-lib.ts'

type Parcel = { key: string; district: string; polygon: Point[]; frontageNormal: Point }
type Placement = { x: number; y: number; width?: number; depth?: number }

export const suburbYards = defineGenerator({
  id: 'suburb-yards',
  version: '1.0.0',
  description: 'Yard trees, hedges and grass behind suburban cottages so hinterland lots are not empty.',
  inputs: {
    parcels: { type: 'Any', runtimeType: 'parcel-set' },
    buildings: { type: 'Any', runtimeType: 'placement-set' },
    structures: { type: 'Any', runtimeType: 'placement-set' },
    heightGrid: { type: 'Any', runtimeType: 'height-grid' },
    cellSize: { type: 'NumberValue', defaultValue: 8 },
  },
  outputs: {
    placements: { type: 'Any', runtimeType: 'placement-set' },
  },
  run(_ctx, args: {
    parcels?: { parcels?: Parcel[] }
    buildings?: { placements?: Placement[] }
    structures?: { placements?: Placement[] }
    heightGrid?: number[][]
    cellSize?: number
  }) {
    const parcels = (args.parcels?.parcels ?? []).filter((parcel) => parcel.district.startsWith('suburb'))
    const buildings = [...(args.buildings?.placements ?? []), ...(args.structures?.placements ?? [])]
    const cellSize = Number(args.cellSize) || 8
    const heightGrid = args.heightGrid
    const heightAt = (pt: Point) => (heightGrid ? sampleGridHeight(heightGrid, cellSize, pt) : 0)
    const out: Array<{
      key: string
      prototypeKey: string
      x: number
      y: number
      z: number
      rotation: number
      scale: readonly [number, number, number]
      role: 'derived'
      lineage: { source: string; via: string[] }
    }> = []
    let n = 0

    for (const parcel of parcels) {
      const c = centroidOf(parcel.polygon)
      const nrm = parcel.frontageNormal
      const ring = parcel.polygon.length >= 2 ? resamplePolyline([...parcel.polygon, parcel.polygon[0]!], 7) : [c]
      const spots: Array<{ pt: Point; key: string; proto: string; scale: readonly [number, number, number] }> = [
        {
          pt: [c[0] + nrm[0] * 5.6, c[1] + nrm[1] * 5.6],
          key: 'yard-tree',
          proto: 'street-tree',
          scale: [1.05, 1.05, 1.12],
        },
        {
          pt: [c[0] + nrm[0] * 3.2 - nrm[1] * 3.4, c[1] + nrm[1] * 3.2 + nrm[0] * 3.4],
          key: 'yard-hedge',
          proto: 'hedge',
          scale: [1.15, 0.9, 0.95],
        },
        {
          pt: [c[0] - nrm[0] * 2.4 + nrm[1] * 2.8, c[1] - nrm[1] * 2.4 - nrm[0] * 2.8],
          key: 'yard-grass',
          proto: 'grass-clump',
          scale: [1.2, 1.1, 0.85],
        },
      ]
      if (n % 5 === 0 && ring[1]) {
        spots.push({
          pt: ring[1]!,
          key: 'yard-set',
          proto: 'suburb-garden-set',
          scale: [1, 1, 1],
        })
      }
      for (const spot of spots) {
        if (
          buildings.some(
            (building) =>
              dist(spot.pt, [building.x, building.y]) <
              2.4 + Math.max(building.width ?? 4, building.depth ?? 4) * 0.42,
          )
        )
          continue
        if (out.some((item) => dist(spot.pt, [item.x, item.y]) < 3.4)) continue
        out.push({
          key: `${spot.key}-${parcel.key}-${n++}`,
          prototypeKey: spot.proto,
          x: spot.pt[0],
          y: spot.pt[1],
          z: heightAt(spot.pt) + 0.1,
          rotation: Math.atan2(nrm[1], nrm[0]) + 0.2,
          scale: spot.scale,
          role: 'derived',
          lineage: { source: 'parcels', via: ['yard', parcel.district] },
        })
        if (out.length >= 420) {
          return { placements: { placements: out, role: 'derived', lineage: { source: 'parcels', via: ['yard'] } } }
        }
      }
    }

    return { placements: { placements: out, role: 'derived', lineage: { source: 'parcels', via: ['yard'] } } }
  },
})
