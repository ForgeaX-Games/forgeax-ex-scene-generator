// @scene-module-id module.coastal.cottage
import { plaster } from "../looks/plaster.material.ts"
import { roofTile } from "../looks/roof-tile.material.ts"
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
  footprint: 6.8,
  cellSize: 1,
})
// Main 1.5-story wall body
const wallRaw = gridToBoxes({
  points: plot.points,
  buildingHeight: 4.2,
  footprint: 5.8,
  cellSize: 1,
})
// Cross-gabled tile roof
const roofRaw = gabledHouses({
  points: plot.points,
  buildingHeight: 0.35,
  roofHeight: 2.8,
  footprint: 6.5,
  depth: 8.2,
  cellSize: 1,
})
// Front porch
const porch = controlPoints({
  points: [[0, 3.8]],
})
const porchRaw = gridToBoxes({
  points: porch.points,
  buildingHeight: 2.3,
  footprint: 2.8,
  cellSize: 1,
})
// Side wing
const wing = controlPoints({
  points: [[3.2, -0.4]],
})
const wingRaw = gridToBoxes({
  points: wing.points,
  buildingHeight: 3.2,
  footprint: 2.6,
  cellSize: 1,
})
// Chimney
const chimney = controlPoints({
  points: [[-2.2, -1.6]],
})
const chimneyRaw = gridToBoxes({
  points: chimney.points,
  buildingHeight: 2.2,
  footprint: 0.75,
  cellSize: 1,
})

const foundation = bindMaterial({
  mesh: foundationRaw.mesh,
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
const porchPaint = bindMaterial({
  mesh: porchRaw.mesh,
  material: timber.material,
})
const wingPaint = bindMaterial({
  mesh: wingRaw.mesh,
  material: plaster.material,
})
const stack = bindMaterial({
  mesh: chimneyRaw.mesh,
  material: brick.material,
})

const root = scopeSceneNode({
  name: "Cottage",
  schema: "scope",
})
const foundationNode = meshSceneNode({
  name: "Foundation",
  mesh: foundation.mesh,
})
const wallNode = meshSceneNode({
  name: "Walls",
  mesh: walls.mesh,
})
const roofNode = meshSceneNode({
  name: "Roof",
  mesh: roof.mesh,
})
const porchNode = meshSceneNode({
  name: "Porch",
  mesh: porchPaint.mesh,
})
const wingNode = meshSceneNode({
  name: "Wing",
  mesh: wingPaint.mesh,
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
  child: wallNode.scene,
  name: "Walls",
  x: 0,
  y: 0,
  z: 0.5,
})
const c = place({
  scene: b.scene,
  child: wingNode.scene,
  name: "Wing",
  x: 0,
  y: 0,
  z: 0.5,
})
const d = place({
  scene: c.scene,
  child: porchNode.scene,
  name: "Porch",
  x: 0,
  y: 0,
  z: 0.5,
})
const e = place({
  scene: d.scene,
  child: roofNode.scene,
  name: "Roof",
  x: 0,
  y: 0,
  z: 4.7,
})
export const cottage = place({
  scene: e.scene,
  child: chimneyNode.scene,
  name: "Chimney",
  x: 0,
  y: 0,
  z: 4.7,
})
