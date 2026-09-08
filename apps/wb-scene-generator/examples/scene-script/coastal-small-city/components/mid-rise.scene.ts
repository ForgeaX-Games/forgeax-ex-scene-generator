// @scene-module-id module.coastal.midRise
import { plaster } from "../looks/plaster.material.ts"
import { brick } from "../looks/brick.material.ts"
import { stone } from "../looks/stone.material.ts"
import { slate } from "../looks/slate.material.ts"

const origin = controlPoints({
  points: [[0, 0]],
})
// Deep foundation plinth
const foundationRaw = gridToBoxes({
  points: origin.points,
  buildingHeight: 3.0,
  footprint: 12.4,
  cellSize: 1,
})
// Ground floor retail storefront
const podiumRaw = gridToBoxes({
  points: origin.points,
  buildingHeight: 4.5,
  footprint: 11.8,
  cellSize: 1,
})
// 4-story masonry body
const towerRaw = gridToBoxes({
  points: origin.points,
  buildingHeight: 10.5,
  footprint: 9.6,
  cellSize: 1,
})
// Decorative classical cornice / attic
const crownRaw = gridToBoxes({
  points: origin.points,
  buildingHeight: 2.8,
  footprint: 10.2,
  cellSize: 1,
})
// Rooftop elevator / mechanical penthouse
const penthouseRaw = gridToBoxes({
  points: origin.points,
  buildingHeight: 2.2,
  footprint: 4.5,
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
  mesh: towerRaw.mesh,
  material: brick.material,
})
const crown = bindMaterial({
  mesh: crownRaw.mesh,
  material: plaster.material,
})
const penthouse = bindMaterial({
  mesh: penthouseRaw.mesh,
  material: slate.material,
})

const root = scopeSceneNode({
  name: "MidRise",
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
const towerNode = meshSceneNode({
  name: "Tower",
  mesh: shaft.mesh,
})
const crownNode = meshSceneNode({
  name: "Cornice",
  mesh: crown.mesh,
})
const penthouseNode = meshSceneNode({
  name: "Penthouse",
  mesh: penthouse.mesh,
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
  child: towerNode.scene,
  name: "Tower",
  x: 0,
  y: 0,
  z: 5.0,
})
const d = place({
  scene: c.scene,
  child: crownNode.scene,
  name: "Cornice",
  x: 0,
  y: 0,
  z: 15.5,
})
export const midRise = place({
  scene: d.scene,
  child: penthouseNode.scene,
  name: "Penthouse",
  x: 0,
  y: 0,
  z: 18.3,
})
