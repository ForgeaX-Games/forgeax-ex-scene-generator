// @scene-module-id module.coastal.streetTree
import { timber } from "../looks/timber.material.ts"
import { foliage } from "../looks/foliage.material.ts"

// Tree base collar and trunk
const origin = controlPoints({
  points: [[0, 0]],
})
// Deep root collar anchored below ground
const rootCollarRaw = gridToBoxes({
  points: origin.points,
  buildingHeight: 1.6,
  footprint: 0.65,
  cellSize: 1,
})
// Main slender tree trunk
const trunkRaw = gridToBoxes({
  points: origin.points,
  buildingHeight: 4.2,
  footprint: 0.38,
  cellSize: 1,
})
// Branching fork nodes supporting the canopy
const branchPlots = controlPoints({
  points: [[0.42, 0.28], [-0.38, 0.35], [0.12, -0.48]],
})
const branchRaw = gridToBoxes({
  points: branchPlots.points,
  buildingHeight: 1.8,
  footprint: 0.26,
  cellSize: 1,
})

// Tier 1: Lower broad canopy skirt
const canopyLowerPlots = controlPoints({
  points: [[0.82, 0.1], [-0.78, 0.15], [0.1, 0.85], [-0.08, -0.82]],
})
const canopyLowerRaw = gridToBoxes({
  points: canopyLowerPlots.points,
  buildingHeight: 1.8,
  footprint: 2.4,
  cellSize: 1,
})

// Tier 2: Mid main foliage crown
const canopyMidPlots = controlPoints({
  points: [[0, 0], [0.52, 0.48], [-0.48, 0.52], [0.46, -0.5], [-0.52, -0.45]],
})
const canopyMidRaw = gridToBoxes({
  points: canopyMidPlots.points,
  buildingHeight: 2.2,
  footprint: 2.2,
  cellSize: 1,
})

// Tier 3: Upper canopy peak
const canopyTopPlots = controlPoints({
  points: [[0, 0], [0.22, -0.18], [-0.18, 0.22]],
})
const canopyTopRaw = gridToBoxes({
  points: canopyTopPlots.points,
  buildingHeight: 1.9,
  footprint: 1.65,
  cellSize: 1,
})

const rootCollar = bindMaterial({
  mesh: rootCollarRaw.mesh,
  material: timber.material,
})
const trunk = bindMaterial({
  mesh: trunkRaw.mesh,
  material: timber.material,
})
const branches = bindMaterial({
  mesh: branchRaw.mesh,
  material: timber.material,
})
const lowerCanopy = bindMaterial({
  mesh: canopyLowerRaw.mesh,
  material: foliage.material,
})
const midCanopy = bindMaterial({
  mesh: canopyMidRaw.mesh,
  material: foliage.material,
})
const topCanopy = bindMaterial({
  mesh: canopyTopRaw.mesh,
  material: foliage.material,
})

const root = scopeSceneNode({
  name: "StreetTree",
  schema: "scope",
})
const rootCollarNode = meshSceneNode({
  name: "RootCollar",
  mesh: rootCollar.mesh,
})
const trunkNode = meshSceneNode({
  name: "Trunk",
  mesh: trunk.mesh,
})
const branchNode = meshSceneNode({
  name: "Branches",
  mesh: branches.mesh,
})
const lowerNode = meshSceneNode({
  name: "CanopyLower",
  mesh: lowerCanopy.mesh,
})
const midNode = meshSceneNode({
  name: "CanopyMid",
  mesh: midCanopy.mesh,
})
const topNode = meshSceneNode({
  name: "CanopyTop",
  mesh: topCanopy.mesh,
})

const a = place({
  scene: root.scene,
  child: rootCollarNode.scene,
  name: "RootCollar",
  x: 0,
  y: 0,
  z: -1.0,
})
const b = place({
  scene: a.scene,
  child: trunkNode.scene,
  name: "Trunk",
  x: 0,
  y: 0,
  z: 0.2,
})
const c = place({
  scene: b.scene,
  child: branchNode.scene,
  name: "Branches",
  x: 0,
  y: 0,
  z: 3.2,
})
const d = place({
  scene: c.scene,
  child: lowerNode.scene,
  name: "CanopyLower",
  x: 0,
  y: 0,
  z: 3.6,
})
const e = place({
  scene: d.scene,
  child: midNode.scene,
  name: "CanopyMid",
  x: 0,
  y: 0,
  z: 4.8,
})
export const streetTree = place({
  scene: e.scene,
  child: topNode.scene,
  name: "CanopyTop",
  x: 0,
  y: 0,
  z: 6.2,
})
