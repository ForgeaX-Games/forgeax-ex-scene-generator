// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "poiScatter",
  "contractVersion": "2.0.0",
  "opId": "poi_scatter",
  "description": "Randomly scatters Points of Interest onto cells matching specified target values; supports single grid, multi-value grid, and grid-list inputs, preserving the input format in output.",
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
      "description": "Array of POI rules; simplified [{name: \"targetValue:count:minDistance\"}, ...] e.g. [{\"cave\": \"7:4:12\"}]; legacy {decoration, targetValue, count, minDistance} also accepted.",
      "label": "POI规则列表"
    },
    {
      "name": "assetNames",
      "type": "array",
      "access": "item",
      "description": "POI asset names, index-aligned with poiRules. Single: a plain name; batch: [a,b], \"a,b\" or \"a;b\". Empty falls back to each rule's own name.",
      "label": "资产名"
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
      "name": "outputAssetNames",
      "type": "string",
      "access": "list",
      "description": "Per-placed-POI asset names in row-major order, exactly matching the point list produced by alg_field2points; feed straight into a downstream scene_set_attribute.",
      "label": "逐点资产名"
    },
    {
      "name": "placedCount",
      "type": "number",
      "access": "item",
      "description": "Total number of POI points successfully placed across all rules.",
      "label": "成功放置数量"
    }
  ],
  "deterministic": true
})
