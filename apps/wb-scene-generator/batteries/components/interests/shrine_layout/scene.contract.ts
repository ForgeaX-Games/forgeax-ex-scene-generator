// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "shrineLayout",
  "contractVersion": "2.0.0",
  "opId": "shrine_layout",
  "description": "Generate a shrine, clearing, or arena layout from a single region mask. Altar direction is randomly chosen from the four cardinal directions per grid; use seed to fix results. Outputs one multi-value grid. Grid lists are handled per-item by the DataTree engine.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "access": "item",
      "description": "Single region mask grid (non-zero cells treated as valid area). The engine fans out a grid list one-by-one.",
      "label": "区域掩码"
    },
    {
      "name": "algorithm",
      "type": "string",
      "access": "item",
      "defaultValue": "clearing",
      "description": "Layout algorithm: clearing=forest clearing with campfire, cruciform=rectangular ritual hall with altar, arena=circular arena with thick walls and columns.",
      "label": "布局类型",
      "options": [
        "clearing",
        "cruciform",
        "arena"
      ],
      "mode": "parameter"
    },
    {
      "name": "decorCount",
      "type": "number",
      "access": "item",
      "defaultValue": 8,
      "description": "Number of decoration positions (columns, torches, stones). Used in clearing and arena modes. Range: 3–12.",
      "label": "装饰点数量",
      "mode": "parameter"
    },
    {
      "name": "pathWidth",
      "type": "number",
      "access": "item",
      "defaultValue": 2,
      "description": "Wall thickness in cells for cruciform mode. Minimum: 1.",
      "label": "墙体厚度",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Random seed for altar direction. 0 = random each run, non-zero = fixed result.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "access": "item",
      "description": "Single multi-value grid: 1=wall, 2=floor, 3=center, 4=altar, 5=deco; pipe to grid_split_by_value to separate semantics.",
      "label": "布局网格"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "access": "item",
      "description": "Name list with only ids actually present, format [{id, name, type}]; altar and decoration entries type=\"asset\", others type=\"tile\" (deco name varies by algorithm).",
      "label": "神殿名称清单"
    }
  ],
  "deterministic": true
})
