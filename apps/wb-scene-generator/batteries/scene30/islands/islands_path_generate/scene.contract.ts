// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "islandsPathGenerate",
  "contractVersion": "1.0.0",
  "opId": "islands_path_generate",
  "description": "Generates random-walk dirt paths over walkable areas to shape island exploration routes.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Refined island terrain.",
      "label": "输入地形"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed controlling path routing.",
      "label": "随机种子",
      "mode": "parameter"
    },
    {
      "name": "pathCount",
      "type": "number",
      "defaultValue": 6,
      "description": "Number of independent dirt paths to attempt.",
      "label": "路径数量",
      "mode": "parameter"
    },
    {
      "name": "stepMin",
      "type": "number",
      "defaultValue": 20,
      "description": "Minimum random-walk steps per path.",
      "label": "最短步数",
      "mode": "parameter"
    },
    {
      "name": "stepMax",
      "type": "number",
      "defaultValue": 60,
      "description": "Maximum random-walk steps per path.",
      "label": "最长步数",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "description": "Island terrain after dirt paths are added.",
      "label": "带路径地形"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "description": "Name list for the path-enriched terrain.",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
