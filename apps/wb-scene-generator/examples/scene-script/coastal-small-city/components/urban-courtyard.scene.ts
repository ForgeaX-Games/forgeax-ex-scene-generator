// @scene-module-id module.coastal.urbanCourtyard
import { bench } from "./bench.scene.ts"
import { planter } from "./planter.scene.ts"
import { lantern } from "./lantern.scene.ts"
import { timber } from "../looks/timber.material.ts"

const postPoints = controlPoints({
  points: [[-2.6, -1.9], [-2.6, 1.9], [2.6, -1.9], [2.6, 1.9]],
})
const postsRaw = gridToBoxes({
  points: postPoints.points,
  buildingHeight: 3.2,
  footprint: 0.28,
  cellSize: 1,
})
const beamPoints = controlPoints({
  points: [[-2.4, -1.9], [-1.2, -1.9], [0, -1.9], [1.2, -1.9], [2.4, -1.9], [-2.4, 1.9], [-1.2, 1.9], [0, 1.9], [1.2, 1.9], [2.4, 1.9]],
})
const beamsRaw = gridToBoxes({
  points: beamPoints.points,
  buildingHeight: 0.32,
  footprint: 1.3,
  cellSize: 1,
})
const postsPaint = bindMaterial({
  mesh: postsRaw.mesh,
  material: timber.material,
})
const beamsPaint = bindMaterial({
  mesh: beamsRaw.mesh,
  material: timber.material,
})
const root = scopeSceneNode({
  name: "UrbanCourtyard",
  schema: "scope",
})
const postNode = meshSceneNode({
  name: "PergolaPosts",
  mesh: postsPaint.mesh,
})
const beamNode = meshSceneNode({
  name: "PergolaCanopy",
  mesh: beamsPaint.mesh,
})
const withPosts = addSceneChildren({
  scene: root.scene,
  nodes: postNode.scene,
})
const withCanopy = place({
  scene: withPosts.scene,
  child: beamNode.scene,
  name: "PergolaCanopy",
  x: 0,
  y: 0,
  z: 3.15,
})
const withBenchA = place({
  scene: withCanopy.scene,
  child: bench.scene,
  name: "CourtyardBenchNorth",
  x: 0,
  y: 1.45,
  z: 0,
})
const withBenchB = place({
  scene: withBenchA.scene,
  child: bench.scene,
  name: "CourtyardBenchSouth",
  x: 0,
  y: -1.45,
  z: 0,
})
const withPlanterA = place({
  scene: withBenchB.scene,
  child: planter.scene,
  name: "CourtyardPlanterWest",
  x: -3.1,
  y: 0,
  z: 0,
})
const withPlanterB = place({
  scene: withPlanterA.scene,
  child: planter.scene,
  name: "CourtyardPlanterEast",
  x: 3.1,
  y: 0,
  z: 0,
})
export const urbanCourtyard = place({
  scene: withPlanterB.scene,
  child: lantern.scene,
  name: "CourtyardLantern",
  x: 0,
  y: 0,
  z: 0,
})
