// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "riverLakeGen",
  "contractVersion": "2.0.0",
  "opId": "river_lake_gen",
  "description": "Generates rivers and lakes on a single input grid, automatically assigns shore/shallow/medium/deep depth zones, and optionally places water items. Grid lists are handled per-item by the DataTree engine.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "access": "item",
      "description": "Single base 2D integer grid; rivers and lakes are overlaid. The engine fans out a grid list one-by-one.",
      "label": "输入网格"
    },
    {
      "name": "inputNameList",
      "type": "array",
      "access": "item",
      "defaultValue": [],
      "description": "Name list for the input grid [{id, name}], merged with water zone names in output.",
      "label": "输入名称清单"
    },
    {
      "name": "riverCount",
      "type": "number",
      "access": "item",
      "defaultValue": 2,
      "description": "Number of rivers to generate.",
      "label": "河流数量",
      "mode": "parameter"
    },
    {
      "name": "algorithm",
      "type": "string",
      "access": "item",
      "defaultValue": "meandering",
      "description": "River path algorithm: straight, meandering, branching, or random.",
      "label": "生成算法",
      "options": [
        "straight",
        "meandering",
        "branching",
        "random"
      ],
      "mode": "parameter"
    },
    {
      "name": "minWidth",
      "type": "number",
      "access": "item",
      "defaultValue": 2,
      "description": "Minimum river width in grid cells.",
      "label": "最小河宽",
      "mode": "parameter"
    },
    {
      "name": "maxWidth",
      "type": "number",
      "access": "item",
      "defaultValue": 6,
      "description": "Maximum river width in grid cells; widest at the middle of the river.",
      "label": "最大河宽",
      "mode": "parameter"
    },
    {
      "name": "lakeCount",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Number of lakes to generate; 0 means none.",
      "label": "湖泊数量",
      "mode": "parameter"
    },
    {
      "name": "waterItems",
      "type": "array",
      "defaultValue": [],
      "description": "Names of items to scatter in water zones (e.g. [\"lily\",\"reed\"]); each gets a unique mask ID.",
      "label": "水中物品清单"
    },
    {
      "name": "seed",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Random seed; 0 uses a different seed each run.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "waterGrid",
      "type": "grid",
      "access": "item",
      "description": "Single multi-value grid with water mask overlaid; each zone has a unique ID (shore/shallow/medium/deep and water items).",
      "label": "水域网格"
    },
    {
      "name": "nameList",
      "type": "array",
      "access": "item",
      "description": "Name list [{id, name}] for all zones; input names come first, water names follow.",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
