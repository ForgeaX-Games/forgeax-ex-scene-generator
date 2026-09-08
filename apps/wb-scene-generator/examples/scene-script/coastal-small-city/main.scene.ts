// @scene-module-id module.coastalSmallCity
// Continent holds landform. City holds Urban/Suburb district children.

import { coastline, field, terrain } from "./terrain.scene.ts"
import { city } from "./districts.scene.ts"

const continent = scopeSceneNode({
  name: "Continent",
  schema: "scope",
})

const worldPlane = basePlane({
  width: 2000,
  height: 2000,
})

const worldGrid = workGrid({
  plane: worldPlane.plane,
  cellSize: 8,
})

const withTerrain = addSceneChildren({
  scene: continent.scene,
  nodes: terrain.scene,
})

const coastGuide = pointsToNode({
  name: "Coastline",
  points: coastline.points,
  style: "polyline",
})

const riverGuide = pointsToNode({
  name: "River",
  points: field.creek,
  style: "polyline",
})

const withCoast = addSceneChildren({
  scene: withTerrain.scene,
  nodes: coastGuide.scene,
})

const withRiver = addSceneChildren({
  scene: withCoast.scene,
  nodes: riverGuide.scene,
})

const assembled = addSceneChildren({
  scene: withRiver.scene,
  nodes: city.scene,
})

sceneOutput({
  scene: assembled.scene,
})
