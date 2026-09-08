// @scene-module-id module.coastal.urbanStallSet
import { stall } from "./stall.scene.ts"
import { crate } from "./crate.scene.ts"
import { planter } from "./planter.scene.ts"

const root = scopeSceneNode({
  name: "UrbanStallSet",
  schema: "scope",
})
const withStall = place({
  scene: root.scene,
  child: stall.scene,
  name: "MarketStall",
  x: 0,
  y: 0.2,
  z: 0,
})
const withCrate = place({
  scene: withStall.scene,
  child: crate.scene,
  name: "MarketCrate",
  x: 1.7,
  y: -0.55,
  z: 0,
})
export const urbanStallSet = place({
  scene: withCrate.scene,
  child: planter.scene,
  name: "MarketPlanter",
  x: -1.65,
  y: 0.7,
  z: 0,
})
