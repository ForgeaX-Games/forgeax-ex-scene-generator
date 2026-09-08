import { describe, expect, it } from 'vitest'
import { controlPoints } from '../../batteries/scene/point/control_points/index.js'
import { pointsAlongPolyline } from '../../batteries/scene/point/points_along_polyline/index.js'
import { valleyHeightfield } from '../../batteries/scene/bridge/valley_heightfield/index.js'
import { gabledHouses } from '../../batteries/scene/bridge/gabled_houses/index.js'
import { heightfieldScale } from '../../batteries/scene/bridge/heightfield_scale/index.js'
import { getSceneContractRegistry } from '../src/scene-script/contracts/contracts.js'

describe('scene batteries and contracts for valley village', () => {
  it('controlPoints parses point2d tuples and returns count', () => {
    const res = controlPoints({
      points: [[6, 24], [18, 20], [30, 26], [42, 22]],
    })
    expect(res.count).toBe(4)
    expect(res.points).toEqual([
      { x: 6, y: 24 },
      { x: 18, y: 20 },
      { x: 30, y: 26 },
      { x: 42, y: 22 },
    ])
  })

  it('pointsAlongPolyline generates distributed plots along the polyline', () => {
    const res = pointsAlongPolyline({
      points: [[6, 24], [18, 20], [30, 26], [42, 22]],
      count: 5,
      offset: 4,
    })
    expect(res.count).toBe(5)
    const points = res.points as Array<{ x: number; y: number }>
    expect(points.length).toBe(5)
    for (const pt of points) {
      expect(Number.isFinite(pt.x)).toBe(true)
      expect(Number.isFinite(pt.y)).toBe(true)
    }
  })

  it('valleyHeightfield generates continuous heightfield with alpine ridges and gentle floor', () => {
    const res = valleyHeightfield({
      width: 48,
      height: 48,
      valleyDepth: 14,
      valleyWidth: 16,
      seed: 23,
    }) as { heightGrid: number[][]; valleyMask: number[][]; minElevation: number; maxElevation: number }
    expect(res.heightGrid.length).toBe(48)
    expect(res.valleyMask.length).toBe(48)
    expect(res.maxElevation).toBeGreaterThan(15)
  })

  it('gabledHouses produces architectural village houses with pitched roofs and foundation', () => {
    const res = gabledHouses({
      points: [{ x: 10, y: 20 }, { x: 25, y: 22 }],
      z: [2, 3],
      buildingHeight: 3.2,
      roofHeight: 1.8,
      footprint: 3.2,
      depth: 2.6,
    })
    expect(res.count).toBe(2)
    expect(res.mesh?.role).toBe('houses')
    expect(res.mesh?.indices.length).toBeGreaterThan(0)
  })

  it('registers all valley batteries in SceneContractRegistry with control: true parameters', async () => {
    const registry = await getSceneContractRegistry()
    const cpContract = registry.get('controlPoints')
    expect(cpContract).toBeTruthy()
    expect(cpContract?.inputs.find((i) => i.name === 'points')?.control).toBe(true)

    const papContract = registry.get('pointsAlongPolyline')
    expect(papContract).toBeTruthy()
    expect(papContract?.inputs.find((i) => i.name === 'count')?.control).toBe(true)

    const vhContract = registry.get('valleyHeightfield')
    expect(vhContract).toBeTruthy()
    expect(vhContract?.inputs.find((i) => i.name === 'valleyDepth')?.control).toBe(true)
    expect(vhContract?.inputs.find((i) => i.name === 'valleyWidth')?.control).toBe(true)

    const ghContract = registry.get('gabledHouses')
    expect(ghContract).toBeTruthy()
    expect(ghContract?.inputs.find((i) => i.name === 'buildingHeight')?.control).toBe(true)
    expect(ghContract?.inputs.find((i) => i.name === 'roofHeight')?.control).toBe(true)

    const hsContract = registry.get('heightfieldScale')
    expect(hsContract).toBeTruthy()
    expect(hsContract?.inputs.find((i) => i.name === 'scale')?.control).toBe(true)

    const ssContract = registry.get('splineSample')
    expect(ssContract).toBeTruthy()
    expect(ssContract?.inputs.find((i) => i.name === 'roadWidth')?.control).toBe(true)

    const sweepContract = registry.get('strokeSweepMesh')
    expect(sweepContract).toBeTruthy()
    expect(sweepContract?.inputs.find((i) => i.name === 'roadWidth')?.control).not.toBe(true)
  })

  it('compiles updated valley.scene.ts successfully', async () => {
    const { parseSceneModule, compileSceneModule } = await import('@forgeax/scene-authoring')
    const registry = await getSceneContractRegistry()
    const source = `
// @scene-module-id module.valley

// @scene-id stmt_valleyField
const vField = valleyHeightfield({
  width: 48,
  height: 48,
  valleyDepth: 14,
  valleyWidth: 16,
  ridgeNoise: 2.2,
  seed: 23,
})

// @scene-id stmt_terrainMesh
const terrain = heightfieldMesh({
  grid: vField.heightGrid,
})

// @scene-id stmt_terrainNode
const meshNode = meshSceneNode({
  name: "Terrain",
  mesh: terrain.mesh,
})

// @scene-id stmt_mainRoad
const mainRoad = controlPoints({
  points: [[4, 23], [16, 21], [32, 26], [44, 24]],
})

// @scene-id stmt_center
const center = splineSample({
  points: mainRoad.points,
  roadWidth: 3,
  flareStart: 1.2,
  samplesPerSegment: 24,
})

// @scene-id stmt_roadMesh
const road = strokeSweepMesh({
  points: center.points,
  widths: center.widths,
  heightGrid: vField.heightGrid,
})

// @scene-id stmt_roadNode
const roadNode = meshSceneNode({
  name: "Road",
  mesh: road.mesh,
})

// @scene-id stmt_plots
const plots = pointsAlongPolyline({
  points: center.points,
  widths: center.widths,
  count: 6,
  margin: 2.2,
  seed: 3,
})

// @scene-id stmt_sampleH
const sampled = sampleHeight({
  grid: vField.heightGrid,
  points: plots.points,
})

// @scene-id stmt_houses
const houses = gabledHouses({
  points: plots.points,
  heightGrid: vField.heightGrid,
  z: sampled.heights,
  yaw: plots.yaw,
  buildingHeight: 3.2,
  roofHeight: 1.8,
  footprint: 3.2,
  depth: 2.6,
})

// @scene-id stmt_houseNode
const houseNode = meshSceneNode({
  name: "Houses",
  mesh: houses.mesh,
})

// @scene-id stmt_guide
const guide = pointsToNode({
  name: "Guide",
  points: mainRoad.points,
})

// @scene-id stmt_withRoad
const withRoad = addSceneChildren({
  scene: meshNode.scene,
  nodes: roadNode.scene,
})

// @scene-id stmt_withHouses
const withHouses = addSceneChildren({
  scene: withRoad.scene,
  nodes: houseNode.scene,
})

// @scene-id stmt_withGuide
export const valley = addSceneChildren({
  scene: withHouses.scene,
  nodes: guide.scene,
})
`
    const parsed = parseSceneModule(source, { file: 'valley.scene.ts', registry })
    expect(parsed.diagnostics).toEqual([])
    const compiled = compileSceneModule(parsed.module, registry)
    expect(compiled.diagnostics).toEqual([])
    expect(compiled.ops.some((o) => o.opId === 'valley_heightfield')).toBe(true)
    expect(compiled.ops.some((o) => o.opId === 'control_points')).toBe(true)
    expect(compiled.ops.some((o) => o.opId === 'spline_sample')).toBe(true)
    expect(compiled.ops.some((o) => o.opId === 'stroke_sweep_mesh')).toBe(true)
    expect(compiled.ops.some((o) => o.opId === 'points_along_polyline')).toBe(true)
    expect(compiled.ops.some((o) => o.opId === 'gabled_houses')).toBe(true)
    expect(compiled.ops.some((o) => o.opId === 'stroke_to_mesh')).toBe(false)
    expect(compiled.ops.some((o) => o.opId === 'polyline_road_spline')).toBe(false)
  })
})
