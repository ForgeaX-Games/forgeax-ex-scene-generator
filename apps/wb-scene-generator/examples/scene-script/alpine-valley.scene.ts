// @scene-module-id module.alpineValley
// 3A alpine valley village white-box: river, stone bridge, plaza, watchtower,
// watermill, terraces, pine forest, and multi-tier settlement.

const vField = valleyHeightfield({
  width: 64,
  height: 64,
  valleyDepth: 18,
  valleyWidth: 18,
  riverDepth: 1.5,
  riverWidth: 6.2,
  ridgeNoise: 2.2,
  seed: 27,
  baseElevation: 2,
})

const terrain = heightfieldMesh({
  grid: vField.heightGrid,
})

const terrainNode = meshSceneNode({
  name: "Terrain",
  mesh: terrain.mesh,
})

const riverPath = controlPoints({
  points: [[0, 24], [16, 25], [30, 24], [46, 26], [64, 25]],
})

const riverCenter = splineSample({
  points: riverPath.points,
  roadWidth: 4.8,
  samplesPerSegment: 24,
})

const river = strokeSweepMesh({
  points: riverCenter.points,
  widths: riverCenter.widths,
  heightGrid: vField.heightGrid,
  roadWidth: 4.8,
  lift: 0.12,
})

const riverNode = meshSceneNode({
  name: "River",
  mesh: river.mesh,
})

const mainRoad = controlPoints({
  points: [[4, 24], [16, 24], [25, 23], [29, 26], [36, 32], [48, 32], [62, 33]],
})

const mainCenter = splineSample({
  points: mainRoad.points,
  roadWidth: 3.2,
  flareStart: 1.2,
  samplesPerSegment: 24,
})

const road = strokeSweepMesh({
  points: mainCenter.points,
  widths: mainCenter.widths,
  heightGrid: vField.heightGrid,
  lift: 0.22,
})

const roadNode = meshSceneNode({
  name: "Road",
  mesh: road.mesh,
})

const trailPath = controlPoints({
  points: [[36, 32], [40, 39], [48, 44], [58, 48]],
})

const trailCenter = splineSample({
  points: trailPath.points,
  roadWidth: 1.8,
  samplesPerSegment: 18,
})

const trail = strokeSweepMesh({
  points: trailCenter.points,
  widths: trailCenter.widths,
  heightGrid: vField.heightGrid,
  lift: 0.2,
})

const trailNode = meshSceneNode({
  name: "Trail",
  mesh: trail.mesh,
})

const bridgeSpan = controlPoints({
  points: [[24, 22.5], [29, 26.5]],
})
const bridgeStart = listGetSingle({ list: bridgeSpan.points, index: 0 })
const bridgeEnd = listGetSingle({ list: bridgeSpan.points, index: 1 })

const bridge = stoneArchBridge({
  start: bridgeStart.item,
  end: bridgeEnd.item,
  heightGrid: vField.heightGrid,
  width: 3.8,
  archHeight: 2,
  parapetHeight: 0.85,
})

const bridgeNode = meshSceneNode({
  name: "Bridge",
  mesh: bridge.mesh,
})

const plazaCenterPts = controlPoints({
  points: [[36, 32]],
})
const plazaCenter = listGetSingle({ list: plazaCenterPts.points, index: 0 })

const plaza = villagePlaza({
  center: plazaCenter.item,
  heightGrid: vField.heightGrid,
  radius: 6.8,
})

const plazaNode = meshSceneNode({
  name: "Plaza",
  mesh: plaza.mesh,
})

const towerPosPts = controlPoints({
  points: [[33, 36]],
})
const towerPos = listGetSingle({ list: towerPosPts.points, index: 0 })

const watchtower = landmarkWatchtower({
  position: towerPos.item,
  heightGrid: vField.heightGrid,
  baseSize: 4.4,
  height: 15,
  yaw: 0.35,
})

const watchtowerNode = meshSceneNode({
  name: "Watchtower",
  mesh: watchtower.mesh,
})

const millPosPts = controlPoints({
  points: [[22, 22]],
})
const millPos = listGetSingle({ list: millPosPts.points, index: 0 })

const watermill = watermillBuilding({
  position: millPos.item,
  heightGrid: vField.heightGrid,
  yaw: 1.57,
})

const watermillNode = meshSceneNode({
  name: "Watermill",
  mesh: watermill.mesh,
})

const walls = terraceWalls({
  heightGrid: vField.heightGrid,
  terraceMask: vField.terraceMask,
  wallThickness: 0.45,
  wallHeight: 1.3,
})

const wallsNode = meshSceneNode({
  name: "TerraceWalls",
  mesh: walls.mesh,
})

const forest = pineForestScatter({
  heightGrid: vField.heightGrid,
  forestMask: vField.forestMask,
  count: 36,
  seed: 42,
})

const forestNode = meshSceneNode({
  name: "Forest",
  mesh: forest.mesh,
})

const housePlots = controlPoints({
  points: [
    [32, 29], [38, 29], [41, 33], [38, 36], [32, 38],
    [10, 27], [15, 21], [18, 27], [44, 30], [48, 35], [54, 31],
    [38, 43], [44, 46], [50, 47], [56, 51],
    [8, 21], [27, 20], [44, 23], [58, 26],
  ],
})

const houses = multiTierHouses({
  points: housePlots.points,
  heightGrid: vField.heightGrid,
})

const housesNode = meshSceneNode({
  name: "Houses",
  mesh: houses.mesh,
})

const guide = pointsToNode({
  name: "Guide",
  points: mainRoad.points,
})

const withRiver = addSceneChildren({ scene: terrainNode.scene, nodes: riverNode.scene })
const withRoad = addSceneChildren({ scene: withRiver.scene, nodes: roadNode.scene })
const withTrail = addSceneChildren({ scene: withRoad.scene, nodes: trailNode.scene })
const withBridge = addSceneChildren({ scene: withTrail.scene, nodes: bridgeNode.scene })
const withPlaza = addSceneChildren({ scene: withBridge.scene, nodes: plazaNode.scene })
const withTower = addSceneChildren({ scene: withPlaza.scene, nodes: watchtowerNode.scene })
const withMill = addSceneChildren({ scene: withTower.scene, nodes: watermillNode.scene })
const withWalls = addSceneChildren({ scene: withMill.scene, nodes: wallsNode.scene })
const withForest = addSceneChildren({ scene: withWalls.scene, nodes: forestNode.scene })
const withHouses = addSceneChildren({ scene: withForest.scene, nodes: housesNode.scene })
export const valley = addSceneChildren({ scene: withHouses.scene, nodes: guide.scene })
