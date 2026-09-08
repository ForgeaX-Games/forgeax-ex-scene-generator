// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "parkGenerator",
  "contractVersion": "2.0.0",
  "opId": "park_generator",
  "description": "Generate a park layout from a single region mask using organic, geometric, or radial algorithms. Outputs one multi-value grid with lawn, paths, garden beds, trees (asset), and ponds. Grid lists are handled per-item by the DataTree engine.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "access": "item",
      "description": "Single region mask grid (non-zero cells treated as valid park area). The engine fans out a grid list one-by-one.",
      "label": "区域掩码"
    },
    {
      "name": "algorithm",
      "type": "string",
      "access": "item",
      "defaultValue": "organic",
      "description": "Park layout algorithm: organic=naturalistic curves, geometric=formal cross, radial=spoke-and-ring.",
      "label": "布局算法",
      "options": [
        "organic",
        "geometric",
        "radial"
      ],
      "mode": "parameter"
    },
    {
      "name": "pathWidth",
      "type": "number",
      "access": "item",
      "defaultValue": 2,
      "description": "Path stroke radius in cells (minimum 1).",
      "label": "小径宽度",
      "mode": "parameter"
    },
    {
      "name": "treeCount",
      "type": "number",
      "access": "item",
      "defaultValue": 20,
      "description": "Number of tree markers to scatter across open lawn cells.",
      "label": "树木数量",
      "mode": "parameter"
    },
    {
      "name": "spokeCount",
      "type": "number",
      "access": "item",
      "defaultValue": 6,
      "description": "For radial mode: number of spoke paths from center (3–8).",
      "label": "辐射数量",
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
      "description": "Single multi-value grid: 1=lawn, 2=path, 3=garden, 4=tree, 5=pond; pipe to grid_split_by_value to separate semantics.",
      "label": "公园网格"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "access": "item",
      "description": "Name list with only ids actually present, format [{id, name, type}]; tree entries type=\"asset\", others type=\"tile\".",
      "label": "公园名称清单"
    }
  ],
  "deterministic": true
})
