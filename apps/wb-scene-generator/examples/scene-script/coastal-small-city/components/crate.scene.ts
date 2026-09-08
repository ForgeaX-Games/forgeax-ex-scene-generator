// @scene-module-id module.coastal.crate
import { timber } from "../looks/timber.material.ts"

const origin = controlPoints({
  points: [[0, 0]],
})
const raw = gridToBoxes({
  points: origin.points,
  buildingHeight: 0.9,
  footprint: 1.05,
  cellSize: 1,
})
const painted = bindMaterial({
  mesh: raw.mesh,
  material: timber.material,
})
export const crate = meshSceneNode({
  name: "Crate",
  mesh: painted.mesh,
})
