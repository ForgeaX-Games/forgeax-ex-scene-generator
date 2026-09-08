import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { compileGeneratorFile, runGeneratorSandbox, writeGeneratorArtifact } from '@forgeax/project-generator'
import { dist, distToPolyline, pointInPolygon, seaPolygonFromCoast, signedCoastDistance, centroidOf, type Point } from '../../examples/scene-script/coastal-small-city/generators/lib/geom.generator-lib.ts'

const here = dirname(fileURLToPath(import.meta.url))
const exampleRoot = join(here, '../../examples/scene-script/coastal-small-city')
const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function runExample(file: string, exportName: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const compiled = await compileGeneratorFile(exampleRoot, file)
  expect(compiled.diagnostics.filter((item) => item.severity === 'error')).toEqual([])
  const scratch = await mkdtemp(join(tmpdir(), 'coastal-run-'))
  dirs.push(scratch)
  await writeGeneratorArtifact(scratch, compiled.artifacts[0]!)
  const result = await runGeneratorSandbox({
    bundlePath: join(scratch, 'state', 'generators', compiled.artifacts[0]!.definitionId, 'bundle.js'),
    exportName,
    args,
    seed: Number(args.seed ?? 11),
  })
  expect(result.ok).toBe(true)
  return result.value as Record<string, unknown>
}

