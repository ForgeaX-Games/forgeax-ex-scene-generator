// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "genVoidIslands",
  "contractVersion": "2.0.0",
  "opId": "gen_void_islands",
  "description": "Prim's MST island connector generating floating circular platforms in void space with bridges and edge glow rings. Spawn, portal and decors are encoded as mask IDs in the grid.",
  "inputs": [
    {
      "name": "width",
      "type": "number",
      "defaultValue": 68,
      "description": "Grid column count, minimum 40.",
      "label": "网格宽度",
      "mode": "parameter"
    },
    {
      "name": "height",
      "type": "number",
      "defaultValue": 68,
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
      "defaultValue": 10,
      "description": "Number of islands to generate, 3-20.",
      "label": "岛屿数量",
      "mode": "parameter"
    },
    {
      "name": "islandMinR",
      "type": "number",
      "defaultValue": 4,
      "description": "Minimum island circle radius in tiles.",
      "label": "岛屿最小半径",
      "mode": "parameter"
    },
    {
      "name": "islandMaxR",
      "type": "number",
      "defaultValue": 8,
      "description": "Maximum island circle radius in tiles.",
      "label": "岛屿最大半径",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "description": "Void islands grid: 1=void, 2=platform, 3=bridge, 4=memory fragment, 5=edge glow, 6=portal, 7=spawn, 8=obelisk, 9=crystal.",
      "label": "输出网格"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "description": "Mask ID to Chinese name mapping list (only IDs that appear in the grid).",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
