// @scene-module-id module.coastal.chapel
import { stone } from "../looks/stone.material.ts"
import { slate } from "../looks/slate.material.ts"
import { plaster } from "../looks/plaster.material.ts"
import { iron } from "../looks/iron.material.ts"

const navePlots = controlPoints({
  points: [[0, -3.5]],
})
const transeptPlots = controlPoints({
  points: [[-4.5, -1.0], [4.5, -1.0]],
})
const towerPlots = controlPoints({
  points: [[0, 6.5]],
})

// Deep foundation plinth
const foundationRaw = gridToBoxes({
  points: [[0, 0]],
  buildingHeight: 3.2,
  footprint: 18.0,
  cellSize: 1,
})
// Nave body
const naveRaw = gridToBoxes({
  points: navePlots.points,
  buildingHeight: 7.5,
  footprint: 6.8,
  cellSize: 1,
})
// Transept wings
const transeptRaw = gridToBoxes({
  points: transeptPlots.points,
  buildingHeight: 5.5,
  footprint: 5.2,
  cellSize: 1,
})
// Nave pitched roof
const naveRoofRaw = gabledHouses({
  points: navePlots.points,
  buildingHeight: 0.35,
  roofHeight: 4.5,
  footprint: 7.2,
  depth: 13.5,
  cellSize: 1,
})
// Transept roofs
const transeptRoofRaw = gabledHouses({
  points: transeptPlots.points,
  buildingHeight: 0.3,
  roofHeight: 3.2,
  footprint: 5.6,
  depth: 7.2,
  cellSize: 1,
})
// Bell tower shaft
const towerRaw = gridToBoxes({
  points: towerPlots.points,
  buildingHeight: 16.5,
  footprint: 4.2,
  cellSize: 1,
})
// Belfry belfry louvers / upper tower
const belfryRaw = gridToBoxes({
  points: towerPlots.points,
  buildingHeight: 4.5,
  footprint: 3.6,
  cellSize: 1,
})
// Spire pinnacle
const spireRaw = gridToBoxes({
  points: towerPlots.points,
  buildingHeight: 8.5,
  footprint: 2.0,
  cellSize: 1,
})

const foundation = bindMaterial({
  mesh: foundationRaw.mesh,
  material: stone.material,
})
const nave = bindMaterial({
  mesh: naveRaw.mesh,
  material: stone.material,
})
const transepts = bindMaterial({
  mesh: transeptRaw.mesh,
  material: plaster.material,
})
const naveRoof = bindMaterial({
  mesh: naveRoofRaw.mesh,
  material: slate.material,
})
const transeptRoof = bindMaterial({
  mesh: transeptRoofRaw.mesh,
  material: slate.material,
})
const tower = bindMaterial({
  mesh: towerRaw.mesh,
  material: stone.material,
})
const belfry = bindMaterial({
  mesh: belfryRaw.mesh,
  material: stone.material,
})
const spire = bindMaterial({
  mesh: spireRaw.mesh,
  material: iron.material,
})

const root = scopeSceneNode({
  name: "Chapel",
  schema: "scope",
})
const foundationNode = meshSceneNode({
  name: "Foundation",
  mesh: foundation.mesh,
})
const naveNode = meshSceneNode({
  name: "Nave",
  mesh: nave.mesh,
})
const transeptNode = meshSceneNode({
  name: "Transepts",
  mesh: transepts.mesh,
})
const naveRoofNode = meshSceneNode({
  name: "NaveRoof",
  mesh: naveRoof.mesh,
})
const transeptRoofNode = meshSceneNode({
  name: "TranseptRoof",
  mesh: transeptRoof.mesh,
})
const towerNode = meshSceneNode({
  name: "Tower",
  mesh: tower.mesh,
})
const belfryNode = meshSceneNode({
  name: "Belfry",
  mesh: belfry.mesh,
})
const spireNode = meshSceneNode({
  name: "Spire",
  mesh: spire.mesh,
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
  child: naveNode.scene,
  name: "Nave",
  x: 0,
  y: 0,
  z: 0.5,
})
const c = place({
  scene: b.scene,
  child: transeptNode.scene,
  name: "Transepts",
  x: 0,
  y: 0,
  z: 0.5,
})
const d = place({
  scene: c.scene,
  child: towerNode.scene,
  name: "Tower",
  x: 0,
  y: 0,
  z: 0.5,
})
const e = place({
  scene: d.scene,
  child: naveRoofNode.scene,
  name: "NaveRoof",
  x: 0,
  y: 0,
  z: 8.0,
})
const f = place({
  scene: e.scene,
  child: transeptRoofNode.scene,
  name: "TranseptRoof",
  x: 0,
  y: 0,
  z: 6.0,
})
const g = place({
  scene: f.scene,
  child: belfryNode.scene,
  name: "Belfry",
  x: 0,
  y: 0,
  z: 17.0,
})
export const chapel = place({
  scene: g.scene,
  child: spireNode.scene,
  name: "Spire",
  x: 0,
  y: 0,
  z: 21.5,
})
