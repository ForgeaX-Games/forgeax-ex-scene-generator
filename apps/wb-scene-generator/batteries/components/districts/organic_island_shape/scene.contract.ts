// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "organicIslandShape",
  "contractVersion": "3.0.0",
  "opId": "organic_island_shape",
  "description": "Uses Perlin noise and distance field to reshape a single input grid into a smooth organic island, splitting ocean into land/shallow/mid/deep tiers within one multi-value grid.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "access": "item",
      "description": "Single rectangular grid; its non-zero region is used as the bounding area. Grid lists are handled per-item by the DataTree engine.",
      "label": "输入网格"
    },
    {
      "name": "noiseScale",
      "type": "number",
      "access": "item",
      "defaultValue": 3,
      "description": "Spatial frequency of Perlin noise; higher values create more jagged coastlines, lower values smoother ones. Recommended range: 1-6.",
      "label": "噪声频率",
      "mode": "parameter"
    },
    {
      "name": "noiseStrength",
      "type": "number",
      "access": "item",
      "defaultValue": 0.35,
      "description": "Noise perturbation strength: 0=perfect ellipse, 1=heavily distorted. Recommended range: 0.1-0.5.",
      "label": "噪声强度",
      "mode": "parameter"
    },
    {
      "name": "islandRatio",
      "type": "number",
      "access": "item",
      "defaultValue": 0.5,
      "description": "Fraction of the bounding box covered by land: 0.3=small island, 0.6=larger island. Range: 0.2-0.75.",
      "label": "岛屿覆盖率",
      "mode": "parameter"
    },
    {
      "name": "octaves",
      "type": "number",
      "access": "item",
      "defaultValue": 4,
      "description": "Number of noise octaves; more octaves add finer coastal details. Recommended: 2-5.",
      "label": "噪声层数",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "access": "item",
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
      "access": "item",
      "description": "Single multi-value grid: land=1, shallow=2, mid=3, deep=4, 0=outside; pipe to grid_split_by_value to separate tiers.",
      "label": "岛屿轮廓网格"
    },
    {
      "name": "nameList",
      "type": "array",
      "access": "item",
      "description": "Fixed name list: 地面(id=1), 浅水(id=2), 中水(id=3), 深水(id=4), all type=tile, matching cell values.",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
