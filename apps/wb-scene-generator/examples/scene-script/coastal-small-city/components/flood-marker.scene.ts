// @scene-module-id module.coastal.floodMarker
import { stone } from "../looks/stone.material.ts"
import { slate } from "../looks/slate.material.ts"

const origin = controlPoints({
  points: [[0, 0]],
})
const plinthRaw = gridToBoxes({
  points: origin.points,
  buildingHeight: 0.42,
  footprint: 1.15,
  cellSize: 1,
})
const shaftRaw = gridToBoxes({
  points: origin.points,
  buildingHeight: 1.85,
  footprint: 0.38,
  cellSize: 1,
})
const plaqueRaw = gridToBoxes({
  points: origin.points,
  buildingHeight: 0.62,
  footprint: 0.72,
  cellSize: 1,
})
const plinthPaint = bindMaterial({
  mesh: plinthRaw.mesh,
  material: stone.material,
})
const shaftPaint = bindMaterial({
  mesh: shaftRaw.mesh,
  material: stone.material,
})
const plaquePaint = bindMaterial({
  mesh: plaqueRaw.mesh,
  material: slate.material,
})
const root = scopeSceneNode({
  name: "FloodMarker",
  schema: "scope",
})
const plinthNode = meshSceneNode({
  name: "MarkerPlinth",
  mesh: plinthPaint.mesh,
})
const shaftNode = meshSceneNode({
  name: "MarkerShaft",
  mesh: shaftPaint.mesh,
})
const plaqueNode = meshSceneNode({
  name: "MarkerPlaque",
  mesh: plaquePaint.mesh,
})
const withPlinth = addSceneChildren({
  scene: root.scene,
  nodes: plinthNode.scene,
})
const withShaft = place({
  scene: withPlinth.scene,
  child: shaftNode.scene,
  name: "MarkerShaft",
  x: 0,
  y: 0,
  z: 0.42,
})
export const floodMarker = place({
  scene: withShaft.scene,
  child: plaqueNode.scene,
  name: "MarkerPlaque",
  x: 0.22,
  y: 0,
  z: 1.15,
})
