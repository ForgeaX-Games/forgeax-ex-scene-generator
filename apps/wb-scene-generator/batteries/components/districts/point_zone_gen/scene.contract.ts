// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "pointZoneGen",
  "contractVersion": "2.0.0",
  "opId": "point_zone_gen",
  "description": "Grows organic zones from given seed points with target area each; all zones are written into one multi-value grid (each zone an increasing id), with the height field passed through to the name list for renderer cliff/elevation processing.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "access": "item",
      "description": "Single input grid; used only to determine output size and starting mask ID (grid max + 1). Grid lists are handled per-item by the DataTree engine.",
      "label": "输入网格"
    },
    {
      "name": "regions",
      "type": "string",
      "defaultValue": "[]",
      "description": "Region descriptors as JSON string or array. Each item: [x, y, area, height]. x/y = seed point (col/row), area = target cell count, height = elevation passed through to nameList.height for renderer auto-processing.",
      "label": "区域定义",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Random seed; 0 uses current timestamp. Each zone derives its own seed offset.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "access": "item",
      "description": "Single multi-value grid: each zone gets an increasing id, 0 elsewhere; pipe to grid_split_by_value to separate zones.",
      "label": "区域网格"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "access": "item",
      "description": "Name list as [{id, name: '区域 N', type: 'tile', height}], aligned with the ids in the grid.",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
