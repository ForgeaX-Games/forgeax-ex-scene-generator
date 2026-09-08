// @scene-module-id module.coastal.stall
import { timber } from "../looks/timber.material.ts"
import { canvas } from "../looks/canvas.material.ts"

const table = controlPoints({
  points: [[0, 0]],
})
const tableRaw = gridToBoxes({
  points: table.points,
  buildingHeight: 1.05,
  footprint: 1.85,
  cellSize: 1,
})
const canopyRaw = gridToBoxes({
  points: table.points,
  buildingHeight: 0.28,
  footprint: 2.35,
  cellSize: 1,
})
const tablePaint = bindMaterial({
  mesh: tableRaw.mesh,
  material: timber.material,
})
const canopyPaint = bindMaterial({
  mesh: canopyRaw.mesh,
  material: canvas.material,
})
const root = scopeSceneNode({
  name: "Stall",
  schema: "scope",
})
const tableNode = meshSceneNode({
  name: "Table",
  mesh: tablePaint.mesh,
})
const canopyNode = meshSceneNode({
  name: "Canopy",
  mesh: canopyPaint.mesh,
})
const withTable = addSceneChildren({
  scene: root.scene,
  nodes: tableNode.scene,
})
export const stall = place({
  scene: withTable.scene,
  child: canopyNode.scene,
  name: "Canopy",
  x: 0,
  y: 0,
  z: 1.88,
})
