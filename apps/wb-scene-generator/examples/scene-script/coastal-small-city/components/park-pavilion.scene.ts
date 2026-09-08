// @scene-module-id module.coastal.parkPavilion
import { timber } from "../looks/timber.material.ts"
import { slate } from "../looks/slate.material.ts"

const postPoints = controlPoints({
  points: [[-2.6, -1.8], [-2.6, 1.8], [2.6, -1.8], [2.6, 1.8]],
})
const postsRaw = gridToBoxes({
  points: postPoints.points,
  buildingHeight: 3.4,
  footprint: 0.28,
  cellSize: 1,
})
const roofOrigin = controlPoints({
  points: [[0, 0]],
})
const roofRaw = gabledHouses({
  points: roofOrigin.points,
  buildingHeight: 0.2,
  roofHeight: 1.15,
  footprint: 6.4,
  depth: 4.6,
  cellSize: 1,
})
const postsPaint = bindMaterial({
  mesh: postsRaw.mesh,
  material: timber.material,
})
const roofPaint = bindMaterial({
  mesh: roofRaw.mesh,
  material: slate.material,
})
const root = scopeSceneNode({
  name: "ParkPavilion",
  schema: "scope",
})
const postNode = meshSceneNode({
  name: "PavilionPosts",
  mesh: postsPaint.mesh,
})
const roofNode = meshSceneNode({
  name: "PavilionRoof",
  mesh: roofPaint.mesh,
})
const withPosts = addSceneChildren({
  scene: root.scene,
  nodes: postNode.scene,
})
export const parkPavilion = place({
  scene: withPosts.scene,
  child: roofNode.scene,
  name: "PavilionRoof",
  x: 0,
  y: 0,
  z: 3.35,
})
