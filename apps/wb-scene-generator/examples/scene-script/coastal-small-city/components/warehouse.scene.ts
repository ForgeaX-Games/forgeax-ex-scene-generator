// @scene-module-id module.coastal.warehouse
import { timber } from "../looks/timber.material.ts"
import { slate } from "../looks/slate.material.ts"
import { stone } from "../looks/stone.material.ts"
import { brick } from "../looks/brick.material.ts"

const bays = controlPoints({
  points: [[-7.5, 0], [0, 0], [7.5, 0]],
})
// Deep stone quayside foundation plinth
const foundationRaw = gridToBoxes({
  points: bays.points,
  buildingHeight: 3.0,
  footprint: 7.8,
  cellSize: 1,
})
// Main warehouse timber/brick walls
const wallRaw = gridToBoxes({
  points: bays.points,
  buildingHeight: 5.2,
  footprint: 7.2,
  cellSize: 1,
})
// Industrial gabled slate roof with cargo dormers
const shedRaw = gabledHouses({
  points: bays.points,
  buildingHeight: 0.35,
  roofHeight: 2.8,
  footprint: 7.6,
  depth: 12.0,
  cellSize: 1,
})
// Elevated wooden quayside loading dock
const dock = controlPoints({
  points: [[-5.5, 7.5], [5.5, 7.5]],
})
const dockRaw = gridToBoxes({
  points: dock.points,
  buildingHeight: 1.2,
  footprint: 3.5,
  cellSize: 1,
})

const foundation = bindMaterial({
  mesh: foundationRaw.mesh,
  material: stone.material,
})
const walls = bindMaterial({
  mesh: wallRaw.mesh,
  material: timber.material,
})
const roof = bindMaterial({
  mesh: shedRaw.mesh,
  material: slate.material,
})
const dockPaint = bindMaterial({
  mesh: dockRaw.mesh,
  material: stone.material,
})

const root = scopeSceneNode({
  name: "Warehouse",
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
const dockNode = meshSceneNode({
  name: "Dock",
  mesh: dockPaint.mesh,
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
  child: dockNode.scene,
  name: "Dock",
  x: 0,
  y: 0,
  z: 0.5,
})
export const warehouse = place({
  scene: c.scene,
  child: roofNode.scene,
  name: "Roof",
  x: 0,
  y: 0,
  z: 5.7,
})
