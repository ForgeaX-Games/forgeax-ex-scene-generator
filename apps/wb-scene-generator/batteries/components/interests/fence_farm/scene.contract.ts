// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "fenceFarm",
  "contractVersion": "2.0.0",
  "opId": "fence_farm",
  "description": "Generate a farm fence layout on a single region mask. Supports border enclosure, section dividers, and individual plot fences with gates. Outputs one multi-value grid (1=interior, 2=fence, 3=gate). Grid lists are handled per-item by the DataTree engine.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "access": "item",
      "description": "Single region mask grid (non-zero cells treated as valid area). The engine fans out a grid list one-by-one.",
      "label": "区域掩码"
    },
    {
      "name": "fenceMode",
      "type": "string",
      "access": "item",
      "defaultValue": "border",
      "description": "Fence layout: border=single outer enclosure, sections=divider fences, plots=individual enclosures.",
      "label": "栅栏形式",
      "options": [
        "border",
        "sections",
        "plots"
      ],
      "mode": "parameter"
    },
    {
      "name": "gateCount",
      "type": "number",
      "access": "item",
      "defaultValue": 2,
      "description": "For border mode: 1–4 gates placed clockwise at the center of each side.",
      "label": "栅栏门数量",
      "mode": "parameter"
    },
    {
      "name": "sectionCount",
      "type": "number",
      "access": "item",
      "defaultValue": 3,
      "description": "For sections mode: number of horizontal sections (minimum 2).",
      "label": "分区数量",
      "mode": "parameter"
    },
    {
      "name": "gateWidth",
      "type": "number",
      "access": "item",
      "defaultValue": 2,
      "description": "For sections mode: width in cells of the gate opening in each divider.",
      "label": "栅栏门宽度",
      "mode": "parameter"
    },
    {
      "name": "plotWidth",
      "type": "number",
      "access": "item",
      "defaultValue": 8,
      "description": "For plots mode: width in columns of each fenced enclosure (minimum 2).",
      "label": "围栏地块宽度",
      "mode": "parameter"
    },
    {
      "name": "plotHeight",
      "type": "number",
      "access": "item",
      "defaultValue": 8,
      "description": "For plots mode: height in rows of each fenced enclosure (minimum 2).",
      "label": "围栏地块高度",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Seed for random orientation in sections mode. 0 = random each run.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "access": "item",
      "description": "Single multi-value grid: 1=interior, 2=fence, 3=gate; pipe to grid_split_by_value to separate semantics.",
      "label": "栅栏网格"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "access": "item",
      "description": "Name list with only ids actually present, format [{id, name, type}]; gate entries type=\"asset\", others type=\"tile\".",
      "label": "栅栏名称清单"
    }
  ],
  "deterministic": true
})
