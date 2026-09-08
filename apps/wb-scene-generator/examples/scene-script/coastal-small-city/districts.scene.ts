// @scene-module-id module.coastal.districts
// City → Urban/Suburb occupancy, then fabric: local lanes, parcels, style families, landmarks, street life.
import { field } from "./terrain.scene.ts"
import { coastalDistricts } from "./generators/coastal-districts.generator.ts"
import { roadNetwork } from "./generators/road-network.generator.ts"
import { localStreets } from "./generators/local-streets.generator.ts"
import { parcels } from "./generators/parcels.generator.ts"
import { civicParkPlan } from "./generators/civic-park-plan.generator.ts"
import { civicParkLayout } from "./generators/civic-park-layout.generator.ts"
import { buildingLayout } from "./generators/building-layout.generator.ts"
import { districtInfill } from "./generators/district-infill.generator.ts"
import { streetTrees } from "./generators/street-trees.generator.ts"
import { streetLife } from "./generators/street-life.generator.ts"
import { suburbYards } from "./generators/suburb-yards.generator.ts"
import { rowHouse } from "./components/row-house.scene.ts"
import { highRise } from "./components/high-rise.scene.ts"
import { midRise } from "./components/mid-rise.scene.ts"
import { civic } from "./components/civic.scene.ts"
import { pier } from "./components/pier.scene.ts"
import { streetTree } from "./components/street-tree.scene.ts"
import { warehouse } from "./components/warehouse.scene.ts"
import { shopHouse } from "./components/shop-house.scene.ts"
import { cottage } from "./components/cottage.scene.ts"
import { lighthouse } from "./components/lighthouse.scene.ts"
import { townHall } from "./components/town-hall.scene.ts"
import { clockTower } from "./components/clock-tower.scene.ts"
import { chapel } from "./components/chapel.scene.ts"
import { crate } from "./components/crate.scene.ts"
import { barrel } from "./components/barrel.scene.ts"
import { stall } from "./components/stall.scene.ts"
import { bench } from "./components/bench.scene.ts"
import { lantern } from "./components/lantern.scene.ts"
import { planter } from "./components/planter.scene.ts"
import { well } from "./components/well.scene.ts"
import { hedge } from "./components/hedge.scene.ts"
import { grassClump } from "./components/grass-clump.scene.ts"
import { harborQuaySet } from "./components/harbor-quay-set.scene.ts"
import { civicPlazaSet } from "./components/civic-plaza-set.scene.ts"
import { urbanStallSet } from "./components/urban-stall-set.scene.ts"
import { suburbGardenSet } from "./components/suburb-garden-set.scene.ts"
import { harborServiceYard } from "./components/harbor-service-yard.scene.ts"
import { civicMemorialGarden } from "./components/civic-memorial-garden.scene.ts"
import { urbanCourtyard } from "./components/urban-courtyard.scene.ts"
import { suburbOrchard } from "./components/suburb-orchard.scene.ts"
import { civicParkGate } from "./components/civic-park-gate.scene.ts"
import { floodMarker } from "./components/flood-marker.scene.ts"
import { parkPavilion } from "./components/park-pavilion.scene.ts"
import { cobble } from "./looks/cobble.material.ts"
import { packedEarth } from "./looks/packed-earth.material.ts"
import { grass } from "./looks/grass.material.ts"
import { sand } from "./looks/sand.material.ts"
import { stone } from "./looks/stone.material.ts"

const plan = coastalDistricts({
  cityBoundary: field.cityBoundary,
  shoreline: field.shoreline,
  creek: field.creek,
  harbor: field.harbor,
  heightGrid: field.heightGrid,
  cellSize: 8,
})

const roads = roadNetwork({
  hubs: plan.hubs,
  coastline: field.shoreline,
  creek: field.creek,
  arterial: field.shoreline,
  cityBoundary: field.cityBoundary,
  districts: plan.districts,
  heightGrid: field.heightGrid,
  cellSize: 8,
  seed: 11,
  width: 600,
  height: 450,
})

const locals = localStreets({
  network: roads.network,
  districts: plan.districts,
  coastline: field.shoreline,
  creek: field.creek,
  cityBoundary: field.cityBoundary,
  heightGrid: field.heightGrid,
  cellSize: 8,
  seed: 11,
})

const lots = parcels({
  network: locals.network,
  districts: plan.districts,
  setback: 6.5,
})

const parkPlan = civicParkPlan({
  blocks: locals.blocks,
  parcels: lots.parcels,
  districts: plan.districts,
  network: locals.network,
  creek: field.creek,
  heightGrid: field.heightGrid,
  cellSize: 8,
})

const buildings = buildingLayout({
  parcels: parkPlan.buildableParcels,
  districts: plan.districts,
  density: 0.94,
  seed: 11,
  heightGrid: field.heightGrid,
  cellSize: 8,
  enriched: 1,
  network: locals.network,
  reserved: parkPlan.parkRegion,
})

