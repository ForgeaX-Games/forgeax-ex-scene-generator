// @scene-module-id module.coastal.civicParkGate
import { stone } from "../looks/stone.material.ts"
import { timber } from "../looks/timber.material.ts"
import { iron } from "../looks/iron.material.ts"

const postPoints = controlPoints({
  points: [[-2.1, 0], [2.1, 0]],
})
const postsRaw = gridToBoxes({
  points: postPoints.points,
  buildingHeight: 3.4,
  footprint: 0.62,
  cellSize: 1,
})
const lintelPoints = controlPoints({
  points: [[-1.4, 0], [0, 0], [1.4, 0]],
})
const lintelRaw = gridToBoxes({
  points: lintelPoints.points,
  buildingHeight: 0.38,
  footprint: 1.15,
  cellSize: 1,
})
const plaquePoints = controlPoints({
  points: [[0, 0.15]],
})
const plaqueRaw = gridToBoxes({
  points: plaquePoints.points,
  buildingHeight: 0.55,
  footprint: 1.4,
  cellSize: 1,
})
const postsPaint = bindMaterial({
  mesh: postsRaw.mesh,
  material: stone.material,
})
const lintelPaint = bindMaterial({
  mesh: lintelRaw.mesh,
  material: timber.material,
})
const plaquePaint = bindMaterial({
  mesh: plaqueRaw.mesh,
  material: iron.material,
})
const root = scopeSceneNode({
  name: "CivicParkGate",
  schema: "scope",
})
const postNode = meshSceneNode({
  name: "GatePosts",
  mesh: postsPaint.mesh,
})
const lintelNode = meshSceneNode({
  name: "GateLintel",
  mesh: lintelPaint.mesh,
})
const plaqueNode = meshSceneNode({
  name: "GatePlaque",
  mesh: plaquePaint.mesh,
})
const withPosts = addSceneChildren({
  scene: root.scene,
  nodes: postNode.scene,
})
const withLintel = place({
  scene: withPosts.scene,
  child: lintelNode.scene,
  name: "GateLintel",
  x: 0,
  y: 0,
  z: 3.35,
})
export const civicParkGate = place({
  scene: withLintel.scene,
  child: plaqueNode.scene,
  name: "GatePlaque",
  x: 0,
  y: 0.2,
  z: 2.2,
})
