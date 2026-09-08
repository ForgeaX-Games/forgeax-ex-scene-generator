// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "genBleedingForest",
  "contractVersion": "2.0.0",
  "opId": "gen_bleeding_forest",
  "description": "Cellular automata forest generator with organic clearings, bioluminescent glow spots, dark pools, and random-walk paths. Decors, portal and spawn point are encoded as mask IDs in the grid.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "array",
      "defaultValue": [],
      "description": "Input grid or list of grids. When provided, width/height are derived from the first grid in the list. Accepts a single grid (2D array) or a list of grids (3D array).",
      "label": "输入网格"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses current timestamp.",
      "label": "随机种子",
      "mode": "parameter"
    },
    {
      "name": "iterations",
      "type": "number",
      "defaultValue": 9,
      "description": "Cellular automata iteration count, 1-10; more iterations create smoother clearings.",
      "label": "CA迭代次数",
      "mode": "parameter"
    },
    {
      "name": "fillRatio",
      "type": "number",
      "defaultValue": 0.51,
      "description": "Initial fill ratio for dense forest, 0.3-0.8; higher values create denser forest.",
      "label": "初始密度",
      "mode": "parameter"
    },
    {
      "name": "pathCount",
      "type": "number",
      "defaultValue": 9,
      "description": "Number of random-walk paths carved to connect clearings.",
      "label": "路径数量",
      "mode": "parameter"
    },
    {
      "name": "poolCount",
      "type": "number",
      "defaultValue": 19,
      "description": "Number of dark pool clusters placed in the map.",
      "label": "暗池数量",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGridList",
      "type": "array",
      "description": "List of single-value grids, one per mask ID (1 where that mask appears, 0 elsewhere).",
      "label": "输出网格列表"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "description": "Mask ID to Chinese name mapping list with type field (asset or tile), only IDs that appear in the grid.",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
