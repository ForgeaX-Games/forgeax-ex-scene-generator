// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "islandsResourceScatter",
  "contractVersion": "1.0.0",
  "opId": "islands_resource_scatter",
  "description": "Scatters food items from the final island terrain and extracts shore-adjacent water sources.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Final island terrain grid.",
      "label": "输入地形"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed controlling food scattering.",
      "label": "随机种子",
      "mode": "parameter"
    },
    {
      "name": "foodDensityScale",
      "type": "number",
      "defaultValue": 1,
      "description": "Multiplier for food spawn probabilities.",
      "label": "食物密度倍率",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "description": "Pass-through final terrain.",
      "label": "地形透传"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "description": "Name list for the final terrain.",
      "label": "名称清单"
    },
    {
      "name": "resourceGrid",
      "type": "grid",
      "description": "Single resource grid encoding food points and shore-adjacent water sources.",
      "label": "资源网格"
    },
    {
      "name": "resourceNameList",
      "type": "array",
      "description": "Resource name list corresponding to the resource grid.",
      "label": "资源清单"
    }
  ],
  "deterministic": true
})
