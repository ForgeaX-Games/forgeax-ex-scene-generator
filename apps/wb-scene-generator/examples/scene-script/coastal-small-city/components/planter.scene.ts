// @scene-module-id module.coastal.planter
import { stone } from "../looks/stone.material.ts"
import { foliage } from "../looks/foliage.material.ts"

const pot = controlPoints({
  points: [[0, 0]],
})
const potRaw = gridToBoxes({
  points: pot.points,
  buildingHeight: 0.52,
  footprint: 0.88,
  cellSize: 1,
})
const leaves = controlPoints({
  points: [[0.16, 0.12], [-0.15, 0.18], [0.04, -0.2]],
})
const leafRaw = gridToBoxes({
  points: leaves.points,
  buildingHeight: 0.72,
  footprint: 0.38,
  cellSize: 1,
})
const potPaint = bindMaterial({
  mesh: potRaw.mesh,
  material: stone.material,
})
const leafPaint = bindMaterial({
  mesh: leafRaw.mesh,
  material: foliage.material,
})
const root = scopeSceneNode({
  name: "Planter",
  schema: "scope",
})
const potNode = meshSceneNode({
  name: "Pot",
  mesh: potPaint.mesh,
})
const leafNode = meshSceneNode({
  name: "Leaves",
  mesh: leafPaint.mesh,
})
const withPot = addSceneChildren({
  scene: root.scene,
  nodes: potNode.scene,
})
export const planter = place({
  scene: withPot.scene,
  child: leafNode.scene,
  name: "Leaves",
  x: 0,
  y: 0,
  z: 0.5,
})
