import { defineGenerator } from '@forgeax/project-generator'
import {
  aabbOf,
  buildRegionPatchMesh,
  buildRibbonMesh,
  centroidOf,
  dist,
  lerp,
  pointInPolygon,
  polygonArea,
  resamplePolyline,
  sampleGridHeight,
  type Point,
} from './lib/geom.generator-lib.ts'

type Entrance = { key: string; point: Point; inward: Point }
type Park = {
  polygon: Point[]
  centroid: Point
  axis: Point
  memorial: Point
  overlook: Point
  riverPoint?: Point
  entrances?: Entrance[]
  story?: string
}

type Placement = {
  key: string
  prototypeKey: string
  x: number
  y: number
  z: number
  rotation: number
  scale: readonly [number, number, number]
  width: number
  depth: number
  role: 'derived'
  lineage: { source: string; via: string[] }
}

function perp(axis: Point): Point {
  return [-axis[1], axis[0]]
}

function along(origin: Point, dir: Point, metres: number): Point {
  return [origin[0] + dir[0] * metres, origin[1] + dir[1] * metres]
}

function clampInside(point: Point, polygon: Point[], center: Point): Point {
  if (pointInPolygon(point, polygon)) return point
  return lerp(center, point, 0.62)
}

export const civicParkLayout = defineGenerator({
  id: 'civic-park-layout',
  version: '1.0.0',
  description: 'Narrative civic riverfront park: entrance court, memorial spine, lawn, rain garden and grove.',
  inputs: {
    park: { type: 'Any', runtimeType: 'park-precinct' },
    heightGrid: { type: 'Any', runtimeType: 'height-grid' },
    cellSize: { type: 'NumberValue', defaultValue: 8 },
  },
  outputs: {
    placements: { type: 'Any', runtimeType: 'placement-set' },
    lawnMesh: { type: 'Mesh' },
    rainGardenMesh: { type: 'Mesh' },
    pathMesh: { type: 'Mesh' },
    paths: { type: 'Any', runtimeType: 'park-paths' },
  },
  run(_ctx, args: { park?: Park; heightGrid?: number[][]; cellSize?: number }) {
    const park = args.park
    const polygon = park?.polygon ?? []
    const center = park?.centroid ?? (polygon.length ? centroidOf(polygon) : ([0, 0] as Point))
    const axis = park?.axis ?? ([0, 1] as Point)
    const side = perp(axis)
    const memorial = park?.memorial ?? along(center, axis, -8)
    const overlook = park?.overlook ?? along(center, axis, 18)
    const cellSize = Number(args.cellSize) || 8
    const heightGrid = args.heightGrid
    const heightAt = (point: Point) => (heightGrid ? sampleGridHeight(heightGrid, cellSize, point) : 0)
    const zAt = (point: Point) => heightAt(point) + 0.12
    const gates = (park?.entrances ?? []).slice(0, 3)
    const gateA = gates[0]?.point ?? along(center, axis, -24)
    const gateB = gates[1]?.point ?? along(center, side, 20)
    const lawnN = clampInside(along(center, side, 10), polygon, center)
    const lawnS = clampInside(along(center, side, -10), polygon, center)
    const grove = clampInside(along(center, [side[0] * 0.7 - axis[0] * 0.4, side[1] * 0.7 - axis[1] * 0.4], 16), polygon, center)
    const rain = clampInside(along(overlook, side, -8), polygon, center)

    const spine = [gateA, memorial, overlook]
    const loop = [memorial, lawnN, along(center, axis, 6), lawnS, memorial]
    const branchB = [gateB, memorial]
    const spurGrove = [lawnN, grove]
    const spurRain = [lawnS, rain]
    const paths = [
      { key: 'spine', kind: 'main', points: spine },
      { key: 'loop', kind: 'loop', points: loop },
      { key: 'entry-b', kind: 'branch', points: branchB },
      { key: 'grove-spur', kind: 'spur', points: spurGrove },
      { key: 'rain-spur', kind: 'spur', points: spurRain },
    ]

    const box = aabbOf(polygon.length ? polygon : [center], 2)
    const lawnPoly = polygon.length >= 4 ? polygon : [
      along(center, [1, 0], 32),
      along(center, [0, 1], 24),
      along(center, [-1, 0], 32),
      along(center, [0, -1], 24),
    ]
    const rainPoly: Point[] = [
      clampInside(along(overlook, [axis[0] + side[0] * 1.2, axis[1] + side[1] * 1.2], 16), lawnPoly, center),
      clampInside(along(overlook, [axis[0] - side[0] * 1.2, axis[1] - side[1] * 1.2], 16), lawnPoly, center),
      clampInside(along(center, [axis[0] * 0.2 - side[0], axis[1] * 0.2 - side[1]], 14), lawnPoly, center),
      clampInside(along(center, [axis[0] * 0.2 + side[0], axis[1] * 0.2 + side[1]], 14), lawnPoly, center),
    ]
    const patchCell = 8

    const lawnMesh = buildRegionPatchMesh(lawnPoly, heightGrid ?? [], patchCell, {
      lift: 0.16,
      color: [0.28, 0.56, 0.24],
      role: 'houses',
      heightCell: cellSize,
    })
    const rainGardenMesh = buildRegionPatchMesh(rainPoly, heightGrid ?? [], patchCell, {
      lift: 0.1,
      color: [0.22, 0.4, 0.3],
      role: 'houses',
      heightCell: cellSize,
    })
    const pathMesh = buildRibbonMesh(
      [
        { points: spine, width: 5.2, kind: 'arterial' },
        { points: loop, width: 3.4, kind: 'local' },
        { points: branchB, width: 3.6, kind: 'local' },
        { points: spurGrove, width: 2.2, kind: 'kerb' },
        { points: spurRain, width: 2.2, kind: 'kerb' },
      ],
      { lift: 0.28, role: 'road', heightAt },
    )

    const out: Placement[] = []
    const push = (
      key: string,
      prototypeKey: string,
      point: Point,
      rotation: number,
      size: { width: number; depth: number },
      scale: readonly [number, number, number] = [1, 1, 1],
    ) => {
      const placed = clampInside(point, polygon.length ? polygon : [point], center)
      out.push({
        key,
        prototypeKey,
        x: placed[0],
        y: placed[1],
        z: zAt(placed),
        rotation,
        scale,
        width: size.width * scale[0],
        depth: size.depth * scale[1],
        role: 'derived',
        lineage: { source: 'civic-park', via: [key.split('-')[0] ?? 'park', prototypeKey] },
      })
    }

    const facingRiver = Math.atan2(axis[1], axis[0])
    const facingStreet = facingRiver + Math.PI
    push('gate-a', 'civic-park-gate', gateA, Math.atan2(gates[0]?.inward[1] ?? axis[1], gates[0]?.inward[0] ?? axis[0]), { width: 6, depth: 2.2 })
    if (gates[1] || gateB) {
      push('gate-b', 'civic-park-gate', gateB, Math.atan2(gates[1]?.inward[1] ?? -side[1], gates[1]?.inward[0] ?? -side[0]), { width: 6, depth: 2.2 })
    }
    push('memorial', 'civic-memorial-garden', memorial, facingRiver, { width: 9, depth: 9 })
    push('pavilion', 'park-pavilion', along(memorial, side, 11), facingStreet, { width: 8, depth: 6 })
    push('flood-low', 'flood-marker', along(overlook, axis, 4), facingRiver, { width: 1.4, depth: 1.0 })
    push('flood-mid', 'flood-marker', along(lerp(memorial, overlook, 0.55), side, 3.2), facingRiver, { width: 1.4, depth: 1.0 })
    push('flood-high', 'flood-marker', along(memorial, [-axis[0], -axis[1]], 4), facingRiver, { width: 1.4, depth: 1.0 })

    const benches: Array<[Point, number]> = [
      [along(overlook, side, 4.5), facingRiver],
      [along(overlook, side, -4.5), facingRiver],
      [along(lawnN, axis, -2), facingStreet],
      [along(lawnS, axis, -2), facingStreet],
      [along(grove, side, -3), Math.atan2(-side[1], -side[0])],
      [along(rain, axis, -3), facingRiver],
    ]
    benches.forEach((item, index) => push(`bench-${index}`, 'bench', item[0], item[1], { width: 1.7, depth: 0.8 }))

    resamplePolyline(spine, 14).forEach((point, index) => {
      if (index === 0 || index === resamplePolyline(spine, 14).length - 1) return
      push(`lantern-${index}`, 'lantern', along(point, side, 2.1), facingRiver, { width: 0.5, depth: 0.5 })
    })

    const treeSpots: Point[] = []
    const boxW = box.maxX - box.minX
    const boxH = box.maxY - box.minY
    for (let i = 0; i < 10; i++) {
      const t = (i + 0.5) / 10
      treeSpots.push(clampInside([
        box.minX + 4 + (boxW - 8) * (i % 2 === 0 ? 0.08 : 0.92),
        box.minY + 4 + (boxH - 8) * t,
      ], polygon.length ? polygon : treeSpots.concat([center]), center))
    }
    treeSpots.push(along(grove, axis, 3), along(grove, side, 4), along(grove, side, -4))
    treeSpots.forEach((point, index) => {
      push(`tree-${index}`, 'street-tree', point, facingRiver + index * 0.2, { width: 3.2, depth: 3.2 }, [0.9 + (index % 3) * 0.08, 0.9, 1])
    })

    ;[along(grove, axis, -5), along(rain, side, 6), along(gateA, side, 6)].forEach((point, index) => {
      push(`hedge-${index}`, 'hedge', point, facingStreet, { width: 2.4, depth: 0.8 })
    })
    ;[along(rain, side, -5), along(rain, axis, 3), along(lawnN, side, 4)].forEach((point, index) => {
      push(`grass-${index}`, 'grass-clump', point, facingRiver, { width: 1.4, depth: 1.4 })
    })
    ;[along(memorial, side, -8), along(gateA, axis, 4)].forEach((point, index) => {
      push(`planter-${index}`, 'planter', point, facingStreet, { width: 0.9, depth: 0.9 })
    })

    return {
      placements: {
        placements: out,
        role: 'derived',
        lineage: { source: 'civic-park', via: ['layout', park?.story ?? 'flood-memorial'] },
      },
      lawnMesh,
      rainGardenMesh,
      pathMesh,
      paths: {
        paths,
        connected: true,
        spineKeys: ['gate-a', 'memorial', 'overlook'],
        lawnArea: polygonArea(lawnPoly),
        rainArea: polygonArea(rainPoly),
        role: 'derived',
        lineage: { source: 'civic-park', via: ['paths'] },
      },
    }
  },
})