describe('Coastal landform site', () => {
  const coastline: Point[] = [
    [0, 1720], [140, 1648], [300, 1764], [460, 1610], [620, 1788],
    [780, 1564], [960, 1708], [1120, 1580], [1280, 1744], [1460, 1608],
    [1640, 1696], [1820, 1572], [2000, 1660],
  ]

  it('builds a natural terrace and circles a city site from the heightfield', async () => {
    const field = await runExample('generators/coastal-terrain.generator.ts', 'coastalTerrain', {
      coastline,
      seaLevel: 0,
      seed: 11,
      width: 2000,
      height: 2000,
      cellSize: 8,
    }) as {
      heightGrid: number[][]
      cityBoundary: Point[]
      creek: Point[]
      citySite: { origin: Point; width: number; height: number; elevation: number; polygon: Point[]; harbor?: { center: Point; radius: number } }
      shoreline: Point[]
      harbor: { center: Point; radius: number; mouth: Point }
    }

    expect(field.cityBoundary.length).toBeGreaterThan(16)
    expect(field.creek.length).toBeGreaterThanOrEqual(6)
    expect(field.citySite.width).toBeGreaterThan(700)
    expect(field.citySite.height).toBeGreaterThan(220)
    expect(field.citySite.elevation).toBeGreaterThan(2)
    expect(field.citySite.elevation).toBeLessThan(18)

    const mouth = field.creek[field.creek.length - 1]!
    const source = field.creek[0]!
    expect(source[1]).toBeLessThan(mouth[1])
    expect(dist(mouth, field.shoreline[nearestCoast(mouth, field.shoreline)])).toBeLessThan(8)

    const site = field.citySite.polygon
    const center = site.reduce((acc, p) => [acc[0] + p[0] / site.length, acc[1] + p[1] / site.length] as Point, [0, 0] as Point)
    expect(pointInPolygon(center, site)).toBe(true)
    expect(center[1]).toBeLessThan(1680)
    expect(field.creek.some((p) => pointInPolygon(p, site))).toBe(true)
    expect(site.some((p) => dist(p, coastline[nearestCoast(p, coastline)]) < 120)).toBe(true)
    expect(site.some((p) => distToPolyline(p, field.shoreline) < 56)).toBe(true)
    expect(isSimplePolygon(site)).toBe(true)
    let transectHits = 0
    let transectInside = 0
    for (let t = 0.18; t <= 0.72; t += 0.08) {
      const p: Point = [mouth[0] + (center[0] - mouth[0]) * t, mouth[1] + (center[1] - mouth[1]) * t]
      transectHits += 1
      if (pointInPolygon(p, site)) transectInside += 1
    }
    expect(transectHits).toBeGreaterThan(4)
    expect(transectInside / transectHits).toBeGreaterThan(0.8)

    const cell = 8
    const samples: number[] = []
    for (let u = 0.2; u <= 0.8; u += 0.15) {
      for (let v = 0.2; v <= 0.8; v += 0.15) {
        const px = field.citySite.origin[0] + field.citySite.width * u
        const py = field.citySite.origin[1] + field.citySite.height * v
        if (!pointInPolygon([px, py], site)) continue
        if (distToPolyline([px, py], field.creek) < 28) continue
        if (dist([px, py], field.harbor.mouth) < 56) continue
        if (distToPolyline([px, py], field.shoreline) > 180) continue
        const col = Math.max(0, Math.min(field.heightGrid[0]!.length - 1, Math.floor(px / cell)))
        const row = Math.max(0, Math.min(field.heightGrid.length - 1, Math.floor(py / cell)))
        samples.push(field.heightGrid[row]![col]! * cell)
      }
    }
    expect(samples.length).toBeGreaterThanOrEqual(2)
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length
    expect(samples.every((z) => Math.abs(z - mean) < 8)).toBe(true)

    const hx = Math.max(0, Math.min(field.heightGrid[0]!.length - 1, Math.floor(field.harbor.mouth[0] / cell)))
    const hy = Math.max(0, Math.min(field.heightGrid.length - 1, Math.floor(field.harbor.mouth[1] / cell)))
    expect(field.heightGrid[hy]![hx]! * cell).toBeLessThan(1.5)

    const sea = field.heightGrid[Math.floor(field.heightGrid.length * 0.92)]![Math.floor(field.heightGrid[0]!.length * 0.5)]! * cell
    const hill = field.heightGrid[8]![Math.floor(field.heightGrid[0]!.length * 0.5)]! * cell
    expect(sea).toBeLessThan(0.5)
    expect(hill).toBeGreaterThan(field.citySite.elevation + 4)

    expect(field.shoreline.length).toBeGreaterThan(80)
    const controlSea = seaPolygonFromCoast(coastline, 2000, 2000, [1000, 80])
    expect(pointInPolygon([1000, 1900], controlSea)).toBe(true)
    expect(pointInPolygon([1850, 1880], controlSea)).toBe(true)
    expect(pointInPolygon([1000, 200], controlSea)).toBe(false)
    let offshoreMax = -Infinity
    for (let y = 0; y < field.heightGrid.length; y += 2) {
      for (let x = 0; x < field.heightGrid[0]!.length; x += 2) {
        const p: Point = [(x + 0.5) * cell, (y + 0.5) * cell]
        if (signedCoastDistance(p, coastline, controlSea) >= -80) continue
        offshoreMax = Math.max(offshoreMax, field.heightGrid[y]![x]! * cell)
      }
    }
    expect(offshoreMax).toBeLessThan(0.6)

    const plan = await runExample('generators/coastal-districts.generator.ts', 'coastalDistricts', {
      cityBoundary: field.cityBoundary,
      shoreline: field.shoreline,
      creek: field.creek,
      harbor: field.harbor,
      heightGrid: field.heightGrid,
      cellSize: 8,
    }) as {
      districts: { regions: Array<{
        key: string
        polygon: Point[]
        attributes?: { band?: string; density?: number; hub?: Point; waterfront?: boolean; onRiver?: boolean; toHarbor?: number; purpose?: string }
      }> }
      hubs: Point[]
    }
    const regions = plan.districts.regions
    const keys = regions.map((region) => region.key)
    expect(keys).toEqual(expect.arrayContaining(['harbor', 'civic', 'urban-west', 'urban-east', 'suburb-west', 'suburb-east']))
    expect(regions.length).toBe(6)
    expect(plan.hubs.length).toBe(6)
    for (let i = 0; i < plan.hubs.length; i++) {
      for (let j = i + 1; j < plan.hubs.length; j++) {
        expect(dist(plan.hubs[i]!, plan.hubs[j]!)).toBeGreaterThan(36)
      }
    }

    const byKey = Object.fromEntries(regions.map((region) => [region.key, region]))
    const harbor = byKey.harbor!
    const civic = byKey.civic!
    const urbanWest = byKey['urban-west']!
    const suburbWest = byKey['suburb-west']!
    const suburbEast = byKey['suburb-east']!
    expect(pointInPolygon(centroidOf(harbor.polygon), site)).toBe(true)
    expect(pointInPolygon(centroidOf(suburbWest.polygon), site)).toBe(true)
    expect(pointInPolygon(centroidOf(suburbEast.polygon), site)).toBe(true)
    expect(harbor.attributes?.band).toBe('urban')
    expect(urbanWest.attributes?.band).toBe('urban')
    expect(suburbWest.attributes?.band).toBe('suburb')
    expect(suburbEast.attributes?.band).toBe('suburb')
    expect(harbor.attributes?.density ?? 0).toBeGreaterThan(suburbWest.attributes?.density ?? 1)
    expect(polygonArea(harbor.polygon)).toBeLessThan(polygonArea(suburbWest.polygon))
    expect(polygonArea(harbor.polygon)).toBeLessThan(
      polygonArea(suburbWest.polygon) + polygonArea(suburbEast.polygon),
    )
    expect(distToPolyline(centroidOf(harbor.polygon), field.shoreline)).toBeLessThan(
      distToPolyline(centroidOf(suburbWest.polygon), field.shoreline),
    )
    expect(distToPolyline(centroidOf(urbanWest.polygon), field.shoreline)).toBeLessThan(
      distToPolyline(centroidOf(suburbWest.polygon), field.shoreline),
    )
    expect(distToPolyline(centroidOf(civic.polygon), field.creek)).toBeLessThan(
      distToPolyline(centroidOf(suburbWest.polygon), field.creek) + 40,
    )
    expect(harbor.attributes?.toHarbor ?? 99).toBeLessThan(suburbWest.attributes?.toHarbor ?? 0)
    expect(harbor.attributes?.toHarbor ?? 99).toBeLessThan(suburbEast.attributes?.toHarbor ?? 0)
    expect(distToPolyline(centroidOf(suburbWest.polygon), field.shoreline)).toBeGreaterThan(150)
    expect(distToPolyline(centroidOf(suburbEast.polygon), field.shoreline)).toBeGreaterThan(150)
    expect(Math.min(...urbanWest.polygon.map((p) => distToPolyline(p, field.shoreline)))).toBeLessThan(24)
    expect(Math.min(...harbor.polygon.map((p) => distToPolyline(p, field.shoreline)))).toBeLessThan(24)
    expect(distToPolyline(plan.hubs[1]!, field.creek)).toBeLessThan(24)
    expect(distToPolyline(plan.hubs[0]!, field.shoreline)).toBeLessThan(
      distToPolyline(plan.hubs[4]!, field.shoreline),
    )
    expect(harbor.attributes?.purpose).toBe('working-waterfront')
    expect(suburbWest.attributes?.purpose).toBe('hinterland')
    const covered = regions.reduce((sum, region) => sum + polygonArea(region.polygon), 0)
    expect(covered).toBeGreaterThan(polygonArea(site) * 0.82)
    expect(covered).toBeLessThan(polygonArea(site) * 1.18)
    expect((plan as { harborMesh?: { indices?: number[] } }).harborMesh?.indices?.length ?? 0).toBeGreaterThan(24)
  }, 20_000)
})

