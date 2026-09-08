// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "rampMaskGen",
  "contractVersion": "2.0.0",
  "opId": "ramp_mask_gen",
  "description": "Reads each region in a single grid and generates a 2x2 ramp mask at the bottom edge. Supports specifying ramp horizontal position (0~1). The engine fans out a DataTree of grids one-by-one.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "A single 2D grid (grid[y][x]); each distinct non-zero value is treated as a separate region. The engine fans out a DataTree of grids one-by-one.",
      "label": "输入网格"
    },
    {
      "name": "rampPosition",
      "type": "number",
      "access": "item",
      "defaultValue": -1,
      "description": "Horizontal position of the ramp along the region's bottom edge, 0~1 (0=leftmost, 1=rightmost). Use -1 or leave empty for random.",
      "label": "坡道位置",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Random seed for ramp placement. 0 uses current timestamp. Only used when rampPosition is random.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "access": "item",
      "description": "Ramp mask grid: ramp cells keep their region value, others are 0; with a grid-list input the engine emits one per branch as a DataTree.",
      "label": "坡道掩码"
    }
  ],
  "deterministic": true
})
