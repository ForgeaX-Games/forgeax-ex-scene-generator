import { defineGenerator } from '@forgeax/project-generator'
import { decorForStory, storyForEdge, type DecorSpec } from './lib/fabric.generator-lib.ts'
import {
  dist,
  lerp,
  normalOf,
  pointInPolygon,
  resamplePolyline,
  sampleGridHeight,
  type Point,
} from './lib/geom.generator-lib.ts'

type Placement = {
  key: string
  prototypeKey: string
  x: number
  y: number
  z?: number
  rotation: number
  scale?: readonly [number, number, number]
  width?: number
  depth?: number
}

type RoadEdge = {
  polyline: Point[]
  width: number
  kind?: string
  story?: string
  district?: string
}

type Region = { key: string; polygon: Point[] }

export const streetLife = defineGenerator({
  id: 'street-life',
  version: '1.0.0',
  description: 'Street furniture and work objects from each lane story, cleared from buildings.',
  inputs: {
    network: { type: 'Any', runtimeType: 'road-network' },
    districts: { type: 'Any', runtimeType: 'region-set' },
    buildings: { type: 'Any', runtimeType: 'placement-set' },
    structures: { type: 'Any', runtimeType: 'placement-set' },
    reserved: { type: 'Any', runtimeType: 'region-set' },
    heightGrid: { type: 'Any', runtimeType: 'height-grid' },
    cellSize: { type: 'NumberValue', defaultValue: 8 },
    seed: { type: 'NumberValue', defaultValue: 11, control: true },
    clearance: { type: 'NumberValue', defaultValue: 4.2 },
  },
  outputs: {
    placements: { type: 'Any', runtimeType: 'placement-set' },
  },
  run(_ctx, args: {
    network: { edges?: RoadEdge[] }
    districts?: { regions?: Region[] }
    buildings?: { placements?: Array<{ x: number; y: number; width?: number; depth?: number }> }
    structures?: { placements?: Array<{ x: number; y: number; width?: number; depth?: number }> }
    reserved?: { regions?: Array<{ polygon: Point[] }> }
    heightGrid?: number[][]
    cellSize?: number
    seed: number
    clearance?: number
  }) {
    const buildings = [...(args.buildings?.placements ?? []), ...(args.structures?.placements ?? [])]
    const regions = args.districts?.regions ?? []
    const clearance = Number(args.clearance) || 4.2
    const cellSize = Number(args.cellSize) || 8
    const heightGrid = args.heightGrid
    const out: Placement[] = []

    const districtAt = (pt: Point): string => {
      for (const region of regions) {
        if (pointInPolygon(pt, region.polygon)) return region.key
      }
      return 'residential'
    }

    const reserved = args.reserved?.regions ?? []
    const blocked = (pt: Point): boolean =>
      reserved.some((region) => pointInPolygon(pt, region.polygon)) ||
      buildings.some((b) => dist(pt, [b.x, b.y]) < clearance + Math.max(b.width ?? 6, b.depth ?? 6) * 0.22)

    const heightAt = (pt: Point) => (heightGrid ? sampleGridHeight(heightGrid, cellSize, pt) : 0)
    let n = 0

    const ranked = [...(args.network.edges ?? [])].sort((a, b) => {
      const rank = (edge: RoadEdge) => (edge.kind === 'local' ? 0 : edge.kind === 'waterfront' ? 1 : 2)
      return rank(a) - rank(b)
    })

    const placeSpec = (edge: RoadEdge, spec: DecorSpec, lanternBudget: { left: number }) => {
      if (edge.polyline.length < 2) return
      if (spec.prototypeKey === 'lantern' && lanternBudget.left <= 0) return
      const samples = resamplePolyline(edge.polyline, spec.spacing)
      if (samples.length < 3) return
      for (let i = 1; i < samples.length - 1; i++) {
        const a = samples[i - 1]!
        const b = samples[i]!
        const p = lerp(a, b, 0.5)
        const nrm = normalOf(a, b)
        const sides = spec.side === 'both' ? [-1, 1] : spec.side === 'left' ? [-1] : [1]
        for (const side of sides) {
          const jx = ((i * 17 + n * 13) % 10) / 10 - 0.5
          const jy = ((i * 11 + n * 7) % 10) / 10 - 0.5
          const candidate: Point = [
            p[0] + nrm[0] * side * (edge.width / 2 + spec.kerb) + nrm[0] * jx * spec.jitter,
            p[1] + nrm[1] * side * (edge.width / 2 + spec.kerb) + nrm[1] * jy * spec.jitter,
          ]
          if (blocked(candidate)) continue
          if (out.some((item) => dist(candidate, [item.x, item.y]) < spec.spacing * 0.4)) continue
          const sx = 0.82 + ((i + n) % 5) * 0.07
          const sy = 0.86 + ((i * 3 + n) % 4) * 0.06
          out.push({
            key: `life-${n++}`,
            prototypeKey: spec.prototypeKey,
            x: candidate[0],
            y: candidate[1],
            z: heightAt(candidate) + 0.15,
            rotation: Math.atan2(nrm[1] * side, nrm[0] * side) + jx * 0.35,
            scale: [sx, sy, 0.85 + ((n % 4) * 0.08)],
            width: 1.2,
            depth: 1.2,
          })
          if (spec.prototypeKey === 'lantern') lanternBudget.left -= 1
          if (out.length >= 620) return
        }
      }
    }

    const lanternBudget = { left: 90 }
    for (const pass of ['props', 'lanterns'] as const) {
      for (const edge of ranked) {
        if (pass === 'props' && out.length >= 520) break
        if (edge.polyline.length < 2) continue
        const mid = edge.polyline[Math.floor(edge.polyline.length / 2)]!
        const district = edge.district ?? districtAt(mid)
        const story = edge.story ?? storyForEdge(district, edge.kind)
        const specs = decorForStory(district, story).filter((spec) =>
          pass === 'lanterns' ? spec.prototypeKey === 'lantern' : spec.prototypeKey !== 'lantern',
        )
        for (const spec of specs) {
          placeSpec(edge, spec, lanternBudget)
          if (pass === 'props' && out.length >= 520) break
          if (out.length >= 620) {
            return { placements: { placements: out, role: 'derived', lineage: { source: 'local-streets', via: ['street-story'] } } }
          }
        }
      }
    }

    return { placements: { placements: out, role: 'derived', lineage: { source: 'local-streets', via: ['street-story'] } } }
  },
})
