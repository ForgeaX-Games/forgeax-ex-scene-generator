// @scene-module-id module.coastal.pier
import { timber } from "../looks/timber.material.ts"
import { slate } from "../looks/slate.material.ts"
import { iron } from "../looks/iron.material.ts"

const deck = controlPoints({
  points: [[-12, 0], [-6, 0], [0, 0], [6, 0], [12, 0]],
})
// Timber piling foundation extending below water
const pilesRaw = gridToBoxes({
  points: deck.points,
  buildingHeight: 3.5,
  footprint: 1.2,
  cellSize: 1,
})
// Boardwalk plank deck
const deckRaw = gridToBoxes({
  points: deck.points,
  buildingHeight: 1.2,
  footprint: 5.4,
  cellSize: 1,
})
// Harbour master cargo shed
const shed = controlPoints({
  points: [[0, 3.2]],
})
const shedWallsRaw = gridToBoxes({
  points: shed.points,
  buildingHeight: 3.6,
  footprint: 5.2,
  cellSize: 1,
})
const shedRoofRaw = gabledHouses({
  points: shed.points,
  buildingHeight: 0.3,
  roofHeight: 2.2,
  footprint: 5.6,
  depth: 6.8,
  cellSize: 1,
})
// Mooring crane / derrick
const crane = controlPoints({
  points: [[10.5, 0]],
})
const craneRaw = gridToBoxes({
  points: crane.points,
  buildingHeight: 5.2,
  footprint: 0.8,
  cellSize: 1,
})

const piles = bindMaterial({
  mesh: pilesRaw.mesh,
  material: timber.material,
})
const deckPaint = bindMaterial({
  mesh: deckRaw.mesh,
  material: timber.material,
})
const shedWalls = bindMaterial({
  mesh: shedWallsRaw.mesh,
  material: timber.material,
})
const shedRoof = bindMaterial({
  mesh: shedRoofRaw.mesh,
  material: slate.material,
})
const cranePaint = bindMaterial({
  mesh: craneRaw.mesh,
  material: iron.material,
})

const root = scopeSceneNode({
  name: "Pier",
  schema: "scope",
})
const pilesNode = meshSceneNode({
  name: "Piles",
  mesh: piles.mesh,
})
const deckNode = meshSceneNode({
  name: "Deck",
  mesh: deckPaint.mesh,
})
const shedWallNode = meshSceneNode({
  name: "ShedWalls",
  mesh: shedWalls.mesh,
})
const shedRoofNode = meshSceneNode({
  name: "ShedRoof",
  mesh: shedRoof.mesh,
})
const craneNode = meshSceneNode({
  name: "Crane",
  mesh: cranePaint.mesh,
})

const a = place({
  scene: root.scene,
  child: pilesNode.scene,
  name: "Piles",
  x: 0,
  y: 0,
  z: -2.5,
})
const b = place({
  scene: a.scene,
  child: deckNode.scene,
  name: "Deck",
  x: 0,
  y: 0,
  z: 0.2,
})
const c = place({
  scene: b.scene,
  child: shedWallNode.scene,
  name: "ShedWalls",
  x: 0,
  y: 0,
  z: 1.4,
})
const d = place({
  scene: c.scene,
  child: shedRoofNode.scene,
  name: "ShedRoof",
  x: 0,
  y: 0,
  z: 5.0,
})
export const pier = place({
  scene: d.scene,
  child: craneNode.scene,
  name: "Crane",
  x: 0,
  y: 0,
  z: 1.4,
})