const park = civicParkLayout({
  park: parkPlan.park,
  heightGrid: field.heightGrid,
  cellSize: 8,
})

const infill = districtInfill({
  districts: plan.districts,
  cityBoundary: field.cityBoundary,
  parcels: parkPlan.buildableParcels,
  buildings: buildings.placements,
  network: locals.network,
  heightGrid: field.heightGrid,
  cellSize: 8,
  seed: 11,
  reserved: parkPlan.parkRegion,
})

const trees = streetTrees({
  network: locals.network,
  buildings: buildings.placements,
  structures: infill.placements,
  reserved: parkPlan.parkRegion,
  clearance: 5.4,
  heightGrid: field.heightGrid,
  cellSize: 8,
})

const life = streetLife({
  network: locals.network,
  districts: plan.districts,
  buildings: buildings.placements,
  structures: infill.placements,
  reserved: parkPlan.parkRegion,
  heightGrid: field.heightGrid,
  cellSize: 8,
  seed: 11,
  clearance: 3.6,
})

const yards = suburbYards({
  parcels: lots.parcels,
  buildings: buildings.placements,
  structures: infill.placements,
  heightGrid: field.heightGrid,
  cellSize: 8,
})

const catalog = prototypeCatalog({
  keys: [
    "row-house",
    "high-rise",
    "mid-rise",
    "civic",
    "pier",
    "street-tree",
    "warehouse",
    "shop-house",
    "cottage",
    "lighthouse",
    "town-hall",
    "clock-tower",
    "chapel",
    "crate",
    "barrel",
    "stall",
    "bench",
    "lantern",
    "planter",
    "well",
    "hedge",
    "grass-clump",
    "harbor-quay-set",
    "civic-plaza-set",
    "urban-stall-set",
    "suburb-garden-set",
    "harbor-service-yard",
    "civic-memorial-garden",
    "urban-courtyard",
    "suburb-orchard",
    "civic-park-gate",
    "flood-marker",
    "park-pavilion",
  ],
  prototypes: [
    rowHouse.scene,
    highRise.scene,
    midRise.scene,
    civic.scene,
    pier.scene,
    streetTree.scene,
    warehouse.scene,
    shopHouse.scene,
    cottage.scene,
    lighthouse.scene,
    townHall.scene,
    clockTower.scene,
    chapel.scene,
    crate.scene,
    barrel.scene,
    stall.scene,
    bench.scene,
    lantern.scene,
    planter.scene,
    well.scene,
    hedge.scene,
    grassClump.scene,
    harborQuaySet.scene,
    civicPlazaSet.scene,
    urbanStallSet.scene,
    suburbGardenSet.scene,
    harborServiceYard.scene,
    civicMemorialGarden.scene,
    urbanCourtyard.scene,
    suburbOrchard.scene,
    civicParkGate.scene,
    floodMarker.scene,
    parkPavilion.scene,
  ],
})

const cityRoot = scopeSceneNode({
  name: "City",
  schema: "scope",
})

const arterialMesh = bindMaterial({
  mesh: roads.mesh,
  material: cobble.material,
})

const laneMesh = bindMaterial({
  mesh: locals.mesh,
  material: packedEarth.material,
})

const arterialNode = meshSceneNode({
  name: "Arterials",
  mesh: arterialMesh.mesh,
})

const laneNode = meshSceneNode({
  name: "Lanes",
  mesh: laneMesh.mesh,
})

const urbanRoot = scopeSceneNode({
  name: "Urban",
  schema: "scope",
})

const suburbRoot = scopeSceneNode({
  name: "Suburb",
  schema: "scope",
})

const harborGround = bindMaterial({
  mesh: plan.harborMesh,
  material: sand.material,
})

const civicGround = bindMaterial({
  mesh: plan.civicMesh,
  material: stone.material,
})

const urbanWestGround = bindMaterial({
  mesh: plan.urbanWestMesh,
  material: packedEarth.material,
})

const urbanEastGround = bindMaterial({
  mesh: plan.urbanEastMesh,
  material: packedEarth.material,
})

const suburbWestGround = bindMaterial({
  mesh: plan.suburbWestMesh,
  material: grass.material,
})

const suburbEastGround = bindMaterial({
  mesh: plan.suburbEastMesh,
  material: grass.material,
})

const harborNode = meshSceneNode({
  name: "Harbor",
  mesh: harborGround.mesh,
})

const harborHub = pointsToNode({
  name: "HarborHub",
  points: plan.harborHub,
  style: "points",
})

const harbor = addSceneChildren({
  scene: harborNode.scene,
  nodes: harborHub.scene,
})

const civicNode = meshSceneNode({
  name: "Civic",
  mesh: civicGround.mesh,
})

const civicHub = pointsToNode({
  name: "CivicHub",
  points: plan.civicHub,
  style: "points",
})

const civicWithHub = addSceneChildren({
  scene: civicNode.scene,
  nodes: civicHub.scene,
})

