// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "sceneRandomPoint",
  "contractVersion": "1.1.1",
  "opId": "scene_random_point",
  "description": "Randomly fills a specified number of points in the grid with a given fill value.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "access": "item",
      "description": "Input 2D integer grid.",
      "label": "输入网格"
    },
    {
      "name": "count",
      "type": "number",
      "defaultValue": 10,
      "description": "Number of points to randomly fill.",
      "label": "点位数量",
      "mode": "parameter"
    },
    {
      "name": "fillValue",
      "type": "number",
      "defaultValue": 1,
      "description": "Value to fill into the selected cells.",
      "label": "填充值",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses system random (different each run).",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "access": "item",
      "description": "Output grid with randomly filled points.",
      "label": "输出网格"
    }
  ],
  "deterministic": true
})
