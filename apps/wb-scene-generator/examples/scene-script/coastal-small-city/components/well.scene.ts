// @scene-module-id module.coastal.well
import { stone } from "../looks/stone.material.ts"
import { timber } from "../looks/timber.material.ts"
import { roofTile } from "../looks/roof-tile.material.ts"

const origin = controlPoints({
  points: [[0, 0]],
})
const curbRaw = gridToBoxes({
  points: origin.points,
  buildingHeight: 0.88,
  footprint: 1.75,
  cellSize: 1,
})
const posts = controlPoints({
  points: [[-0.68, 0], [0.68, 0]],
})
const postRaw = gridToBoxes({
  points: posts.points,
  buildingHeight: 1.85,
  footprint: 0.2,
  cellSize: 1,
})
const roofRaw = gabledHouses({
  points: origin.points,
  buildingHeight: 0.18,
  roofHeight: 0.72,
  footprint: 2.05,
  depth: 1.55,
  cellSize: 1,
})
const curb = bindMaterial({
  mesh: curbRaw.mesh,
  material: stone.material,
})
const postsPaint = bindMaterial({
  mesh: postRaw.mesh,
  material: timber.material,
})
const roof = bindMaterial({
  mesh: roofRaw.mesh,
  material: roofTile.material,
})
const root = scopeSceneNode({
  name: "Well",
  schema: "scope",
})
const curbNode = meshSceneNode({
  name: "Curb",
  mesh: curb.mesh,
})
const postNode = meshSceneNode({
  name: "Posts",
  mesh: postsPaint.mesh,
})
const roofNode = meshSceneNode({
  name: "Roof",
  mesh: roof.mesh,
})
const withCurb = addSceneChildren({
  scene: root.scene,
  nodes: curbNode.scene,
})
const withPosts = place({
  scene: withCurb.scene,
  child: postNode.scene,
  name: "Posts",
  x: 0,
  y: 0,
  z: 0.88,
})
export const well = place({
  scene: withPosts.scene,
  child: roofNode.scene,
  name: "Roof",
  x: 0,
  y: 0,
  z: 2.7,
})
