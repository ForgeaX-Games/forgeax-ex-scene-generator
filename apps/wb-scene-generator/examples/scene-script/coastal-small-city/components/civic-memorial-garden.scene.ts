// @scene-module-id module.coastal.civicMemorialGarden
import { bench } from "./bench.scene.ts"
import { planter } from "./planter.scene.ts"
import { stone } from "../looks/stone.material.ts"

const plinthPoints = controlPoints({
  points: [[0, 0]],
})
const lowerRaw = gridToBoxes({
  points: plinthPoints.points,
  buildingHeight: 0.42,
  footprint: 3.8,
  cellSize: 1,
})
const upperRaw = gridToBoxes({
  points: plinthPoints.points,
  buildingHeight: 0.52,
  footprint: 2.5,
  cellSize: 1,
})
const columnRaw = gridToBoxes({
  points: plinthPoints.points,
  buildingHeight: 4.6,
  footprint: 0.82,
  cellSize: 1,
})
const crownRaw = gridToBoxes({
  points: plinthPoints.points,
  buildingHeight: 0.65,
  footprint: 1.15,
  cellSize: 1,
})
const lowerPaint = bindMaterial({
  mesh: lowerRaw.mesh,
  material: stone.material,
})
const upperPaint = bindMaterial({
  mesh: upperRaw.mesh,
  material: stone.material,
})
const columnPaint = bindMaterial({
  mesh: columnRaw.mesh,
  material: stone.material,
})
const crownPaint = bindMaterial({
  mesh: crownRaw.mesh,
  material: stone.material,
})
const root = scopeSceneNode({
  name: "CivicMemorialGarden",
  schema: "scope",
})
const lowerNode = meshSceneNode({
  name: "MemorialTerrace",
  mesh: lowerPaint.mesh,
})
const upperNode = meshSceneNode({
  name: "MemorialSteps",
  mesh: upperPaint.mesh,
})
const columnNode = meshSceneNode({
  name: "MemorialColumn",
  mesh: columnPaint.mesh,
})
const crownNode = meshSceneNode({
  name: "MemorialCrown",
  mesh: crownPaint.mesh,
})
const withTerrace = addSceneChildren({
  scene: root.scene,
  nodes: lowerNode.scene,
})
const withSteps = place({
  scene: withTerrace.scene,
  child: upperNode.scene,
  name: "MemorialSteps",
  x: 0,
  y: 0,
  z: 0.4,
})
const withColumn = place({
  scene: withSteps.scene,
  child: columnNode.scene,
  name: "MemorialColumn",
  x: 0,
  y: 0,
  z: 0.9,
})
const withCrown = place({
  scene: withColumn.scene,
  child: crownNode.scene,
  name: "MemorialCrown",
  x: 0,
  y: 0,
  z: 5.45,
})
const withBenchA = place({
  scene: withCrown.scene,
  child: bench.scene,
  name: "GardenBenchWest",
  x: -3.4,
  y: 0,
  z: 0,
})
const withBenchB = place({
  scene: withBenchA.scene,
  child: bench.scene,
  name: "GardenBenchEast",
  x: 3.4,
  y: 0,
  z: 0,
})
const withPlanterA = place({
  scene: withBenchB.scene,
  child: planter.scene,
  name: "GardenPlanterNorth",
  x: 0,
  y: 3.1,
  z: 0,
})
export const civicMemorialGarden = place({
  scene: withPlanterA.scene,
  child: planter.scene,
  name: "GardenPlanterSouth",
  x: 0,
  y: -3.1,
  z: 0,
})
