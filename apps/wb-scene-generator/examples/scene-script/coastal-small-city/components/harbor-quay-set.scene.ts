// @scene-module-id module.coastal.harborQuaySet
import { crate } from "./crate.scene.ts"
import { barrel } from "./barrel.scene.ts"
import { lantern } from "./lantern.scene.ts"

const root = scopeSceneNode({
  name: "HarborQuaySet",
  schema: "scope",
})
const withCrate = place({
  scene: root.scene,
  child: crate.scene,
  name: "QuayCrate",
  x: -1.5,
  y: 0.7,
  z: 0,
})
const withBarrel = place({
  scene: withCrate.scene,
  child: barrel.scene,
  name: "QuayBarrel",
  x: 1.35,
  y: -0.45,
  z: 0,
})
export const harborQuaySet = place({
  scene: withBarrel.scene,
  child: lantern.scene,
  name: "QuayLantern",
  x: 0.15,
  y: -1.7,
  z: 0,
})
