// @scene-module-id module.coastal.suburbGardenSet
import { hedge } from "./hedge.scene.ts"
import { planter } from "./planter.scene.ts"
import { well } from "./well.scene.ts"
import { grassClump } from "./grass-clump.scene.ts"

const root = scopeSceneNode({
  name: "SuburbGardenSet",
  schema: "scope",
})
const withHedge = place({
  scene: root.scene,
  child: hedge.scene,
  name: "GardenHedge",
  x: -2.1,
  y: 0.15,
  z: 0,
})
const withPlanter = place({
  scene: withHedge.scene,
  child: planter.scene,
  name: "GardenPlanter",
  x: 1.55,
  y: 0.9,
  z: 0,
})
const withWell = place({
  scene: withPlanter.scene,
  child: well.scene,
  name: "GardenWell",
  x: 0.2,
  y: -1.7,
  z: 0,
})
export const suburbGardenSet = place({
  scene: withWell.scene,
  child: grassClump.scene,
  name: "GardenGrass",
  x: 2.2,
  y: -0.6,
  z: 0,
})