function polygonArea(polygon: readonly Point[]): number {
  let area = 0
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!
    const b = polygon[(i + 1) % polygon.length]!
    area += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(area) * 0.5
}

function isSimplePolygon(polygon: readonly Point[]): boolean {
  const ring = polygon.length >= 2 && dist(polygon[0]!, polygon[polygon.length - 1]!) < 1e-6
    ? polygon.slice(0, -1)
    : [...polygon]
  if (ring.length < 4) return false
  const n = ring.length
  const hits = (a: Point, b: Point, c: Point, d: Point): boolean => {
    const cross = (p: Point, q: Point, r: Point): number =>
      (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    const d1 = cross(a, b, c)
    const d2 = cross(a, b, d)
    const d3 = cross(c, d, a)
    const d4 = cross(c, d, b)
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
    return false
  }
  for (let i = 0; i < n; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % n]!
    for (let j = i + 1; j < n; j++) {
      const prev = (i - 1 + n) % n
      const next = (i + 1) % n
      if (j === prev || j === i || j === next) continue
      if (j === 0 && i === n - 1) continue
      const c = ring[j]!
      const d = ring[(j + 1) % n]!
      if (hits(a, b, c, d)) return false
    }
  }
  return true
}

function nearestCoast(point: Point, coast: readonly Point[]): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < coast.length; i++) {
    const d = dist(point, coast[i]!)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

describe('Coastal small city relations', () => {
  const hubs: Point[] = [[90, 80], [260, 160], [400, 220], [480, 320]]
  const coastline: Point[] = [[40, 60], [180, 90], [340, 70], [520, 110]]

  it('keeps the road graph connected and buildings on frontage with tree clearance', async () => {
    const roads = await runExample('generators/road-network.generator.ts', 'roadNetwork', {
      hubs,
      coastline,
      arterial: coastline,
    }) as { network: { nodes: Array<{ key: string }>; edges: Array<{ from: string; to: string; kind?: string; polyline: Point[]; width: number }> } }
    const seen = new Set<string>([roads.network.nodes[0]?.key ?? 'hub-0'])
    let grew = true
    while (grew) {
      grew = false
      for (const edge of roads.network.edges) {
        if (seen.has(edge.from) && !seen.has(edge.to)) {
          seen.add(edge.to)
          grew = true
        }
        if (seen.has(edge.to) && !seen.has(edge.from)) {
          seen.add(edge.from)
          grew = true
        }
      }
    }
    expect(seen.size).toBe(roads.network.nodes.length)

    expect(roads.network.edges.length).toBeGreaterThanOrEqual(8)
    expect(new Set(roads.network.edges.map((edge) => edge.kind)).size).toBeGreaterThanOrEqual(2)

    const districts = await runExample('generators/district-plan.generator.ts', 'districtPlan', {
      hubs,
      cityBoundary: [[20, 20], [580, 20], [580, 430], [20, 430]],
      density: 0.72,
      width: 600,
      height: 450,
    }) as { districts: { regions: Array<{ key: string; polygon: Point[] }> } }
    expect(districts.districts.regions.length).toBeGreaterThanOrEqual(3)

    const lots = await runExample('generators/parcels.generator.ts', 'parcels', {
      network: roads.network,
      districts: districts.districts,
      setback: 6,
    }) as { parcels: { parcels: Array<{ key: string; polygon: Point[]; frontageNormal: Point }> } }
    expect(lots.parcels.parcels.length).toBeGreaterThan(80)

    const buildings = await runExample('generators/building-layout.generator.ts', 'buildingLayout', {
      parcels: lots.parcels,
      density: 0.72,
      seed: 11,
    }) as { placements: { placements: Array<{ x: number; y: number; rotation: number; prototypeKey: string }> } }
    expect(buildings.placements.placements.length).toBeGreaterThan(80)
    expect(buildings.placements.placements.length).toBeLessThanOrEqual(500)
    expect(new Set(buildings.placements.placements.map((item) => item.prototypeKey)).size).toBeGreaterThanOrEqual(3)
    for (const building of buildings.placements.placements.slice(0, 40)) {
      const host = lots.parcels.parcels.find((parcel) => pointInPolygon([building.x, building.y], parcel.polygon))
      expect(host).toBeTruthy()
    }

    const trees = await runExample('generators/street-trees.generator.ts', 'streetTrees', {
      network: roads.network,
      buildings: buildings.placements,
      clearance: 6,
    }) as { placements: { placements: Array<{ x: number; y: number }> } }
    expect(trees.placements.placements.length).toBeGreaterThan(80)
    expect(trees.placements.placements.length).toBeLessThanOrEqual(480)
    for (const tree of trees.placements.placements.slice(0, 40)) {
      expect(buildings.placements.placements.every((building) => dist([tree.x, tree.y], [building.x, building.y]) >= 6)).toBe(true)
    }

    const again = await runExample('generators/building-layout.generator.ts', 'buildingLayout', {
      parcels: lots.parcels,
      density: 0.72,
      seed: 11,
    })
    expect(again).toEqual(buildings)
  })

  it('generates fully-connected coastal road network with bridges and zone-adaptive mesh', async () => {
    const field = (await runExample('generators/coastal-terrain.generator.ts', 'coastalTerrain', {
      coastline,
      seaLevel: 0,
      seed: 11,
      width: 2000,
      height: 2000,
      cellSize: 8,
    })) as {
      cityBoundary: Point[]
      shoreline: Point[]
      creek: Point[]
      harbor: Point
      heightGrid: number[][]
    }

    const plan = (await runExample('generators/coastal-districts.generator.ts', 'coastalDistricts', {
      cityBoundary: field.cityBoundary,
      shoreline: field.shoreline,
      creek: field.creek,
      harbor: field.harbor,
      heightGrid: field.heightGrid,
      cellSize: 8,
    })) as {
      districts: { regions: Array<{ key: string; polygon: Point[] }> }
      hubs: Point[]
    }

    const roads = (await runExample('generators/road-network.generator.ts', 'roadNetwork', {
      hubs: plan.hubs,
      coastline: field.shoreline,
      creek: field.creek,
      arterial: field.shoreline,
      cityBoundary: field.cityBoundary,
      districts: plan.districts,
      heightGrid: field.heightGrid,
      cellSize: 8,
      seed: 11,
      width: 600,
      height: 450,
    })) as {
      network: {
        nodes: Array<{ key: string; x: number; y: number; kind: string }>
        edges: Array<{ key: string; from: string; to: string; kind: string; polyline: Point[]; width: number }>
        bridges: Array<{ key: string; span: number }>
      }
      mesh: {
        positions: number[]
        indices: number[]
        role: string
      }
    }

    expect(roads.network.nodes.length).toBeGreaterThan(16)
    expect(roads.network.edges.length).toBeGreaterThan(16)

    // Verify 100% connectivity
    const seen = new Set<string>([roads.network.nodes[0]!.key])
    let grew = true
    while (grew) {
      grew = false
      for (const edge of roads.network.edges) {
        if (seen.has(edge.from) && !seen.has(edge.to)) {
          seen.add(edge.to)
          grew = true
        }
        if (seen.has(edge.to) && !seen.has(edge.from)) {
          seen.add(edge.from)
          grew = true
        }
      }
    }
    expect(seen.size).toBe(roads.network.nodes.length)

    // Verify bridges exist when creek is present
    if (field.creek.length >= 4) {
      expect(roads.network.bridges.length).toBeGreaterThanOrEqual(1)
      expect(roads.network.edges.some((e) => e.kind === 'bridge')).toBe(true)
    }

    // Verify waterfront promenade exists
    expect(roads.network.edges.some((e) => e.kind === 'waterfront')).toBe(true)

    // Verify mesh validity
    expect(roads.mesh.positions.length).toBeGreaterThan(100)
    expect(roads.mesh.indices.length).toBeGreaterThan(100)
    expect(roads.mesh.role).toBe('road')
  })

  it('weaves story-tagged local lanes, district-style buildings and street furniture', async () => {
    const shore: Point[] = [
      [0, 1720], [140, 1648], [300, 1764], [460, 1610], [620, 1788],
      [780, 1564], [960, 1708], [1120, 1580], [1280, 1744], [1460, 1608],
      [1640, 1696], [1820, 1572], [2000, 1660],
    ]
    const field = (await runExample('generators/coastal-terrain.generator.ts', 'coastalTerrain', {
      coastline: shore,
      seaLevel: 0,
      seed: 11,
      width: 2000,
      height: 2000,
      cellSize: 8,
    })) as {
      cityBoundary: Point[]
      shoreline: Point[]
      creek: Point[]
      harbor: Point
      heightGrid: number[][]
    }

    const plan = (await runExample('generators/coastal-districts.generator.ts', 'coastalDistricts', {
      cityBoundary: field.cityBoundary,
      shoreline: field.shoreline,
      creek: field.creek,
      harbor: field.harbor,
      heightGrid: field.heightGrid,
      cellSize: 8,
    })) as {
      districts: { regions: Array<{ key: string; polygon: Point[]; attributes?: { hub?: Point; purpose?: string } }> }
      hubs: Point[]
    }

    const roads = (await runExample('generators/road-network.generator.ts', 'roadNetwork', {
      hubs: plan.hubs,
      coastline: field.shoreline,
      creek: field.creek,
      arterial: field.shoreline,
      cityBoundary: field.cityBoundary,
      districts: plan.districts,
      heightGrid: field.heightGrid,
      cellSize: 8,
      seed: 11,
    })) as { network: { edges: Array<{ kind: string; polyline: Point[]; story?: string; district?: string }> } }

    const locals = (await runExample('generators/local-streets.generator.ts', 'localStreets', {
      network: roads.network,
      districts: plan.districts,
      coastline: field.shoreline,
      creek: field.creek,
      cityBoundary: field.cityBoundary,
      heightGrid: field.heightGrid,
      cellSize: 8,
      seed: 11,
    })) as {
      network: { edges: Array<{ kind: string; polyline: Point[]; story?: string; district?: string; width: number }> }
      mesh: { indices: number[]; role: string }
      blocks: { blocks: Array<{ district: string; polygon: Point[]; area: number }> }
    }

    const localEdges = locals.network.edges.filter((edge) => edge.kind === 'local')
    expect(localEdges.length).toBeGreaterThan(8)
    expect(new Set(localEdges.map((edge) => edge.story).filter(Boolean)).size).toBeGreaterThanOrEqual(3)
    expect(localEdges.some((edge) => edge.district === 'harbor' && (edge.story === 'quay-unload' || edge.story === 'fish-alley'))).toBe(true)
    expect(localEdges.some((edge) => edge.district === 'civic')).toBe(true)
    expect(locals.mesh.indices.length).toBeGreaterThan(24)

    const lots = (await runExample('generators/parcels.generator.ts', 'parcels', {
      network: locals.network,
      districts: plan.districts,
      setback: 5,
    })) as { parcels: { parcels: Array<{ key: string; district: string; polygon: Point[]; frontageNormal: Point }> } }
    expect(lots.parcels.parcels.length).toBeGreaterThan(40)
    expect(new Set(lots.parcels.parcels.map((lot) => lot.district)).size).toBeGreaterThanOrEqual(3)

    const parkPlan = (await runExample('generators/civic-park-plan.generator.ts', 'civicParkPlan', {
      blocks: locals.blocks,
      parcels: lots.parcels,
      districts: plan.districts,
      network: locals.network,
      creek: field.creek,
      heightGrid: field.heightGrid,
      cellSize: 8,
    })) as {
      park: {
        polygon: Point[]
        area: number
        centroid: Point
        memorial: Point
        overlook: Point
        entrances: Array<{ point: Point }>
        story: string
      }
      parkRegion: { regions: Array<{ polygon: Point[] }> }
      buildableParcels: { parcels: Array<{ key: string; polygon: Point[] }> }
    }
    const civic = plan.districts.regions.find((region) => region.key === 'civic')
    expect(parkPlan.park.area).toBeGreaterThanOrEqual(4000)
    expect(parkPlan.park.area).toBeLessThanOrEqual(7000)
    expect(parkPlan.park.entrances.length).toBeGreaterThanOrEqual(2)
    expect(parkPlan.park.story.length).toBeGreaterThan(20)
    if (civic) {
      expect(pointInPolygon(parkPlan.park.centroid, civic.polygon)).toBe(true)
    }

    const buildings = (await runExample('generators/building-layout.generator.ts', 'buildingLayout', {
      parcels: parkPlan.buildableParcels,
      districts: plan.districts,
      density: 0.78,
      seed: 11,
      heightGrid: field.heightGrid,
      cellSize: 8,
      enriched: 1,
      reserved: parkPlan.parkRegion,
    })) as { placements: { placements: Array<{ prototypeKey: string; x: number; y: number; scale?: number[]; source?: string }> } }

    const keys = new Set(buildings.placements.placements.map((item) => item.prototypeKey))
    expect(keys.has('lighthouse')).toBe(true)
    expect(keys.has('town-hall')).toBe(true)
    expect(keys.has('clock-tower')).toBe(true)
    expect(keys.has('chapel')).toBe(true)
    expect(keys.has('warehouse') || keys.has('shop-house') || keys.has('cottage')).toBe(true)
    expect(buildings.placements.placements.some((item) => item.scale && item.scale[0] !== item.scale[1])).toBe(true)
    expect(buildings.placements.placements.filter((item) => item.prototypeKey === 'lighthouse').length).toBe(1)
    expect(buildings.placements.placements.every((item) => !pointInPolygon([item.x, item.y], parkPlan.park.polygon))).toBe(true)

    const parkLayout = (await runExample('generators/civic-park-layout.generator.ts', 'civicParkLayout', {
      park: parkPlan.park,
      heightGrid: field.heightGrid,
      cellSize: 8,
    })) as {
      placements: { placements: Array<{ prototypeKey: string; x: number; y: number }> }
      lawnMesh: { indices: number[] }
      pathMesh: { indices: number[] }
      paths: { paths: Array<{ key: string; points: Point[] }>; connected: boolean; lawnArea: number }
    }
    const parkKeys = new Set(parkLayout.placements.placements.map((item) => item.prototypeKey))
    expect(parkKeys.has('civic-park-gate')).toBe(true)
    expect(parkKeys.has('civic-memorial-garden')).toBe(true)
    expect(parkKeys.has('flood-marker')).toBe(true)
    expect(parkKeys.has('park-pavilion')).toBe(true)
    expect(parkLayout.placements.placements.filter((item) => item.prototypeKey === 'bench').length).toBeGreaterThanOrEqual(6)
    expect(parkLayout.placements.placements.filter((item) => item.prototypeKey === 'street-tree').length).toBeGreaterThanOrEqual(8)
    expect(parkLayout.lawnMesh.indices.length).toBeGreaterThan(48)
    expect(parkLayout.pathMesh.indices.length).toBeGreaterThan(48)
    expect(parkLayout.paths.connected).toBe(true)
    expect(parkLayout.paths.paths.some((path) => path.key === 'spine')).toBe(true)
    const spine = parkLayout.paths.paths.find((path) => path.key === 'spine')!
    expect(dist(spine.points[0]!, parkPlan.park.entrances[0]!.point)).toBeLessThan(8)
    expect(dist(spine.points[spine.points.length - 1]!, parkPlan.park.overlook)).toBeLessThan(8)

    const infill = (await runExample('generators/district-infill.generator.ts', 'districtInfill', {
      districts: plan.districts,
      cityBoundary: field.cityBoundary,
      parcels: parkPlan.buildableParcels,
      buildings: buildings.placements,
      network: locals.network,
      heightGrid: field.heightGrid,
      cellSize: 8,
      seed: 11,
      reserved: parkPlan.parkRegion,
    })) as {
      placements: {
        placements: Array<{
          prototypeKey: string
          x: number
          y: number
          width: number
          depth: number
        }>
      }
    }
    const infillKeys = new Set(infill.placements.placements.map((item) => item.prototypeKey))
    expect(infill.placements.placements.length).toBeGreaterThan(12)
    expect(infillKeys.size).toBeGreaterThanOrEqual(3)
    for (const item of infill.placements.placements) {
      const radius = Math.max(item.width, item.depth) * 0.46
      expect(pointInPolygon([item.x, item.y], parkPlan.park.polygon)).toBe(false)
      expect(
        locals.network.edges.every(
          (edge) => distToPolyline([item.x, item.y], edge.polyline) > edge.width / 2 + radius + 1.3,
        ),
      ).toBe(true)
      expect(
        buildings.placements.placements.every(
          (building) => dist([item.x, item.y], [building.x, building.y]) > radius + 3,
        ),
      ).toBe(true)
    }

    const life = (await runExample('generators/street-life.generator.ts', 'streetLife', {
      network: locals.network,
      districts: plan.districts,
      buildings: buildings.placements,
      structures: infill.placements,
      heightGrid: field.heightGrid,
      cellSize: 8,
      seed: 11,
      clearance: 4.2,
    })) as { placements: { placements: Array<{ prototypeKey: string }> } }
    const lifeKeys = new Set(life.placements.placements.map((item) => item.prototypeKey))
    expect(life.placements.placements.length).toBeGreaterThan(20)
    expect(lifeKeys.has('lantern') || lifeKeys.has('crate') || lifeKeys.has('bench') || lifeKeys.has('stall')).toBe(true)
  }, 45_000)
})
