/**
 * Harbor-town districts from landform, not leftover (t,u) packing.
 *
 * Settlement morphology (metres, from the shore and the river):
 *   sea → harbor at the mouth → coastal urban fabric along the quay
 *        → civic corridor along the creek → hinterland suburb inland.
 *
 * Suburb is the inland expansion belt, not a ring around the city and
 * not the leftover of a bounding box. Waterfront districts start at the
 * water and continue into the city along the crenulated shore.
 */
import { defineGenerator } from '@forgeax/project-generator'
import {
  aabbOf,
  alongPolyline,
  asPoint,
  asPointList,
  buildOccupancyPatchMesh,
  centroidOf,
  closeRing,
  closestSignedDistance,
  dist,
  distToPolyline,
  lerp,
  nearestAlongT,
  occupancyRing,
  offsetToward,
  pointInPolygon,
  polygonArea,
  simplifyPolyline,
  type Point,
} from './lib/geom.generator-lib.ts'

type Harbor = { center?: Point; radius?: number; mouth?: Point }
type DistrictKey = (typeof SPECS)[number]['key']

const SPECS = [
  { key: 'harbor', band: 'urban', density: 0.88, waterfront: true, onRiver: true, purpose: 'working-waterfront' },
  { key: 'civic', band: 'urban', density: 0.82, waterfront: false, onRiver: true, purpose: 'river-spine' },
  { key: 'urban-west', band: 'urban', density: 0.66, waterfront: true, onRiver: false, purpose: 'coastal-fabric' },
  { key: 'urban-east', band: 'urban', density: 0.66, waterfront: true, onRiver: false, purpose: 'coastal-fabric' },
  { key: 'suburb-west', band: 'suburb', density: 0.36, waterfront: false, onRiver: false, purpose: 'hinterland' },
  { key: 'suburb-east', band: 'suburb', density: 0.36, waterfront: false, onRiver: false, purpose: 'hinterland' },
] as const

/** First-principles extents in metres, measured from shore / creek / mouth. */
const PLAN = {
  harborRadius: 150,
  harborDepth: 150,
  urbanDepth: 280,
  civicHalfWidth: 88,
  civicInlandMin: 72,
  civicInlandMax: 520,
  quayReach: 48,
} as const

const COLORS = {
  harbor: [0.82, 0.56, 0.36],
  civic: [0.80, 0.72, 0.40],
  'urban-west': [0.74, 0.66, 0.46],
  'urban-east': [0.74, 0.66, 0.46],
  'suburb-west': [0.50, 0.64, 0.42],
  'suburb-east': [0.50, 0.64, 0.42],
} as const

export const coastalDistricts = defineGenerator({
  id: 'coastal-districts',
  version: '2.0.0',
  description: 'Harbor-town districts from shore distance, river corridor and mouth basin.',
  inputs: {
    cityBoundary: { type: 'Any', runtimeType: 'point2d-list', access: 'list' },
    shoreline: { type: 'Any', runtimeType: 'point2d-list', access: 'list' },
    creek: { type: 'Any', runtimeType: 'point2d-list', access: 'list' },
    harbor: { type: 'Any', runtimeType: 'harbor' },
    heightGrid: { type: 'Grid' },
    cellSize: { type: 'NumberValue', defaultValue: 8 },
  },
  outputs: {
    districts: { type: 'Any', runtimeType: 'region-set' },
    hubs: { type: 'Any', runtimeType: 'point2d-list', access: 'list' },
    harborHub: { type: 'Any', runtimeType: 'point2d-list', access: 'list' },
    civicHub: { type: 'Any', runtimeType: 'point2d-list', access: 'list' },
    urbanWestHub: { type: 'Any', runtimeType: 'point2d-list', access: 'list' },
    urbanEastHub: { type: 'Any', runtimeType: 'point2d-list', access: 'list' },
    suburbWestHub: { type: 'Any', runtimeType: 'point2d-list', access: 'list' },
    suburbEastHub: { type: 'Any', runtimeType: 'point2d-list', access: 'list' },
    harborMesh: { type: 'Mesh' },
    civicMesh: { type: 'Mesh' },
    urbanWestMesh: { type: 'Mesh' },
    urbanEastMesh: { type: 'Mesh' },
    suburbWestMesh: { type: 'Mesh' },
    suburbEastMesh: { type: 'Mesh' },
  },
  run(_ctx, args: {
    cityBoundary: Point[]
    shoreline: Point[]
    creek: Point[]
    harbor: Harbor
    heightGrid?: number[][]
    cellSize?: number
  }) {
    const city = closeRing(asPointList(args.cityBoundary))
    const shore = asPointList(args.shoreline)
    const creek = asPointList(args.creek)
    const mid = centroidOf(city)
    const mouth = asPoint(args.harbor?.mouth) ?? creek[creek.length - 1] ?? mid
    const cell = Number(args.cellSize) || 8
    const ringCell = 20
    const patchCell = 16
    const grid = Array.isArray(args.heightGrid) ? args.heightGrid : []
    const model = harborTownModel(city, shore, creek, mouth)
    const box = aabbOf(city, PLAN.quayReach + ringCell * 2)
    const westT = model.t0 + (model.mouthT - model.t0) * 0.45
    const eastT = model.mouthT + (model.t1 - model.mouthT) * 0.55

    const occOf = (key: DistrictKey) => (point: Point) => model.classify(point) === key ? 1 : -1
    const seedHubs: Point[] = [
      pullInside(offsetToward(shore, model.mouthT, 50, mid), city, mouth),
      pullInside(creek.length >= 2 ? inlandAlong(creek, 170) : offsetToward(shore, model.mouthT, 170, mid), city, mid),
      pullInside(offsetToward(shore, westT, 90, mid), city, mid),
      pullInside(offsetToward(shore, eastT, 90, mid), city, mid),
      pullInside(offsetToward(shore, westT, 300, mid), city, mid),
      pullInside(offsetToward(shore, eastT, 300, mid), city, mid),
    ]
    const regions = SPECS.flatMap((spec, index) => {
      const occ = occOf(spec.key)
      const raw = occupancyRing(occ, box, ringCell)
      const polygon = simplifyPolyline(raw.length >= 4 ? raw : fallbackRing(seedHubs[index] ?? mid), 10)
      const hub = pullInside(centroidOf(polygon), city, seedHubs[index] ?? mid)
      if (polygon.length < 4) return []
      return [{
        key: spec.key,
        kind: spec.key,
        polygon,
        attributes: {
          hub,
          band: spec.band,
          density: spec.density,
          waterfront: spec.waterfront,
          onRiver: spec.onRiver,
          purpose: spec.purpose,
          alongShore: distToPolyline(hub, shore),
          alongRiver: creek.length >= 2 ? distToPolyline(hub, creek) : null,
          toHarbor: dist(hub, mouth),
          area: polygonArea(polygon),
        },
        role: 'derived' as const,
        lineage: { source: 'cityBoundary', via: ['shoreline', 'creek', 'harbor'] },
      }]
    })
    const hubs = regions.map((region) => region.attributes.hub as Point)

    const patch = (key: DistrictKey) =>
      buildOccupancyPatchMesh(occOf(key), box, grid, patchCell, {
        lift: 0.04,
        color: COLORS[key],
        role: 'houses',
        heightCell: cell,
      })

    return {
      districts: { regions, role: 'derived', lineage: { source: 'cityBoundary', via: ['shoreline', 'creek', 'harbor'] } },
      hubs,
      harborHub: hubs[0] ? [hubs[0]] : [],
      civicHub: hubs[1] ? [hubs[1]] : [],
      urbanWestHub: hubs[2] ? [hubs[2]] : [],
      urbanEastHub: hubs[3] ? [hubs[3]] : [],
      suburbWestHub: hubs[4] ? [hubs[4]] : [],
      suburbEastHub: hubs[5] ? [hubs[5]] : [],
      harborMesh: patch('harbor'),
      civicMesh: patch('civic'),
      urbanWestMesh: patch('urban-west'),
      urbanEastMesh: patch('urban-east'),
      suburbWestMesh: patch('suburb-west'),
      suburbEastMesh: patch('suburb-east'),
    }
  },
})

