// @scene-module-id module.coastal.townHall
import { stone } from "../looks/stone.material.ts"
import { slate } from "../looks/slate.material.ts"
import { plaster } from "../looks/plaster.material.ts"
import { iron } from "../looks/iron.material.ts"

const hallPlots = controlPoints({
  points: [[0, 0]],
})
const wingPlots = controlPoints({
  points: [[-9.8, 1.2], [9.8, 1.2]],
})
// Deep foundation terrace
const foundationRaw = gridToBoxes({
  points: [[0, 0]],
  buildingHeight: 3.2,
  footprint: 28.0,
  cellSize: 1,
})
// Central grand hall
const bodyRaw = gridToBoxes({
  points: hallPlots.points,
  buildingHeight: 9.2,
  footprint: 11.5,
  cellSize: 1,
})
// Symmetrical administrative side wings
const wingBodyRaw = gridToBoxes({
  points: wingPlots.points,
  buildingHeight: 7.0,
  footprint: 8.2,
  cellSize: 1,
})
// Main hall gabled roof
const hallRoofRaw = gabledHouses({
  points: hallPlots.points,
  buildingHeight: 0.4,
  roofHeight: 4.2,
  footprint: 12.0,
  depth: 14.5,
  cellSize: 1,
})
// Side wings gabled roofs
const wingRoofRaw = gabledHouses({
  points: wingPlots.points,
  buildingHeight: 0.35,
  roofHeight: 3.2,
  footprint: 8.6,
  depth: 10.5,
  cellSize: 1,
})
// Central clock tower cupola
const cupolaRaw = gridToBoxes({
  points: [[0, 0]],
  buildingHeight: 7.5,
  footprint: 3.8,
  cellSize: 1,
})
// Spire / lantern pinnacle
const spireRaw = gridToBoxes({
  points: [[0, 0]],
  buildingHeight: 4.5,
  footprint: 1.6,
  cellSize: 1,
})
// Grand entrance ceremonial steps
const steps = controlPoints({
  points: [[0, 8.8]],
})
const stepRaw = gridToBoxes({
  points: steps.points,
  buildingHeight: 1.2,
  footprint: 8.5,
  cellSize: 1,
})

const foundation = bindMaterial({
  mesh: foundationRaw.mesh,
  material: stone.material,
})
const body = bindMaterial({
  mesh: bodyRaw.mesh,
  material: plaster.material,
})
const wingBody = bindMaterial({
  mesh: wingBodyRaw.mesh,
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
const cupola = bindMaterial({
  mesh: cupolaRaw.mesh,
  material: stone.material,
})
const spire = bindMaterial({
  mesh: spireRaw.mesh,
  material: iron.material,
})
const stepsPaint = bindMaterial({
  mesh: stepRaw.mesh,
  material: stone.material,
})

const root = scopeSceneNode({
  name: "TownHall",
  schema: "scope",
})
const foundationNode = meshSceneNode({
  name: "Foundation",
  mesh: foundation.mesh,
})
const bodyNode = meshSceneNode({
  name: "Body",
  mesh: body.mesh,
})
const wingNode = meshSceneNode({
  name: "Wings",
  mesh: wingBody.mesh,
})
const hallRoofNode = meshSceneNode({
  name: "HallRoof",
  mesh: hallRoof.mesh,
})
const wingRoofNode = meshSceneNode({
  name: "WingRoof",
  mesh: wingRoof.mesh,
})
const cupolaNode = meshSceneNode({
  name: "Cupola",
  mesh: cupola.mesh,
})
const spireNode = meshSceneNode({
  name: "Spire",
  mesh: spire.mesh,
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
  child: bodyNode.scene,
  name: "Body",
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
  z: 9.7,
})
const f = place({
  scene: e.scene,
  child: wingRoofNode.scene,
  name: "WingRoof",
  x: 0,
  y: 0,
  z: 7.5,
})
const g = place({
  scene: f.scene,
  child: cupolaNode.scene,
  name: "Cupola",
  x: 0,
  y: 0,
  z: 14.0,
})
export const townHall = place({
  scene: g.scene,
  child: spireNode.scene,
  name: "Spire",
  x: 0,
  y: 0,
  z: 21.5,
})
