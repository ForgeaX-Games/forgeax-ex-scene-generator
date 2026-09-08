// @scene-module-id module.coastal.rowHouse
import { plaster } from "../looks/plaster.material.ts"
import { roofTile } from "../looks/roof-tile.material.ts"
import { stone } from "../looks/stone.material.ts"
import { brick } from "../looks/brick.material.ts"

const plots = controlPoints({
  points: [[-2.4, 0], [2.4, 0]],
})
// Deep foundation plinth
const foundationRaw = gridToBoxes({
  points: plots.points,
  buildingHeight: 3.0,
  footprint: 5.2,
  cellSize: 1,
})
// Ground floor stoop / entry
const stoop = controlPoints({
  points: [[-2.4, 3.6], [2.4, 3.6]],
})
const stoopRaw = gridToBoxes({
  points: stoop.points,
  buildingHeight: 1.1,
  footprint: 2.2,
  cellSize: 1,
})
// 3-story townhouse bodies
const wallRaw = gridToBoxes({
  points: plots.points,
  buildingHeight: 7.8,
  footprint: 4.6,
  cellSize: 1,
})
// Twin gabled pitched roofs
const roofRaw = gabledHouses({
  points: plots.points,
  buildingHeight: 0.35,
  roofHeight: 2.6,
  footprint: 4.9,
  depth: 8.8,
  cellSize: 1,
})
// Party wall chimneys
const chimneys = controlPoints({
  points: [[-4.6, 0], [0, 0], [4.6, 0]],
})
const chimneyRaw = gridToBoxes({
  points: chimneys.points,
  buildingHeight: 1.8,
  footprint: 0.55,
  cellSize: 1,
})

const foundation = bindMaterial({
  mesh: foundationRaw.mesh,
  material: stone.material,
})
const stoops = bindMaterial({
  mesh: stoopRaw.mesh,
  material: stone.material,
})
const walls = bindMaterial({
  mesh: wallRaw.mesh,
  material: plaster.material,
})
const roof = bindMaterial({
  mesh: roofRaw.mesh,
  material: roofTile.material,
})
const stack = bindMaterial({
  mesh: chimneyRaw.mesh,
  material: brick.material,
})

const root = scopeSceneNode({
  name: "RowHouse",
  schema: "scope",
})
const foundationNode = meshSceneNode({
  name: "Foundation",
  mesh: foundation.mesh,
})
const stoopNode = meshSceneNode({
  name: "Stoops",
  mesh: stoops.mesh,
})
const wallNode = meshSceneNode({
  name: "Walls",
  mesh: walls.mesh,
})
const roofNode = meshSceneNode({
  name: "Roof",
  mesh: roof.mesh,
})
const chimneyNode = meshSceneNode({
  name: "Chimneys",
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
  child: wallNode.scene,
  name: "Walls",
  x: 0,
  y: 0,
  z: 0.5,
})
const c = place({
  scene: b.scene,
  child: stoopNode.scene,
  name: "Stoops",
  x: 0,
  y: 0,
  z: 0.5,
})
const d = place({
  scene: c.scene,
  child: roofNode.scene,
  name: "Roof",
  x: 0,
  y: 0,
  z: 8.3,
})
export const rowHouse = place({
  scene: d.scene,
  child: chimneyNode.scene,
  name: "Chimneys",
  x: 0,
  y: 0,
  z: 8.3,
})
