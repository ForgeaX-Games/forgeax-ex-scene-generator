// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "cosmosBiomeMapper",
  "contractVersion": "1.0.0",
  "opId": "cosmos_biome_mapper",
  "description": "Maps elevation and moisture grids to terrain type grid based on planet type (lush/desert/frozen/volcanic/toxic/barren).",
  "inputs": [
    {
      "name": "elevationGrid",
      "type": "grid",
      "description": "Elevation grid from cosmos_terrain_gen.elevationGrid, values 0-1000.",
      "label": "高度图"
    },
    {
      "name": "temperatureGrid",
      "type": "grid",
      "description": "Temperature grid from cosmos_terrain_gen.temperatureGrid, values 0-1000.",
      "label": "温度图"
    },
    {
      "name": "moistureGrid",
      "type": "grid",
      "description": "Moisture grid from cosmos_terrain_gen.moistureGrid, values 0-1000.",
      "label": "湿度图"
    },
    {
      "name": "planetType",
      "type": "string",
      "defaultValue": "lush",
      "description": "Planet environment type, determines terrain mapping rules.",
      "label": "星球类型",
      "options": [
        "lush",
        "desert",
        "frozen",
        "volcanic",
        "toxic",
        "barren"
      ],
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "terrainGridList",
      "type": "array",
      "description": "Multiple single-value grids, one per terrain type; each grid has the terrain id (starting from 1) at matching cells and 0 elsewhere; corresponds 1:1 with nameList.",
      "label": "地形网格列表"
    },
    {
      "name": "nameList",
      "type": "array",
      "description": "All terrain types for this planet [{id(from 1), name, type:\"tile\", height(sequential)}], sorted by height, corresponds 1:1 with terrainGridList.",
      "label": "地形名称列表"
    }
  ],
  "deterministic": true
})
