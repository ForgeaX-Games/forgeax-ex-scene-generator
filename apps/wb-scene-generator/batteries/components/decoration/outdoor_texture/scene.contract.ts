// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "outdoorTexture",
  "contractVersion": "3.0.0",
  "opId": "outdoor_texture",
  "description": "Generate outdoor ground texture (grass/dirt/gravel/sand/wet grass/fallen leaves/moss/snow) from a single mask grid using the Whittaker biome model + multi-octave FBM. Outputs one multi-value grid and a name list. The engine fans out a DataTree of grids one-by-one.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "A single 2D mask grid (grid[y][x]); non-zero cells are valid ground. The engine fans out a DataTree of grids one-by-one.",
      "label": "掩码网格"
    },
    {
      "name": "temperature",
      "type": "number",
      "access": "item",
      "defaultValue": 0.5,
      "description": "Global temperature bias (0-1): 0=freezing (snow/moss/gravel dominant), 0.5=temperate (grass dominant), 1=scorching (sand dominant).",
      "label": "温度",
      "mode": "parameter"
    },
    {
      "name": "moisture",
      "type": "number",
      "access": "item",
      "defaultValue": 0.5,
      "description": "Global moisture bias (0-1): 0=arid (sand/gravel dominant), 0.5=moderate (grass dominant), 1=saturated (wet grass/moss dominant).",
      "label": "湿度",
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
      "description": "A single multi-value biome grid; each cell is a texture id (1–8) or 0. With a grid-list input the engine emits one per branch as a DataTree.",
      "label": "纹理网格"
    },
    {
      "name": "nameList",
      "type": "array",
      "access": "item",
      "description": "Texture entries actually present; names come from one randomly chosen 8-name theme, ordered id 1→8.",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