function harborTownModel(
  city: readonly Point[],
  shore: readonly Point[],
  creek: readonly Point[],
  mouth: Point,
) {
  const mid = centroidOf(city)
  const mouthT = nearestAlongT(shore, mouth)
  let t0 = 1
  let t1 = 0
  for (const point of city) {
    const t = nearestAlongT(shore, point)
    if (t < t0) t0 = t
    if (t > t1) t1 = t
  }
  const landSign = shore.length >= 2 ? Math.sign(closestSignedDistance(mid, shore)) || 1 : 1

  const onLand = (point: Point): boolean => {
    if (shore.length < 2) return true
    return closestSignedDistance(point, shore) * landSign >= -2
  }

  const inSettlement = (point: Point): boolean => {
    if (pointInPolygon(point, city)) return true
    if (!onLand(point)) return false
    const shoreD = distToPolyline(point, shore)
    if (shoreD > PLAN.quayReach) return false
    const t = nearestAlongT(shore, point)
    return t >= t0 - 0.012 && t <= t1 + 0.012
  }

  const westOfRiver = (point: Point): boolean => {
    if (creek.length >= 2) return closestSignedDistance(point, creek) < 0
    return nearestAlongT(shore, point) < mouthT
  }

  const classify = (point: Point): DistrictKey | null => {
    if (!inSettlement(point)) return null
    const shoreD = distToPolyline(point, shore)
    const riverD = creek.length >= 2 ? distToPolyline(point, creek) : Infinity
    const west = westOfRiver(point)
    if (dist(point, mouth) < PLAN.harborRadius && shoreD < PLAN.harborDepth) return 'harbor'
    if (
      riverD < PLAN.civicHalfWidth
      && shoreD > PLAN.civicInlandMin
      && shoreD < PLAN.civicInlandMax
    ) return 'civic'
    if (shoreD < PLAN.urbanDepth) return west ? 'urban-west' : 'urban-east'
    return west ? 'suburb-west' : 'suburb-east'
  }

  return { mouthT, t0, t1, classify }
}

function inlandAlong(line: readonly Point[], metres: number): Point {
  if (line.length === 0) return [0, 0]
  if (line.length === 1) return line[0]!
  let acc = 0
  let i = line.length - 1
  while (i > 0 && acc < metres) {
    acc += dist(line[i]!, line[i - 1]!)
    i -= 1
  }
  if (acc >= metres * 0.4) return line[i]!
  return alongPolyline(line, 0.62)
}

function pullInside(point: Point, city: readonly Point[], fallback: Point): Point {
  let q = point
  for (let i = 0; i < 8; i++) {
    if (pointInPolygon(q, city)) return q
    q = lerp(q, fallback, 0.28)
  }
  return fallback
}

function fallbackRing(hub: Point): Point[] {
  const s = 24
  return closeRing([
    [hub[0] - s, hub[1] - s],
    [hub[0] + s, hub[1] - s],
    [hub[0] + s, hub[1] + s],
    [hub[0] - s, hub[1] + s],
  ])
}
