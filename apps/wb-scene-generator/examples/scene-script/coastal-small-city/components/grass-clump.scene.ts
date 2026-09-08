// @scene-module-id module.coastal.grassClump
import { foliage } from "../looks/foliage.material.ts"
import { grass } from "../looks/grass.material.ts"

const tufts = controlPoints({
  points: [[-0.55, 0.1], [0, -0.15], [0.5, 0.18], [0.15, 0.45], [-0.3, -0.4]],
})
const bladeRaw = gridToBoxes({
  points: tufts.points,
  buildingHeight: 0.55,
  footprint: 0.42,
  cellSize: 1,
})
const moundRaw = gridToBoxes({
  points: tufts.points,
  buildingHeight: 0.16,
  footprint: 0.7,
  cellSize: 1,
})
const blades = bindMaterial({
  mesh: bladeRaw.mesh,
  material: foliage.material,
})
const mound = bindMaterial({
  mesh: moundRaw.mesh,
  material: grass.material,
})
const root = scopeSceneNode({
  name: "GrassClump",
  schema: "scope",
})
const moundNode = meshSceneNode({
  name: "Mound",
  mesh: mound.mesh,
})
const bladeNode = meshSceneNode({
  name: "Blades",
  mesh: blades.mesh,
})
const withMound = addSceneChildren({
  scene: root.scene,
  nodes: moundNode.scene,
})
export const grassClump = addSceneChildren({
  scene: withMound.scene,
  nodes: bladeNode.scene,
})
