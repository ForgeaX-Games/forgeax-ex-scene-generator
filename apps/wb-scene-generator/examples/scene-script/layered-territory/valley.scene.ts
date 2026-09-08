// @scene-module-id module.layeredValley
// Local metres: (0, 0)–(128, 128). Do not write continent XY here.

import { Plaza } from "./plaza.scene.ts"

const mountainPeaks = controlPoints({
  points: [[18, 10], [42, 8], [68, 9], [92, 12], [114, 16], [22, 28], [108, 36]],
})

const riverPath = controlPoints({
  points: [[0, 52], [22, 56], [48, 50], [70, 54], [96, 58], [128, 54]],
})

const plazaCenterPts = controlPoints({
  points: [[72, 66]],
})
const plazaCenter = listGetSingle({ list: plazaCenterPts.points, index: 0 })

const vField = valleyHeightfield({
  width: 128,
  height: 128,
  valleyDepth: 42,
  valleyWidth: 32,
  riverDepth: 2.2,
  riverWidth: 8,
  ridgeNoise: 4.6,
  seed: 27,
  baseElevation: 3,
  peaks: mountainPeaks.points,
  riverPoints: riverPath.points,
  erosionStrength: 0.75,
  terraceSteps: 6,
  plazaCenter: plazaCenter.item,
  plazaRadius: 7.4,
})

const terrain = heightfieldMesh({
  grid: vField.heightGrid,
})

const terrainNode = meshSceneNode({
  name: "Terrain",
  mesh: terrain.mesh,
})

const riverCenter = splineSample({
  points: riverPath.points,
  roadWidth: 6.4,
  samplesPerSegment: 24,
})

const river = strokeSweepMesh({
  points: riverCenter.points,
  widths: riverCenter.widths,
  heightGrid: vField.heightGrid,
  roadWidth: 6.4,
  lift: 0.04,
  color: [0.22, 0.54, 0.82],
})

const riverNode = meshSceneNode({
  name: "River",
  mesh: river.mesh,
})

const network = villageRoadNetwork({
  plazaCenter: plazaCenter.item,
  plazaRadius: 7.4,
  riverPoints: riverPath.points,
  heightGrid: vField.heightGrid,
  riverWidth: 8,
  seed: 27,
})

const roadNode = meshSceneNode({
  name: "Road",
  mesh: network.mesh,
})

const bridge = stoneArchBridge({
  start: network.bridgeStart,
  end: network.bridgeEnd,
  heightGrid: vField.heightGrid,
  width: 4.2,
  archHeight: 2.4,
  parapetHeight: 0.85,
})

const bridgeNode = meshSceneNode({
  name: "Bridge",
  mesh: bridge.mesh,
})

const plaza = Plaza({
  heightGrid: vField.heightGrid,
  center: plazaCenter.item,
})

const watchtower = landmarkWatchtower({
  position: network.towerPosition,
  heightGrid: vField.heightGrid,
  baseSize: 4.2,
  height: 16,
  yaw: 0.35,
})

const watchtowerNode = meshSceneNode({
  name: "Watchtower",
  mesh: watchtower.mesh,
})

const watermill = watermillBuilding({
  position: network.millPosition,
  heightGrid: vField.heightGrid,
  yaw: network.millYaw,
})

const watermillNode = meshSceneNode({
  name: "Watermill",
  mesh: watermill.mesh,
})

const layout = proceduralVillageLayout({
  heightGrid: vField.heightGrid,
  buildableMask: vField.buildableMask,
  valleyMask: vField.valleyMask,
  terraceMask: vField.terraceMask,
  forestMask: vField.forestMask,
  slopeGrid: vField.slopeGrid,
  roadPoints: network.arterialPoints,
  ringPoints: network.ringPoints,
  trailPoints: network.trailPoints,
  feederPoints: network.feederPoints,
  millAccessPoints: network.millAccessPoints,
  riverPoints: riverPath.points,
  plazaCenter: plazaCenter.item,
  plazaRadius: 7.4,
  towerPosition: network.towerPosition,
  millPosition: network.millPosition,
  targetCount: 56,
  density: 1.15,
  roadSetback: 2.2,
  minSpacing: 2.0,
  seed: 37,
})

