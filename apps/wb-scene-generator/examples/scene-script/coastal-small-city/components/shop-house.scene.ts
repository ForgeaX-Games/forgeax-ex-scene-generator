// @scene-module-id module.coastal.shopHouse
import { plaster } from "../looks/plaster.material.ts"
import { roofTile } from "../looks/roof-tile.material.ts"
import { canvas } from "../looks/canvas.material.ts"
import { timber } from "../looks/timber.material.ts"
import { brick } from "../looks/brick.material.ts"
import { stone } from "../looks/stone.material.ts"

const plot = controlPoints({
  points: [[0, 0]],
})
// Deep foundation plinth
const foundationRaw = gridToBoxes({
  points: plot.points,
  buildingHeight: 3.0,
  footprint: 7.8,
  cellSize: 1,
})
// Ground floor commercial shopfront
const shopRaw = gridToBoxes({
  points: plot.points,
  buildingHeight: 3.8,
  footprint: 7.2,
  cellSize: 1,
})
// 2 upper residential floors
const upperRaw = gridToBoxes({
  points: plot.points,
  buildingHeight: 5.8,
  footprint: 6.6,
  cellSize: 1,
})
// Gabled tiled roof with overhanging eaves
const roofRaw = gabledHouses({
  points: plot.points,
  buildingHeight: 0.35,
  roofHeight: 2.8,
  footprint: 7.2,
  depth: 9.0,
  cellSize: 1,
})
// Projecting canvas canopy awning
const awning = controlPoints({
  points: [[0, 4.35]],
})
const awningRaw = gridToBoxes({
  points: awning.points,
  buildingHeight: 0.28,
  footprint: 6.6,
  cellSize: 1,
})
// Shop signboard
const sign = controlPoints({
  points: [[0, 4.5]],
})
const signRaw = gridToBoxes({
  points: sign.points,
  buildingHeight: 0.75,
  footprint: 2.2,
  cellSize: 1,
})
// Rooftop chimney
const chimney = controlPoints({
  points: [[2.2, -2.0]],
})
const chimneyRaw = gridToBoxes({
  points: chimney.points,
  buildingHeight: 2.0,
  footprint: 0.65,
  cellSize: 1,
})

const foundation = bindMaterial({
  mesh: foundationRaw.mesh,
  material: stone.material,
})
const shop = bindMaterial({
  mesh: shopRaw.mesh,
  material: brick.material,
})
const upper = bindMaterial({
  mesh: upperRaw.mesh,
  material: plaster.material,
})
const roof = bindMaterial({
  mesh: roofRaw.mesh,
  material: roofTile.material,
})
const cloth = bindMaterial({
  mesh: awningRaw.mesh,
  material: canvas.material,
})
const board = bindMaterial({
  mesh: signRaw.mesh,
  material: timber.material,
})
const stack = bindMaterial({
  mesh: chimneyRaw.mesh,
  material: brick.material,
})

const root = scopeSceneNode({
  name: "ShopHouse",
  schema: "scope",
})
const foundationNode = meshSceneNode({
  name: "Foundation",
  mesh: foundation.mesh,
})
const shopNode = meshSceneNode({
  name: "Shopfront",
  mesh: shop.mesh,
})
const upperNode = meshSceneNode({
  name: "Upper",
  mesh: upper.mesh,
})
const roofNode = meshSceneNode({
  name: "Roof",
  mesh: roof.mesh,
})
const awningNode = meshSceneNode({
  name: "Awning",
  mesh: cloth.mesh,
})
const signNode = meshSceneNode({
  name: "Sign",
  mesh: board.mesh,
})
const chimneyNode = meshSceneNode({
  name: "Chimney",
  mesh: stack.mesh,
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
  child: shopNode.scene,
  name: "Shopfront",
  x: 0,
  y: 0,
  z: 0.5,
})
const c = place({
  scene: b.scene,
  child: upperNode.scene,
  name: "Upper",
  x: 0,
  y: 0,
  z: 4.3,
})
const d = place({
  scene: c.scene,
  child: roofNode.scene,
  name: "Roof",
  x: 0,
  y: 0,
  z: 10.1,
})
const e = place({
  scene: d.scene,
  child: awningNode.scene,
  name: "Awning",
  x: 0,
  y: 0,
  z: 3.4,
})
const f = place({
  scene: e.scene,
  child: signNode.scene,
  name: "Sign",
  x: 0,
  y: 0,
  z: 4.3,
})
export const shopHouse = place({
  scene: f.scene,
  child: chimneyNode.scene,
  name: "Chimney",
  x: 0,
  y: 0,
  z: 10.1,
})
