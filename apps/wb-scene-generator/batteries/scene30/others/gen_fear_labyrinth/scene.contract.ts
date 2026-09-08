// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "genFearLabyrinth",
  "contractVersion": "2.0.0",
  "opId": "gen_fear_labyrinth",
  "description": "DFS perfect maze generator with fear chambers, vein-textured walls, and blood crystals for horror dungeon scenes. Spawn, portal and decors are encoded as mask IDs in the grid.",
  "inputs": [
    {
      "name": "width",
      "type": "number",
      "defaultValue": 65,
      "description": "Grid column count, minimum 11; automatically forced to odd.",
      "label": "网格宽度",
      "mode": "parameter"
    },
    {
      "name": "height",
      "type": "number",
      "defaultValue": 65,
      "description": "Grid row count, minimum 11; automatically forced to odd.",
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
      "name": "chamberChance",
      "type": "number",
      "defaultValue": 0.2,
      "description": "Probability of widening maze intersections into fear chambers, 0-1.",
      "label": "恐惧房间概率",
      "mode": "parameter"
    },
    {
      "name": "veinChance",
      "type": "number",
      "defaultValue": 0.08,
      "description": "Probability of wall tiles adjacent to floor becoming vein tiles, 0-1.",
      "label": "血脉墙概率",
      "mode": "parameter"
    },
    {
      "name": "crystalChance",
      "type": "number",
      "defaultValue": 0.15,
      "description": "Probability of generating blood crystals inside fear chambers, 0-1.",
      "label": "晶体生成概率",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "description": "Fear labyrinth grid: 1=wall, 2=floor, 3=blood stain, 4=chamber, 5=crystal, 6=portal, 7=spawn, 8=skull decor, 9=fear eye (single POI).",
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
