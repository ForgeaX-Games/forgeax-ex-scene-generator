// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "islandCozyVillage",
  "contractVersion": "1.0.0",
  "opId": "island_cozy_village",
  "description": "Generates a cozy island village map with beaches, grassland, forests, cottages, and docks.",
  "inputs": [
    {
      "name": "width",
      "type": "number",
      "defaultValue": 80,
      "description": "Grid column count, minimum 40.",
      "label": "网格宽度",
      "mode": "parameter"
    },
    {
      "name": "height",
      "type": "number",
      "defaultValue": 80,
      "description": "Grid row count, minimum 40.",
      "label": "网格高度",
      "mode": "parameter"
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
      "name": "islandCount",
      "type": "number",
      "defaultValue": 2,
      "description": "Number of islands to generate, 1-4.",
      "label": "岛屿数量",
      "mode": "parameter"
    },
    {
      "name": "houseCount",
      "type": "number",
      "defaultValue": 4,
      "description": "Total number of cottages on each island, 1-12.",
      "label": "民居数量",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "description": "Island map grid: 1=ocean,2=shallow,3=beach,4=grass,5=forest,6=house,7=dock,8=path,9=flower.",
      "label": "输出网格"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "description": "Name list mapping mask IDs to names, format: [{id, name, type}].",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
