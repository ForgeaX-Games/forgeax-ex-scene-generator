// @scene-module-id module.coastal.civic
import { plaster } from "../looks/plaster.material.ts"
import { slate } from "../looks/slate.material.ts"
import { stone } from "../looks/stone.material.ts"

const hall = controlPoints({
  points: [[0, 0]],
})
const wings = controlPoints({
  points: [[-9.6, 1.2], [9.6, 1.2]],
})
// Deep foundation terrace
const foundationRaw = gridToBoxes({
  points: [[0, 0]],
  buildingHeight: 3.2,
  footprint: 26.0,
  cellSize: 1,
})
// Grand central atrium hall
const hallWallRaw = gridToBoxes({
  points: hall.points,
  buildingHeight: 8.5,
  footprint: 9.6,
  cellSize: 1,
})
// Colonnaded side gallery wings
const wingWallRaw = gridToBoxes({
  points: wings.points,
  buildingHeight: 6.2,
  footprint: 7.2,
  cellSize: 1,
})
// Central gabled slate roof
const hallRoofRaw = gabledHouses({
  points: hall.points,
  buildingHeight: 0.35,
  roofHeight: 3.8,
  footprint: 10.2,
  depth: 13.0,
  cellSize: 1,
})
// Side gallery roofs
const wingRoofRaw = gabledHouses({
  points: wings.points,
  buildingHeight: 0.3,
  roofHeight: 2.6,
  footprint: 7.6,
  depth: 9.8,
  cellSize: 1,
})
// Grand classical entrance steps
const steps = controlPoints({
  points: [[0, 8.2]],
})
const stepRaw = gridToBoxes({
  points: steps.points,
  buildingHeight: 1.0,
  footprint: 7.5,
  cellSize: 1,
})

const foundation = bindMaterial({
  mesh: foundationRaw.mesh,
  material: stone.material,
})
const hallWalls = bindMaterial({
  mesh: hallWallRaw.mesh,
  material: plaster.material,
})
const wingWalls = bindMaterial({
  mesh: wingWallRaw.mesh,
  material: plaster.material,
})
const hallRoof = bindMaterial({
  mesh: hallRoofRaw.mesh,
  material: slate.material,
})
const wingRoof = bindMaterial({
  mesh: wingRoofRaw.mesh,
  material: slate.material,
})
const stepsPaint = bindMaterial({
  mesh: stepRaw.mesh,
  material: stone.material,
})

const root = scopeSceneNode({
  name: "Civic",
  schema: "scope",
})
const foundationNode = meshSceneNode({
  name: "Foundation",
  mesh: foundation.mesh,
})
const hallNode = meshSceneNode({
  name: "Hall",
  mesh: hallWalls.mesh,
})
const wingNode = meshSceneNode({
  name: "Wings",
  mesh: wingWalls.mesh,
})
const hallRoofNode = meshSceneNode({
  name: "HallRoof",
  mesh: hallRoof.mesh,
})
const wingRoofNode = meshSceneNode({
  name: "WingRoof",
  mesh: wingRoof.mesh,
})
const stepNode = meshSceneNode({
  name: "Steps",
  mesh: stepsPaint.mesh,
})

const a = place({
  scene: root.scene,
  child: foundationNode.scene,
  name: "Foundation",
  x: 0,
  y: 0,
  z: -2.5,
})
const b = place({
  scene: a.scene,
  child: hallNode.scene,
  name: "Hall",
  x: 0,
  y: 0,
  z: 0.5,
})
const c = place({
  scene: b.scene,
  child: wingNode.scene,
  name: "Wings",
  x: 0,
  y: 0,
  z: 0.5,
})
const d = place({
  scene: c.scene,
  child: stepNode.scene,
  name: "Steps",
  x: 0,
  y: 0,
  z: 0.5,
})
const e = place({
  scene: d.scene,
  child: hallRoofNode.scene,
  name: "HallRoof",
  x: 0,
  y: 0,
  z: 9.0,
})
export const civic = place({
  scene: e.scene,
  child: wingRoofNode.scene,
  name: "WingRoof",
  x: 0,
  y: 0,
  z: 6.7,
})
