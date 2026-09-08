// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "formatFactory",
  "contractVersion": "1.0.0",
  "opId": "format_factory",
  "description": "Validates, splits, and normalizes input grids and name lists into standard single-value grid list and canonical name entries.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "any",
      "description": "Accepts single-value grid, multi-value grid, grid list, or any nested mix.",
      "label": "网格输入"
    },
    {
      "name": "nameList",
      "type": "array",
      "description": "Name list in any nested format; will be flattened and normalized to standard entries.",
      "label": "名称清单"
    },
    {
      "name": "mode",
      "type": "string",
      "defaultValue": "sort",
      "description": "sort=run all steps (validate + split + flatten); more modes can be added later.",
      "label": "运行模式",
      "options": [
        "sort"
      ],
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGridList",
      "type": "array",
      "description": "List of single-value binary (0/1) grids after splitting.",
      "label": "网格列表"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "description": "Normalized name list with entries in format {id, name, type}.",
      "label": "名称清单"
    },
    {
      "name": "detail",
      "type": "string",
      "description": "Detailed report of each step's validation and processing result.",
      "label": "详细信息"
    }
  ],
  "deterministic": true
})
