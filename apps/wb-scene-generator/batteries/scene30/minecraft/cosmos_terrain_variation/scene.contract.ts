// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "cosmosTerrainVariation",
  "contractVersion": "1.1.0",
  "opId": "cosmos_terrain_variation",
  "description": "Merges multiple single-value terrain grids into one, then applies boundary noise to create natural terrain transitions.",
  "inputs": [
    {
      "name": "terrainGridList",
      "type": "array",
      "defaultValue": [],
      "description": "Input terrain grid list (from cosmos_biome_mapper.terrainGridList), multiple single-value terrain grids.",
      "label": "地形网格列表"
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
      "name": "variationStrength",
      "type": "number",
      "defaultValue": 1,
      "description": "Boundary perturbation multiplier; 1.0 = normal (up to 30% boundary cells replaced), 0 = disabled.",
      "label": "变化强度",
      "mode": "parameter"
    },
    {
      "name": "inputNameList",
      "type": "array",
      "defaultValue": [],
      "description": "Terrain name list (from cosmos_biome_mapper.nameList); passed through and filtered by IDs present in the output grid.",
      "label": "输入名称清单"
    }
  ],
  "outputs": [
    {
      "name": "variedGridList",
      "type": "array",
      "description": "Multiple single-value grids, one per terrain type; each grid has the terrain id at matching cells and 0 elsewhere; corresponds 1:1 with nameList.",
      "label": "细化地形网格列表"
    },
    {
      "name": "nameList",
      "type": "array",
      "description": "Terrain name entries actually present in the merged grid; filtered from inputNameList by used IDs.",
      "label": "地形名称清单"
    }
  ],
  "deterministic": true
})
