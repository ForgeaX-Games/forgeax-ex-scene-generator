// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "poiPlace",
  "contractVersion": "2.0.0",
  "opId": "poi_place",
  "description": "Places POI points at given coordinates; if a coordinate does not match the target value, BFS searches the entire grid for the nearest valid cells and randomly picks one.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "access": "item",
      "description": "Single input grid (number[][]); grid lists are handled per-item by the DataTree engine.",
      "label": "输入网格"
    },
    {
      "name": "poiRules",
      "type": "array",
      "description": "Array of POI rules; simplified [[\"name\", targetValue, [x1,y1], ...], ...]; legacy [{decoration, targetValue, points}] also accepted.",
      "label": "POI规则列表"
    },
    {
      "name": "minDistance",
      "type": "number",
      "access": "item",
      "defaultValue": 8,
      "description": "Minimum cell distance between all placed POI points.",
      "label": "最小间距",
      "mode": "parameter"
    },
    {
      "name": "scatterR",
      "type": "number",
      "access": "item",
      "defaultValue": 5,
      "description": "Extra radius for random scatter around the nearest valid cell (0 = exact snap).",
      "label": "散播半径",
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
      "description": "Single multi-value grid: each POI type gets an increasing id, 0 elsewhere; pipe to grid_split_by_value to separate.",
      "label": "输出网格"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "access": "item",
      "description": "Name list for POI ids actually present in the grid: [{id, name, type}], type is always \"asset\".",
      "label": "名称清单"
    },
    {
      "name": "placedCount",
      "type": "number",
      "access": "item",
      "description": "Total number of POI points successfully placed.",
      "label": "成功放置数量"
    }
  ],
  "deterministic": true
})
