// @scene-module-id module.coastal.highRise
import { stone } from "../looks/stone.material.ts"
import { brick } from "../looks/brick.material.ts"
import { slate } from "../looks/slate.material.ts"
import { iron } from "../looks/iron.material.ts"
import { plaster } from "../looks/plaster.material.ts"

const plot = controlPoints({
  points: [[0, 0]],
})
// Deep foundation plinth extending below ground to prevent slope clipping
const foundationRaw = gridToBoxes({
  points: plot.points,
  buildingHeight: 3.2,
  footprint: 14.8,
  cellSize: 1,
})
// Podium: 3-story grand commercial entrance hall with arcade
const podiumRaw = gridToBoxes({
  points: plot.points,
  buildingHeight: 6.8,
  footprint: 14.2,
  cellSize: 1,
})
// Lower Tower: 6 stories of masonry office block
const midTowerRaw = gridToBoxes({
  points: plot.points,
  buildingHeight: 16.5,
  footprint: 10.8,
  cellSize: 1,
})
// Upper Setback Tower: 4 stories of steel/glass framed tower
const upperTowerRaw = gridToBoxes({
  points: plot.points,
  buildingHeight: 12.0,
  footprint: 8.2,
  cellSize: 1,
})
// Crown: Penthouse structure
const crownRaw = gridToBoxes({
  points: plot.points,
  buildingHeight: 4.2,
  footprint: 5.6,
  cellSize: 1,
})
// Spire / Antenna pinnacle
const spireRaw = gridToBoxes({
  points: plot.points,
  buildingHeight: 7.5,
  footprint: 1.1,
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
const midTower = bindMaterial({
  mesh: midTowerRaw.mesh,
  material: brick.material,
})
const upperTower = bindMaterial({
  mesh: upperTowerRaw.mesh,
  material: plaster.material,
})
const crown = bindMaterial({
  mesh: crownRaw.mesh,
  material: slate.material,
})
const spire = bindMaterial({
  mesh: spireRaw.mesh,
  material: iron.material,
})

const root = scopeSceneNode({
  name: "HighRise",
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
const midTowerNode = meshSceneNode({
  name: "MidTower",
  mesh: midTower.mesh,
})
const upperTowerNode = meshSceneNode({
  name: "UpperTower",
  mesh: upperTower.mesh,
})
const crownNode = meshSceneNode({
  name: "Crown",
  mesh: crown.mesh,
})
const spireNode = meshSceneNode({
  name: "Spire",
  mesh: spire.mesh,
})

// Anchor foundation starting at z = -2.5m below ground
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
  child: midTowerNode.scene,
  name: "MidTower",
  x: 0,
  y: 0,
  z: 7.3,
})
const d = place({
  scene: c.scene,
  child: upperTowerNode.scene,
  name: "UpperTower",
  x: 0,
  y: 0,
  z: 23.8,
})
const e = place({
  scene: d.scene,
  child: crownNode.scene,
  name: "Crown",
  x: 0,
  y: 0,
  z: 35.8,
})
export const highRise = place({
  scene: e.scene,
  child: spireNode.scene,
  name: "Spire",
  x: 0,
  y: 0,
  z: 40.0,
})
