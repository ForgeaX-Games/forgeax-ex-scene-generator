// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "lakeGen",
  "contractVersion": "2.0.0",
  "opId": "lake_gen",
  "description": "Generate organic lakes inside a designated area of a single mask grid. Each lake receives a unique ID; outputs one multi-value grid and a name list. Grid lists are handled per-item by the DataTree engine.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "access": "item",
      "description": "Single source mask grid (number[][]); lakes are placed in cells whose value equals targetId. The engine fans out a grid list one-by-one.",
      "label": "输入网格"
    },
    {
      "name": "targetId",
      "type": "number",
      "access": "item",
      "defaultValue": 1,
      "description": "Cell value marking the valid area for lake placement.",
      "label": "目标区域ID",
      "mode": "parameter"
    },
    {
      "name": "lakeCount",
      "type": "number",
      "access": "item",
      "defaultValue": 3,
      "description": "Number of lakes to generate.",
      "label": "湖泊数量",
      "mode": "parameter"
    },
    {
      "name": "lakeSize",
      "type": "number",
      "access": "item",
      "defaultValue": 50,
      "description": "Target size of each lake in grid cells.",
      "label": "湖泊大小",
      "mode": "parameter"
    },
    {
      "name": "sizeVariance",
      "type": "number",
      "access": "item",
      "defaultValue": 0.3,
      "description": "Size randomness factor (0 = all same size, 1 = ±100% variance). Recommended 0.1–0.5.",
      "label": "大小随机性",
      "mode": "parameter"
    },
    {
      "name": "minSpacing",
      "type": "number",
      "access": "item",
      "defaultValue": 3,
      "description": "Minimum gap in cells between any two lakes.",
      "label": "最小间距",
      "mode": "parameter"
    },
    {
      "name": "lakeBaseId",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Starting mask ID for lakes; 0 = auto (max existing grid value + 1).",
      "label": "起始掩码ID",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Random seed; 0 uses the current timestamp for a different result each run.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "access": "item",
      "description": "Single multi-value grid: each lake gets an increasing id, 0 elsewhere; pipe to grid_split_by_value to separate lakes.",
      "label": "湖泊网格"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "access": "item",
      "description": "Lake name list [{id, name, type}] aligned with the ids in the grid.",
      "label": "湖泊清单"
    }
  ],
  "deterministic": true
})
