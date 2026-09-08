import { defineGenerator } from '@forgeax/project-generator'
import { fabricOf } from './lib/fabric.generator-lib.ts'
import {
  asPoint,
  centroidOf,
  dist,
  distToPolyline,
  hashSeed,
  pointInPolygon,
  rng,
  sampleGridHeight,
  type Point,
} from './lib/geom.generator-lib.ts'

type Parcel = { key: string; district: string; polygon: Point[]; frontageNormal: Point }

const LEGACY_MIX: Record<string, Array<[string, number]>> = {
  harbor: [['warehouse', 0.35], ['row-house', 0.4], ['mid-rise', 0.25]],
  civic: [['civic', 0.45], ['mid-rise', 0.35], ['town-hall', 0.2]],
  market: [['high-rise', 0.25], ['mid-rise', 0.45], ['shop-house', 0.3]],
  residential: [['row-house', 0.6], ['shop-house', 0.25], ['mid-rise', 0.15]],
  urban: [['high-rise', 0.2], ['mid-rise', 0.4], ['shop-house', 0.4]],
  'urban-west': [['high-rise', 0.25], ['mid-rise', 0.4], ['shop-house', 0.35]],
  'urban-east': [['high-rise', 0.25], ['mid-rise', 0.4], ['shop-house', 0.35]],
  suburb: [['cottage', 0.75], ['row-house', 0.25]],
  'suburb-west': [['cottage', 0.8], ['row-house', 0.2]],
  'suburb-east': [['cottage', 0.8], ['row-house', 0.2]],
}

function pickFromWeights(table: Array<[string, number]>, random: () => number): string {
  let cursor = random()
  for (const [key, weight] of table) {
    cursor -= weight
    if (cursor <= 0) return key
  }
  return table[table.length - 1]![0]
}

function pickPrototype(district: string, random: () => number, enriched: boolean): string {
  if (!enriched) return pickFromWeights(LEGACY_MIX[district] ?? LEGACY_MIX.residential!, random)
  const family = fabricOf(district).buildingFamily
  if (district.startsWith('urban') || district === 'market') {
    const weights: Array<[string, number]> = [
      ['high-rise', 0.42],
      ['mid-rise', 0.32],
      ['shop-house', 0.18],
      ['row-house', 0.08],
    ]
    return pickFromWeights(weights, random)
  }
  if (district === 'civic') {
    const weights: Array<[string, number]> = [
      ['civic', 0.35],
      ['mid-rise', 0.35],
      ['shop-house', 0.2],
      ['row-house', 0.1],
    ]
    return pickFromWeights(weights, random)
  }
  if (district === 'harbor') {
    const weights: Array<[string, number]> = [
      ['warehouse', 0.4],
      ['pier', 0.2],
      ['row-house', 0.25],
      ['shop-house', 0.15],
    ]
    return pickFromWeights(weights, random)
  }
  const weights: Array<[string, number]> = family.map((key, index) => [
    key,
    index === 0 ? 0.6 : 0.4 / Math.max(1, family.length - 1),
  ])
  return pickFromWeights(weights, random)
}

function sizeFor(proto: string): { width: number; depth: number } {
  if (proto === 'high-rise') return { width: 15, depth: 14 }
  if (proto === 'lighthouse' || proto === 'clock-tower') return { width: 9, depth: 9 }
  if (proto === 'town-hall' || proto === 'civic') return { width: 22, depth: 16 }
  if (proto === 'chapel') return { width: 14, depth: 18 }
  if (proto === 'warehouse') return { width: 18, depth: 12 }
  if (proto === 'mid-rise') return { width: 13, depth: 11 }
  if (proto === 'shop-house') return { width: 8.5, depth: 10 }
  if (proto === 'pier') return { width: 14, depth: 16 }
  if (proto === 'cottage') return { width: 8.5, depth: 9.5 }
  if (proto === 'row-house') return { width: 10, depth: 9 }
  return { width: 10, depth: 8 }
}

