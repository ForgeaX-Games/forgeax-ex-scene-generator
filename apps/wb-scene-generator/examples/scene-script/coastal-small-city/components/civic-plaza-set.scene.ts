// @scene-module-id module.coastal.civicPlazaSet
import { bench } from "./bench.scene.ts"
import { planter } from "./planter.scene.ts"
import { lantern } from "./lantern.scene.ts"

const root = scopeSceneNode({
  name: "CivicPlazaSet",
  schema: "scope",
})
const withBench = place({
  scene: root.scene,
  child: bench.scene,
  name: "PlazaBench",
  x: -1.6,
  y: 0.2,
  z: 0,
})
const withPlanter = place({
  scene: withBench.scene,
  child: planter.scene,
  name: "PlazaPlanter",
  x: 1.5,
  y: 0.85,
  z: 0,
})
export const civicPlazaSet = place({
  scene: withPlanter.scene,
  child: lantern.scene,
  name: "PlazaLantern",
  x: 0.1,
  y: -1.55,
  z: 0,
})
