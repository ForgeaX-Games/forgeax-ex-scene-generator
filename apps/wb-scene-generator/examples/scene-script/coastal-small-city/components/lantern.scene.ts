// @scene-module-id module.coastal.lantern
import { iron } from "../looks/iron.material.ts"
import { canvas } from "../looks/canvas.material.ts"

const origin = controlPoints({
  points: [[0, 0]],
})
const poleRaw = gridToBoxes({
  points: origin.points,
  buildingHeight: 3.05,
  footprint: 0.18,
  cellSize: 1,
})
const lampRaw = gridToBoxes({
  points: origin.points,
  buildingHeight: 0.42,
  footprint: 0.44,
  cellSize: 1,
})
const pole = bindMaterial({
  mesh: poleRaw.mesh,
  material: iron.material,
})
const lamp = bindMaterial({
  mesh: lampRaw.mesh,
  material: canvas.material,
})
const root = scopeSceneNode({
  name: "Lantern",
  schema: "scope",
})
const poleNode = meshSceneNode({
  name: "Pole",
  mesh: pole.mesh,
})
const lampNode = meshSceneNode({
  name: "Lamp",
  mesh: lamp.mesh,
})
const withPole = addSceneChildren({
  scene: root.scene,
  nodes: poleNode.scene,
})
export const lantern = place({
  scene: withPole.scene,
  child: lampNode.scene,
  name: "Lamp",
  x: 0,
  y: 0,
  z: 3.05,
})
