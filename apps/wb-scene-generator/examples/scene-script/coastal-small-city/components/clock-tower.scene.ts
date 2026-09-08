// @scene-module-id module.coastal.clockTower
import { brick } from "../looks/brick.material.ts"
import { stone } from "../looks/stone.material.ts"
import { iron } from "../looks/iron.material.ts"
import { slate } from "../looks/slate.material.ts"

const origin = controlPoints({
  points: [[0, 0]],
})
// Deep foundation plinth
const foundationRaw = gridToBoxes({
  points: origin.points,
  buildingHeight: 3.2,
  footprint: 9.2,
  cellSize: 1,
})
// Ground floor podium
const podiumRaw = gridToBoxes({
  points: origin.points,
  buildingHeight: 5.5,
  footprint: 8.5,
  cellSize: 1,
})
// Tall masonry tower shaft
const shaftRaw = gridToBoxes({
  points: origin.points,
  buildingHeight: 16.0,
  footprint: 4.8,
  cellSize: 1,
})
// Clock chamber
const clockRaw = gridToBoxes({
  points: origin.points,
  buildingHeight: 4.2,
  footprint: 5.8,
  cellSize: 1,
})
// Belfry / bell room
const belfryRaw = gridToBoxes({
  points: origin.points,
  buildingHeight: 3.5,
  footprint: 4.2,
  cellSize: 1,
})
// Spire roof cap
const capRaw = gridToBoxes({
  points: origin.points,
  buildingHeight: 4.5,
  footprint: 2.2,
  cellSize: 1,
})

const foundation = bindMaterial({
  mesh: foundationRaw.mesh,
  material: stone.material,
})
const podium = bindMaterial({
  mesh: podiumRaw.mesh,
  material: stone.material,
})
const shaft = bindMaterial({
  mesh: shaftRaw.mesh,
  material: brick.material,
})
const clock = bindMaterial({
  mesh: clockRaw.mesh,
  material: iron.material,
})
const belfry = bindMaterial({
  mesh: belfryRaw.mesh,
  material: stone.material,
})
const cap = bindMaterial({
  mesh: capRaw.mesh,
  material: slate.material,
})

const root = scopeSceneNode({
  name: "ClockTower",
  schema: "scope",
})
const foundationNode = meshSceneNode({
  name: "Foundation",
  mesh: foundation.mesh,
})
const podiumNode = meshSceneNode({
  name: "Podium",
  mesh: podium.mesh,
})
const shaftNode = meshSceneNode({
  name: "Shaft",
  mesh: shaft.mesh,
})
const clockNode = meshSceneNode({
  name: "Clock",
  mesh: clock.mesh,
})
const belfryNode = meshSceneNode({
  name: "Belfry",
  mesh: belfry.mesh,
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
  child: podiumNode.scene,
  name: "Podium",
  x: 0,
  y: 0,
  z: 0.5,
})
const c = place({
  scene: b.scene,
  child: shaftNode.scene,
  name: "Shaft",
  x: 0,
  y: 0,
  z: 6.0,
})
const d = place({
  scene: c.scene,
  child: clockNode.scene,
  name: "Clock",
  x: 0,
  y: 0,
  z: 22.0,
})
const e = place({
  scene: d.scene,
  child: belfryNode.scene,
  name: "Belfry",
  x: 0,
  y: 0,
  z: 26.2,
})
export const clockTower = place({
  scene: e.scene,
  child: capNode.scene,
  name: "Cap",
  x: 0,
  y: 0,
  z: 29.7,
})