const houses = multiTierHouses({
  plots: layout.plots,
  heightGrid: vField.heightGrid,
})

const housesNode = meshSceneNode({
  name: "Houses",
  mesh: houses.mesh,
})

const walls = terraceWalls({
  heightGrid: vField.heightGrid,
  terraceMask: vField.terraceMask,
  wallThickness: 0.45,
  wallHeight: 1.3,
  roadPoints: network.arterialPoints,
  ringPoints: network.ringPoints,
  trailPoints: network.trailPoints,
  feederPoints: network.feederPoints,
  millAccessPoints: network.millAccessPoints,
  riverPoints: riverPath.points,
  riverWidth: 8,
  plazaCenter: plazaCenter.item,
  plazaRadius: 7.4,
  towerPosition: network.towerPosition,
  millPosition: network.millPosition,
  avoidPoints: layout.points,
  clearance: 3.6,
})

const wallsNode = meshSceneNode({
  name: "TerraceWalls",
  mesh: walls.mesh,
})

const forest = pineForestScatter({
  heightGrid: vField.heightGrid,
  forestMask: vField.forestMask,
  count: 80,
  seed: 42,
  avoidPoints: layout.points,
  avoidRadius: 3.8,
  plazaCenter: plazaCenter.item,
  plazaRadius: 7.4,
})

const forestNode = meshSceneNode({
  name: "Forest",
  mesh: forest.mesh,
})

const props = alpineSceneProps({
  heightGrid: vField.heightGrid,
  slopeGrid: vField.slopeGrid,
  terraceMask: vField.terraceMask,
  forestMask: vField.forestMask,
  roadPoints: network.arterialPoints,
  ringPoints: network.ringPoints,
  trailPoints: network.trailPoints,
  feederPoints: network.feederPoints,
  millAccessPoints: network.millAccessPoints,
  riverPoints: riverPath.points,
  plazaCenter: plazaCenter.item,
  plazaRadius: 7.4,
  bridgeStart: network.bridgeStart,
  bridgeEnd: network.bridgeEnd,
  towerPosition: network.towerPosition,
  millPosition: network.millPosition,
  avoidPoints: layout.points,
  riverWidth: 8,
  seed: 42,
})

const propsNode = meshSceneNode({
  name: "Props",
  mesh: props.mesh,
})

const plazaGuide = pointsToNode({
  name: "Center",
  points: plazaCenterPts.points,
  style: "points",
})

const riverGuide = pointsToNode({
  name: "RiverPath",
  points: riverPath.points,
  style: "polyline",
})

const peakGuide = pointsToNode({
  name: "Peaks",
  points: mountainPeaks.points,
  style: "points",
})

const riverWithPath = addSceneChildren({ scene: riverNode.scene, nodes: riverGuide.scene })
const plazaWithCenter = addSceneChildren({ scene: plaza.scene, nodes: plazaGuide.scene })
const terrainWithPeaks = addSceneChildren({ scene: terrainNode.scene, nodes: peakGuide.scene })

const withRiver = addSceneChildren({ scene: terrainWithPeaks.scene, nodes: riverWithPath.scene })
const withRoad = addSceneChildren({ scene: withRiver.scene, nodes: roadNode.scene })
const withBridge = addSceneChildren({ scene: withRoad.scene, nodes: bridgeNode.scene })
const withPlaza = addSceneChildren({ scene: withBridge.scene, nodes: plazaWithCenter.scene })
const withTower = addSceneChildren({ scene: withPlaza.scene, nodes: watchtowerNode.scene })
const withMill = addSceneChildren({ scene: withTower.scene, nodes: watermillNode.scene })
const withWalls = addSceneChildren({ scene: withMill.scene, nodes: wallsNode.scene })
const withHouses = addSceneChildren({ scene: withWalls.scene, nodes: housesNode.scene })
const withForest = addSceneChildren({ scene: withHouses.scene, nodes: forestNode.scene })
export const valley = addSceneChildren({ scene: withForest.scene, nodes: propsNode.scene })
