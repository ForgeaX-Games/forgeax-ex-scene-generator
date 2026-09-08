// @scene-module-id module.coastal.barrel
import { timber } from "../looks/timber.material.ts"

const origin = controlPoints({
  points: [[0, 0]],
})
const raw = gridToBoxes({
  points: origin.points,
  buildingHeight: 1.2,
  footprint: 0.78,
  cellSize: 1,
})
const painted = bindMaterial({
  mesh: raw.mesh,
  material: timber.material,
})
export const barrel = meshSceneNode({
  name: "Barrel",
  mesh: painted.mesh,
})