export const buildingLayout = defineGenerator({
  id: 'building-layout',
  version: '2.1.0',
  description: 'Functional zone building layout with downtown high-rise skyline, civic monuments, and anti-clipping foundation elevation.',
  inputs: {
    parcels: { type: 'Any', runtimeType: 'parcel-set' },
    density: { type: 'NumberValue', defaultValue: 0.7, control: true },
    seed: { type: 'NumberValue', defaultValue: 11, control: true },
    heightGrid: { type: 'Any', runtimeType: 'height-grid' },
    cellSize: { type: 'NumberValue', defaultValue: 8 },
    enriched: { type: 'NumberValue', defaultValue: 0 },
    districts: { type: 'Any', runtimeType: 'region-set' },
    network: { type: 'Any', runtimeType: 'road-network' },
    reserved: { type: 'Any', runtimeType: 'region-set' },
  },
  outputs: {
    placements: { type: 'Any', runtimeType: 'placement-set' },
  },
  run(_ctx, args: {
    parcels: { parcels: Parcel[] }
    density: number
    seed: number
    heightGrid?: number[][]
    cellSize?: number
    enriched?: number
    districts?: { regions?: Array<{ key: string; polygon: Point[]; attributes?: { hub?: Point } }> }
    network?: { edges?: Array<{ polyline: Point[]; width: number }> }
    reserved?: { regions?: Array<{ polygon: Point[] }> }
  }) {
    const random = rng(hashSeed(Number(args.seed) || 11, 71))
    const density = Math.min(1, Math.max(0.55, Number(args.density) || 0.92))
    const enriched = Number(args.enriched) > 0
    const cellSize = Number(args.cellSize) || 8
    const heightGrid = args.heightGrid
    const heightAt = (pt: Point) => (heightGrid ? sampleGridHeight(heightGrid, cellSize, pt) : 0)
    const parcels = args.parcels.parcels ?? []
    const regions = args.districts?.regions ?? []
    const roads = args.network?.edges ?? []
    const reserved = args.reserved?.regions ?? []
    const inReserved = (pt: Point): boolean => reserved.some((region) => pointInPolygon(pt, region.polygon))

    const onCarriageway = (pt: Point, pad: number): boolean =>
      roads.some((edge) => edge.polyline.length >= 2 && distToPolyline(pt, edge.polyline) < edge.width / 2 + pad)

    const baseHeightFor = (x: number, y: number, w: number, d: number, yaw = 0): number => {
      if (!heightGrid) return 0
      const cos = Math.cos(yaw)
      const sin = Math.sin(yaw)
      const hw = w * 0.42
      const hd = d * 0.42
      const cZ = heightAt([x, y])
      const z1 = heightAt([x + hw * cos - hd * sin, y + hw * sin + hd * cos])
      const z2 = heightAt([x - hw * cos - hd * sin, y - hw * sin + hd * cos])
      const z3 = heightAt([x + hw * cos + hd * sin, y + hw * sin - hd * cos])
      const z4 = heightAt([x - hw * cos + hd * sin, y - hw * sin - hd * cos])
      return Math.max(cZ, z1, z2, z3, z4) + 0.12
    }

    const hubOf = (district: string): Point | null => {
      const region = regions.find((item) => item.key === district)
      if (!region) return null
      return asPoint(region.attributes?.hub) ?? centroidOf(region.polygon)
    }

    const landmarkAt = new Map<string, Point>()
    if (enriched) {
      for (const region of regions) {
        const hub = asPoint(region.attributes?.hub) ?? centroidOf(region.polygon)
        landmarkAt.set(region.key, hub)
      }
      for (const parcel of parcels) {
        if (landmarkAt.has(parcel.district)) continue
        landmarkAt.set(parcel.district, centroidOf(parcel.polygon))
      }
    }

    const landmarkPlacements = [...landmarkAt.entries()].map(([district, hub]) => {
      const fabric = fabricOf(district)
      const size = sizeFor(fabric.landmarkKey)
      const yaw = (random() - 0.5) * 0.12
      const sx = 0.96 + random() * 0.08
      const sy = 0.96 + random() * 0.08
      const sz = 0.98 + random() * 0.06
      const z = baseHeightFor(hub[0], hub[1], size.width * sx, size.depth * sy, yaw)
      return {
        key: `landmark-${district}`,
        prototypeKey: fabric.landmarkKey,
        x: hub[0],
        y: hub[1],
        z,
        rotation: yaw,
        scale: [sx, sy, sz] as const,
        width: size.width * sx,
        depth: size.depth * sy,
        source: district,
        role: 'derived' as const,
        lineage: { source: 'districts', via: ['hub', fabric.purpose, fabric.story] },
      }
    })

    const placements = parcels.flatMap((parcel) => {
      const [x, y] = centroidOf(parcel.polygon)
      const fabric = fabricOf(parcel.district)
      const localDensity = enriched ? fabric.density : density
      const facing = Math.atan2(parcel.frontageNormal[1], parcel.frontageNormal[0])
      const hub = hubOf(parcel.district) ?? landmarkAt.get(parcel.district)
      if (hub && dist([x, y], hub) < 11) return []
      if (inReserved([x, y])) return []
      if (onCarriageway([x, y], 2.8)) return []
      if (random() > Math.min(1, localDensity + 0.12)) return []

      const prototypeKey = pickPrototype(parcel.district, random, enriched)
      const size = sizeFor(prototypeKey)
      const yaw = facing + (random() - 0.5) * 0.1
      const sx = 0.95 + random() * 0.1
      const sy = 0.95 + random() * 0.1
      const sz = 0.96 + random() * 0.08
      const z = baseHeightFor(x, y, size.width * sx, size.depth * sy, yaw)

      return [{
        key: `bldg-${parcel.key}`,
        prototypeKey,
        x,
        y,
        z,
        rotation: yaw,
        scale: [sx, sy, sz] as const,
        width: size.width * sx,
        depth: size.depth * sy,
        source: parcel.key,
        role: 'derived' as const,
        lineage: { source: 'parcels', via: ['frontage', parcel.district, fabric.purpose] },
      }]
    })

    const downtown: typeof placements = []
    if (enriched) {
      for (const region of regions) {
        if (!region.key.startsWith('urban') && region.key !== 'civic') continue
        const hub = asPoint(region.attributes?.hub) ?? centroidOf(region.polygon)
        const ring = region.key === 'civic' ? [18, 32] : [16, 28, 42]
        let k = 0
        for (const radius of ring) {
          const count = radius < 24 ? 6 : 8
          for (let i = 0; i < count; i++) {
            const ang = (i / count) * Math.PI * 2 + (region.key === 'civic' ? 0.2 : 0)
            const x = hub[0] + Math.cos(ang) * radius
            const y = hub[1] + Math.sin(ang) * radius
            if (!pointInPolygon([x, y], region.polygon)) continue
            if (inReserved([x, y])) continue
            if (onCarriageway([x, y], 3.2)) continue
            const proto = region.key === 'civic'
              ? (i % 3 === 0 ? 'civic' : 'mid-rise')
              : (i % 4 === 0 ? 'mid-rise' : 'high-rise')
            const size = sizeFor(proto)
            const yaw = ang + Math.PI / 2
            downtown.push({
              key: `cbd-${region.key}-${k++}`,
              prototypeKey: proto,
              x,
              y,
              z: baseHeightFor(x, y, size.width, size.depth, yaw),
              rotation: yaw,
              scale: [1, 1, 1.05 + (i % 3) * 0.08] as const,
              width: size.width,
              depth: size.depth,
              source: region.key,
              role: 'derived' as const,
              lineage: { source: 'districts', via: ['cbd', region.key] },
            })
          }
        }
      }
    }

    const unique = [...landmarkPlacements, ...downtown]
    for (const item of placements) {
      const tight = item.prototypeKey === 'high-rise' || item.prototypeKey === 'mid-rise'
      const gap = Math.max(item.width, item.depth, 7) * (tight ? 0.38 : 0.46) + (tight ? 1.4 : 2.0)
      if (
        unique.some(
          (other) =>
            dist([item.x, item.y], [other.x, other.y]) <
            Math.max(gap, Math.max(other.width ?? 7, other.depth ?? 7) * 0.36 + 1.6),
        )
      )
        continue
      unique.push(item)
      if (unique.length >= 900) break
    }

    return { placements: { placements: unique, role: 'derived', lineage: { source: 'parcels', via: ['frontage'] } } }
  },
})
