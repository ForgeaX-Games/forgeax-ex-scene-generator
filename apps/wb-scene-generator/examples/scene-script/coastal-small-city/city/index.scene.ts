// @scene-module-id module.coastal.city
import { rowHouse } from "../components/row-house.scene.ts"
import { midRise } from "../components/mid-rise.scene.ts"
import { civic } from "../components/civic.scene.ts"
import { pier } from "../components/pier.scene.ts"
import { streetTree } from "../components/street-tree.scene.ts"
import { districtPlan } from "../generators/district-plan.generator.ts"
import { roadNetwork } from "../generators/road-network.generator.ts"
import { parcels } from "../generators/parcels.generator.ts"
import { buildingLayout } from "../generators/building-layout.generator.ts"
import { streetTrees } from "../generators/street-trees.generator.ts"

export const cityBoundary = controlPoints({
  points: [[20, 20], [580, 20], [580, 430], [20, 430], [20, 20]],
})

export const hubs = controlPoints({
  points: [[90, 80], [260, 160], [400, 220], [480, 320]],
})

export const arterial = controlPoints({
  points: [[40, 60], [180, 90], [340, 70], [520, 110]],
})

export const density = numberValue({ value: 0.72 })
export const citySeed = numberValue({ value: 11 })

const plan = districtPlan({
  hubs: hubs.points,
  cityBoundary: cityBoundary.points,
  coastline: arterial.points,
  density: density.value,
  seed: citySeed.value,
  width: 600,
  height: 450,
})

const roads = roadNetwork({
  hubs: hubs.points,
  coastline: arterial.points,
  arterial: arterial.points,
  cityBoundary: cityBoundary.points,
  seed: citySeed.value,
  width: 600,
  height: 450,
})

const lots = parcels({
  network: roads.network,
  districts: plan.districts,
  setback: 6,
})

const buildings = buildingLayout({
  parcels: lots.parcels,
  density: density.value,
  seed: citySeed.value,
})

const trees = streetTrees({
  network: roads.network,
  buildings: buildings.placements,
  clearance: 6,
})

const catalog = prototypeCatalog({
  keys: ["row-house", "mid-rise", "civic", "pier", "street-tree"],
  prototypes: [rowHouse.scene, midRise.scene, civic.scene, pier.scene, streetTree.scene],
})

const cityRoot = scopeSceneNode({
  name: "City",
  schema: "scope",
})

const streets = meshSceneNode({
  name: "Streets",
  mesh: roads.mesh,
})

const withStreets = addSceneChildren({
  scene: cityRoot.scene,
  nodes: streets.scene,
})

const withBuildings = instantiatePlacements({
  scene: withStreets.scene,
  catalog: catalog.catalog,
  placements: buildings.placements,
})

const withTrees = instantiatePlacements({
  scene: withBuildings.scene,
  catalog: catalog.catalog,
  placements: trees.placements,
})

const hubGuide = pointsToNode({
  name: "Hubs",
  points: hubs.points,
  style: "points",
})

export const city = addSceneChildren({
  scene: withTrees.scene,
  nodes: hubGuide.scene,
})
