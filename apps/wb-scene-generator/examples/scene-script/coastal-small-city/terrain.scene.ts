// @scene-module-id module.coastal.terrain
// Landform only. City content is not composed here — the derived CitySite
// is the contract a later settlement pass must consume.
import { coastalTerrain } from "./generators/coastal-terrain.generator.ts"
import { grass } from "./looks/grass.material.ts"

export const coastline = controlPoints({
  points: [
    [0, 1720],
    [140, 1648],
    [300, 1764],
    [460, 1610],
    [620, 1788],
    [780, 1564],
    [960, 1708],
    [1120, 1580],
    [1280, 1744],
    [1460, 1608],
    [1640, 1696],
    [1820, 1572],
    [2000, 1660],
  ],
})

export const seaLevel = numberValue({ value: 0 })
export const terrainSeed = numberValue({ value: 11 })

export const field = coastalTerrain({
  coastline: coastline.points,
  seaLevel: seaLevel.value,
  seed: terrainSeed.value,
  width: 2000,
  height: 2000,
  cellSize: 8,
})

const land = bindMaterial({
  mesh: field.mesh,
  material: grass.material,
})

export const terrain = meshSceneNode({
  name: "Terrain",
  mesh: land.mesh,
})
