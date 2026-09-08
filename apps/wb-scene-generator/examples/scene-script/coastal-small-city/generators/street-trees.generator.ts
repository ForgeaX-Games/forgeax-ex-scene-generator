import { defineGenerator } from '@forgeax/project-generator'
import { dist, lerp, normalOf, pointInPolygon, resamplePolyline, sampleGridHeight, type Point } from './lib/geom.generator-lib.ts'

type Placement = { x: number; y: number; width?: number; depth?: number }
type RoadEdge = { polyline: Point[]; width: number; kind?: string; story?: string }

export const streetTrees = defineGenerator({
  id: 'street-trees',
  version: '1.2.0',
  description: 'Trees on both kerbs, denser on locals, skipping buildings and junctions.',
  inputs: {
    network: { type: 'Any', runtimeType: 'road-network' },
    buildings: { type: 'Any', runtimeType: 'placement-set' },
    structures: { type: 'Any', runtimeType: 'placement-set' },
    reserved: { type: 'Any', runtimeType: 'region-set' },
    clearance: { type: 'NumberValue', defaultValue: 6 },
    heightGrid: { type: 'Any', runtimeType: 'height-grid' },
    cellSize: { type: 'NumberValue', defaultValue: 8 },
  },
  outputs: {
    placements: { type: 'Any', runtimeType: 'placement-set' },
  },
  run(_ctx, args: {
    network: { edges: RoadEdge[] }
    buildings: { placements: Placement[] }
    structures?: { placements?: Placement[] }
    reserved?: { regions?: Array<{ polygon: Point[] }> }
    clearance: number
    heightGrid?: number[][]
    cellSize?: number
  }) {
    const buildings = [...(args.buildings.placements ?? []), ...(args.structures?.placements ?? [])]
    const reserved = args.reserved?.regions ?? []
    const inReserved = (pt: Point): boolean => reserved.some((region) => pointInPolygon(pt, region.polygon))
    const clearance = Number(args.clearance) || 6
    const cellSize = Number(args.cellSize) || 8
    const heightGrid = args.heightGrid
    const heightAt = (pt: Point) => (heightGrid ? sampleGridHeight(heightGrid, cellSize, pt) : 0)
    const out = []
    let n = 0
    for (const edge of args.network.edges ?? []) {
      const spacing = edge.kind === 'local' ? 7 : edge.kind === 'waterfront' ? 9 : 12
      const samples = resamplePolyline(edge.polyline, spacing)
      if (samples.length < 3) continue
      for (let i = 1; i < samples.length - 1; i++) {
        const a = samples[i - 1]!
        const b = samples[i]!
        const mid = lerp(a, b, 0.5)
        const nrm = normalOf(a, b)
        for (const side of [-1, 1] as const) {
          const candidate: Point = [
            mid[0] + nrm[0] * side * (edge.width / 2 + 1.8),
            mid[1] + nrm[1] * side * (edge.width / 2 + 1.8),
          ]
          if (inReserved(candidate)) continue
          if (buildings.some((building) => dist(candidate, [building.x, building.y]) < clearance)) continue
          const garden = edge.story === 'garden-lane' || edge.kind === 'local'
          const proto = garden && n % 4 === 0 ? 'hedge' : garden && n % 5 === 0 ? 'grass-clump' : 'street-tree'
          out.push({
            key: `tree-${n++}`,
            prototypeKey: proto,
            x: candidate[0],
            y: candidate[1],
            z: heightAt(candidate) + 0.12,
            rotation: Math.atan2(nrm[1] * side, nrm[0] * side),
            scale: [0.85 + (n % 4) * 0.08, 0.85 + ((n * 3) % 4) * 0.08, 0.9 + (n % 3) * 0.08] as const,
            source: 'frontage',
            role: 'derived' as const,
            lineage: { source: 'roads', via: ['building-clearance'] },
          })
          if (out.length >= 720) {
            return { placements: { placements: out, role: 'derived', lineage: { source: 'roads' } } }
          }
        }
      }
    }
    return { placements: { placements: out, role: 'derived', lineage: { source: 'roads' } } }
  },
})
