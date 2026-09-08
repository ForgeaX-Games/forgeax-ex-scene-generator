// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "cosmosZoneMarker",
  "contractVersion": "1.2.0",
  "opId": "cosmos_zone_marker",
  "description": "Marks special POI zones (structure/crystal/ancient) on terrain grid using Voronoi noise.",
  "inputs": [
    {
      "name": "terrainGrid",
      "type": "array",
      "defaultValue": [],
      "description": "Terrain type grid (from cosmos_terrain_variation.variedGridList); accepts single grid or list, merged internally.",
      "label": "地形网格"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses current timestamp.",
      "label": "随机种子",
      "mode": "parameter"
    },
    {
      "name": "zoneDensity",
      "type": "number",
      "defaultValue": 0.38,
      "description": "Controls number of zone clusters on the map; higher = more clusters; 1.0 = default, 2.0 = ~2x clusters. Does not affect cluster size.",
      "label": "区域块数密度",
      "mode": "parameter"
    },
    {
      "name": "structureZoneSize",
      "type": "number",
      "defaultValue": 0.08,
      "description": "Area threshold for structure zones (0~0.5); higher = larger clusters; 0 = disabled.",
      "label": "结构区域大小",
      "mode": "parameter"
    },
    {
      "name": "crystalZoneSize",
      "type": "number",
      "defaultValue": 0.12,
      "description": "Area threshold for crystal zones (0~0.5); higher = larger clusters; 0 = disabled.",
      "label": "水晶区域大小",
      "mode": "parameter"
    },
    {
      "name": "ancientZoneSize",
      "type": "number",
      "defaultValue": 0.1,
      "description": "Area threshold for ancient zones (0~0.5); higher = larger clusters; 0 = disabled.",
      "label": "远古区域大小",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "zoneGridList",
      "type": "array",
      "description": "Multiple single-value grids, one per zone type; each grid has the zone ID (100/200/300) at matching cells and 0 elsewhere; corresponds 1:1 with nameList.",
      "label": "区域网格列表"
    },
    {
      "name": "nameList",
      "type": "array",
      "description": "Name entries for zones that actually appear [{id, name, type:\"asset\"}]; corresponds 1:1 with zoneGridList.",
      "label": "区域名称列表"
    }
  ],
  "deterministic": true
})
