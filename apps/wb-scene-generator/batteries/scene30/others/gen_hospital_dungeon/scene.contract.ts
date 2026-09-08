// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "genHospitalDungeon",
  "contractVersion": "2.0.0",
  "opId": "gen_hospital_dungeon",
  "description": "BSP binary space partitioning dungeon generator producing hospital-style rooms connected by L-shaped corridors. Spawn, portal and decors are encoded as mask IDs in the grid.",
  "inputs": [
    {
      "name": "width",
      "type": "number",
      "defaultValue": 72,
      "description": "Grid column count, minimum 40.",
      "label": "网格宽度",
      "mode": "parameter"
    },
    {
      "name": "height",
      "type": "number",
      "defaultValue": 54,
      "description": "Grid row count, minimum 30.",
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
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "description": "Hospital dungeon grid: 1=wall, 2=floor, 3=corridor, 4=portal, 5=spawn, 6=bed, 7=monitor, 8=chair, 9=light.",
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
