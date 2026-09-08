// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "cosmosTerrainGen",
  "contractVersion": "1.0.0",
  "opId": "cosmos_terrain_gen",
  "description": "Generates elevation, temperature, and moisture grids using warped simplex FBM for cosmos-style planet terrain.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "array",
      "defaultValue": [],
      "description": "Grid list (or single grid) used to infer width/height from the first entry; defaults to 64×64 if absent.",
      "label": "网格输入"
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
      "name": "noiseScale",
      "type": "number",
      "defaultValue": 0.02,
      "description": "FBM sampling scale; smaller values create smoother terrain.",
      "label": "噪声缩放",
      "mode": "parameter"
    },
    {
      "name": "warpStrength",
      "type": "number",
      "defaultValue": 15,
      "description": "Domain warp strength; higher values create more organic terrain.",
      "label": "扭曲强度",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "elevationGrid",
      "type": "grid",
      "description": "Elevation grid, values 0-1000.",
      "label": "高度图"
    },
    {
      "name": "temperatureGrid",
      "type": "grid",
      "description": "Temperature grid, values 0-1000.",
      "label": "温度图"
    },
    {
      "name": "moistureGrid",
      "type": "grid",
      "description": "Moisture grid, values 0-1000.",
      "label": "湿度图"
    }
  ],
  "deterministic": true
})
