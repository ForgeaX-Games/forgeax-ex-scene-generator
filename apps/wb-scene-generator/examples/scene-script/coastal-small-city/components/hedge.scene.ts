// @scene-module-id module.coastal.hedge
import { foliage } from "../looks/foliage.material.ts"
import { stone } from "../looks/stone.material.ts"

const clumps = controlPoints({
  points: [[-1.2, 0], [0, 0], [1.2, 0]],
})
// Stone planter / curb base
const curbRaw = gridToBoxes({
  points: clumps.points,
  buildingHeight: 0.35,
  footprint: 1.35,
  cellSize: 1,
})
// Dense trimmed foliage hedge body
const bodyRaw = gridToBoxes({
  points: clumps.points,
  buildingHeight: 1.45,
  footprint: 1.15,
  cellSize: 1,
})
// Crown ridge
const crownRaw = gridToBoxes({
  points: clumps.points,
  buildingHeight: 0.45,
  footprint: 0.85,
  cellSize: 1,
})

const curb = bindMaterial({
  mesh: curbRaw.mesh,
  material: stone.material,
})
const body = bindMaterial({
  mesh: bodyRaw.mesh,
  material: foliage.material,
})
const crown = bindMaterial({
  mesh: crownRaw.mesh,
  material: foliage.material,
})

const root = scopeSceneNode({
  name: "Hedge",
  schema: "scope",
})
const curbNode = meshSceneNode({
  name: "Curb",
  mesh: curb.mesh,
})
const bodyNode = meshSceneNode({
  name: "Body",
  mesh: body.mesh,
})
const crownNode = meshSceneNode({
  name: "Crown",
  mesh: crown.mesh,
})

const a = place({
  scene: root.scene,
  child: curbNode.scene,
  name: "Curb",
  x: 0,
  y: 0,
  z: -0.3,
})
const b = place({
  scene: a.scene,
  child: bodyNode.scene,
  name: "Body",
  x: 0,
  y: 0,
  z: 0.05,
})
export const hedge = place({
  scene: b.scene,
  child: crownNode.scene,
  name: "Crown",
  x: 0,
  y: 0,
  z: 1.5,
})