const parkLawn = bindMaterial({
  mesh: park.lawnMesh,
  material: grass.material,
})
const parkRain = bindMaterial({
  mesh: park.rainGardenMesh,
  material: packedEarth.material,
})
const parkPaths = bindMaterial({
  mesh: park.pathMesh,
  material: cobble.material,
})
const parkLawnNode = meshSceneNode({
  name: "CivicParkLawn",
  mesh: parkLawn.mesh,
})
const parkRainNode = meshSceneNode({
  name: "CivicParkRainGarden",
  mesh: parkRain.mesh,
})
const parkPathNode = meshSceneNode({
  name: "CivicParkPaths",
  mesh: parkPaths.mesh,
})
const civicWithLawn = addSceneChildren({
  scene: civicWithHub.scene,
  nodes: parkLawnNode.scene,
})
const civicWithRain = addSceneChildren({
  scene: civicWithLawn.scene,
  nodes: parkRainNode.scene,
})
const civicDistrict = addSceneChildren({
  scene: civicWithRain.scene,
  nodes: parkPathNode.scene,
})

const urbanWestNode = meshSceneNode({
  name: "UrbanWest",
  mesh: urbanWestGround.mesh,
})

const urbanWestHub = pointsToNode({
  name: "UrbanWestHub",
  points: plan.urbanWestHub,
  style: "points",
})

const urbanWest = addSceneChildren({
  scene: urbanWestNode.scene,
  nodes: urbanWestHub.scene,
})

const urbanEastNode = meshSceneNode({
  name: "UrbanEast",
  mesh: urbanEastGround.mesh,
})

const urbanEastHub = pointsToNode({
  name: "UrbanEastHub",
  points: plan.urbanEastHub,
  style: "points",
})

const urbanEast = addSceneChildren({
  scene: urbanEastNode.scene,
  nodes: urbanEastHub.scene,
})

const suburbWestNode = meshSceneNode({
  name: "SuburbWest",
  mesh: suburbWestGround.mesh,
})

const suburbWestHub = pointsToNode({
  name: "SuburbWestHub",
  points: plan.suburbWestHub,
  style: "points",
})

const suburbWest = addSceneChildren({
  scene: suburbWestNode.scene,
  nodes: suburbWestHub.scene,
})

const suburbEastNode = meshSceneNode({
  name: "SuburbEast",
  mesh: suburbEastGround.mesh,
})

const suburbEastHub = pointsToNode({
  name: "SuburbEastHub",
  points: plan.suburbEastHub,
  style: "points",
})

const suburbEast = addSceneChildren({
  scene: suburbEastNode.scene,
  nodes: suburbEastHub.scene,
})

const urbanWithHarbor = addSceneChildren({
  scene: urbanRoot.scene,
  nodes: harbor.scene,
})

const urbanWithCivic = addSceneChildren({
  scene: urbanWithHarbor.scene,
  nodes: civicDistrict.scene,
})

const urbanWithWest = addSceneChildren({
  scene: urbanWithCivic.scene,
  nodes: urbanWest.scene,
})

const urban = addSceneChildren({
  scene: urbanWithWest.scene,
  nodes: urbanEast.scene,
})

const suburbWithWest = addSceneChildren({
  scene: suburbRoot.scene,
  nodes: suburbWest.scene,
})

const suburb = addSceneChildren({
  scene: suburbWithWest.scene,
  nodes: suburbEast.scene,
})

const cityWithUrban = addSceneChildren({
  scene: cityRoot.scene,
  nodes: urban.scene,
})

const cityWithSuburb = addSceneChildren({
  scene: cityWithUrban.scene,
  nodes: suburb.scene,
})

const cityWithArterials = addSceneChildren({
  scene: cityWithSuburb.scene,
  nodes: arterialNode.scene,
})

const cityWithLanes = addSceneChildren({
  scene: cityWithArterials.scene,
  nodes: laneNode.scene,
})

const cityWithBuildings = instantiatePlacements({
  scene: cityWithLanes.scene,
  catalog: catalog.catalog,
  placements: buildings.placements,
})

const cityWithPark = instantiatePlacements({
  scene: cityWithBuildings.scene,
  catalog: catalog.catalog,
  placements: park.placements,
})

const cityWithInfill = instantiatePlacements({
  scene: cityWithPark.scene,
  catalog: catalog.catalog,
  placements: infill.placements,
})

const cityWithTrees = instantiatePlacements({
  scene: cityWithInfill.scene,
  catalog: catalog.catalog,
  placements: trees.placements,
})

const cityWithYards = instantiatePlacements({
  scene: cityWithTrees.scene,
  catalog: catalog.catalog,
  placements: yards.placements,
})

export const city = instantiatePlacements({
  scene: cityWithYards.scene,
  catalog: catalog.catalog,
  placements: life.placements,
})

export { plan, roads, locals, lots, parkPlan, park, buildings, infill, life }
