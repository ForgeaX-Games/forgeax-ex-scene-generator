// @scene-module-id module.coastal.harborServiceYard
import { crate } from "./crate.scene.ts"
import { barrel } from "./barrel.scene.ts"
import { timber } from "../looks/timber.material.ts"
import { iron } from "../looks/iron.material.ts"

const mastPoints = controlPoints({
  points: [[0, 0]],
})
const mastRaw = gridToBoxes({
  points: mastPoints.points,
  buildingHeight: 5.8,
  footprint: 0.52,
  cellSize: 1,
})
const boomPoints = controlPoints({
  points: [[-1.8, 0], [-1.2, 0], [-0.6, 0], [0, 0], [0.6, 0], [1.2, 0], [1.8, 0]],
})
const boomRaw = gridToBoxes({
  points: boomPoints.points,
  buildingHeight: 0.42,
  footprint: 0.68,
  cellSize: 1,
})
const hookPoints = controlPoints({
  points: [[0, 0], [0, 0.48]],
})
const hookRaw = gridToBoxes({
  points: hookPoints.points,
  buildingHeight: 2.2,
  footprint: 0.18,
  cellSize: 1,
})
const basePoints = controlPoints({
  points: [[0, 0]],
})
const baseRaw = gridToBoxes({
  points: basePoints.points,
  buildingHeight: 0.62,
  footprint: 2.2,
  cellSize: 1,
})
const mastPaint = bindMaterial({
  mesh: mastRaw.mesh,
  material: timber.material,
})
const boomPaint = bindMaterial({
  mesh: boomRaw.mesh,
  material: timber.material,
})
const hookPaint = bindMaterial({
  mesh: hookRaw.mesh,
  material: iron.material,
})
const basePaint = bindMaterial({
  mesh: baseRaw.mesh,
  material: timber.material,
})
const root = scopeSceneNode({
  name: "HarborServiceYard",
  schema: "scope",
})
const baseNode = meshSceneNode({
  name: "CraneBase",
  mesh: basePaint.mesh,
})
const mastNode = meshSceneNode({
  name: "CraneMast",
  mesh: mastPaint.mesh,
})
const boomNode = meshSceneNode({
  name: "CraneBoom",
  mesh: boomPaint.mesh,
})
const hookNode = meshSceneNode({
  name: "CraneHook",
  mesh: hookPaint.mesh,
})
const withBase = addSceneChildren({
  scene: root.scene,
  nodes: baseNode.scene,
})
const withMast = place({
  scene: withBase.scene,
  child: mastNode.scene,
  name: "CraneMast",
  x: 0,
  y: 0,
  z: 0.6,
})
const withBoom = place({
  scene: withMast.scene,
  child: boomNode.scene,
  name: "CraneBoom",
  x: 1.8,
  y: 0,
  z: 5.7,
})
const withHook = place({
  scene: withBoom.scene,
  child: hookNode.scene,
  name: "CraneRigging",
  x: 3.5,
  y: 0,
  z: 3.5,
})
const withCrates = place({
  scene: withHook.scene,
  child: crate.scene,
  name: "CargoCrates",
  x: -2.2,
  y: 1.7,
  z: 0,
})
export const harborServiceYard = place({
  scene: withCrates.scene,
  child: barrel.scene,
  name: "CargoBarrels",
  x: -1.8,
  y: -1.8,
  z: 0,
})
