// @scene-module-id module.coastal.bench
import { timber } from "../looks/timber.material.ts"

const seat = controlPoints({
  points: [[0, 0]],
})
const seatRaw = gridToBoxes({
  points: seat.points,
  buildingHeight: 0.5,
  footprint: 1.7,
  cellSize: 1,
})
const back = controlPoints({
  points: [[0, -0.5]],
})
const backRaw = gridToBoxes({
  points: back.points,
  buildingHeight: 1.0,
  footprint: 1.65,
  cellSize: 1,
})
const seatPaint = bindMaterial({
  mesh: seatRaw.mesh,
  material: timber.material,
})
const backPaint = bindMaterial({
  mesh: backRaw.mesh,
  material: timber.material,
})
const root = scopeSceneNode({
  name: "Bench",
  schema: "scope",
})
const seatNode = meshSceneNode({
  name: "Seat",
  mesh: seatPaint.mesh,
})
const backNode = meshSceneNode({
  name: "Back",
  mesh: backPaint.mesh,
})
const withSeat = addSceneChildren({
  scene: root.scene,
  nodes: seatNode.scene,
})
export const bench = addSceneChildren({
  scene: withSeat.scene,
  nodes: backNode.scene,
})
