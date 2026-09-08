// @scene-module-id module.coastal.suburbOrchard
import { streetTree } from "./street-tree.scene.ts"
import { hedge } from "./hedge.scene.ts"
import { well } from "./well.scene.ts"
import { grassClump } from "./grass-clump.scene.ts"

const root = scopeSceneNode({
  name: "SuburbOrchard",
  schema: "scope",
})
const withTreeA = place({
  scene: root.scene,
  child: streetTree.scene,
  name: "OrchardTreeA",
  x: -3.2,
  y: 1.9,
  z: 0,
})
const withTreeB = place({
  scene: withTreeA.scene,
  child: streetTree.scene,
  name: "OrchardTreeB",
  x: 0.2,
  y: -2.2,
  z: 0,
})
const withTreeC = place({
  scene: withTreeB.scene,
  child: streetTree.scene,
  name: "OrchardTreeC",
  x: 3.4,
  y: 1.6,
  z: 0,
})
const withHedgeA = place({
  scene: withTreeC.scene,
  child: hedge.scene,
  name: "OrchardHedgeWest",
  x: -4.8,
  y: 0,
  z: 0,
})
const withHedgeB = place({
  scene: withHedgeA.scene,
  child: hedge.scene,
  name: "OrchardHedgeEast",
  x: 4.8,
  y: 0,
  z: 0,
})
const withWell = place({
  scene: withHedgeB.scene,
  child: well.scene,
  name: "OrchardWell",
  x: 0,
  y: 2.4,
  z: 0,
})
export const suburbOrchard = place({
  scene: withWell.scene,
  child: grassClump.scene,
  name: "OrchardMeadow",
  x: 0,
  y: 0,
  z: 0,
})
