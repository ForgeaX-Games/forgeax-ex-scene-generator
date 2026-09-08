import { defineGenerator } from '@forgeax/project-generator'
import {
  aabbOf,
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

type Region = { key: string; polygon: Point[]; attributes?: { hub?: Point } }
type Parcel = { key: string; district: string; polygon: Point[]; frontageNormal: Point }
type Building = { x: number; y: number; width?: number; depth?: number; source?: string }
type RoadEdge = { polyline: Point[]; width: number }

type InfillSpec = {
  prototypeKey: string
  width: number
  depth: number
}

const INFILL: Record<string, InfillSpec[]> = {
  harbor: [
    { prototypeKey: 'harbor-service-yard', width: 9, depth: 7 },
    { prototypeKey: 'harbor-quay-set', width: 5, depth: 5 },
  ],
  civic: [
    { prototypeKey: 'civic-memorial-garden', width: 9, depth: 9 },
    { prototypeKey: 'civic-plaza-set', width: 5, depth: 5 },
  ],
  urban: [
    { prototypeKey: 'urban-courtyard', width: 8, depth: 7 },
    { prototypeKey: 'urban-stall-set', width: 5, depth: 5 },
  ],
  suburb: [
    { prototypeKey: 'suburb-orchard', width: 11, depth: 8 },
    { prototypeKey: 'suburb-garden-set', width: 6, depth: 5 },
  ],
}

function familyFor(district: string): InfillSpec[] {
  if (district === 'harbor') return INFILL.harbor!
  if (district === 'civic') return INFILL.civic!
  if (district.startsWith('urban') || district === 'market') return INFILL.urban!
  return INFILL.suburb!
}

function budgetFor(district: string): number {
  if (district === 'harbor') return 28
  if (district === 'civic') return 24
  if (district.startsWith('urban')) return 42
  return 34
}

export const districtInfill = defineGenerator({
  id: 'district-infill',
  version: '1.0.0',
  description: 'District-specific service yards, memorial gardens, courtyards and orchards occupy safe urban voids.',
  inputs: {
    districts: { type: 'Any', runtimeType: 'region-set' },
    cityBoundary: { type: 'Any', runtimeType: 'point-list' },
    parcels: { type: 'Any', runtimeType: 'parcel-set' },
    buildings: { type: 'Any', runtimeType: 'placement-set' },
    network: { type: 'Any', runtimeType: 'road-network' },
    heightGrid: { type: 'Any', runtimeType: 'height-grid' },
    cellSize: { type: 'NumberValue', defaultValue: 8 },
    seed: { type: 'NumberValue', defaultValue: 11, control: true },
    reserved: { type: 'Any', runtimeType: 'region-set' },
  },
  outputs: {
    placements: { type: 'Any', runtimeType: 'placement-set' },
  },
  run(_ctx, args: {
    districts?: { regions?: Region[] }
    cityBoundary?: Point[]
    parcels?: { parcels?: Parcel[] }
    buildings?: { placements?: Building[] }
    network?: { edges?: RoadEdge[] }
    heightGrid?: number[][]
    cellSize?: number
    seed: number
    reserved?: { regions?: Array<{ polygon: Point[] }> }
  }) {
    const regions = args.districts?.regions ?? []
    const parcels = args.parcels?.parcels ?? []
    const buildings = args.buildings?.placements ?? []
    const roads = args.network?.edges ?? []
    const heightGrid = args.heightGrid
    const cellSize = Number(args.cellSize) || 8
    const reserved = args.reserved?.regions ?? []
    const inReserved = (point: Point): boolean => reserved.some((region) => pointInPolygon(point, region.polygon))
    const random = rng(hashSeed(Number(args.seed) || 11, 149))
    const occupiedParcels = new Set(buildings.map((building) => building.source).filter(Boolean))
    const out: Array<{
      key: string
      prototypeKey: string
      x: number
      y: number
      z: number
      rotation: number
      scale: readonly [number, number, number]
      width: number
      depth: number
      source: string
      role: 'derived'
      lineage: { source: string; via: string[] }
    }> = []
    const districtCounts = new Map<string, number>()
    let serial = 0

    const heightAt = (point: Point): number =>
      heightGrid ? sampleGridHeight(heightGrid, cellSize, point) : 0

    const inside = (point: Point, polygon: Point[], width: number, depth: number, yaw: number): boolean => {
      const cos = Math.cos(yaw)
      const sin = Math.sin(yaw)
      const hw = width * 0.46
      const hd = depth * 0.46
      const corners: Point[] = [
        [point[0] + hw * cos - hd * sin, point[1] + hw * sin + hd * cos],
        [point[0] - hw * cos - hd * sin, point[1] - hw * sin + hd * cos],
        [point[0] + hw * cos + hd * sin, point[1] + hw * sin - hd * cos],
        [point[0] - hw * cos + hd * sin, point[1] - hw * sin - hd * cos],
      ]
      return corners.every((corner) => pointInPolygon(corner, polygon))
    }

    const roadClear = (point: Point, width: number, depth: number): boolean => {
      const radius = Math.max(width, depth) * 0.46
      return roads.every(
        (edge) =>
          edge.polyline.length < 2 ||
          distToPolyline(point, edge.polyline) > edge.width / 2 + radius + 1.4,
      )
    }

    const objectClear = (point: Point, width: number, depth: number): boolean => {
      const radius = Math.max(width, depth) * 0.44
      if (
        buildings.some((building) => {
          const other = Math.max(building.width ?? 7, building.depth ?? 7) * 0.42
          return dist(point, [building.x, building.y]) < radius + other + 1.8
        })
      )
        return false
      return !out.some((item) => {
        const other = Math.max(item.width, item.depth) * 0.44
        return dist(point, [item.x, item.y]) < radius + other + 3.2
      })
    }

    const place = (
      point: Point,
      region: Region,
      source: string,
      facing?: Point,
      preferredLarge = false,
      containment = region.polygon,
    ): boolean => {
      const count = districtCounts.get(region.key) ?? 0
      const transition = source.startsWith('transition-')
      if (count >= budgetFor(region.key) + (transition ? 12 : 0)) return false
      const family = familyFor(region.key)
      const large = preferredLarge || random() < (region.key.startsWith('suburb') ? 0.48 : 0.34)
      const spec = family[large ? 0 : 1]!
      const baseYaw = facing ? Math.atan2(facing[1], facing[0]) : random() * Math.PI
      const yaw = baseYaw + (random() - 0.5) * 0.18
      const sx = 0.9 + random() * 0.18
      const sy = 0.9 + random() * 0.18
      const width = spec.width * sx
      const depth = spec.depth * sy
      if (region.key === 'civic') return false
      if (inReserved(point)) return false
      if (!inside(point, containment, width, depth, yaw)) return false
      if (!roadClear(point, width, depth) || !objectClear(point, width, depth)) return false
      const hub = asPoint(region.attributes?.hub) ?? centroidOf(region.polygon)
      if (dist(point, hub) < (region.key === 'civic' ? 16 : 12)) return false
      const cos = Math.cos(yaw)
      const sin = Math.sin(yaw)
      const hw = width * 0.42
      const hd = depth * 0.42
      const z = Math.max(
        heightAt(point),
        heightAt([point[0] + hw * cos - hd * sin, point[1] + hw * sin + hd * cos]),
        heightAt([point[0] - hw * cos - hd * sin, point[1] - hw * sin + hd * cos]),
        heightAt([point[0] + hw * cos + hd * sin, point[1] + hw * sin - hd * cos]),
        heightAt([point[0] - hw * cos + hd * sin, point[1] - hw * sin - hd * cos]),
      ) + 0.12
      out.push({
        key: `infill-${region.key}-${serial++}`,
        prototypeKey: spec.prototypeKey,
        x: point[0],
        y: point[1],
        z,
        rotation: yaw,
        scale: [sx, sy, 0.94 + random() * 0.12],
        width,
        depth,
        source,
        role: 'derived',
        lineage: { source: 'districts', via: ['safe-void', region.key, spec.prototypeKey] },
      })
      districtCounts.set(region.key, count + 1)
      return true
    }

    for (const region of regions) {
      if (region.key === 'civic') continue
      const districtParcels = parcels.filter(
        (parcel) => parcel.district === region.key && !occupiedParcels.has(parcel.key),
      )
      for (let i = 0; i < districtParcels.length; i++) {
        const parcel = districtParcels[i]!
        if (i % 2 === 1 && random() < 0.55) continue
        place(
          centroidOf(parcel.polygon),
          region,
          parcel.key,
          parcel.frontageNormal,
          i % 5 === 0,
        )
      }

      const box = aabbOf(region.polygon, -6)
      const spacing = region.key.startsWith('suburb') ? 22 : region.key === 'harbor' ? 18 : 20
      let row = 0
      for (let y = box.minY + spacing * 0.5; y <= box.maxY; y += spacing) {
        let col = 0
        for (let x = box.minX + spacing * 0.5; x <= box.maxX; x += spacing) {
          if ((districtCounts.get(region.key) ?? 0) >= budgetFor(region.key)) break
          const jitter = spacing * 0.22
          const point: Point = [
            x + (random() - 0.5) * jitter + (row % 2) * spacing * 0.24,
            y + (random() - 0.5) * jitter,
          ]
          if ((row + col) % 3 !== 0 && random() < 0.38) {
            col += 1
            continue
          }
          place(point, region, `open-${region.key}-${row}-${col}`, undefined, (row + col) % 7 === 0)
          col += 1
        }
        row += 1
      }
    }

    const cityBoundary = args.cityBoundary ?? []
    if (cityBoundary.length >= 3 && regions.length > 0) {
      const centers = regions.map((region) => ({
        region,
        center: asPoint(region.attributes?.hub) ?? centroidOf(region.polygon),
      }))
      const box = aabbOf(cityBoundary, -10)
      const spacing = 26
      let transitionCount = 0
      let row = 0
      for (let y = box.minY + spacing * 0.5; y <= box.maxY && transitionCount < 42; y += spacing) {
        let col = 0
        for (let x = box.minX + spacing * 0.5; x <= box.maxX && transitionCount < 42; x += spacing) {
          const point: Point = [
            x + (row % 2) * spacing * 0.28 + (random() - 0.5) * 5,
            y + (random() - 0.5) * 5,
          ]
          col += 1
          if (!pointInPolygon(point, cityBoundary)) continue
          if (regions.some((region) => pointInPolygon(point, region.polygon))) continue
          if (heightAt(point) < 0.6) continue
          let nearest = centers[0]!
          for (const candidate of centers) {
            if (dist(point, candidate.center) < dist(point, nearest.center)) nearest = candidate
          }
          if (dist(point, nearest.center) > 125) continue
          if ((row + col) % 2 === 1 && random() < 0.45) continue
          if (
            place(
              point,
              nearest.region,
              `transition-${row}-${col}`,
              undefined,
              true,
              cityBoundary,
            )
          )
            transitionCount += 1
        }
        row += 1
      }
    }

    return {
      placements: {
        placements: out,
        role: 'derived',
        lineage: { source: 'districts', via: ['safe-void-infill'] },
      },
    }
  },
})
