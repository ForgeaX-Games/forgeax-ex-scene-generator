// @scene-module-id module.coastal.lighthouse
import { stone } from "../looks/stone.material.ts"
import { plaster } from "../looks/plaster.material.ts"
import { iron } from "../looks/iron.material.ts"
import { canvas } from "../looks/canvas.material.ts"
import { roofTile } from "../looks/roof-tile.material.ts"

const origin = controlPoints({
  points: [[0, 0]],
})
// Heavy stone coastal bastion plinth
const foundationRaw = gridToBoxes({
  points: origin.points,
  buildingHeight: 3.5,
  footprint: 9.5,
  cellSize: 1,
})
// Keeper's base cottage
const cottagePlots = controlPoints({
  points: [[0, 4.2]],
})
const keeperWallsRaw = gridToBoxes({
  points: cottagePlots.points,
  buildingHeight: 3.8,
  footprint: 5.2,
  cellSize: 1,
})
const keeperRoofRaw = gabledHouses({
  points: cottagePlots.points,
  buildingHeight: 0.3,
  roofHeight: 2.2,
  footprint: 5.6,
  depth: 6.2,
  cellSize: 1,
})
// Lower lighthouse shaft (masonry)
const shaftLowerRaw = gridToBoxes({
  points: origin.points,
  buildingHeight: 11.0,
  footprint: 4.8,
  cellSize: 1,
})
// Upper lighthouse shaft (tapered white plaster)
const shaftUpperRaw = gridToBoxes({
  points: origin.points,
  buildingHeight: 11.0,
  footprint: 3.6,
  cellSize: 1,
})
// Observation walkway gallery
const galleryRaw = gridToBoxes({
  points: origin.points,
  buildingHeight: 1.5,
  footprint: 5.2,
  cellSize: 1,
})
// Glass beacon lantern room
const lanternRaw = gridToBoxes({
  points: origin.points,
  buildingHeight: 3.2,
  footprint: 2.8,
  cellSize: 1,
})
// Beacon copper cap & pinnacle
const capRaw = gridToBoxes({
  points: origin.points,
  buildingHeight: 2.2,
  footprint: 1.4,
  cellSize: 1,
})

const foundation = bindMaterial({
  mesh: foundationRaw.mesh,
  material: stone.material,
})
const keeperWalls = bindMaterial({
  mesh: keeperWallsRaw.mesh,
  material: plaster.material,
})
const keeperRoof = bindMaterial({
  mesh: keeperRoofRaw.mesh,
  material: roofTile.material,
})
const shaftLower = bindMaterial({
  mesh: shaftLowerRaw.mesh,
  material: stone.material,
})
const shaftUpper = bindMaterial({
  mesh: shaftUpperRaw.mesh,
  material: plaster.material,
})
const gallery = bindMaterial({
  mesh: galleryRaw.mesh,
  material: iron.material,
})
const lantern = bindMaterial({
  mesh: lanternRaw.mesh,
  material: canvas.material,
})
const cap = bindMaterial({
  mesh: capRaw.mesh,
  material: iron.material,
})

const root = scopeSceneNode({
  name: "Lighthouse",
  schema: "scope",
})
const foundationNode = meshSceneNode({
  name: "Foundation",
  mesh: foundation.mesh,
})
const keeperWallNode = meshSceneNode({
  name: "KeeperWalls",
  mesh: keeperWalls.mesh,
})
const keeperRoofNode = meshSceneNode({
  name: "KeeperRoof",
  mesh: keeperRoof.mesh,
})
const shaftLowerNode = meshSceneNode({
  name: "ShaftLower",
  mesh: shaftLower.mesh,
})
const shaftUpperNode = meshSceneNode({
  name: "ShaftUpper",
  mesh: shaftUpper.mesh,
})
const galleryNode = meshSceneNode({
  name: "Gallery",
  mesh: gallery.mesh,
})
const lanternNode = meshSceneNode({
  name: "Lantern",
  mesh: lantern.mesh,
})
const capNode = meshSceneNode({
  name: "Cap",
  mesh: cap.mesh,
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
  child: keeperWallNode.scene,
  name: "KeeperWalls",
  x: 0,
  y: 0,
  z: 0.5,
})
const c = place({
  scene: b.scene,
  child: keeperRoofNode.scene,
  name: "KeeperRoof",
  x: 0,
  y: 0,
  z: 4.3,
})
const d = place({
  scene: c.scene,
  child: shaftLowerNode.scene,
  name: "ShaftLower",
  x: 0,
  y: 0,
  z: 0.5,
})
const e = place({
  scene: d.scene,
  child: shaftUpperNode.scene,
  name: "ShaftUpper",
  x: 0,
  y: 0,
  z: 11.5,
})
const f = place({
  scene: e.scene,
  child: galleryNode.scene,
  name: "Gallery",
  x: 0,
  y: 0,
  z: 22.5,
})
const g = place({
  scene: f.scene,
  child: lanternNode.scene,
  name: "Lantern",
  x: 0,
  y: 0,
  z: 24.0,
})
export const lighthouse = place({
  scene: g.scene,
  child: capNode.scene,
  name: "Cap",
  x: 0,
  y: 0,
  z: 27.2,
})
