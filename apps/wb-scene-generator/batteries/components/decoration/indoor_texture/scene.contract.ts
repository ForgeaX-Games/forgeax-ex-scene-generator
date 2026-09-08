// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "indoorTexture",
  "contractVersion": "2.0.0",
  "opId": "indoor_texture",
  "description": "Generate indoor floor texture distribution from a single floor mask using four algorithms. Outputs one multi-value grid (each cell is texture id 1–5 or 0) and a name list. The engine fans out a DataTree of grids one-by-one.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "A single 2D floor mask grid (grid[y][x]); non-zero cells are valid floor positions. The engine fans out a DataTree of grids one-by-one.",
      "label": "楼层掩码"
    },
    {
      "name": "algorithm",
      "type": "string",
      "access": "item",
      "defaultValue": "nature",
      "description": "Texture algorithm: nature=noise+edge decay, water=environment factors, smooth=cluster smooth, mixed=hybrid.",
      "label": "算法",
      "options": [
        "nature",
        "water",
        "smooth",
        "mixed"
      ],
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
      "description": "A single multi-value texture grid; each cell is a texture id (1–5) or 0. With a grid-list input the engine emits one per branch as a DataTree.",
      "label": "纹理网格"
    },
    {
      "name": "nameList",
      "type": "array",
      "access": "item",
      "description": "Texture entries actually present, [{id, name, type:\"tile\"}], ordered id 1→5.",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
